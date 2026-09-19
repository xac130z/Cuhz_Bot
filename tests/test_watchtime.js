'use strict';
// Two questions, two numbers, one command. The per-stream figure is "since your
// first message this stream" and must never be phrased as "since you arrived":
// Twitch gives the bot no arrival event for anonymous viewers, and the 'join'
// handler only handles the bot's own join. Honesty is enforced by string here.
const assert = require('node:assert/strict');
const { evaluateBotBoot, readBotSource } = require('./helpers/isolated_bot_boot');
const { formatMinutes } = require('../src/duration');

let passed = 0;
const check = (n, f) => { f(); passed++; console.log(`PASS ${n}`); };
const src = readBotSource();
const lift = (name, end) => src.slice(src.indexOf(name), src.indexOf(end, src.indexOf(name)));

// pure pieces lifted out of bot.js and run for real
const { formatWatchLine, sqlTimestamp } = new Function('formatMinutes',
    lift('function sqlTimestamp', 'async function sessionFirstSeen') +
    lift('function formatWatchLine', '// Passive paycheck tuning') +
    'return { formatWatchLine, sqlTimestamp };')(formatMinutes);

const NOW = Date.UTC(2026, 8, 19, 3, 0, 0);
const H = 3600000;

check('live + first message 72 min ago + 36h all-time -> both numbers', () => {
    assert.equal(formatWatchLine('planetcuhz', { live: true, firstSeenMs: NOW - 72 * 60000, totalMinutes: 2168, nowMs: NOW }),
        '⏱️ @planetcuhz — in this stream: 1h 12m · all-time across the fam: 36h 8m 💎');
});
check('live, first message this instant -> "just got here", never 0m', () => {
    assert.match(formatWatchLine('x', { live: true, firstSeenMs: NOW - 20000, totalMinutes: 0, nowMs: NOW }), /in this stream: just got here/);
    assert.match(formatWatchLine('x', { live: true, firstSeenMs: null, totalMinutes: 0, nowMs: NOW }), /just got here/);
});
check('offline -> says so instead of inventing a session', () => {
    const r = formatWatchLine('x', { live: false, firstSeenMs: NOW - 5 * H, totalMinutes: 600, nowMs: NOW });
    assert.match(r, /stream is offline right now/); assert.match(r, /all-time across the fam: 10h 0m/);
});
check('no all-time minutes -> honest "just started tracking", no "0m"', () => {
    const r = formatWatchLine('x', { live: true, firstSeenMs: NOW - 30 * 60000, totalMinutes: 0, nowMs: NOW });
    assert.match(r, /just started tracking/); assert.doesNotMatch(r, /\b0m\b/);
    assert.match(formatWatchLine('x', { live: true, firstSeenMs: NOW - H, totalMinutes: -4, nowMs: NOW }), /just started tracking/);
});
check('the reply never claims "since you arrived/joined/got here at"', () => {
    const fn = lift('function formatWatchLine', '// Passive paycheck tuning');
    assert.doesNotMatch(fn, /since you (arrived|joined|opened)/i);
});
check('sqlTimestamp renders CURRENT_TIMESTAMP-shaped UTC so both dialects compare correctly', () => {
    assert.equal(sqlTimestamp(new Date(Date.UTC(2026, 8, 19, 1, 5, 9, 500))), '2026-09-19 01:05:09');
    assert.doesNotMatch(sqlTimestamp(NOW), /T|Z/);
});
check('the per-stream lookup is scoped by channel, user AND stream start, via MIN(created_at)', () => {
    const fn = lift('async function sessionFirstSeen', 'function formatWatchLine');
    assert.match(fn, /SELECT MIN\(created_at\) AS first_at FROM chat_log WHERE channel = \? AND username = \? AND created_at >= \?/);
    assert.match(fn, /sqlTimestamp\(startedAt\)/, 'cutoff goes through the dialect-safe formatter');
    assert.match(fn, /if \(!startedAt\) return null;/);
});
check('!session / !here / !howlong are aliases of the same handler and !session is advertised', () => {
    assert.match(src, /msg === '!watchtime' \|\| msg === '!session' \|\| msg === '!here' \|\| msg === '!howlong'/);
    assert.match(lift("utility:   '", '\n'), /!session/);
});
check('the bot still boots', () => {
    const e = evaluateBotBoot(src); assert.equal(e.reachedEnd, true); assert.deepEqual(e.forbiddenAttempts, []);
});
console.log(`\n${passed} watch-time checks passed.`);
