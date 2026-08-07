'use strict';

// ============================================================================
//  CUHZ Bot — Viewer tier entitlement engine (harvested from the stranded
//  feature/stream-commerce-tier-sync branch, ADAPTED to ladder-v2 canon).
//
//  Resolves a viewer's PAID bot tier (community | silver | gold) from the
//  Planet Cuhz site's `bot-worker-sync` edge function, grants the promised
//  monthly point stipends, and polls a verified purchase feed for
//  consent-gated thank-yous.
//
//  SHIP STATUS: lands strictly INERT. Every entry point below checks its
//  governing flag FIRST and short-circuits to the pre-existing behavior
//  (community tier / no network call / no db write / no chat line) when that
//  flag is unset. Nothing in this file runs unless an owner sets
//  ENABLE_TIER_SYNC=true (stipends) and/or ENABLE_PURCHASE_SHOUTOUTS=true
//  (thank-yous) in Railway. See tests/test_tier_service_flag_off.js for the
//  proof.
//
//  ADAPTED FROM SOURCE (Cuhz_Bot@feature/stream-commerce-tier-sync, 16
//  commits behind ladder-v2 at harvest time):
//   - Stipend/thank-you copy no longer says "Silver Supporter" / "Gold
//     Executive" (pre-ladder-v2 naming) — it says "Silver" / "Gold", matching
//     the current PLAN_DETAILS copy in bot.js.
//   - The commerce_content.js dependency (full !plans/!silver/!gold/!affiliate
//     command family + periodic promo pool) was NOT ported. That registry is
//     stale relative to ladder-v2 (still says "Affiliate Pack $49.99/mo",
//     which is now "Partner"; !discord/!store etc. also duplicate commands
//     that already exist in this bot.js). Only the three small copy helpers
//     tier_service.js itself needs (stipend line, generic/named thank-you,
//     upgrade line) are reproduced here, inline, with canon-correct labels.
//     Porting the full commerce-command surface is out of scope for this
//     lane (earn/perk-grant only, no new commands) and is flagged in the PR
//     as a follow-up requiring an owner copy review.
//   - config field names (siteApiUrl/siteApiSecret/enableTierSync/
//     enablePurchaseShoutouts) added to src/config.js in this same PR,
//     matching the source branch's names exactly (no rename needed there).
//   - pointsService.claimBonus(username, bonusType, amount) already matches
//     the call shape this file expects — no adapter needed. NOTE: main's
//     claimBonus does a check-then-insert (not a single atomic statement); a
//     same-tick double call for the *same* user has a narrow race window.
//     For a once-a-month stipend this is a low-severity, low-probability
//     gap (unlike a hot spend path) but is called out here for the owner —
//     if lane α's atomic deductPoints work lands a matching atomic
//     claimBonus, this file needs no changes to benefit from it.
//   - announced_purchases table added to src/database.js schema in this PR
//     (both sqlite + postgres dialects), copied from the source branch as-is.
//   - STIPEND_AMOUNTS (silver: 1000, gold: 5000 points/month) are carried
//     over UNCHANGED from the source branch. This is a NEW mechanic — no
//     current ladder-v2 copy advertises a stipend amount — so these numbers
//     are not yet "owner-locked canon" the way POINT_REWARDS costs are. They
//     are left untouched (not invented, not altered) per the no-price-edits
//     rule; the owner should confirm/publish them before flipping
//     ENABLE_TIER_SYNC.
//
//  HARD LAWS (unchanged from source):
//   - Fail-open ALWAYS: any error, timeout, missing config, or disabled flag
//     resolves to 'community'. Chat is NEVER blocked or delayed by the site.
//   - Honest states only: an unknown viewer is 'community'. We never claim a
//     payment state from chat; tiers come only from the DB via the site.
//   - Gated by config.enableTierSync — when off, getTier is a pure 'community'.
//   - Request/response field names EXACTLY mirror the bot-worker-sync events:
//       POST { event:'entitlements', logins:[...] }
//         -> { viewers: { login: { products:[...], bot_tier:'gold'|'silver'|'community' } } }
//       POST { event:'entitlements_recent', since:'ISO' }
//         -> { purchases: [ { entitlement_id, twitch_login, product, created_at } ] }
// ============================================================================

const config = require('./config');
const logger = require('./logger');
const db = require('./database');
const pointsService = require('./points_service');

