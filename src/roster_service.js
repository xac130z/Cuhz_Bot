'use strict';

// ============================================================================
//  CUHZ Bot — Roster sync service (Wave 6 self-serve join)
//
//  Makes the planetcuhz.com self-serve flow real: a streamer requests CUHZ Bot
//  on the website, the site records an `approved` bot_request, and THIS module
//  reconciles that desired-state against the channels CUHZ Bot is actually in —
//  auto-joining approved channels and parting revoked ones.
//
//  It polls the site's `bot-worker-sync` edge function (~30s, jittered) for the
//  desired channel list, computes join/part deltas vs the currently-joined
//  roster, paces joins within Twitch limits, and reports lifecycle events back.
//
//  HARD LAWS:
//   - Default-OFF: nothing runs unless config.enableRosterSync (ENABLE_ROSTER_SYNC=true).
//   - Fail-open ALWAYS: if the site is unreachable/misconfigured we KEEP the
//     current roster, never crash, and retry with backoff. A site outage must
//     never part a channel or take the bot down.
//   - PROTECTED env channels: any channel in TWITCH_CHANNEL_NAME is never parted
//     by roster-sync, even if it is absent from desired-state.
//   - Honest states: joined-via-roster channels are the Basic/free experience
//     (they are NOT added to CHANNEL_TIERS) — no Pro/Premium surfaces are granted.
//   - Contract field names EXACTLY mirror bot-worker-sync:
//       GET  -> { channels: [ { id, twitch_user_id, twitch_login, status,
//                               is_mod, channel_bot_granted, can_send,
//                               blocked_reason, last_seen_at } ] }   (status in approved|active)
//       POST { id, event:'joined', twitch_login, is_mod, can_send }
//       POST { id, event:'parted' }
//       POST { id, event:'error', message }
//       POST { event:'heartbeat', ids:[...] }        (batch, <=500 ids)
//   - NO crypto, anywhere.
// ============================================================================

const config = require('./config');
const logger = require('./logger');
const db = require('./database');

// --- Tunables ---------------------------------------------------------------
const POLL_BASE_MS = 30 * 1000;            // desired-state poll cadence
const POLL_JITTER_MS = 5 * 1000;           // +[0,5s) jitter so restarts don't sync up
const POLL_BACKOFF_MAX_MS = 5 * 60 * 1000; // cap exponential poll backoff at 5 min
const HEARTBEAT_MS = 60 * 1000;            // batch heartbeat cadence
const INITIAL_DELAY_MS = 8 * 1000;         // let IRC connect before the first reconcile
const REQUEST_TIMEOUT_MS = 5 * 1000;       // hard network timeout per call
const JOIN_WINDOW_MS = 10 * 1000;          // Twitch JOIN rate window
const MAX_JOINS_PER_WINDOW = 15;           // <=15 JOINs / 10s (conservative vs Twitch's ~20)
const JOIN_BACKOFF_BASE_MS = 60 * 1000;    // per-channel join backoff after a failure
const JOIN_BACKOFF_MAX_MS = 30 * 60 * 1000;
const LOGIN_RE = /^[a-z0-9_]{2,25}$/;

// Mirrors bot-worker-sync's VALID_BLOCKED_REASONS. Kept so a future send-health
// path can validate before reporting; roster-sync itself only emits join/part/error.
const VALID_BLOCKED_REASONS = new Set([
    'cap', 'followers_only', 'subs_only',
    'verified_phone_required', 'verified_email', 'ratelimit', 'banned'
]);

// Mutable knobs (tests tighten spacing / per-cycle caps to run fast).
const TUNING = {
    joinSpacingMs: 400,     // spacing between JOINs inside one reconcile cycle
    maxJoinsPerCycle: 10    // cap new joins per reconcile so first-run doesn't burst
};

// --- State ------------------------------------------------------------------
let _started = false;
let _pollTimer = null;
let _heartbeatTimer = null;
let _pollFails = 0;                 // consecutive desired-state fetch failures (drives backoff)
let _reconciling = false;          // guard against overlapping cycles
let _activeIds = [];               // ids of desired channels we're joined to (heartbeat targets)

