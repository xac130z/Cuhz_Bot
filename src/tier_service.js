'use strict';

// ============================================================================
//  CUHZ Bot — channel plan service (Wave 6 stream commerce)
//
//  Resolves the current Twitch channel's CUHZ Bot plan from the Planet Cuhz
//  site's `bot-worker-sync` edge function and polls a verified purchase feed for
//  consent-gated thank-yous. Entitlements are channel-scoped: callers must pass
//  the broadcaster/channel login, never the chatter login.
//
//  HARD LAWS:
//   - Fail-open ALWAYS: any error, timeout, missing config, or disabled flag
//     resolves to 'community'. Chat is NEVER blocked or delayed by the site.
//   - Honest states only: an unknown channel is 'community'. We never claim a
//     payment state from chat; plans come only from the DB via the site.
//   - Gated by config.enableTierSync — when off, resolution is pure 'community'.
//   - Request/response field names EXACTLY mirror the bot-worker-sync events:
//       POST { event:'entitlements', logins:[...] }
//         -> { viewers: { login: { products:[...], bot_tier:'...' } } }
//       POST { event:'entitlements_recent', since:'ISO' }
//         -> { purchases: [ { entitlement_id, twitch_login, product, created_at } ] }
//
//  External-contract limitation: the existing payload field/table key remains
//  `twitch_login`; the producer must store the entitled CHANNEL login there.
//  Reinterpreting that existing key avoids a schema migration safely.
// ============================================================================

const config = require('./config');
const logger = require('./logger');
const db = require('./database');
const commerceContent = require('./commerce_content');

// --- Tunables ---------------------------------------------------------------
const CACHE_TTL_TIER_MS = 10 * 60 * 1000;      // paid plans cached 10 min
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

// Stored SKU compatibility is deliberately broader than the public catalog.
// bot_affiliate and the old `affiliate` plan value are legacy aliases for Partner.
const PRODUCT_META = Object.freeze({
    bot_community: { plan: 'community', label: 'Community' },
    bot_silver: { plan: 'silver', label: 'Silver' },
    bot_gold: { plan: 'gold', label: 'Gold' },
    bot_partner: { plan: 'partner', label: 'Partner' },
    bot_affiliate: { plan: 'partner', label: 'Partner' },
    bot_architect: { plan: 'architect', label: 'Architect' }
});

// --- State ------------------------------------------------------------------
const _cache = new Map();     // login -> { tier, products, fetchedAt }
const _pending = new Map();   // channel login -> null
let _flushTimer = null;
let _sendMessage = null;      // injected bot.js sender
let _watcherStarted = false;
let _watcherCtx = {};
let _cursor = null;           // ISO string; persisted via announced_purchases
let _lastShoutoutAt = 0;

