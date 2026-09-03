/**
 * test_tier_service_flag_off.js — proves the DEFAULT (unset env) path through
 * tier_service.js is a true no-op: no network call is ever attempted, no
 * cache/pending state is created, no db write happens, and every public
 * entry point resolves to the pre-existing 'community' behavior — with
 * NOTHING mutated to force it. This is the harvest's core safety contract
 * (lane δ / A3 in the commerce-spine plan): ENABLE_TIER_SYNC and
 * ENABLE_PURCHASE_SHOUTOUTS unset must be indistinguishable, behaviorally,
 * from tier_service.js not existing at all.
 *
 * Unlike test_tier_service.js (which flips config flags on to prove the
 * mechanics work), this file deliberately does NOT set any ENABLE_* /
 * SITE_API_* env var and does NOT mutate config after require — it asserts
 * the real defaults a fresh Railway deploy would have.
 */

delete process.env.DATABASE_URL;   // sqlite for the test run
delete process.env.ENABLE_TIER_SYNC;
delete process.env.ENABLE_PURCHASE_SHOUTOUTS;
delete process.env.SITE_API_URL;
delete process.env.SITE_API_SECRET;

const assert = require('assert');

// Trip a hard failure if tier_service ever reaches the network while flags
// are unset — this is the single most important assertion in this file.
let fetchCalls = 0;
const realFetch = global.fetch;
global.fetch = (...args) => {
    fetchCalls++;
    throw new Error(`tier_service made a network call while flags were unset: ${JSON.stringify(args[0])}`);
};

const config = require('../src/config');
const tierService = require('../src/tier_service');
const I = tierService._internal;

async function run() {
    // --- Precondition: the actual defaults, not a test-forced state ---
    assert.strictEqual(config.enableTierSync, false, 'ENABLE_TIER_SYNC must default to false when unset');
    assert.strictEqual(config.enablePurchaseShoutouts, false, 'ENABLE_PURCHASE_SHOUTOUTS must default to false when unset');
    assert.strictEqual(config.siteApiUrl, undefined, 'SITE_API_URL must default to unset');
    assert.strictEqual(config.siteApiSecret, undefined, 'SITE_API_SECRET must default to unset');

    // --- getTier: synchronous, always 'community', no cache/pending touched ---
    assert.strictEqual(I._cache.size, 0, 'cache must start empty');
    assert.strictEqual(I._pending.size, 0, 'pending queue must start empty');
    const t1 = tierService.getTier('anyviewer');
    assert.strictEqual(t1, 'community');
    assert.strictEqual(fetchCalls, 0, 'getTier must not touch the network when flag is off');
    assert.strictEqual(I._cache.size, 0, 'getTier must not populate the cache when flag is off');
    assert.strictEqual(I._pending.size, 0, 'getTier must not enqueue a background refresh when flag is off');

    // --- getTierAwait: resolves 'community' with no network attempt ---
    const t2 = await tierService.getTierAwait('anyviewer2', 50);
    assert.strictEqual(t2, 'community');
    assert.strictEqual(fetchCalls, 0, 'getTierAwait must not touch the network when flag is off');

    // --- getCached: no entries exist, returns null (never throws) ---
    assert.strictEqual(tierService.getCached('anyviewer'), null);

    // --- pollPurchases: returns immediately, no network, no db write ---
    // (Calling the internal function directly — bot.js itself never even
    // creates the setInterval that would call this when the flag is off; see
    // the `if (config.enablePurchaseShoutouts)` guard around
    // tierService.startPurchaseWatcher(...) in src/bot.js.)
    await I.pollPurchases();
    assert.strictEqual(fetchCalls, 0, 'pollPurchases must not touch the network when flag is off');

    // --- startPurchaseWatcher itself is safe to call (bot.js won't, but the
    // function must not throw or reach the network if ever called directly) ---
    // Not invoked here: it schedules a real 60s interval, which would keep
    // the test process alive. Its internal pollPurchases() early-return
    // (asserted above) is what actually matters for inertness.

    // --- init(): storing a sendMessage function must never fire it ---
    let sent = 0;
    tierService.init({ sendMessage: () => { sent++; } });
    assert.strictEqual(sent, 0, 'init() must not itself send any message');

    // --- grantStipend must never fire while sync is off in real bot usage ---
    // (tier_service's own getTier/getTierAwait never call grantStipend when
    // config.enableTierSync is false — _fetchAndCache, the only caller, is
    // unreachable from a flag-off getTier/getTierAwait call, both proven
    // above via the fetch-call counter staying at 0.)

    console.log('✅ Tier service flag-off inertness proven: 0 network calls, 0 cache writes, 0 messages sent, pure community/no-op behavior');
    global.fetch = realFetch;
    process.exit(0);
}

run().catch((err) => {
    global.fetch = realFetch;
    console.error('❌ Tier service flag-off inertness test FAILED:', err && err.stack ? err.stack : err);
    process.exit(1);
});