// --- Tunables ---------------------------------------------------------------
const CACHE_TTL_TIER_MS = 10 * 60 * 1000;      // paid tiers cached 10 min
const CACHE_TTL_COMMUNITY_MS = 5 * 60 * 1000;  // community/unknown 5 min (fresh purchase surfaces fast)
const CACHE_MAX_ENTRIES = 5000;
const BATCH_FLUSH_MS = 5000;                   // batch flushes every 5s
const BATCH_MAX = 25;                          // ...or when 25 logins are queued
const SITE_MAX_LOGINS = 100;                   // server caps at 100/call
const REQUEST_TIMEOUT_MS = 3000;               // hard 3s network timeout
const AWAIT_DEFAULT_MS = 1500;                 // getTierAwait budget
const PURCHASE_POLL_MS = 60 * 1000;            // purchase watcher cadence
const SHOUTOUT_MIN_INTERVAL_MS = 5 * 60 * 1000; // max 1 thank-you / 5 min
const SHOUTOUT_MAX_AGE_MS = 30 * 60 * 1000;    // drop a queued thank-you after 30 min
const LOGIN_RE = /^[a-z0-9_]{2,25}$/;

const STIPEND_AMOUNTS = Object.freeze({ silver: 1000, gold: 5000 });

// product -> { tier, label }. bot_affiliate/bot_partner is a STREAMER SKU: it
// is a real purchase but not a viewer tier, so it is never celebrated as a
// viewer thank-you. Both legacy and current product keys are mapped —
// harvest-time uncertainty: this file has no visibility into what SKU key
// the live bot-worker-sync function currently emits for the Partner plan
// (renamed from "Affiliate Pack" in ladder-v2), so both are recognized
// defensively. Fail-open means an unrecognized key just never celebrates —
// never a crash, never a wrong tier.
const PRODUCT_META = Object.freeze({
    bot_silver: { tier: 'silver', label: 'Silver' },
    bot_gold: { tier: 'gold', label: 'Gold' },
    bot_affiliate: { tier: 'community', label: 'Partner' },
    bot_partner: { tier: 'community', label: 'Partner' }
});

// --- Inline copy (replaces the source branch's commerce_content.js dep) -----
// Only the three lines tier_service.js itself needs. Canon-correct labels
// ("Silver" / "Gold" — no "Supporter"/"Executive" suffix, matching bot.js's
// PLAN_DETAILS). No prices here — this module never quotes a dollar amount.
function _cleanUser(user) {
    return String(user || '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
}
const GENERIC_THANKS = Object.freeze({
    silver: '🎉 Somebody just went Silver on the Planet — CUHZ fam growing 💜',
    gold: '🎉 Somebody just went Gold on the Planet — CUHZ fam growing 💜'
});
const NAMED_THANKS = Object.freeze({
    silver: '🎉 @{user} just went Silver 🥈 Welcome to the fam cuhz',
    gold: '🎉 @{user} just went Gold 💎 Welcome to the upper orbit cuhz'
});
const UPGRADE_LINE = '🚀 @{user} leveled UP — Silver → Gold 💎';
function genericThankYou(tier) {
    return GENERIC_THANKS[tier] || null;
}
function namedThankYou(user, tier) {
    const tpl = NAMED_THANKS[tier];
    return tpl ? tpl.replace('{user}', _cleanUser(user)) : null;
}
function upgradeLine(user) {
    return UPGRADE_LINE.replace('{user}', _cleanUser(user));
}

// --- State ------------------------------------------------------------------
const _cache = new Map();     // login -> { tier, products, fetchedAt }
const _pending = new Map();   // login -> channel (for stipend announce context)
let _flushTimer = null;
let _sendMessage = null;      // injected bot.js sender
let _watcherStarted = false;
let _watcherCtx = {};
let _cursor = null;           // ISO string; persisted via announced_purchases
let _lastShoutoutAt = 0;

// --- Helpers ----------------------------------------------------------------
function normalize(login) {
    const l = String(login || '').toLowerCase().replace(/^@/, '').trim();
    return LOGIN_RE.test(l) ? l : null;
}

function ttlFor(tier) {
    return (tier === 'silver' || tier === 'gold') ? CACHE_TTL_TIER_MS : CACHE_TTL_COMMUNITY_MS;
}

function normalizeTier(t) {
    return (t === 'gold' || t === 'silver') ? t : 'community';
}

function setCache(login, value) {
    _cache.delete(login);
    _cache.set(login, value);
    if (_cache.size > CACHE_MAX_ENTRIES) {
        // LRU-ish: drop the oldest-inserted entries.
        const overflow = _cache.size - CACHE_MAX_ENTRIES;
        let i = 0;
        for (const k of _cache.keys()) {
            _cache.delete(k);
            if (++i >= overflow) break;
        }
    }
}

/** Returns a fresh cached { tier, products } or null if missing/expired. */
function getCached(login) {
    const l = normalize(login);
    if (!l) return null;
    const entry = _cache.get(l);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt >= ttlFor(entry.tier)) return null;
    // touch recency
    _cache.delete(l);
    _cache.set(l, entry);
    return { tier: entry.tier, products: entry.products };
}

