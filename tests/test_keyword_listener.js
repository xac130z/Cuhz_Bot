const assert = require('assert');
const kw = require('../src/keyword_listener');
const policy = require('../src/safety_policy');

// Fake urgency / scarcity language that must NEVER appear in keyword replies.
const FORBIDDEN_URGENCY = [
    'hurry', 'act now', 'act fast', 'last chance', 'limited time', 'limited-time',
    'expires', 'ends soon', 'only today', 'today only', 'while supplies last',
    'urgent', 'flash sale', 'countdown', 'running out', 'few left', 'selling fast',
    "don't miss out", 'don’t miss out'
];
// NO crypto, anywhere — ever.
const FORBIDDEN_CRYPTO = ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'wallet', ' nft', 'seed phrase'];

const BOT_NAMES = ['cuhzbot', 'cuhz bot', 'cuhz_bot_login'];

function testReplyRegistry() {
    const lines = [];
    for (const intent of kw.INTENTS) {
        assert.ok(Array.isArray(kw.REPLIES[intent]) && kw.REPLIES[intent].length > 0,
            `intent ${intent} must have a reply pool`);
        for (const l of kw.REPLIES[intent]) lines.push(l);
    }

    for (const line of lines) {
        assert.ok(typeof line === 'string' && line.length > 0, 'reply must be a non-empty string');
        assert.ok(line.length < 500, `reply exceeds Twitch limit: ${line}`);

        // 1. Passes the outbound safety gate as a deterministic bot reply.
        const checked = policy.validateOutbound(line, { source: 'bot' });
        assert.strictEqual(checked.allowed, true, `validateOutbound blocked: ${line} (${checked.reason})`);

        // 2. Every URL is on the approved allowlist.
        for (const url of policy.extractUrls(line)) {
            assert.strictEqual(policy.isApprovedUrl(url), true, `unapproved URL in: ${line} -> ${url}`);
        }

        const lower = line.toLowerCase();
        // 3. No fake urgency / scarcity language.
        for (const bad of FORBIDDEN_URGENCY) {
            assert.ok(!lower.includes(bad), `urgency language "${bad}" found in: ${line}`);
        }
        // 4. No crypto, ever.
        for (const bad of FORBIDDEN_CRYPTO) {
            assert.ok(!lower.includes(bad), `crypto term "${bad}" found in: ${line}`);
        }
        // 5. NO prices — those live only in commerce_content.js. Never a bare "$<digit>".
        assert.doesNotMatch(line, /\$\s*\d/, `keyword reply must not quote a price: ${line}`);
        // 6. Points only at real, honest surfaces.
        assert.ok(
            /!plans|!mytier|!help|planetcuhz\.com/i.test(line),
            `reply should point to a real surface (!plans/!mytier/!help/planetcuhz.com): ${line}`
        );
    }
    // 7. Customer-facing spelling is "CUHZ Bot" where the bot is named.
    assert.ok(kw.REPLIES.help.some(l => /CUHZ Bot/.test(l)), 'help pool should name "CUHZ Bot"');
}

function testIntentDetectionPositive() {
    const d = m => kw.detectIntent(m, { botNames: BOT_NAMES });

    // price
    assert.strictEqual(d('yo what is the price on this'), 'price');
    assert.strictEqual(d('how much does gold cost'), 'price'); // "how much" (price wins over any help)
    assert.strictEqual(d('the cost is what im wondering'), 'price');
    assert.strictEqual(d('i wanna subscribe to the bot'), 'price');
    assert.strictEqual(d('is there a sub tier for this'), 'price');

    // help
    assert.strictEqual(d('can somebody help me'), 'help');
    assert.strictEqual(d('how do i use the ask command'), 'help');
    assert.strictEqual(d('how does this bot work'), 'help');

    // what-question: starts with "what" AND (has "?" OR mentions bot)
    assert.strictEqual(d('what is planet cuhz?'), 'what_question');
    assert.strictEqual(d('what can cuhzbot even do'), 'what_question'); // bot mention, no "?"

    // bot-mention: mentions bot AND has "?" (and NOT already a higher intent)
    assert.strictEqual(d('yo cuhzbot you around?'), 'bot_mention');
    assert.strictEqual(d('hey cuhz bot, still there?'), 'bot_mention');
    assert.strictEqual(d('anyone home cuhz_bot_login?'), 'bot_mention'); // login name
}

function testIntentDetectionNegative() {
    const d = m => kw.detectIntent(m, { botNames: BOT_NAMES });

    // Word-boundary discipline: no substring false positives.
    assert.strictEqual(d('that costume is fire'), null);      // "cost" inside "costume"
    assert.strictEqual(d('i unsubscribed last week'), null);  // "subscribe" inside "unsubscribed"
    assert.strictEqual(d('somewhat hyped tonight'), null);    // "what" inside "somewhat"
    assert.strictEqual(d('whatever works for you'), null);    // "what" starts but "whatever" != word "what"

    // "what ..." with neither "?" nor bot mention → not a what-question.
    assert.strictEqual(d('what a stream that was'), null);
    // Bot mention without "?" and not a what-question → nothing.
    assert.strictEqual(d('cuhzbot is actually clean'), null);
    // Plain chatter.
    assert.strictEqual(d('hello everyone good to be here'), null);
    assert.strictEqual(d(''), null);
    assert.strictEqual(d('   '), null);

    // Commands never produce an intent (guarded here AND at the bot.js hook).
    assert.strictEqual(d('!plans'), null);
    assert.strictEqual(d('!help how much'), null); // command, even though it contains "how much"
}

