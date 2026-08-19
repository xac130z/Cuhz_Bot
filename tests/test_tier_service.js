const assert = require('assert');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const tierService = require('../src/tier_service');

const I = tierService._internal;

async function run() {
    // Channel/login normalization accepts Twitch's channel prefix.
    assert.strictEqual(I.normalize('SomeCuhz'), 'somecuhz');
    assert.strictEqual(I.normalize('@SomeCuhz'), 'somecuhz');
    assert.strictEqual(I.normalize('#SomeCuhz'), 'somecuhz');
    assert.strictEqual(I.normalize('bad name!'), null);
    assert.strictEqual(I.normalize('x'), null);

    // Public plans plus the retained Partner aliases normalize deterministically.
    for (const plan of ['community', 'silver', 'gold', 'partner', 'architect']) {
        assert.strictEqual(I.normalizeTier(plan), plan);
    }
    assert.strictEqual(I.normalizeTier('affiliate'), 'partner');
    assert.strictEqual(I.normalizeTier('bot_affiliate'), 'partner');
    assert.strictEqual(I.normalizeTier('unknown'), 'community');

    // Every paid channel plan gets the longer cache TTL.
    for (const plan of ['silver', 'gold', 'partner', 'architect']) {
        assert.ok(I.ttlFor(plan) > I.ttlFor('community'));
    }

    config.enableTierSync = true;
    I._cache.clear();

    // The cache key is the broadcaster/channel login. Two unrelated viewers in
    // one paid channel therefore resolve exactly the same channel plan.
    I.setCache('paid_channel', { tier: 'gold', products: ['bot_gold'], fetchedAt: Date.now() });
    const viewerOne = 'viewer_one';
    const viewerTwo = 'viewer_two';
    const planSeenBy = (_viewer) => tierService.getChannelPlan('paid_channel');
    assert.notStrictEqual(viewerOne, viewerTwo);
    assert.strictEqual(planSeenBy(viewerOne), 'gold');
    assert.strictEqual(planSeenBy(viewerTwo), 'gold');
    assert.strictEqual(tierService.getChannelPlan('#paid_channel'), 'gold');

    // A paid viewer/owner in another channel cannot elevate this Basic channel:
    // only the current broadcaster login is looked up.
    I.setCache('paid_viewer_elsewhere', { tier: 'partner', products: ['bot_affiliate'], fetchedAt: Date.now() });
    I.setCache('basic_channel', { tier: 'community', products: [], fetchedAt: Date.now() });
    assert.strictEqual(tierService.getChannelPlan('basic_channel'), 'community');
    assert.strictEqual(tierService.getChannelPlan('paid_viewer_elsewhere'), 'partner');

    // Feature-off remains a fail-open Community result even with paid cache data.
    config.enableTierSync = false;
    assert.strictEqual(tierService.getChannelPlan('paid_channel'), 'community');

    // Network/config failure also fails open without throwing.
    config.enableTierSync = true;
    const savedUrl = config.siteApiUrl;
    const savedSecret = config.siteApiSecret;
    config.siteApiUrl = undefined;
    config.siteApiSecret = undefined;
    assert.strictEqual(await tierService.getChannelPlanAwait('uncached_channel', 100), 'community');
    config.siteApiUrl = savedUrl;
    config.siteApiSecret = savedSecret;

    // Stored SKU compatibility: old Affiliate records are publicly Partner.
    assert.strictEqual(I.PRODUCT_META.bot_partner.plan, 'partner');
    assert.strictEqual(I.PRODUCT_META.bot_affiliate.plan, 'partner');
    assert.strictEqual(I.PRODUCT_META.bot_affiliate.label, 'Partner');
    assert.strictEqual(I.PRODUCT_META.bot_architect.plan, 'architect');

    // Retired monthly viewer stipends are structurally disabled: no amount table,
    // grant function, points-service import, or claimBonus call remains.
    assert.strictEqual(I.STIPEND_AMOUNTS, undefined);
    assert.strictEqual(I.grantStipend, undefined);
    const source = fs.readFileSync(path.join(__dirname, '../src/tier_service.js'), 'utf8');
    assert.doesNotMatch(source, /claimBonus|points_service|Monthly .*stipend|STIPEND_AMOUNTS/);

    // Bot runtime must resolve by channel login, not chatter login, and must not
    // retain retired viewer discount/badge/priority branches.
    const botSource = fs.readFileSync(path.join(__dirname, '../src/bot.js'), 'utf8');
    assert.match(botSource, /getChannelPlan\(channelLogin\)/);
    assert.match(botSource, /getChannelPlanAwait\(channelLogin\)/);
    assert.doesNotMatch(botSource, /viewerTier|getTier\(viewerLogin|ASK_BRAIN_SILVER|Verified Cuhz badge/);

    config.enableTierSync = false;
    console.log('✅ Tier service tests passed');
    process.exit(0);
}

run().catch((err) => {
    console.error('❌ Tier service tests FAILED:', err && err.stack ? err.stack : err);
    process.exit(1);
});
