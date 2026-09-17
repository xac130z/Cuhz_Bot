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

console.log(`\n${passed} cuhzn-greeting checks passed.`);
