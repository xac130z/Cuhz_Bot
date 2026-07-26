const assert = require('assert');
const commerce = require('../src/commerce_content');
const policy = require('../src/safety_policy');

// Fake urgency / scarcity language that must NEVER appear in commerce copy.
// (Note: "80% off the Claude brain" is a REAL, sourced perk — not a fake discount —
//  so generic "off"/"sale" are intentionally not banned; only pressure phrasing is.)
const FORBIDDEN_URGENCY = [
    'hurry', 'act now', 'act fast', 'last chance', 'limited time', 'limited-time',
    'expires', 'ends soon', 'only today', 'today only', 'while supplies last',
    'urgent', 'flash sale', 'countdown', 'running out', 'few left', 'selling fast',
    "don't miss out", 'don’t miss out'
];

// NO crypto, anywhere — ever.
const FORBIDDEN_CRYPTO = ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'wallet', ' nft', 'seed phrase'];

function everyLine() {
    // Every customer-facing string the registry can emit, rendered.
    const lines = [];
    for (const v of Object.values(commerce.COMMERCE_COMMANDS)) lines.push(v);
    for (const tier of ['gold', 'silver', 'community']) lines.push(commerce.myTierLine(tier, 'testcuhz'));
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
    }

    // 5. Customer-facing spelling is "CUHZ Bot".
    assert.match(commerce.COMMERCE_COMMANDS['!plans'], /CUHZ Bot/);

    // 6. Sourced prices are exactly as published (PRICING_PAGE.md ↔ Pricing.tsx).
    assert.match(commerce.COMMERCE_COMMANDS['!silver'], /\$4\.99\/mo/);
    assert.match(commerce.COMMERCE_COMMANDS['!gold'], /\$14\.99\/mo/);
    assert.match(commerce.COMMERCE_COMMANDS['!affiliate'], /\$49\.99\/mo/);
    assert.match(commerce.COMMERCE_COMMANDS['!pro'], /\$9\.99\/mo/);
    assert.match(commerce.COMMERCE_COMMANDS['!pro'], /\$24\.99\/mo/);
    assert.match(commerce.COMMERCE_COMMANDS['!store'], /\$9\b/);
    assert.match(commerce.COMMERCE_COMMANDS['!store'], /\$7\b/);
    assert.match(commerce.COMMERCE_COMMANDS['!store'], /\$15\b/);

    // 7. Architect is quote-only — never a number.
    assert.doesNotMatch(commerce.COMMERCE_COMMANDS['!architect'], /\$\s*\d/);
    assert.match(commerce.COMMERCE_COMMANDS['!architect'], /quote only/i);

    // 7b. !site carries the truth-pack Chain Studio facts: ten finishes, free,
    // and the real planetcuhz.com/chain surface.
    assert.match(commerce.COMMERCE_COMMANDS['!site'], /10 finishes/);
    assert.match(commerce.COMMERCE_COMMANDS['!site'], /free/i);
    assert.ok(commerce.COMMERCE_COMMANDS['!site'].includes('https://planetcuhz.com/chain'));
    assert.ok(commerce.COMMERCE_COMMANDS['!store'].includes('https://planetcuhz.com/store'));

    // 8. Dispatch shape mirrors stream_content.launchCommandResponse.
    assert.strictEqual(commerce.commerceCommandResponse('!plans'), commerce.COMMERCE_COMMANDS['!plans']);
    assert.strictEqual(commerce.commerceCommandResponse('!shop'), commerce.COMMERCE_COMMANDS['!store']); // alias
    assert.strictEqual(commerce.commerceCommandResponse('!mytier'), null); // dynamic, not static
    assert.strictEqual(commerce.commerceCommandResponse('!notacommand'), null);
    assert.strictEqual(commerce.commerceCommandResponse('!SILVER extra args'), commerce.COMMERCE_COMMANDS['!silver']);

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

    // 9. !mytier lines are tier-correct and mention the user.
    assert.match(commerce.myTierLine('gold', 'cuhzy'), /Gold Executive/);
    assert.match(commerce.myTierLine('gold', 'cuhzy'), /@cuhzy/);
    assert.match(commerce.myTierLine('silver', 'cuhzy'), /Silver Supporter/);
    assert.match(commerce.myTierLine('community', 'cuhzy'), /Community tier/);
    // Unknown tier falls back to community (honest default).
    assert.match(commerce.myTierLine('bogus', 'cuhzy'), /Community tier/);

    // 10. Thank-you pools: generic never names anyone; named + upgrade do.
    assert.doesNotMatch(commerce.genericThankYou('gold'), /@/);
    assert.match(commerce.namedThankYou('cuhzy', 'gold'), /@cuhzy/);
    assert.match(commerce.upgradeLine('cuhzy'), /@cuhzy/);
    assert.match(commerce.upgradeLine('cuhzy'), /Silver → Gold/);

    console.log('✅ Commerce content tests passed');
}

run();