let _joinFn = null;                // (channel) => Promise   (client.join)
let _partFn = null;                // (channel) => Promise   (client.part)
let _getJoined = () => [];         // () => string[] joined channel names (# prefixed)
let _protected = new Set();        // bare env logins — NEVER parted

const _roster = new Map();         // bare login -> { id }  (channels WE joined via roster)
const _joinTimestamps = [];        // sliding window of JOIN send times (rate pacing)
const _joinBackoff = new Map();    // bare login -> { until, fails }

// Network seam — real by default, overridable by tests for hermetic runs.
let _netGetDesired = getDesired;
let _netPostEvent = postEvent;

// --- Helpers ----------------------------------------------------------------
function normalizeLogin(x) {
    const l = String(x == null ? '' : x).toLowerCase().replace(/^#/, '').replace(/^@/, '').trim();
    return LOGIN_RE.test(l) ? l : null;
}

function bareLogin(channel) {
    return String(channel == null ? '' : channel).toLowerCase().replace(/^#/, '').trim();
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Join pacing ------------------------------------------------------------
function pruneJoinWindow() {
    const cutoff = Date.now() - JOIN_WINDOW_MS;
    while (_joinTimestamps.length && _joinTimestamps[0] <= cutoff) _joinTimestamps.shift();
}

/** True while fewer than MAX_JOINS_PER_WINDOW JOINs were sent in the last 10s. */
function canJoinNow() {
    pruneJoinWindow();
    return _joinTimestamps.length < MAX_JOINS_PER_WINDOW;
}

function recordJoinAttempt() {
    _joinTimestamps.push(Date.now());
}

function isCoolingDown(login) {
    const b = _joinBackoff.get(login);
    return !!(b && b.until > Date.now());
}

function bumpBackoff(login) {
    const prev = _joinBackoff.get(login) || { fails: 0 };
    const fails = prev.fails + 1;
    const wait = Math.min(JOIN_BACKOFF_BASE_MS * Math.pow(2, fails - 1), JOIN_BACKOFF_MAX_MS);
    _joinBackoff.set(login, { until: Date.now() + wait, fails });
}

function clearBackoff(login) {
    _joinBackoff.delete(login);
}

// --- Delta computation (pure) -----------------------------------------------
// Given desired-state rows, the currently-joined channel list, the protected env
// set, and the persisted roster, decide what to join / confirm / part and which
// ids to heartbeat. Pure + side-effect free so it is trivially testable.
//
//   toJoin    — desired & NOT joined            -> client.join + POST joined
//   toConfirm — desired & joined & status 'approved' (e.g. an env channel that was
//               requested on the site): no IRC join, just POST joined so the site
//               flips it to 'active'. Idempotent — stops once status is 'active'.
//   toPart    — in our roster, NOT desired, NOT protected -> client.part + POST parted
//   heartbeatIds — desired & joined (site rows to keep last_seen_at fresh)
function computeDelta({ desired, joined, protectedSet, roster }) {
    const prot = protectedSet instanceof Set
        ? protectedSet
        : new Set([...(protectedSet || [])].map(bareLogin).filter(Boolean));

    const joinedSet = new Set([...(joined || [])].map(bareLogin).filter(Boolean));

    const desiredByLogin = new Map();
    for (const row of (desired || [])) {
        const login = normalizeLogin(row && row.twitch_login);
        if (!login) continue;
        if (row.id === undefined || row.id === null || row.id === '') continue;
        desiredByLogin.set(login, row);
    }

    const toJoin = [];
    const toConfirm = [];
    const heartbeatIds = [];
    for (const [login, row] of desiredByLogin) {
        const id = String(row.id);
        if (joinedSet.has(login)) {
            heartbeatIds.push(id);
            if (row.status === 'approved') toConfirm.push({ id, login });
        } else {
            toJoin.push({ id, login, status: String(row.status || '') });
        }
    }

    // Roster entries as [login, { id }]
    const rosterEntries = roster instanceof Map
        ? [...roster.entries()]
        : [...(roster || [])].map((l) => [bareLogin(l), {}]);

    const toPart = [];
    for (const [login, info] of rosterEntries) {
        if (desiredByLogin.has(login)) continue;   // still wanted
        if (prot.has(login)) continue;             // PROTECTED — never part
        toPart.push({ id: info && info.id ? String(info.id) : null, login });
    }

    return { toJoin, toConfirm, toPart, heartbeatIds };
}

// --- Persistence (sqlite/pg via db adapter, like announced_purchases) -------
async function loadRoster() {
    try {
        const rows = await db.prepare('SELECT twitch_login, request_id FROM roster_channels').all();
        for (const r of (rows || [])) {
            const login = normalizeLogin(r.twitch_login);
            if (login) _roster.set(login, { id: r.request_id ? String(r.request_id) : null });
        }
        logger.info(`🛰️ roster-sync loaded ${_roster.size} persisted channel(s)`);
    } catch (err) {
        logger.warn(`roster-sync loadRoster error: ${err && err.message}`);
    }
}

async function persistRoster(login, id) {
    // Delete+insert = dialect-safe upsert across sqlite and Postgres.
    try {
        await db.prepare('DELETE FROM roster_channels WHERE twitch_login = ?').run(login);
        await db.prepare('INSERT INTO roster_channels (twitch_login, request_id) VALUES (?, ?)')
            .run(login, id ? String(id) : null);
    } catch (err) {
        logger.warn(`roster-sync persist error for ${login}: ${err && err.message}`);
    }
}

async function unpersistRoster(login) {
    try {
        await db.prepare('DELETE FROM roster_channels WHERE twitch_login = ?').run(login);
    } catch (err) {
        logger.warn(`roster-sync unpersist error for ${login}: ${err && err.message}`);
    }
}

// --- Network ----------------------------------------------------------------
function functionsBase() {
    return String(config.siteApiUrl || '').replace(/\/+$/, '');
}

async function getDesired() {
    if (!config.siteApiUrl || !config.siteApiSecret) {
        throw new Error('SITE_API_URL/SITE_API_SECRET not configured');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${functionsBase()}/bot-worker-sync`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${config.siteApiSecret}` },
            signal: controller.signal
        });
        if (!res.ok) throw new Error(`site responded ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

async function postEvent(body) {
    if (!config.siteApiUrl || !config.siteApiSecret) {
        throw new Error('SITE_API_URL/SITE_API_SECRET not configured');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${functionsBase()}/bot-worker-sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.siteApiSecret}`
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        if (!res.ok) throw new Error(`site responded ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

// --- Execution --------------------------------------------------------------
async function doJoin(item) {
    const channel = `#${item.login}`;
    recordJoinAttempt(); // count the JOIN we're about to send toward the rate window
    try {
        await _joinFn(channel);
    } catch (err) {
        bumpBackoff(item.login);
        logger.warn(`roster-sync join failed #${item.login}: ${err && err.message}`);
        // Report the failure so the site can surface it to the streamer.
        await _netPostEvent({
            id: item.id,
            event: 'error',
            message: `join failed: ${(err && err.message) ? String(err.message).slice(0, 400) : 'unknown'}`
        }).catch(() => {});
        return false;
    }
    _roster.set(item.login, { id: item.id });
    await persistRoster(item.login, item.id);
    clearBackoff(item.login);
    // is_mod=false: honest — we are not a mod on a fresh join. can_send=true: a
    // normal IRC join can post; the send-health path (out of scope here) narrows it.
    await _netPostEvent({
        id: item.id,
        event: 'joined',
        twitch_login: item.login,
        is_mod: false,
        can_send: true
    }).catch((err) => logger.warn(`roster-sync joined report failed #${item.login}: ${err && err.message}`));
    logger.info(`🛰️ roster-sync joined #${item.login}`);
    return true;
}

async function executeJoins(toJoin) {
    let count = 0;
    for (const item of toJoin) {
        if (count >= TUNING.maxJoinsPerCycle) break; // spread the rest over later cycles
        if (!canJoinNow()) break;                    // respect the 10s JOIN window
        if (isCoolingDown(item.login)) continue;     // per-channel backoff after failures
        const ok = await doJoin(item);
        if (ok) count++;
        if (TUNING.joinSpacingMs > 0) await delay(TUNING.joinSpacingMs);
    }
    return count;
}

async function executeConfirms(toConfirm) {
    // Cheap POSTs (no IRC join) that flip an already-joined 'approved' row to
    // 'active'. Cap per cycle for politeness; the rest flush next cycle.
    let n = 0;
    for (const item of toConfirm) {
        if (n >= TUNING.maxJoinsPerCycle) break;
        await _netPostEvent({
            id: item.id,
            event: 'joined',
            twitch_login: item.login,
            is_mod: false,
            can_send: true
        }).catch((err) => logger.warn(`roster-sync confirm failed #${item.login}: ${err && err.message}`));
        n++;
    }
    return n;
}

async function executeParts(toPart) {
    for (const item of toPart) {
        const channel = `#${item.login}`;
        try {
            await _partFn(channel);
        } catch (err) {
            // Part failure is non-fatal — drop it from our roster anyway so we
            // don't keep trying, and still report the lifecycle event.
            logger.warn(`roster-sync part failed #${item.login}: ${err && err.message}`);
        }
        _roster.delete(item.login);
        await unpersistRoster(item.login);
        if (item.id) {
            // No message: the site treats a parted 'revoked' row as an expected
            // no-op (the streamer removed the bot); anything else it records honestly.
            await _netPostEvent({ id: item.id, event: 'parted' })
                .catch((err) => logger.warn(`roster-sync parted report failed #${item.login}: ${err && err.message}`));
        }
        logger.info(`🛰️ roster-sync parted #${item.login}`);
    }
}

// --- Reconcile + poll loop --------------------------------------------------
async function reconcile() {
    if (!config.enableRosterSync) return;
    if (!config.siteApiUrl || !config.siteApiSecret) return;
    if (_reconciling) return;
    _reconciling = true;
    try {
        let data;
        try {
            data = await _netGetDesired();
        } catch (err) {
            // FAIL-OPEN: keep the current roster untouched, bump backoff, retry later.
            _pollFails++;
            logger.warn(`roster-sync desired-state fetch failed (fail-open, keeping roster): ${err && err.message}`);
            return;
        }
        _pollFails = 0;

        const desired = (data && Array.isArray(data.channels)) ? data.channels : [];
        const joined = _getJoined ? (_getJoined() || []) : [];
        const delta = computeDelta({ desired, joined, protectedSet: _protected, roster: _roster });

        // Hygiene: a channel that became protected (added to env) must leave the
        // roster so we never treat it as roster-owned again.
        for (const login of [..._roster.keys()]) {
            if (_protected.has(login)) {
                _roster.delete(login);
                await unpersistRoster(login);
            }
        }

        _activeIds = delta.heartbeatIds;

        await executeJoins(delta.toJoin);
        await executeConfirms(delta.toConfirm);
        await executeParts(delta.toPart);
    } finally {
        _reconciling = false;
    }
}

function scheduleNextPoll() {
    if (!config.enableRosterSync) return;
    const backoff = _pollFails > 0
        ? Math.min(POLL_BASE_MS * Math.pow(2, _pollFails), POLL_BACKOFF_MAX_MS)
        : POLL_BASE_MS;
    const wait = backoff + Math.floor(Math.random() * POLL_JITTER_MS);
    _pollTimer = setTimeout(runPoll, wait);
    if (_pollTimer.unref) _pollTimer.unref();
}

async function runPoll() {
    try {
        await reconcile();
    } catch (err) {
        logger.warn(`roster-sync poll error: ${err && err.message}`);
    } finally {
        scheduleNextPoll();
    }
}

async function runHeartbeat() {
    if (!config.enableRosterSync) return;
    if (!config.siteApiUrl || !config.siteApiSecret) return;
    const ids = _activeIds.slice(0, 500);
    if (ids.length === 0) return;
    try {
        await _netPostEvent({ event: 'heartbeat', ids });
    } catch (err) {
        logger.warn(`roster-sync heartbeat failed: ${err && err.message}`);
    }
}

/**
 * Start roster-sync. Safe to call once at startup regardless of flag state —
 * when ENABLE_ROSTER_SYNC is off, no timers are scheduled and nothing polls.
 * @param {{
 *   client?: object,
 *   join?: (channel: string) => Promise<any>,
 *   part?: (channel: string) => Promise<any>,
 *   getJoined?: () => string[],
 *   protectedChannels?: string[]   // env TWITCH_CHANNEL_NAME channels — never parted
 * }} deps
 */
function start(deps) {
    if (_started) return;
    _started = true;
    deps = deps || {};

    const client = deps.client || null;
    _joinFn = deps.join || (client ? (ch) => client.join(ch) : null);
    _partFn = deps.part || (client ? (ch) => client.part(ch) : null);
    _getJoined = deps.getJoined || (client ? () => client.getChannels() : () => []);
    _protected = new Set((deps.protectedChannels || []).map(bareLogin).filter(Boolean));

    if (!config.enableRosterSync) {
        logger.info('🛰️ roster-sync disabled (ENABLE_ROSTER_SYNC=false) — no channels auto-joined');
        return;
    }
    if (!config.siteApiUrl || !config.siteApiSecret) {
        logger.warn('🛰️ roster-sync enabled but SITE_API_URL/SITE_API_SECRET unset — staying idle (fail-open)');
        return;
    }
    if (!_joinFn || !_partFn) {
        logger.warn('🛰️ roster-sync enabled but no join/part client wired — staying idle');
        return;
    }

    loadRoster().catch(() => {});

    _pollTimer = setTimeout(runPoll, INITIAL_DELAY_MS + Math.floor(Math.random() * POLL_JITTER_MS));
    if (_pollTimer.unref) _pollTimer.unref();
    _heartbeatTimer = setInterval(() => {
        runHeartbeat().catch((err) => logger.warn(`roster-sync heartbeat error: ${err && err.message}`));
    }, HEARTBEAT_MS);
    if (_heartbeatTimer.unref) _heartbeatTimer.unref();

    logger.info(`🛰️ roster-sync started (poll ~${POLL_BASE_MS / 1000}s jittered, <=${MAX_JOINS_PER_WINDOW} joins/${JOIN_WINDOW_MS / 1000}s, protected: ${[..._protected].join(', ') || 'none'})`);
}

module.exports = {
    start,
    reconcile,
    computeDelta,
    // Exposed for tests / internal reuse:
    _internal: {
        computeDelta,
        normalizeLogin,
        bareLogin,
        canJoinNow,
        pruneJoinWindow,
        recordJoinAttempt,
        isCoolingDown,
        bumpBackoff,
        clearBackoff,
        executeJoins,
        executeParts,
        executeConfirms,
        runHeartbeat,
        VALID_BLOCKED_REASONS,
        TUNING,
        _roster,
        _joinTimestamps,
        _joinBackoff,
        // Test seams:
        setNet: ({ getDesired: gd, postEvent: pe } = {}) => {
            if (gd) _netGetDesired = gd;
            if (pe) _netPostEvent = pe;
        },
        setDeps: ({ join, part, getJoined, protectedChannels } = {}) => {
            if (join) _joinFn = join;
            if (part) _partFn = part;
            if (getJoined) _getJoined = getJoined;
            if (protectedChannels) _protected = new Set(protectedChannels.map(bareLogin).filter(Boolean));
        },
        getActiveIds: () => _activeIds.slice(),
        reset: () => {
            _joinTimestamps.length = 0;
            _joinBackoff.clear();
            _roster.clear();
            _activeIds = [];
            _pollFails = 0;
            _reconciling = false;
            _protected = new Set();
            _netGetDesired = getDesired;
            _netPostEvent = postEvent;
            TUNING.joinSpacingMs = 400;
            TUNING.maxJoinsPerCycle = 10;
        }
    }
};
