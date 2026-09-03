/**
 * test_tier_service.js — adapted from the stranded feature/stream-commerce-
 * tier-sync branch's tests/test_tier_service.js, with copy assertions updated
 * to ladder-v2 canon (Silver/Gold, no "Supporter"/"Executive" suffix).
 *
 * Exercises tier_service.js WITH the flags turned on (mutating the shared
 * config object directly, same pattern the source test used) to prove the
 * mechanics work. The dedicated flag-OFF/no-op proof lives in
 * tests/test_tier_service_flag_off.js — keep both; they check different
 * things (mechanics-when-enabled vs. inertness-when-disabled).
 */

// Force SQLite mode for testing (claimBonus/stipend test needs a real ledger).
delete process.env.DATABASE_URL;

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

    // --- stipend announce copy is honest + ladder-v2 canon-correct (no $, no
    // crypto, and no pre-ladder-v2 "Supporter"/"Executive" suffix) ---
    const goldLine = I.buildStipendLine('cuhzy', 'gold', I.STIPEND_AMOUNTS.gold);
    assert.match(goldLine, /\+5,000 CUHZ points @cuhzy/);
    assert.doesNotMatch(goldLine, /\$/);
    assert.doesNotMatch(goldLine, /Executive|Supporter/);
    const silverLine = I.buildStipendLine('cuhzy', 'silver', I.STIPEND_AMOUNTS.silver);
    assert.match(silverLine, /\+1,000 CUHZ points @cuhzy/);
    assert.doesNotMatch(silverLine, /Executive|Supporter/);

    // --- thank-you / upgrade copy: canon labels, no retired "Affiliate Pack" vocab ---
    assert.strictEqual(I.genericThankYou('gold'), '🎉 Somebody just went Gold on the Planet — CUHZ fam growing 💜');
    assert.strictEqual(I.namedThankYou('CuhzFan', 'silver'), '🎉 @CuhzFan just went Silver 🥈 Welcome to the fam cuhz');
    assert.match(I.upgradeLine('CuhzFan'), /Silver → Gold/);
    for (const line of [I.genericThankYou('silver'), I.genericThankYou('gold'), I.namedThankYou('x', 'gold'), I.upgradeLine('x')]) {
        assert.doesNotMatch(line, /\$/, 'thank-you copy must never quote a price');
        assert.doesNotMatch(line, /Executive|Supporter|Affiliate Pack/, 'thank-you copy must use ladder-v2 labels only');
    }

    // --- product meta: Partner (formerly "Affiliate Pack") is a purchase but NOT a viewer tier ---
    assert.strictEqual(I.PRODUCT_META.bot_gold.tier, 'gold');
    assert.strictEqual(I.PRODUCT_META.bot_silver.tier, 'silver');
    assert.strictEqual(I.PRODUCT_META.bot_affiliate.tier, 'community');
    assert.strictEqual(I.PRODUCT_META.bot_affiliate.label, 'Partner');
    assert.strictEqual(I.PRODUCT_META.bot_partner.tier, 'community');
    assert.notStrictEqual(I.PRODUCT_META.bot_affiliate.label, 'Affiliate Pack', 'retired ladder-v1 label must not resurface');

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
