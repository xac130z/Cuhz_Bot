'use strict';
// The failure mode this guards against is loud and personal: alerting the owner's
// phone for every regular in chat after every redeploy. That happens the moment
// "new" is read from the in-memory welcome map instead of the database.
const assert = require('node:assert/strict');
const { evaluateBotBoot, readBotSource } = require('./helpers/isolated_bot_boot');

let passed = 0;
const check = (n, f) => { f(); passed++; console.log(`PASS ${n}`); };
const src = readBotSource();
const fn = (name, end) => src.slice(src.indexOf(name), src.indexOf(end, src.indexOf(name)));

check('"new" is read from the DATABASE, never from the in-memory welcome map', () => {
    const f = fn('async function isFirstTimeEver', 'async function alertFirstTimer');
    assert.match(f, /userMemory\.getProfile/, 'must consult user_profiles');
    assert.match(f, /total_messages <= 1/, 'first INSERT sets total_messages = 1');
    assert.doesNotMatch(f, /_channelWelcomes/, '_channelWelcomes resets on restart — using it re-alerts everyone');
});

check('a database error yields "not new" — it never guesses, because guessing spams', () => {
    const f = fn('async function isFirstTimeEver', 'async function alertFirstTimer');
    assert.match(f, /catch[\s\S]*return false;/, 'errors must fail to "not new"');
});

check('the feature is completely inert without DISCORD_ALERT_WEBHOOK_URL', () => {
    assert.match(src, /const DISCORD_ALERT_WEBHOOK = \(process\.env\.DISCORD_ALERT_WEBHOOK_URL \|\| ''\)\.trim\(\);/);
    const f = fn('async function alertFirstTimer', '\nconst _loungeReplies');
    assert.match(f, /if \(!DISCORD_ALERT_WEBHOOK/, 'early return when unset');
    // the call site must also be gated, so no query runs when the feature is off
    assert.match(src, /if \(DISCORD_ALERT_WEBHOOK && await isFirstTimeEver/);
});

check('a raid is throttled rather than becoming dozens of phone buzzes', () => {
    const f = fn('async function alertFirstTimer', '\nconst _loungeReplies');
    assert.match(f, /FIRST_TIMER_MAX_PER_WINDOW/);
    assert.match(src, /const FIRST_TIMER_MAX_PER_WINDOW = 8;/);
    assert.match(f, /_firstTimerSuppressed/, 'suppressed count must be surfaced, not silently dropped');
});

check('a stranger’s first message cannot ping the server or break markdown', () => {
    const f = fn('async function alertFirstTimer', '\nconst _loungeReplies');
    assert.match(f, /allowed_mentions: \{ parse: \[\] \}/, 'no @everyone from a username');
    assert.match(f, /replace\(\/`\/g/, 'backticks neutralised');
    assert.match(f, /\.slice\(0, 180\)/, 'length capped');
});

check('repeated webhook failures pause the feature instead of retrying forever', () => {
    const f = fn('async function alertFirstTimer', '\nconst _loungeReplies');
    assert.match(f, /_alertFailures\+\+/);
    assert.match(f, /_alertPausedUntil/);
});

check('an alert can never break chat handling', () => {
    const f = fn('async function alertFirstTimer', '\nconst _loungeReplies');
    assert.match(f, /try \{/); assert.match(f, /catch \(err\)/);
    // fire-and-forget at the call site: no await, so a slow webhook can't stall the handler
    assert.match(src, /\n\s+alertFirstTimer\(channel, usernameL, tags\.username, message\);/);
});

check('the bot still boots with the alert path wired in', () => {
    const e = evaluateBotBoot(src);
    assert.equal(e.reachedEnd, true);
    assert.deepEqual(e.forbiddenAttempts, []);
});

console.log(`\n${passed} first-timer alert checks passed.`);