function stipendReason(tier, date) {
    const ym = `${date.getUTCFullYear()}_${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    return `tier_bonus_${ym}_${tier}`;
}

function buildStipendLine(login, tier, amount) {
    const label = tier === 'gold' ? 'Gold' : 'Silver';
    const emoji = tier === 'gold' ? '💎' : '🥈';
    return `${emoji} Monthly ${label} stipend landed: +${amount.toLocaleString('en-US')} CUHZ points @${login}`;
}

// --- Network ----------------------------------------------------------------
function functionsBase() {
    return String(config.siteApiUrl || '').replace(/\/+$/, '');
}

async function postSite(body) {
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

// --- Stipend ----------------------------------------------------------------
// Idempotent per calendar month via pointsService.claimBonus (unique reason).
// Announces at most once (only when the grant actually happened AND we have a
// channel + sender). Returns whether the grant fired this call.
async function grantStipend(login, tier, channel) {
    try {
        const amount = STIPEND_AMOUNTS[tier];
        if (!amount) return false;
        const granted = await pointsService.claimBonus(login, stipendReason(tier, new Date()), amount);
        if (granted && channel && _sendMessage) {
            _sendMessage(channel, buildStipendLine(login, tier, amount));
        }
        return granted;
    } catch (err) {
        logger.warn(`tier_service stipend error for ${login}: ${err && err.message}`);
        return false;
    }
}

// --- Batch lookup -----------------------------------------------------------
// POSTs entitlements, updates the cache, and fires stipends. Returns a
// Map<login, tier> for the resolved logins. Throws only on network failure
// (callers catch and fail open).
async function _fetchAndCache(logins, channelByLogin) {
    const result = new Map();
    if (logins.length === 0) return result;
    const data = await postSite({ event: 'entitlements', logins });
    const viewers = (data && data.viewers) || {};
    const now = Date.now();
    for (const l of logins) {
        const v = viewers[l] || { products: [], bot_tier: 'community' };
        const tier = normalizeTier(v.bot_tier);
        const products = Array.isArray(v.products) ? v.products : [];
        setCache(l, { tier, products, fetchedAt: now });
        result.set(l, tier);
        if (tier === 'silver' || tier === 'gold') {
            grantStipend(l, tier, channelByLogin ? channelByLogin.get(l) : null).catch(() => {});
        }
    }
    return result;
}

function enqueue(login, channel) {
    if (channel) _pending.set(login, channel);
    else if (!_pending.has(login)) _pending.set(login, null);
    if (_pending.size >= BATCH_MAX) {
        flush();
        return;
    }
    if (!_flushTimer) _flushTimer = setTimeout(flush, BATCH_FLUSH_MS);
}

async function flush() {
    if (_flushTimer) {
        clearTimeout(_flushTimer);
        _flushTimer = null;
    }
    if (_pending.size === 0) return;
    const batch = [..._pending.entries()].slice(0, SITE_MAX_LOGINS);
    for (const [l] of batch) _pending.delete(l);
    const logins = batch.map(([l]) => l);
    const channelByLogin = new Map(batch);
    try {
        await _fetchAndCache(logins, channelByLogin);
    } catch (err) {
        // Fail-open: cache nothing; the next lookup re-enqueues. Chat is unaffected.
        logger.warn(`tier_service batch lookup failed (fail-open community): ${err && err.message}`);
    }
    if (_pending.size > 0 && !_flushTimer) _flushTimer = setTimeout(flush, BATCH_FLUSH_MS);
}

// --- Public: tier resolution ------------------------------------------------

/**
 * Synchronous, cached tier lookup for the hot dispatch path. Returns instantly:
 * a fresh cached tier, or 'community' on a miss while enqueuing a background
 * refresh. Never throws, never awaits, never blocks chat.
 *
 * INERT WHEN ENABLE_TIER_SYNC IS UNSET: returns 'community' immediately, does
 * not touch the cache, does not enqueue, does not schedule a flush timer.
 * @param {string} login  twitch login
 * @param {string} [channel]  channel for stipend-announce context
 * @returns {'community'|'silver'|'gold'}
 */
function getTier(login, channel) {
    if (!config.enableTierSync) return 'community';
    const l = normalize(login);
    if (!l) return 'community';
    const entry = _cache.get(l);
    const now = Date.now();
    if (entry && (now - entry.fetchedAt) < ttlFor(entry.tier)) {
        _cache.delete(l);
        _cache.set(l, entry);
        return entry.tier;
    }
    // Miss or stale → refresh in the background. Serve last-known (stale-while-
    // revalidate) if we have it, else community.
    enqueue(l, channel);
    return entry ? entry.tier : 'community';
}

/**
 * Fresh tier lookup with a short budget (for !mytier, Gold arrival). Fails open
 * to the last-known tier (or 'community') on timeout/error. The underlying fetch
 * still completes and warms the cache in the background.
 *
 * INERT WHEN ENABLE_TIER_SYNC IS UNSET: returns 'community' immediately, no
 * network call is attempted.
 * @returns {Promise<'community'|'silver'|'gold'>}
 */
async function getTierAwait(login, ms = AWAIT_DEFAULT_MS) {
    if (!config.enableTierSync) return 'community';
    const l = normalize(login);
    if (!l) return 'community';
    const cached = getCached(l);
    if (cached) return cached.tier;
    const fallbackEntry = _cache.get(l);
    const fallback = fallbackEntry ? fallbackEntry.tier : 'community';
    try {
        const fetchP = _fetchAndCache([l], null);
        // Swallow a late rejection if the timeout wins the race (fetch still warms
        // the cache in the background on success) — prevents an unhandled rejection.
        fetchP.catch(() => {});
        const result = await Promise.race([
            fetchP,
            new Promise((resolve) => setTimeout(() => resolve(null), ms))
        ]);
        if (result && result.get(l) !== undefined) return result.get(l);
        return fallback;
    } catch (err) {
        return fallback;
    }
}

// --- Purchase watcher (thank-yous) ------------------------------------------

async function loadCursor() {
    try {
        const row = await db
            .prepare('SELECT created_at FROM announced_purchases ORDER BY created_at DESC LIMIT 1')
            .get();
        return (row && row.created_at) ? String(row.created_at) : new Date().toISOString();
    } catch (err) {
        return new Date().toISOString();
    }
}

function advanceCursor(createdAt) {
    if (createdAt && (!_cursor || String(createdAt) > _cursor)) _cursor = String(createdAt);
}

async function recordAnnounced(entitlementId, login, product, createdAt) {
    try {
        await db.prepare(
            'INSERT INTO announced_purchases (entitlement_id, twitch_login, product, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'
        ).run(entitlementId, login, product, createdAt);
    } catch (err) {
        logger.warn(`tier_service recordAnnounced error: ${err && err.message}`);
    }
}

async function pollPurchases() {
    if (!config.enablePurchaseShoutouts) return;
    if (!config.siteApiUrl || !config.siteApiSecret) return;
    const ctx = _watcherCtx || {};

    // Only while at least one home channel is actually live.
    const homeChannels = Array.isArray(ctx.homeChannels) ? ctx.homeChannels : [];
    const liveHome = homeChannels.filter((ch) => typeof ctx.isLive === 'function' && ctx.isLive(ch));
    if (liveHome.length === 0) return;

    const since = _cursor || new Date(Date.now() - PURCHASE_POLL_MS).toISOString();
    let data;
    try {
        data = await postSite({ event: 'entitlements_recent', since });
    } catch (err) {
        logger.warn(`tier_service entitlements_recent failed: ${err && err.message}`);
        return;
    }

    const purchases = (data && Array.isArray(data.purchases)) ? data.purchases.slice() : [];
    // Oldest-first (the site orders this way; be defensive).
    purchases.sort((a, b) => String(a && a.created_at).localeCompare(String(b && b.created_at)));

    for (const p of purchases) {
        const entitlementId = p && p.entitlement_id ? String(p.entitlement_id) : '';
        const login = normalize(p && p.twitch_login);
        const product = p && p.product ? String(p.product) : '';
        const createdAt = p && p.created_at ? String(p.created_at) : null;
        if (!entitlementId || !login) continue;

        // Dedupe (defensive; the cursor already excludes recorded rows).
        let seen = null;
        try {
            seen = await db
                .prepare('SELECT entitlement_id FROM announced_purchases WHERE entitlement_id = ?')
                .get(entitlementId);
        } catch (_) { seen = null; }
        if (seen) { advanceCursor(createdAt); continue; }

        const meta = PRODUCT_META[product];
        const nowMs = Date.now();
        const ageMs = createdAt ? (nowMs - Date.parse(createdAt)) : 0;

        // Unknown product, non-celebratable SKU (Partner), or too old → record
        // silently so the cursor advances; say nothing. These never consume the
        // 5-min announcement slot.
        const celebratable = meta && (meta.tier === 'silver' || meta.tier === 'gold');
        if (!celebratable || (createdAt && ageMs > SHOUTOUT_MAX_AGE_MS)) {
            await recordAnnounced(entitlementId, login, product, createdAt);
            advanceCursor(createdAt);
            continue;
        }

        // Rate limit: at most one thank-you per 5 min. If gated, STOP — leave this
        // and any newer purchases un-recorded so they retry next poll (order kept).
        if (nowMs - _lastShoutoutAt < SHOUTOUT_MIN_INTERVAL_MS) break;

        const prevTier = (_cache.get(login) || {}).tier || null;
        const isUpgrade = meta.tier === 'gold' && prevTier === 'silver';

        for (const ch of liveHome) {
            const present = !!(typeof ctx.hasChatted === 'function' && ctx.hasChatted(ch, login));
            let line;
            if (isUpgrade && present) line = upgradeLine(login);
            else if (present) line = namedThankYou(login, meta.tier);
            else line = genericThankYou(meta.tier);
            if (line && typeof ctx.sendMessage === 'function') ctx.sendMessage(ch, line);
            else if (line && _sendMessage) _sendMessage(ch, line);
        }
        _lastShoutoutAt = nowMs;

        // Reflect the new tier so future getTier is fresh + upgrade detection works.
        setCache(login, { tier: meta.tier, products: [product], fetchedAt: Date.now() });

        await recordAnnounced(entitlementId, login, product, createdAt);
        advanceCursor(createdAt);
        break; // one announcement per poll cycle
    }
}

/**
 * Start the 60s purchase-feed poller. Gated by config.enablePurchaseShoutouts
 * (checked inside pollPurchases) and live-gated via ctx.isLive. Safe to call
 * once at startup regardless of flag state.
 *
 * CALLERS SHOULD STILL GATE THE CALL SITE: bot.js only calls this when
 * config.enablePurchaseShoutouts is true, so the 60s setInterval is never
 * created at all in the default-off deploy (belt + suspenders on top of the
 * internal pollPurchases() flag check).
 * @param {{ homeChannels?: string[], isLive?: Function, hasChatted?: Function, sendMessage?: Function }} ctx
 */
function startPurchaseWatcher(ctx) {
    if (_watcherStarted) return;
    _watcherStarted = true;
    _watcherCtx = ctx || {};
    loadCursor().then((c) => { _cursor = c; }).catch(() => { _cursor = new Date().toISOString(); });
    const timer = setInterval(() => {
        pollPurchases().catch((err) => logger.warn(`tier_service purchase poll error: ${err && err.message}`));
    }, PURCHASE_POLL_MS);
    if (timer.unref) timer.unref();
    logger.info('🛰️ CUHZ Bot purchase watcher started (60s poll, live-gated, dedupe-persisted)');
}

/** Wire the bot's queue-routed sender (used for stipend announcements). */
function init(deps) {
    if (deps && typeof deps.sendMessage === 'function') _sendMessage = deps.sendMessage;
}

module.exports = {
    init,
    getTier,
    getTierAwait,
    getCached,
    startPurchaseWatcher,
    // Exposed for tests / internal reuse:
    _internal: {
        normalize,
        ttlFor,
        normalizeTier,
        setCache,
        getCached,
        stipendReason,
        buildStipendLine,
        grantStipend,
        flush,
        pollPurchases,
        STIPEND_AMOUNTS,
        PRODUCT_META,
        genericThankYou,
        namedThankYou,
        upgradeLine,
        _cache,
        _pending,
        setSender: (fn) => { _sendMessage = fn; }
    }
};