function testIsBotUser() {
    assert.strictEqual(kw.isBotUser('nightbot', BOT_NAMES), true);
    assert.strictEqual(kw.isBotUser('StreamElements', BOT_NAMES), true);
    assert.strictEqual(kw.isBotUser('Moobot', BOT_NAMES), true);
    assert.strictEqual(kw.isBotUser('cuhzbot', BOT_NAMES), true);        // self (name)
    assert.strictEqual(kw.isBotUser('cuhz_bot_login', BOT_NAMES), true); // self (login)
    assert.strictEqual(kw.isBotUser('@nightbot', BOT_NAMES), true);      // @-prefixed
    assert.strictEqual(kw.isBotUser('', BOT_NAMES), true);               // empty → non-human
    assert.strictEqual(kw.isBotUser('regular_viewer', BOT_NAMES), false);
}

function testCooldownBehavior() {
    let t = 1_000_000_000_000; // realistic epoch-ish start
    const now = () => t;
    const L = kw.createListener({ botNames: BOT_NAMES, now });
    const live = { isLive: true };

    // First price reply fires.
    let r = L.evaluate(Object.assign({ username: 'userA', message: 'what is the price' }, live));
    assert.strictEqual(r.intent, 'price');
    assert.ok(r.reply, 'first eligible message should reply');

    // Immediate repeat (same user) — overall throttle blocks (≤1 per 60s).
    r = L.evaluate(Object.assign({ username: 'userA', message: 'price again' }, live));
    assert.strictEqual(r.reply, null);
    assert.strictEqual(r.reason, 'overall_cooldown');

    // +61s, same user — overall passed but the per-user 5min cooldown holds.
    t += 61 * 1000;
    r = L.evaluate(Object.assign({ username: 'userA', message: 'how much is it' }, live));
    assert.strictEqual(r.reply, null);
    assert.strictEqual(r.reason, 'user_cooldown');

    // Same moment, a DIFFERENT user — overall (61s) + per-intent (61s) both cleared,
    // and userB has never been replied to → reply.
    r = L.evaluate(Object.assign({ username: 'userB', message: 'whats the price' }, live));
    assert.strictEqual(r.intent, 'price');
    assert.ok(r.reply, 'a fresh user after the overall window should reply');

    // Offline → never fires (live-status respect).
    t += 10 * 60 * 1000; // clear all cooldowns
    r = L.evaluate({ username: 'userC', message: 'what is the price', isLive: false });
    assert.strictEqual(r.reply, null);
    assert.strictEqual(r.reason, 'offline');

    // ...but mock API stands in for "live" locally.
    r = L.evaluate({ username: 'userC', message: 'what is the price', isLive: false, useMockApi: true });
    assert.ok(r.reply, 'mock API should satisfy the live gate');

    // Bots/self never get a reply, even on a perfect intent hit.
    r = L.evaluate(Object.assign({ username: 'nightbot', message: 'what is the price' }, live));
    assert.strictEqual(r.reply, null);
    assert.strictEqual(r.reason, 'bot');
}

function testPerIntentCooldownIsolation() {
    // Isolate the per-intent gate: shrink overall + per-user so only the 45s
    // per-intent rail can bite, and prove intents are independent of each other.
    let t = 2_000_000_000_000;
    const now = () => t;
    const L = kw.createListener({
        botNames: BOT_NAMES,
        now,
        cooldowns: { overallCooldownMs: 1000, perUserCooldownMs: 1000, perIntentCooldownMs: 45 * 1000 }
    });
    const live = { isLive: true };

    let r = L.evaluate(Object.assign({ username: 'a', message: 'what is the price' }, live));
    assert.strictEqual(r.intent, 'price');
    assert.ok(r.reply);

    // +2s: overall + per-user cleared, but the SAME intent is still on its 45s rail.
    t += 2000;
    r = L.evaluate(Object.assign({ username: 'b', message: 'how much for gold' }, live));
    assert.strictEqual(r.reply, null);
    assert.strictEqual(r.reason, 'intent_cooldown');

    // Same instant, a DIFFERENT intent (help) is independent → reply.
    r = L.evaluate(Object.assign({ username: 'c', message: 'can you help me' }, live));
    assert.strictEqual(r.intent, 'help');
    assert.ok(r.reply, 'a different intent must not inherit another intent cooldown');
}

function testDefaultsMeetSpecFloors() {
    assert.ok(kw.DEFAULTS.perIntentCooldownMs >= 45 * 1000, 'per-intent cooldown must be ≥45s');
    assert.ok(kw.DEFAULTS.perUserCooldownMs >= 5 * 60 * 1000, 'per-user cooldown must be ≥5min');
    assert.ok(kw.DEFAULTS.overallCooldownMs >= 60 * 1000, 'overall cooldown must be ≥60s');
}

function run() {
    testReplyRegistry();
    testIntentDetectionPositive();
    testIntentDetectionNegative();
    testIsBotUser();
    testCooldownBehavior();
    testPerIntentCooldownIsolation();
    testDefaultsMeetSpecFloors();
    console.log('✅ Keyword listener tests passed');
}

run();
