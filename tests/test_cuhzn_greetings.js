'use strict';
// Arrival recognition must key on the immutable numeric Twitch id. handleAutoShoutout()
// keys on a LOGIN, which is precisely how recognition broke when qweenstormygirlnz89
// became stormygirlnz89 — and, worse, how a recycled login eventually gets a friend's
// personal line read out to a stranger. These tests hold that line.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateBotBoot, readBotSource } = require('./helpers/isolated_bot_boot');

let passed = 0;
const check = (n, f) => { f(); passed++; console.log(`PASS ${n}`); };
const src = readBotSource();

const block = (() => {
    const a = src.indexOf('const CUHZNS = {');
    assert.notEqual(a, -1, 'CUHZNS registry present');
    return src.slice(a, src.indexOf('\n};', a));
})();

check('every cuhzn key is a numeric Twitch id, never a login', () => {
    const keys = [...block.matchAll(/^\s*'([^']+)':\s*\{/gm)].map(m => m[1]);
    assert.ok(keys.length >= 9, `expected the roster, got ${keys.length}`);
    for (const k of keys) assert.match(k, /^\d{1,12}$/, `"${k}" must be a numeric id`);
});

check('each entry names the login it belongs to, and pools are non-empty', () => {
    const entries = [...block.matchAll(/'(\d+)':\s*\{\s*login:\s*'([^']+)',\s*pool:\s*([A-Z_]+|\[)/g)];
    assert.ok(entries.length >= 9);
    for (const [, id, login] of entries) {
        assert.match(login, /^[a-z0-9_]{3,25}$/, `${id} login "${login}"`);
    }
});

check('the greeting lookup is by id and refuses a login', () => {
    const fn = src.slice(src.indexOf('function cuhznGreeting'), src.indexOf('function cuhznGreeting') + 600);
    assert.match(fn, /CUHZNS\[String\(userId/, 'must look up by userId');
    assert.doesNotMatch(fn, /tags\.username|\.login\]/, 'must not look up by login');
});

check('a cuhzn is not greeted in their own channel', () => {
    const fn = src.slice(src.indexOf('function cuhznGreeting'), src.indexOf('function cuhznGreeting') + 600);
    assert.match(fn, /c\.login === String\(channelLogin/, 'broadcaster guard present');
});

check('Phoenix is absent until her account is confirmed (fail closed)', () => {
    assert.doesNotMatch(block, /'757210754'|'823707557'/,
        'neither phoenixnyc nor phoenixpnyc may be added by guess');
});

check('the welcome path calls the registry with the numeric id from tags', () => {
    assert.match(src, /cuhznGreeting\(tags\['user-id'\], channel\)/);
});

check('the paid 5,000-point custom greeting still exists and is not undercut', () => {
    // The registry automates house-written crew lines; a viewer's OWN words on
    // arrival must remain the paid reward, or the economy loses a product.
    assert.match(src, /Custom bot greeting/, 'the 5,000-point reward must still be offered');
    assert.match(src, /ECONOMY NOTE/, 'the distinction must stay written down');
});

check('the registry is declared AFTER every pool it references (no TDZ at boot)', () => {
    // Declaring it earlier throws "Cannot access RICO_QUOTES before initialization"
    // — the same temporal dead-zone class as the September P0. This asserts order
    // directly so the failure is named, not just a generic boot crash.
    const at = src.indexOf('const CUHZNS = {');
    for (const pool of ['FOUR_QUOTES','RICO_QUOTES','MAHNI_QUOTES','QWEEN_QUOTES',
                        'SNOWY_QUOTES','GROUCH_QUOTES','WESTSIDE_QUOTES']) {
        const decl = src.indexOf(`const ${pool} = [`);
        assert.notEqual(decl, -1, `${pool} exists`);
        assert.ok(decl < at, `${pool} must be declared before CUHZNS`);
    }
});

check('the whole bot still boots with the registry wired in', () => {
    const e = evaluateBotBoot(src);
    assert.equal(e.reachedEnd, true);
    assert.deepEqual(e.forbiddenAttempts, []);
});

// ---- the live receipt: pure formatter, exercised for real --------------------
// bot.js has no module.exports, so the function is lifted out by source and run
// with the same formatMinutes the bot uses — the numbers must match !watchtime.
const { formatMinutes } = require('../src/duration');
const fmtSrc = src.slice(src.indexOf('function formatCuhznReceipt'), src.indexOf('/** Live lookup.'));
const formatCuhznReceipt = new Function('formatMinutes', `${fmtSrc}; return formatCuhznReceipt;`)(formatMinutes);
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 17, 12, 0, 0);
const profile = (o = {}) => ({ total_messages: 0, total_watch_minutes: 0, first_seen: null, ...o });

check('receipt prints the same figures as !points / !watchtime and a real tenure', () => {
    const r = formatCuhznReceipt('snowy_wolfies_ttv',
        profile({ total_messages: 1269, total_watch_minutes: 860, first_seen: '2026-08-10T21:06:56Z' }), 780, NOW);
    assert.equal(r, '\u{1F9FE} @snowy_wolfies_ttv \u2014 1,269 messages \u00b7 14h 20m watched \u00b7 780 CUHZ Points \u00b7 here since Aug 10');
});
check('fewer than two real facts -> null (no padding, no "0 messages")', () => {
    assert.equal(formatCuhznReceipt('x', profile(), 0, NOW), null);
    assert.equal(formatCuhznReceipt('x', profile({ total_messages: 5 }), 0, NOW), null);
    assert.equal(formatCuhznReceipt('x', null, 0, NOW), null);
    assert.equal(formatCuhznReceipt('x', null, 400, NOW), null, 'points alone is one fact');
});
check('a profile created today is not "here since today"', () => {
    const r = formatCuhznReceipt('x', profile({ total_messages: 3, total_watch_minutes: 12, first_seen: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() }), 0, NOW);
    assert.equal(r, '\u{1F9FE} @x \u2014 3 messages \u00b7 12m watched');
    const r2 = formatCuhznReceipt('x', profile({ total_messages: 3, total_watch_minutes: 12, first_seen: new Date(NOW - 2 * DAY).toISOString() }), 0, NOW);
    assert.match(r2, /here since Sep 15$/);
});
check('garbage stats are treated as absent, never printed', () => {
    const r = formatCuhznReceipt('x', profile({ total_messages: 'lots', total_watch_minutes: NaN, first_seen: 'not a date' }), 1.5, NOW);
    assert.equal(r, null);
    const r2 = formatCuhznReceipt('x', profile({ total_messages: 40, total_watch_minutes: -5 }), '900', NOW);
    assert.equal(r2, null, 'a negative and a string are not facts');
});
check('the receipt never states a points balance that was not read live', () => {
    // No historical number from the reconciliation evidence may be baked in.
    const block = src.slice(src.indexOf('const CUHZNS = {'), src.indexOf('\n};', src.indexOf('const CUHZNS = {')));
    // Decode the source escapes first: the em-dash is written as \\u2014 in the
    // file, and its digits are not a number the viewer ever sees.
    const receipts = [...block.matchAll(/receipt:\s*'([^']*)'/g)].map(m => JSON.parse(`"${m[1].replace(/"/g, '\\"')}"`));
    assert.equal(receipts.length, 8, 'eight character lines (ohthatztayy is null on purpose)');
    for (const r of receipts) assert.doesNotMatch(r, /\d/, `character line must carry no number: "${r}"`);
});
check('a personal greeting suppresses the generic auto-shoutout instead of stacking on it', () => {
    assert.match(src, /!cuhznGreeted && joinChannelTier !== TIERS\.BASIC/);
    assert.match(src, /cuhznGreeted = true;/);
});
check('the receipt lookup is fail-safe: a stats error cannot suppress the greeting', () => {
    const fn = src.slice(src.indexOf('async function cuhznReceipt'), src.indexOf('async function cuhznReceipt') + 500);
    assert.match(fn, /try \{/); assert.match(fn, /catch \(err\)/); assert.match(fn, /return null;/);
});

console.log(`\n${passed} cuhzn-greeting checks passed.`);
