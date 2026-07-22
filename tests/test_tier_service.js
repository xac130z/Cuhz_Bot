const assert = require('assert');
const config = require('../src/config');
const tierService = require('../src/tier_service');

const I = tierService._internal;

async function run() {
    // --- login normalization ---
    assert.strictEqual(I.normalize('SomeCuhz'), 'somecuhz');
    assert.strictEqual(I.normalize('@SomeCuhz'), 'somecuhz');
    assert.strictEqual(I.normalize('bad name!'), null);
    assert.strictEqual(I.normalize('x'), null); // too short (LOGIN_RE min 2)
    assert.strictEqual(I.normalize(''), null);

    // --- tier normalization (server is source of truth; anything else = community) ---
    assert.strictEqual(I.normalizeTier('gold'), 'gold');
    assert.strictEqual(I.normalizeTier('silver'), 'silver');
    assert.strictEqual(I.normalizeTier('community'), 'community');
    assert.strictEqual(I.normalizeTier('affiliate'), 'community');
    assert.strictEqual(I.normalizeTier(undefined), 'community');

    // --- TTL constants: paid tiers cached longer than community ---
    assert.ok(I.ttlFor('gold') > I.ttlFor('community'));
    assert.ok(I.ttlFor('silver') > I.ttlFor('community'));

    // --- cache TTL behavior: fresh returns tier, expired returns null ---
    I.setCache('freshgold', { tier: 'gold', products: ['bot_gold'], fetchedAt: Date.now() });
    assert.strictEqual(I.getCached('freshgold').tier, 'gold');

    // Aged past the gold TTL (10 min) -> expired -> null.
    I.setCache('stalegold', { tier: 'gold', products: ['bot_gold'], fetchedAt: Date.now() - (11 * 60 * 1000) });
    assert.strictEqual(I.getCached('stalegold'), null);

    // Community aged past its shorter 5-min TTL -> expired.
    I.setCache('stalecomm', { tier: 'community', products: [], fetchedAt: Date.now() - (6 * 60 * 1000) });
    assert.strictEqual(I.getCached('stalecomm'), null);

    // --- getTier is a pure 'community' when tier sync is OFF (secure default) ---
    config.enableTierSync = false;
    assert.strictEqual(tierService.getTier('freshgold'), 'community', 'flag off must ignore cache and return community');

    // --- fail-open: sync ON but site unconfigured -> getTierAwait resolves community, never throws ---
    config.enableTierSync = true;
    const savedUrl = config.siteApiUrl;
    const savedSecret = config.siteApiSecret;
    config.siteApiUrl = undefined;
    config.siteApiSecret = undefined;
    const failOpen = await tierService.getTierAwait('nevercuhz', 300);
    assert.strictEqual(failOpen, 'community', 'unconfigured site must fail open to community');
    // getTier with sync on but site unconfigured still returns community synchronously (miss -> community).
    assert.strictEqual(tierService.getTier('nevercuhz2'), 'community');
    config.siteApiUrl = savedUrl;
    config.siteApiSecret = savedSecret;
    config.enableTierSync = false;

    // --- stipend reason string is stable per calendar month + tier ---
    const d = new Date(Date.UTC(2026, 6, 21)); // 2026-07
    assert.strictEqual(I.stipendReason('gold', d), 'tier_bonus_2026_07_gold');
    assert.strictEqual(I.stipendReason('silver', d), 'tier_bonus_2026_07_silver');

    // --- stipend announce copy is honest + tier-correct (no $, no crypto) ---
    const goldLine = I.buildStipendLine('cuhzy', 'gold', I.STIPEND_AMOUNTS.gold);
    assert.match(goldLine, /\+5,000 CUHZ points @cuhzy/);
    assert.doesNotMatch(goldLine, /\$/);
    const silverLine = I.buildStipendLine('cuhzy', 'silver', I.STIPEND_AMOUNTS.silver);
    assert.match(silverLine, /\+1,000 CUHZ points @cuhzy/);

    // --- product meta: affiliate is a purchase but NOT a viewer tier ---
    assert.strictEqual(I.PRODUCT_META.bot_gold.tier, 'gold');
    assert.strictEqual(I.PRODUCT_META.bot_silver.tier, 'silver');
    assert.strictEqual(I.PRODUCT_META.bot_affiliate.tier, 'community');

    // --- stipend idempotency: claimBonus grants once per (login, month, tier) ---
    // Uses the real points ledger with a unique login so the run is deterministic.
    let sends = 0;
    I.setSender((_channel, _text) => { sends++; });
    const uniqueLogin = `stipendtest_${Date.now()}`;
    const first = await I.grantStipend(uniqueLogin, 'gold', '#test');
    const second = await I.grantStipend(uniqueLogin, 'gold', '#test');
    assert.strictEqual(first, true, 'first stipend must grant');
    assert.strictEqual(second, false, 'second stipend in same month must NOT grant (idempotent)');
    assert.strictEqual(sends, 1, 'stipend must announce exactly once');

    console.log('✅ Tier service tests passed');
    // The DB adapter (sqlite) holds no open interval; allow a clean exit.
    process.exit(0);
}

run().catch((err) => {
    console.error('❌ Tier service tests FAILED:', err && err.stack ? err.stack : err);
    process.exit(1);
});
