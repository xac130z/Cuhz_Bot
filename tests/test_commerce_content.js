const assert = require('assert');
const fs = require('fs');
const path = require('path');
const commerce = require('../src/commerce_content');
const policy = require('../src/safety_policy');

// Fake urgency / scarcity language that must NEVER appear in commerce copy.
const FORBIDDEN_URGENCY = [
    'hurry', 'act now', 'act fast', 'last chance', 'limited time', 'limited-time',
    'expires', 'ends soon', 'only today', 'today only', 'while supplies last',
    'urgent', 'flash sale', 'countdown', 'running out', 'few left', 'selling fast',
    "don't miss out", 'don’t miss out'
];

// NO crypto, anywhere — ever.
const FORBIDDEN_CRYPTO = ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'wallet', ' nft', 'seed phrase'];

// Retired public product names and viewer-subscription framing must never leak
// into emitted copy. Internal entitlement keys remain unchanged elsewhere.
const FORBIDDEN_STALE_COMMERCE = [
    'silver supporter', 'gold executive', 'affiliate pack', 'pricing#bot',
    "you're silver", "you’re silver", "you're gold", "you’re gold",
    'community tier', 'viewer tier', 'viewer plan'
];

const PRICING_URL = 'https://planetcuhz.com/pricing';
const BOT_ONBOARDING_URL = 'https://planetcuhz.com/bot';
const ARCHITECT_QUOTE_URL = 'https://planetcuhz.com/solutions#start';

function everyLine() {
    // Every customer-facing string the registry can emit, rendered.
    const lines = [];
    for (const v of Object.values(commerce.COMMERCE_COMMANDS)) lines.push(v);
    for (const tier of ['architect', 'partner', 'gold', 'silver', 'community']) lines.push(commerce.myTierLine(tier, 'testcuhz'));
    for (const l of commerce.PROMO_LINES) lines.push(l);
    for (const l of commerce.GOLD_ARRIVAL) lines.push(`${l} @testcuhz 💎`);
    for (const tier of ['silver', 'gold']) {
        lines.push(commerce.genericThankYou(tier));
        lines.push(commerce.namedThankYou('testcuhz', tier));
    }
    lines.push(commerce.upgradeLine('testcuhz'));
    return lines;
}

