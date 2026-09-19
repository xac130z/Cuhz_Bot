'use strict';
// The website's "Get CUHZ Bot" flow was a dead end: bot_requests existed,
// bot-worker-sync served it, and nothing in the bot ever read it. These checks
// pin the pipe and its safety properties.
const assert = require('node:assert/strict');
const { evaluateBotBoot, readBotSource } = require('./helpers/isolated_bot_boot');
let passed = 0; const check = (n, f) => { f(); passed++; console.log(`PASS ${n}`); };
const src = readBotSource();
const fn = src.slice(src.indexOf('async function fetchSyncedChannels'), src.indexOf('// Passive paycheck tuning'));

check('sync is inert without BOT_SYNC_URL and never uses a second secret', () => {
    assert.match(src, /const BOT_SYNC_URL = \(process\.env\.BOT_SYNC_URL \|\| ''\)\.trim\(\);/);
    assert.match(fn, /if \(!BOT_SYNC_URL \|\| !config\.botApiSecret\) return \[\];/);
    assert.match(fn, /Bearer \$\{config\.botApiSecret\}/, 'same BOT_API_SECRET bot-worker-sync expects');
});
check('only approved/active, Twitch-shaped logins can become channels (never free text)', () => {
    assert.match(fn, /\['approved', 'active'\]\.includes\(r\.status\)/);
    assert.match(fn, /LOGIN_SHAPE\.test\(l\)/);
    assert.match(fn, /normalizeChannels\(logins\)/);
});
check('a sync failure returns [] and cannot take the bot down', () => {
    assert.match(fn, /catch \(err\)[\s\S]*return \[\];/);
});
check('boot MERGES synced channels; dashboard and config paths are untouched', () => {
    assert.match(src, /const synced = await fetchSyncedChannels\(\);\n\s+for \(const ch of synced\) if \(!channelsToJoin\.includes\(ch\)\) channelsToJoin\.push\(ch\);/);
    assert.match(src, /\/\/ Fallback to config if no dashboard channels/);
});
check('the 5-minute re-sync timer lives inside app.listen(), joins only new channels', () => {
    const listenAt = src.indexOf('app.listen(config.port');
    const clockAt = src.indexOf('const syncClock = setInterval(');
    assert.ok(clockAt > listenAt, 'timer must be inside the listen callback');
    assert.match(src, /if \(connectedChannels\.has\(ch\)\) continue;\n\s+await client\.join\(ch\);/);
});
check('the bot still boots in the inert harness (no timers or network at boot)', () => {
    const e = evaluateBotBoot(src); assert.equal(e.reachedEnd, true); assert.deepEqual(e.forbiddenAttempts, []);
});
console.log(`\n${passed} bot-worker-sync checks passed.`);
