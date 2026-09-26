'use strict';
// The !help utility line is a promise. Every command on it must have a handler,
// every constant those handlers read must exist, and the two commands that
// printed "undefined" on stream (see 2026-09-18 screenshots) must be unable to.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateBotBoot, readBotSource } = require('./helpers/isolated_bot_boot');

let passed = 0;
const check = (n, f) => { f(); passed++; console.log(`PASS ${n}`); };
const src = readBotSource();
const at = (start, end) => { const a = src.indexOf(start); assert.notEqual(a, -1, start); return src.slice(a, src.indexOf(end, a)); };
// Assert on CODE, not prose: a comment that explains the old bug must not be able
// to satisfy or defeat the assertion about the fix.
const code = text => text.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

const handlers = new Set([
    ...src.matchAll(/msg === '!([a-z0-9&]+)'/g),
    ...src.matchAll(/msg\.startsWith\('!([a-z0-9&]+)[ ']/g),
    ...src.matchAll(/^\s+'!([a-z0-9&]+)':\s*'/gm),          // PUBLIC_COMMANDS map
].map(m => m[1]));

check('every command on the !help utility line has a handler', () => {
    // The line is two string literals: the base for every tier, plus a
    // Pro/Premium tail on the next line. Slice through to the next section key.
    const line = at("utility:   '", "\n            vibes:");
    const promised = [...new Set([...line.matchAll(/!([a-z0-9&]+)/g)].map(m => m[1]))];
    assert.ok(promised.length >= 24, `found ${promised.length}: ${promised.join(' ')}`);
    const missing = promised.filter(c => !handlers.has(c));
    assert.deepEqual(missing, [], `no handler for: ${missing.map(c => '!' + c).join(' ')}`);
});

check('the quote pools the zero-dependency commands read all exist and are non-empty', () => {
    for (const k of ['LURK_QUOTES', 'UNLURK_QUOTES', 'RAID_HYPE_MANUAL', 'SUB_HYPE', 'NEW_FOLLOWER_HYPE', 'LIVE_ANNOUNCEMENTS']) {
        const block = at(`const ${k} = [`, '\n];');
        assert.ok((block.match(/^\s+['"`]/gm) || []).length >= 1, `${k} has entries`);
    }
    for (const k of ['website', 'linktree', 'discord']) assert.match(at('const SOCIAL_LINKS = {', '\n};'), new RegExp(`\\b${k}:`));
});

check('checkStreamStatus now captures Helix viewer_count (it was dropped)', () => {
    const fn = at('async function checkStreamStatus', '\n}\n');
    assert.match(fn, /viewers: Number\.isFinite\(Number\(stream\.viewer_count\)\)/);
});

check('!viewers can no longer print "undefined": it reads the live poll and never stats.viewers', () => {
    const h = code(at("if (msg === '!viewers') {", '\n        return;\n    }'));
    assert.doesNotMatch(h, /stats\.viewers/, 'stream_sessions has no viewers column');
    assert.match(h, /streamStates\.get\(streamKey\(channel\)\)/);
    assert.match(h, /if \(now === null\)/, 'explicit not-yet-polled branch instead of interpolating a hole');
    assert.doesNotMatch(h, /\$\{stats\.peak_viewers \|\| stats\.viewers\}/);
});

check('!streamstats never prints "Invalid Date" or "undefined"', () => {
    const h = code(at("if (msg === '!streamstats') {", '\n        return;\n    }'));
    assert.doesNotMatch(h, /stats\.viewers\b/);
    assert.match(h, /Number\.isFinite\(t\.getTime\(\)\)/, 'date guard present');
    assert.doesNotMatch(h, /new Date\(stats\.started_at\)\.toLocale/, 'raw toLocale on a possibly-null column');
});

check('!followage answers the broadcaster about their own channel instead of "not following (yet)!"', () => {
    const h = at("if (msg.startsWith('!followage')", '\n        return;\n    }');
    assert.match(h, /targetUsername\.toLowerCase\(\) === cleanChannel/);
    assert.match(h, /you built it/);
});

check('the bot still boots with all of the above', () => {
    const e = evaluateBotBoot(src);
    assert.equal(e.reachedEnd, true);
    assert.deepEqual(e.forbiddenAttempts, []);
});

console.log(`\n${passed} utility-command checks passed.`);