function run() {
    const lines = everyLine();

    for (const line of lines) {
        assert.ok(typeof line === 'string' && line.length > 0, 'line must be a non-empty string');
        assert.ok(line.length < 500, `line exceeds Twitch limit: ${line}`);

        // 1. Passes the outbound safety gate as a deterministic bot reply.
        const checked = policy.validateOutbound(line, { source: 'bot' });
        assert.strictEqual(checked.allowed, true, `validateOutbound blocked: ${line} (${checked.reason})`);

        // 2. Every URL is on the approved allowlist.
        for (const url of policy.extractUrls(line)) {
            assert.strictEqual(policy.isApprovedUrl(url), true, `unapproved URL in: ${line} -> ${url}`);
        }

        // 3. No fake urgency / scarcity language.
        const lower = line.toLowerCase();
        for (const bad of FORBIDDEN_URGENCY) {
            assert.ok(!lower.includes(bad), `urgency language "${bad}" found in: ${line}`);
        }

        // 4. No crypto, ever.
        for (const bad of FORBIDDEN_CRYPTO) {
            assert.ok(!lower.includes(bad), `crypto term "${bad}" found in: ${line}`);
        }

        // 4b. The retired created.app chain generator never resurfaces in
        // commerce copy — the Chain Studio lives at planetcuhz.com/chain.
        assert.ok(!lower.includes('created.app'), `stale created.app link found in: ${line}`);

        // 4c. No retired public names or viewer-plan framing.
        for (const bad of FORBIDDEN_STALE_COMMERCE) {
            assert.ok(!lower.includes(bad), `stale commerce wording "${bad}" found in: ${line}`);
        }
    }

    // 5. Customer-facing spelling is "CUHZ Bot".
    assert.match(commerce.COMMERCE_COMMANDS['!plans'], /CUHZ Bot/);

    // 6. Lock the exact live catalog, scopes, and canonical purchase guidance.
    const plans = commerce.COMMERCE_COMMANDS['!plans'];
    for (const exact of [
        'Free $0', 'Pro $9.99/mo', 'Team $24.99/mo',
        'Community free', 'Silver $4.99/mo', 'Gold $14.99/mo',
        'Partner $49.99/mo', 'Architect Custom Build (quote)',
        'Founders $99', 'Coaching Sprint $25/session'
    ]) {
        assert.ok(plans.includes(exact), `!plans missing exact catalog entry: ${exact}`);
    }
    assert.match(plans, /CUHZ Bot \(one plan per Twitch channel\)/);
    assert.match(plans, /Gold \$14\.99\/mo \(includes site Pro\)/);
    assert.ok(plans.includes(PRICING_URL));

    assert.match(commerce.COMMERCE_COMMANDS['!community'], /free CUHZ Bot plan for one Twitch channel/);
    assert.match(commerce.COMMERCE_COMMANDS['!silver'], /Silver — \$4\.99\/mo for one CUHZ Bot plan on one Twitch channel/);
    assert.match(commerce.COMMERCE_COMMANDS['!gold'], /Gold — \$14\.99\/mo for one CUHZ Bot plan on one Twitch channel; includes site Pro/);
    assert.match(commerce.COMMERCE_COMMANDS['!partner'], /Partner — \$49\.99\/mo for one CUHZ Bot plan on one Twitch channel/);
    assert.strictEqual(commerce.COMMERCE_COMMANDS['!pro'], commerce.COMMERCE_COMMANDS['!membership']);
    assert.match(commerce.COMMERCE_COMMANDS['!pro'], /Free \$0 · Pro \$9\.99\/mo · Team \$24\.99\/mo/);
    assert.match(commerce.COMMERCE_COMMANDS['!store'], /Founders \$99 · Coaching Sprint \$25\/session/);

    // Every emitted line containing a public price directs people to the one
    // canonical pricing URL; no stale anchors or store checkout are presented.
    for (const line of lines.filter(line => /\$\d/.test(line))) {
        assert.ok(line.includes(PRICING_URL), `priced line lacks canonical pricing URL: ${line}`);
    }
    assert.ok(commerce.COMMERCE_COMMANDS['!community'].includes(BOT_ONBOARDING_URL));
    assert.ok(commerce.COMMERCE_COMMANDS['!community'].includes(PRICING_URL));

    // 7. Architect is quote-only — never a number.
    assert.doesNotMatch(commerce.COMMERCE_COMMANDS['!architect'], /\$\s*\d/);
    assert.match(commerce.COMMERCE_COMMANDS['!architect'], /quote only/i);
    assert.ok(commerce.COMMERCE_COMMANDS['!architect'].includes(PRICING_URL));
    assert.ok(commerce.COMMERCE_COMMANDS['!architect'].includes(ARCHITECT_QUOTE_URL));

    // 7b. !site carries the truth-pack Chain Studio facts: ten finishes, free,
    // and the real planetcuhz.com/chain surface.
    assert.match(commerce.COMMERCE_COMMANDS['!site'], /10 finishes/);
    assert.match(commerce.COMMERCE_COMMANDS['!site'], /free/i);
    assert.ok(commerce.COMMERCE_COMMANDS['!site'].includes('https://planetcuhz.com/chain'));


    // 8. Dispatch shape mirrors stream_content.launchCommandResponse.
    assert.strictEqual(commerce.commerceCommandResponse('!plans'), commerce.COMMERCE_COMMANDS['!plans']);
    assert.strictEqual(commerce.commerceCommandResponse('!shop'), commerce.COMMERCE_COMMANDS['!store']); // alias
    assert.strictEqual(commerce.commerceCommandResponse('!affiliate'), commerce.COMMERCE_COMMANDS['!partner']); // legacy alias
    assert.strictEqual(commerce.commerceCommandResponse('!partner'), commerce.COMMERCE_COMMANDS['!partner']);
    assert.ok(commerce.isCommerceCommand('!affiliate') && commerce.isCommerceCommand('!partner'));
    assert.match(commerce.myTierLine('partner', 'cuhzy'), /Partner CUHZ Bot plan/);
    assert.strictEqual(commerce.commerceCommandResponse('!mytier'), null); // dynamic, not static
    assert.strictEqual(commerce.commerceCommandResponse('!notacommand'), null);
    assert.strictEqual(commerce.commerceCommandResponse('!SILVER extra args'), commerce.COMMERCE_COMMANDS['!silver']);

    // The customer-facing dynamic help route advertises current public names,
    // not the retained !affiliate compatibility alias, and links canonical pricing.
    const botSource = fs.readFileSync(path.join(__dirname, '../src/bot.js'), 'utf8');
    const helpMatch = botSource.match(/const commerceHelp = '([^']+)'/);
    assert.ok(helpMatch, 'commerce help line must exist');
    const commerceHelp = helpMatch[1];
    assert.ok(commerceHelp.includes('CUHZ Bot plans'));
    assert.ok(commerceHelp.includes('!community'));
    assert.ok(commerceHelp.includes('!partner'));
    assert.ok(commerceHelp.includes('!architect'));
    assert.ok(commerceHelp.includes('!membership'));
    assert.ok(commerceHelp.includes(PRICING_URL));
    assert.ok(!commerceHelp.includes('!affiliate'));
    assert.ok(!commerceHelp.includes('Tiers'));

    // Basic third-party channels consume the canonical registry as their denylist.
    // This locks both newly public plan commands and the Partner legacy alias.
    for (const name of ['!community', '!partner', '!affiliate']) {
        assert.ok(commerce.COMMERCE_COMMAND_NAMES.includes(name), `${name} missing from canonical commerce registry`);
    }
    assert.match(botSource, /\.\.\.commerceContent\.COMMERCE_COMMAND_NAMES/);
    assert.doesNotMatch(botSource, /'!plans', '!silver', '!gold', '!affiliate'/);

    // 8b. !discord voice-fam command + its aliases resolve to the same voice line.
    assert.ok(commerce.COMMERCE_COMMANDS['!discord'], '!discord command must exist');
    assert.strictEqual(commerce.commerceCommandResponse('!discord'), commerce.COMMERCE_COMMANDS['!discord']);
    assert.strictEqual(commerce.commerceCommandResponse('!voice'), commerce.COMMERCE_COMMANDS['!discord']); // alias
    assert.strictEqual(commerce.commerceCommandResponse('!family'), commerce.COMMERCE_COMMANDS['!discord']); // alias
    assert.strictEqual(commerce.commerceCommandResponse('!FAMILY come thru'), commerce.COMMERCE_COMMANDS['!discord']);
    assert.ok(commerce.isCommerceCommand('!discord') && commerce.isCommerceCommand('!voice') && commerce.isCommerceCommand('!family'));
    for (const name of ['!discord', '!voice', '!family']) {
        assert.ok(commerce.COMMERCE_COMMAND_NAMES.includes(name), `${name} must be in COMMERCE_COMMAND_NAMES`);
    }

    // 8c. The voice line points at the exact voice-only Discord the site uses,
    // and that URL is on the safety allowlist (discord.gg host approved).
    const voiceLine = commerce.COMMERCE_COMMANDS['!discord'];
    assert.ok(voiceLine.includes('https://discord.gg/eNxDKkxQdN'), 'voice line must use the site voice Discord invite');
    assert.strictEqual(policy.isApprovedUrl('https://discord.gg/eNxDKkxQdN'), true);
    for (const url of policy.extractUrls(voiceLine)) {
        assert.strictEqual(policy.isApprovedUrl(url), true, `unapproved URL in voice line: ${url}`);
    }

    // 8d. !pod podcast command + its aliases resolve to the same podcast line.
    assert.ok(commerce.COMMERCE_COMMANDS['!pod'], '!pod command must exist');
    assert.strictEqual(commerce.commerceCommandResponse('!pod'), commerce.COMMERCE_COMMANDS['!pod']);
    assert.strictEqual(commerce.commerceCommandResponse('!podcast'), commerce.COMMERCE_COMMANDS['!pod']); // alias
    assert.strictEqual(commerce.commerceCommandResponse('!pcp'), commerce.COMMERCE_COMMANDS['!pod']); // alias
    assert.strictEqual(commerce.commerceCommandResponse('!PCP tune in'), commerce.COMMERCE_COMMANDS['!pod']);
    assert.ok(commerce.isCommerceCommand('!pod') && commerce.isCommerceCommand('!podcast') && commerce.isCommerceCommand('!pcp'));
    for (const name of ['!pod', '!podcast', '!pcp']) {
        assert.ok(commerce.COMMERCE_COMMAND_NAMES.includes(name), `${name} must be in COMMERCE_COMMAND_NAMES`);
    }

    // 8e. The podcast line points at the real planetcuhz.com/podcast surface,
    // and that URL is on the safety allowlist (approved host + APPROVED_LINKS).
    const podLine = commerce.COMMERCE_COMMANDS['!pod'];
    assert.ok(podLine.includes('https://planetcuhz.com/podcast'), 'pod line must use the site podcast surface');
    assert.strictEqual(policy.isApprovedUrl('https://planetcuhz.com/podcast'), true);
    assert.strictEqual(policy.APPROVED_LINKS.podcast, 'https://planetcuhz.com/podcast');
    for (const url of policy.extractUrls(podLine)) {
        assert.strictEqual(policy.isApprovedUrl(url), true, `unapproved URL in pod line: ${url}`);
    }

    // 9. !mytier reports the channel-scoped bot plan and mentions the user.
    assert.match(commerce.myTierLine('gold', 'cuhzy'), /channel runs the Gold CUHZ Bot plan/);
    assert.match(commerce.myTierLine('gold', 'cuhzy'), /@cuhzy/);
    assert.match(commerce.myTierLine('silver', 'cuhzy'), /channel runs the Silver CUHZ Bot plan/);
    assert.match(commerce.myTierLine('community', 'cuhzy'), /channel runs the free Community CUHZ Bot plan/);
    // Unknown tier falls back to community (honest default).
    assert.match(commerce.myTierLine('bogus', 'cuhzy'), /Community CUHZ Bot plan/);

    // 10. Thank-you pools: generic never names anyone; named + upgrade do.
    assert.doesNotMatch(commerce.genericThankYou('gold'), /@/);
    assert.match(commerce.namedThankYou('cuhzy', 'gold'), /@cuhzy/);
    assert.match(commerce.upgradeLine('cuhzy'), /@cuhzy/);
    assert.match(commerce.upgradeLine('cuhzy'), /channel upgraded from Silver to Gold CUHZ Bot/);

    console.log('✅ Commerce content tests passed');
}

run();
