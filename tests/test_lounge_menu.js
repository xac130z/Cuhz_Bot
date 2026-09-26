'use strict';
// Operator menu: text in, text out. Every entry must round-trip to a sentence
// the lounge validator accepts — one grammar, one validator.
const assert = require('node:assert/strict');
const { parseLab, renderMenu, ENTRIES } = require('../src/lounge_menu');
const { parseCommand } = require('../src/lounge_control');

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };

check('non-!lab messages are null (fall through)', () => {
    for (const m of ['hello', '!lounge', '!labs', '!la b', '', null, 42, '!lab'.padEnd(300, 'x')]) {
        assert.equal(parseLab(m), null, JSON.stringify(m));
    }
});
check('bare !lab / !lab menu → page 1; !lab more / !lab menu 2 → page 2; !lab 1 and !lab 2 are ENTRIES', () => {
    assert.deepEqual(parseLab('!lab'), { kind: 'menu', page: 1 });
    assert.deepEqual(parseLab('!lab menu'), { kind: 'menu', page: 1 });
    assert.deepEqual(parseLab('!LAB'), { kind: 'menu', page: 1 });
    assert.deepEqual(parseLab('!lab more'), { kind: 'menu', page: 2 });
    assert.deepEqual(parseLab('!lab menu 2'), { kind: 'menu', page: 2 });
    assert.equal(parseLab('!lab 1').cmd, '!lounge vibe chill');
    assert.equal(parseLab('!lab 2').cmd, '!lounge vibe hype');
});
check('every numbered command entry yields a sentence the lounge validator parses without error', () => {
    for (const e of ENTRIES.filter(e => e.cmd)) {
        const byNum = parseLab(`!lab ${e.n}`);
        const byWords = parseLab(`!lab ${e.words}`);
        assert.equal(byNum.kind, 'command', e.words);
        assert.equal(byNum.cmd, e.cmd);
        assert.deepEqual(byWords, byNum, `number and word forms must be identical for ${e.words}`);
        const parsed = parseCommand(e.cmd);
        assert.ok(parsed && !parsed.error, `${e.cmd} must be a valid lounge command, got ${JSON.stringify(parsed)}`);
    }
});
check('action entries map to bot-level actions and carry an optional argument', () => {
    assert.deepEqual(parseLab('!lab 14 confirm').action, 'house_set');
    assert.equal(parseLab('!lab 14 confirm').arg, 'confirm');
    assert.equal(parseLab('!lab house set').arg, null);
    assert.equal(parseLab('!lab house set confirm').arg, 'confirm');
    assert.equal(parseLab('!lab house show').action, 'house_show');
    assert.equal(parseLab('!lab 15').action, 'queue');
    assert.equal(parseLab('!lab q').action, 'queue');
    assert.equal(parseLab('!lab 12').action, 'badge_on');
    assert.equal(parseLab('!lab badge off').action, 'badge_off');
    assert.deepEqual(parseLab('!lab mute @Rando'), { kind: 'action', action: 'mute', entry: null, arg: '@rando' });
    assert.equal(parseLab('!lab unmute rando').action, 'unmute');
});
check('color and card word forms forward to the same validator (and inherit its rejections)', () => {
    assert.equal(parseLab('!lab color mint').cmd, '!lounge color mint');
    assert.ok(!parseCommand(parseLab('!lab color mint').cmd).error);
    assert.equal(parseCommand(parseLab('!lab color gold').cmd).error, 'bad_color');
    // __proto__ dies in the token gate (missing_value), which is earlier and stricter than bad_color.
    assert.ok(parseCommand(parseLab('!lab color __proto__').cmd).error);
    assert.equal(parseLab('!lab card 3').cmd, '!lounge card 3');
    assert.equal(parseCommand(parseLab('!lab card 999').cmd).intent, 'card');   // clamped by the state machine
    assert.equal(parseCommand(parseLab('!lab card abc').cmd).error, 'bad_card');
});
check('unknown numbers and words are "unknown", never a silent fallthrough', () => {
    for (const m of ['!lab 0', '!lab 16', '!lab 99', '!lab dance', '!lab house', '!lab house nope', '!lab vibe']) {
        assert.equal(parseLab(m).kind, 'unknown', m);
    }
});
check('non-ASCII / oversized input is rejected before any parsing', () => {
    assert.equal(parseLab('!lab​ 3'), null);
    assert.equal(parseLab('!lab ３'), null);
    assert.equal(parseLab('!lab ' + 'a'.repeat(200)), null);
});
check('menu pages fit a single Twitch message and mention the page flip', () => {
    for (const p of [1, 2]) {
        const line = renderMenu(p);
        assert.ok(line.length > 40 && line.length <= 480, `page ${p} length ${line.length}`);
    }
    assert.match(renderMenu(1), /!lab more/);
    assert.match(renderMenu(2), /house set/);
});

console.log(`\n${passed} lounge menu checks passed (pure module).`);