// --- Helpers ----------------------------------------------------------------
function normalize(login) {
    const l = String(login || '').toLowerCase().replace(/^[#@]/, '').trim();
    return LOGIN_RE.test(l) ? l : null;
}

function ttlFor(plan) {
    return plan !== 'community' ? CACHE_TTL_TIER_MS : CACHE_TTL_COMMUNITY_MS;
}

function normalizePlan(value) {
    const plan = String(value || '').toLowerCase().trim();
    if (plan === 'affiliate' || plan === 'bot_affiliate') return 'partner';
    return ['community', 'silver', 'gold', 'partner', 'architect'].includes(plan)
        ? plan
        : 'community';
}

// Backwards-compatible internal name for older callers/tests.
const normalizeTier = normalizePlan;

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

// --- Batch lookup -----------------------------------------------------------
// POSTs entitlements and updates the cache. Returns a Map<channel login, plan>.
// Retired viewer stipends are intentionally not granted here.
// (callers catch and fail open).
async function _fetchAndCache(logins) {
    const result = new Map();
    if (logins.length === 0) return result;
    const data = await postSite({ event: 'entitlements', logins });
    const viewers = (data && data.viewers) || {};
    const now = Date.now();
    for (const l of logins) {
        const v = viewers[l] || { products: [], bot_tier: 'community' };
        const tier = normalizePlan(v.bot_plan || v.bot_tier);
        const products = Array.isArray(v.products) ? v.products : [];
        setCache(l, { tier, products, fetchedAt: now });
        result.set(l, tier);

    }
    return result;
}

function enqueue(login) {
    if (!_pending.has(login)) _pending.set(login, null);
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
    try {
        await _fetchAndCache(logins);
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
 * @param {string} login Twitch channel/broadcaster login
 * @returns {'community'|'silver'|'gold'|'partner'|'architect'}
 */
function getChannelPlan(login) {
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
    enqueue(l);
    return entry ? entry.tier : 'community';
}

/**
 * Fresh tier lookup with a short budget (for !mytier, Gold arrival). Fails open
 * to the last-known tier (or 'community') on timeout/error. The underlying fetch
 * still completes and warms the cache in the background.
 * @returns {Promise<'community'|'silver'|'gold'|'partner'|'architect'>}
 */
async function getChannelPlanAwait(login, ms = AWAIT_DEFAULT_MS) {
    if (!config.enableTierSync) return 'community';
    const l = normalize(login);
    if (!l) return 'community';
    const cached = getCached(l);
    if (cached) return cached.tier;
    const fallbackEntry = _cache.get(l);
    const fallback = fallbackEntry ? fallbackEntry.tier : 'community';
    try {
        const fetchP = _fetchAndCache([l]);
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

        // Unknown/non-celebratable product or too old → record
        // silently so the cursor advances; say nothing. These never consume the
        // 5-min announcement slot.
        const celebratable = meta && (meta.plan === 'silver' || meta.plan === 'gold');
        if (!celebratable || (createdAt && ageMs > SHOUTOUT_MAX_AGE_MS)) {
            await recordAnnounced(entitlementId, login, product, createdAt);
            advanceCursor(createdAt);
            continue;
        }

        // Rate limit: at most one thank-you per 5 min. If gated, STOP — leave this
        // and any newer purchases un-recorded so they retry next poll (order kept).
        if (nowMs - _lastShoutoutAt < SHOUTOUT_MIN_INTERVAL_MS) break;

        const prevTier = (_cache.get(login) || {}).tier || null;
        const isUpgrade = meta.plan === 'gold' && prevTier === 'silver';

        // An entitlement belongs only to the Twitch channel whose login is on the
        // record. Never fan a purchase out to unrelated live channels.
        const matchingChannels = liveHome.filter((ch) => normalize(ch) === login);
        for (const ch of matchingChannels) {
            const present = !!(typeof ctx.hasChatted === 'function' && ctx.hasChatted(ch, login));
            let line;
            if (isUpgrade && present) line = commerceContent.upgradeLine(login);
            else if (present) line = commerceContent.namedThankYou(login, meta.plan);
            else line = commerceContent.genericThankYou(meta.plan);
            if (line && typeof ctx.sendMessage === 'function') ctx.sendMessage(ch, line);
            else if (line && _sendMessage) _sendMessage(ch, line);
        }
        if (matchingChannels.length > 0) _lastShoutoutAt = nowMs;

        // Reflect the new tier so future getTier is fresh + upgrade detection works.
        setCache(login, { tier: meta.plan, products: [product], fetchedAt: Date.now() });

        await recordAnnounced(entitlementId, login, product, createdAt);
        advanceCursor(createdAt);
        break; // one announcement per poll cycle
    }
}

/**
 * Start the 60s purchase-feed poller. Gated by config.enablePurchaseShoutouts
 * (checked inside pollPurchases) and live-gated via ctx.isLive. Safe to call
 * once at startup regardless of flag state.
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

/** Wire the bot's queue-routed sender. */
function init(deps) {
    if (deps && typeof deps.sendMessage === 'function') _sendMessage = deps.sendMessage;
}

module.exports = {
    init,
    getChannelPlan,
    getChannelPlanAwait,
    // Legacy method names remain API-compatible, but their argument is now
    // explicitly the channel login rather than an individual viewer.
    getTier: getChannelPlan,
    getTierAwait: getChannelPlanAwait,
    getCached,
    startPurchaseWatcher,
    // Exposed for tests / internal reuse:
    _internal: {
        normalize,
        ttlFor,
        normalizeTier,
        setCache,
        getCached,

        flush,
        pollPurchases,
        PRODUCT_META,
        _cache,
        _pending,
        setSender: (fn) => { _sendMessage = fn; }
    }
};
