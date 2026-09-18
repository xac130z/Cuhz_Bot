'use strict';
// Pure-module tests: no network, no database, no bot boot, no timers.
// Clock is injected so every limit is deterministic.
const assert = require('node:assert/strict');
const { createLoungeControl, parseCommand, SUB_PALETTES, PALETTES } = require('../src/lounge_control');

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };

// Fixture ids. FOUR and OWNER are verified real ids (Twitch GQL, 2026-09-17).
// OP_A is a stand-in operator id for these tests: Phoenix's real id is NOT yet
// confirmed (phoenixnyc=757210754 vs phoenixpnyc=823707557) and a test must not
// assert a fact nobody has verified. The module is id-agnostic; only bot.js
// carries the real operator list.
const PHOENIX = '900000001', FOUR = '952381011', OWNER = '1293717308';
const ROOM = '175727753';
let T = 1000000;
const clock = () => T;
// Most of this file exercises the WIDER ladder (subs steer), so it opts in with
// access:'subscribers'. The default is operators-only; see the block at the end.
const make = (o = {}) => createLoungeControl({ now: clock, operatorIds: [PHOENIX, FOUR, OWNER], cardCount: 5, access: 'subscribers', ...o });
const sub = (id, login = 'subby') => ({ userId: id, login, subscriber: true });
const viewer = (id, login = 'rando') => ({ userId: id, login });
const op = () => ({ userId: PHOENIX, login: 'operator_a' });
const mod = (id = '500') => ({ userId: id, login: 'modperson', moderator: true });
// every applied change must clear both the per-user and per-channel floors
const advance = ms => { T += ms; };
const turn = () => advance(11000);

check('a non-lounge message is ignored entirely (falls through to the bot)', () => {
    const l = make();
    assert.equal(l.applyIntent(ROOM, sub('1'), 'hello chat'), null);
    assert.equal(l.applyIntent(ROOM, sub('1'), '!points'), null);
});

check('bare !vibe is NOT taken over — the existing bot command still owns it', () => {
    assert.equal(parseCommand('!vibe'), null);
    assert.deepEqual(parseCommand('!vibe hype'), { intent: 'vibe', value: 'hype' });
});

check('subscribers can drive; plain viewers cannot', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock');
    turn();
    assert.equal(l.applyIntent(ROOM, viewer('7'), '!lounge color mint').reason, 'subscribers_only');
    assert.equal(l.applyIntent(ROOM, sub('8'), '!lounge color mint').status, 'applied');
});

check('operators are Phoenix, four_a_reason and the owner, by numeric id only', () => {
    const l = make();
    assert.equal(l.roleOf({ userId: PHOENIX }), 'operator');
    assert.equal(l.roleOf({ userId: FOUR }), 'operator');
    assert.equal(l.roleOf({ userId: OWNER }), 'operator');
    // the SAME login with a different id gets nothing — the Stormy rename lesson
    assert.equal(l.roleOf({ userId: '999', login: 'phoenixpnyc' }), 'viewer');
    assert.equal(l.roleOf({ userId: 'phoenixpnyc' }), 'unknown');
});

check('turbo is operator-only (photosensitivity), chill and hype are open', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    assert.equal(l.applyIntent(ROOM, sub('9'), '!lounge vibe turbo').reason, 'vibe_operator_only');
    turn();
    assert.equal(l.applyIntent(ROOM, sub('9'), '!lounge vibe hype').status, 'applied');
    turn();
    assert.equal(l.applyIntent(ROOM, op(), '!lounge vibe turbo').status, 'applied');
});

check('transparent palette is operator-only; the other nine are open to subs', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    assert.equal(l.applyIntent(ROOM, sub('10'), '!lounge color transparent').reason, 'color_operator_only');
    assert.equal(SUB_PALETTES.includes('transparent'), false);
    assert.equal(SUB_PALETTES.length, 9);
    assert.equal(Object.keys(PALETTES).length, 10);
});

check('injection attempts die at the byte gate, before any case folding', () => {
    for (const bad of [
        '!lounge color <script>alert(1)</script>',
        '!lounge color lаvender',           // Cyrillic a
        '!lounge vibe ‮turbo',          // RTL override
        '!lounge color __proto__',
        '!lounge color constructor',
        '!lounge card 1e309',
        '!lounge color ' + 'x'.repeat(300),
        '!lounge color #ff0000',
    ]) {
        const r = parseCommand(bad);
        assert.ok(r === null || r.error, `leaked: ${bad}`);
    }
});

check('a rejected argument never mutates state', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    l.applyIntent(ROOM, sub('11'), '!lounge color mint'); turn();
    const before = l.readState(ROOM);
    l.applyIntent(ROOM, sub('11'), '!lounge color __proto__');
    l.applyIntent(ROOM, sub('11'), '!lounge vibe nonsense');
    const after = l.readState(ROOM);
    assert.equal(after.palette, before.palette);
    assert.equal(after.seq, before.seq);
});

check('restart starts LOCKED — losing a lock would reopen control mid-incident', () => {
    const l = make();
    assert.equal(l.readState(ROOM).locked, true);
    assert.equal(l.applyIntent(ROOM, sub('12'), '!lounge color mint').reason, 'locked');
});

check('mods can lock and unlock but cannot paint', () => {
    const l = make();
    assert.equal(l.applyIntent(ROOM, mod(), '!lounge unlock').status, 'applied');
    assert.equal(l.readState(ROOM).locked, false);
    turn();
    assert.equal(l.applyIntent(ROOM, mod(), '!lounge color mint').reason, 'subscribers_only');
    assert.equal(l.applyIntent(ROOM, viewer('13'), '!lounge lock').status, 'silent');
});

check('one turn per viewer per 10s, and a 3s channel floor', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    assert.equal(l.applyIntent(ROOM, sub('20'), '!lounge color mint').status, 'applied');
    advance(1000);
    assert.equal(l.applyIntent(ROOM, sub('20'), '!lounge color peach').reason, 'your_turn_soon');
    // a different sub is still inside the channel floor
    assert.equal(l.applyIntent(ROOM, sub('21'), '!lounge color peach').reason, 'channel_floor');
    advance(3000);
    assert.equal(l.applyIntent(ROOM, sub('21'), '!lounge color peach').status, 'applied');
});

check('asking for what is already on screen is free and silent (co-sign)', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    l.applyIntent(ROOM, sub('30'), '!lounge vibe hype');
    advance(1000);
    const r = l.applyIntent(ROOM, sub('31'), '!lounge vibe hype');
    assert.equal(r.status, 'cosigned');   // not a rejection, costs no turn
});

check('rejection replies are throttled to one per user per minute', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    l.applyIntent(ROOM, sub('40'), '!lounge color mint');
    advance(500);
    const first = l.applyIntent(ROOM, sub('40'), '!lounge color peach');
    const second = l.applyIntent(ROOM, sub('40'), '!lounge color black');
    assert.equal(first.quiet, false);   // speak once
    assert.equal(second.quiet, true);   // then stay quiet
});

check('a burst trips channel cooling', () => {
    const l = make({ limits: { userCooldownMs: 0, channelFloorMs: 0 } });
    l.applyIntent(ROOM, op(), '!lounge unlock');
    for (let i = 0; i < 20; i++) { advance(10); l.applyIntent(ROOM, sub(String(100 + i)), `!lounge card ${(i % 5) + 1}`); }
    advance(10);
    assert.equal(l.applyIntent(ROOM, sub('999'), '!lounge card 2').reason, 'cooling');
});

check('card is clamped to the real asset count, not the 15 card names', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    l.applyIntent(ROOM, sub('50'), '!lounge card 12');
    assert.equal(l.readState(ROOM).card, 5);
    assert.equal(l.readState(ROOM).cardCount, 5);
});

check('zoom moves in bounded steps and never leaves the safe range', () => {
    // burst cap lifted here on purpose: this test is about the zoom clamp, and the
    // burst limiter has its own test above.
    const l = make({ limits: { userCooldownMs: 0, channelFloorMs: 0, burstMax: 1000 } });
    l.applyIntent(ROOM, op(), '!lounge unlock');
    for (let i = 0; i < 20; i++) { advance(10); l.applyIntent(ROOM, sub('60'), '!lounge zoom in'); }
    assert.ok(l.readState(ROOM).zoom <= 1.20);
    for (let i = 0; i < 40; i++) { advance(10); l.applyIntent(ROOM, sub('60'), '!lounge zoom out'); }
    assert.ok(l.readState(ROOM).zoom >= 0.85);
    advance(10); l.applyIntent(ROOM, sub('60'), '!lounge zoom reset');
    assert.equal(l.readState(ROOM).zoom, 1);
});

check('turbo decays to hype on its own', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    l.applyIntent(ROOM, op(), '!lounge vibe turbo');
    assert.equal(l.readState(ROOM).vibe, 'turbo');
    advance(61000);
    assert.equal(l.tick(ROOM).reason, 'turbo_decay');
    assert.equal(l.readState(ROOM).vibe, 'hype');
});

check('the lounge comes home to the house look when chat goes quiet', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    l.applyIntent(ROOM, sub('70'), '!lounge color peach');
    assert.equal(l.readState(ROOM).palette, 'peach');
    advance(91000);
    assert.equal(l.tick(ROOM).reason, 'idle');
    assert.equal(l.readState(ROOM).palette, 'black');
});

check('an operator can set the house look and the lounge returns to it', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    l.applyIntent(ROOM, op(), '!lounge color lavender'); turn();
    assert.equal(l.setHouse(ROOM, op()).status, 'applied');
    l.applyIntent(ROOM, sub('80'), '!lounge color mint');
    advance(91000); l.tick(ROOM);
    assert.equal(l.readState(ROOM).palette, 'lavender');
});

check('an operator can take the remote from one person only', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    assert.equal(l.mute(ROOM, viewer('1'), '90').status, 'silent');   // not an operator
    assert.equal(l.mute(ROOM, op(), '90').status, 'applied');
    assert.equal(l.applyIntent(ROOM, sub('90'), '!lounge color mint').reason, 'muted');
    turn();
    assert.equal(l.applyIntent(ROOM, sub('91'), '!lounge color mint').status, 'applied');
});

check('published state carries no user ids and no chat text', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    l.applyIntent(ROOM, sub('99', 'coolcuhz'), '!lounge color mint');
    const s = l.readState(ROOM);
    const json = JSON.stringify(s);
    assert.equal(json.includes('99'), false, 'user id leaked into state');
    assert.equal(json.includes('!lounge'), false, 'chat text leaked into state');
    assert.equal(s.setByLogin, 'coolcuhz');
    assert.deepEqual(Object.keys(s).sort(), ['bootId','card','cardCount','depth','frozen','glow','locked',
        'palette','pollMs','position','rotation','seq','setByLogin','shadow','speed','thickness','tilt',
        'updatedAtMs','version','vibe','zoom']);
});

check('the badge can be killed in one command', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    l.applyIntent(ROOM, sub('95', 'someone'), '!lounge color mint');
    assert.equal(l.readState(ROOM).setByLogin, 'someone');
    l.setBadge(ROOM, false);
    assert.equal(l.readState(ROOM).setByLogin, null);
});

check('seq only ever moves forward — stale payloads cannot revert the stream', () => {
    const l = make();
    let last = l.readState(ROOM).seq;
    l.applyIntent(ROOM, op(), '!lounge unlock');
    for (const cmd of ['!lounge color mint', '!lounge vibe hype', '!lounge card 2']) {
        turn(); l.applyIntent(ROOM, op(), cmd);
        const s = l.readState(ROOM);
        assert.ok(s.seq > last, 'seq went backwards'); last = s.seq;
    }
});

check('rooms are isolated — one channel cannot drive another', () => {
    const l = make();
    const other = '999999';
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    l.applyIntent(ROOM, op(), '!lounge color peach');
    assert.equal(l.readState(ROOM).palette, 'peach');
    assert.equal(l.readState(other).palette, 'black');
    assert.equal(l.readState(other).locked, true);
});

check('a missing or non-numeric room id writes nothing', () => {
    const l = make();
    assert.equal(l.applyIntent('', op(), '!lounge color mint').reason, 'no_room');
    assert.equal(l.applyIntent('#cuhz_bot', op(), '!lounge color mint').reason, 'no_room');
});

check('the audit log records who did what, and never the raw message', () => {
    const l = make();
    l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    l.applyIntent(ROOM, sub('77', 'auditme'), '!lounge color mint');
    const entry = l.auditOf(ROOM).pop();
    assert.equal(entry.decision, 'applied');
    assert.equal(entry.actor, '77');
    assert.equal(entry.intent, 'color');
    assert.equal(JSON.stringify(entry).includes('!lounge'), false);
});

check('status and the palette rack are open to everyone, and read-only', () => {
    const l = make();
    const before = l.readState(ROOM).seq;
    assert.equal(l.applyIntent(ROOM, viewer('1'), '!lounge').status, 'status');
    const colors = l.applyIntent(ROOM, viewer('1'), '!lounge colors');
    assert.equal(colors.status, 'colors');
    assert.equal(colors.palettes.includes('transparent'), false);
    assert.equal(l.applyIntent(ROOM, op(), '!lounge colors').palettes.length, 10);
    assert.equal(l.readState(ROOM).seq, before);
});

check('subscribers get the density controls, operators get the motion controls', () => {
    const l = make(); l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    // density: allowed for a sub
    assert.equal(l.applyIntent(ROOM, sub('40'), '!lounge depth 8').status, 'applied'); turn();
    assert.equal(l.applyIntent(ROOM, sub('41'), '!lounge thickness 0').status, 'applied'); turn();
    // motion: operator-only for the same reason turbo is
    for (const cmd of ['!lounge speed 100', '!lounge rotation 20', '!lounge position -20',
                       '!lounge tilt 25', '!lounge shadow on', '!lounge freeze on']) {
        const r = l.applyIntent(ROOM, sub('42'), cmd);
        assert.equal(r.status, 'rejected', cmd);
        assert.equal(r.reason, 'intent_operator_only', cmd);
        assert.equal(l.applyIntent(ROOM, op(), cmd).status, 'applied', `operator ${cmd}`);
        turn();
    }
});
check('every numeric control is bound by the lab\u2019s own slider range, and nothing else is reachable', () => {
    const { RANGES } = require('../src/lounge_control');
    const l = make(); l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    for (const [key, r] of Object.entries(RANGES)) {
        for (const bad of [r.min - 1, r.max + 1, 999, -999]) {
            const res = l.applyIntent(ROOM, op(), `!lounge ${key} ${bad}`);
            assert.equal(res.reason, 'out_of_range', `${key} ${bad} must be refused`);
        }
        for (const good of [r.min, r.max]) {
            assert.equal(l.applyIntent(ROOM, op(), `!lounge ${key} ${good}`).status, 'applied', `${key} ${good}`);
            assert.equal(l.readState(ROOM)[key], good);
            turn();
        }
        // non-numeric and injection-shaped values never reach the state
        for (const junk of ['abc', '__proto__', '1.5', '1e3', '', '0x8']) {
            const res = l.applyIntent(ROOM, op(), `!lounge ${key} ${junk}`);
            assert.notEqual(res.status, 'applied', `${key} ${junk}`);
        }
    }
});
check('"auto" hands one control back to the vibe preset without resetting the rest', () => {
    const l = make(); l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    l.applyIntent(ROOM, op(), '!lounge depth 8'); turn();
    l.applyIntent(ROOM, op(), '!lounge rotation 10'); turn();
    assert.equal(l.readState(ROOM).depth, 8);
    l.applyIntent(ROOM, op(), '!lounge depth auto'); turn();
    assert.equal(l.readState(ROOM).depth, null, 'depth follows the preset again');
    assert.equal(l.readState(ROOM).rotation, 10, 'the other override survived');
});
check('a fine override SURVIVES a later vibe change, and !lounge reset clears everything', () => {
    const l = make(); l.applyIntent(ROOM, op(), '!lounge unlock'); turn();
    l.applyIntent(ROOM, op(), '!lounge depth 7'); turn();
    l.applyIntent(ROOM, op(), '!lounge vibe hype'); turn();
    assert.equal(l.readState(ROOM).depth, 7, '"I want 7 layers" survives "now make it hype"');
    assert.equal(l.readState(ROOM).vibe, 'hype');
    l.applyIntent(ROOM, op(), '!lounge reset'); turn();
    const s = l.readState(ROOM);
    assert.equal(s.depth, null); assert.equal(s.vibe, 'chill'); assert.equal(s.frozen, false);
});
check('whoami reports only the asker\u2019s own id, to everyone, and changes no state', () => {
    const l = make();
    const before = l.readState(ROOM).seq;
    const r = l.applyIntent(ROOM, viewer('777', 'rando'), '!lounge whoami');
    assert.equal(r.status, 'whoami');
    assert.equal(r.userId, '777');
    assert.equal(r.role, 'viewer');
    assert.equal(l.readState(ROOM).seq, before, 'whoami must not mutate state');
    assert.equal(l.applyIntent(ROOM, op(), '!lounge whoami').role, 'operator');
});

// ---- operators-only (the DEFAULT) -----------------------------------------
check('DEFAULT access is operators-only: a subscriber cannot change anything', () => {
    const l = createLoungeControl({ now: clock, operatorIds: [OWNER], cardCount: 5 });
    assert.equal(l.stats().access, 'operators');
    l.applyIntent(ROOM, { userId: OWNER, login: 'planetcuhz' }, '!lounge unlock'); turn();
    for (const cmd of ['!lounge vibe hype', '!lounge color mint', '!lounge depth 8', '!lounge zoom in', '!lounge reset']) {
        const r = l.applyIntent(ROOM, sub('31', 'paidsub'), cmd);
        assert.equal(r.status, 'rejected', cmd); assert.equal(r.reason, 'operators_only', cmd);
    }
    assert.equal(l.readState(ROOM).vibe, 'chill', 'nothing moved');
});
check('operators-only: a random viewer and a moderator are blocked from steering too', () => {
    const l = createLoungeControl({ now: clock, operatorIds: [OWNER], cardCount: 5 });
    l.applyIntent(ROOM, { userId: OWNER, login: 'planetcuhz' }, '!lounge unlock'); turn();
    assert.equal(l.applyIntent(ROOM, viewer('32'), '!lounge vibe hype').reason, 'operators_only');
    assert.equal(l.applyIntent(ROOM, mod('33'), '!lounge vibe hype').reason, 'operators_only');
});
check('operators-only: read-only intents stay open, and a mod can still lock (a brake, not a paintbrush)', () => {
    const l = createLoungeControl({ now: clock, operatorIds: [OWNER], cardCount: 5 });
    assert.equal(l.applyIntent(ROOM, viewer('34'), '!lounge').status, 'status');
    assert.equal(l.applyIntent(ROOM, viewer('34'), '!lounge colors').status, 'colors');
    assert.equal(l.applyIntent(ROOM, viewer('34'), '!lounge whoami').status, 'whoami');
    assert.equal(l.applyIntent(ROOM, mod('35'), '!lounge unlock').status, 'applied');
    assert.equal(l.applyIntent(ROOM, mod('35'), '!lounge lock').status, 'applied');
});
check('operators-only: the operator has the full board', () => {
    const l = createLoungeControl({ now: clock, operatorIds: [OWNER], cardCount: 5 });
    const me = { userId: OWNER, login: 'planetcuhz' };
    l.applyIntent(ROOM, me, '!lounge unlock');
    for (const cmd of ['!lounge vibe turbo', '!lounge color transparent', '!lounge depth 8', '!lounge speed 100', '!lounge freeze on']) {
        assert.equal(l.applyIntent(ROOM, me, cmd).status, 'applied', cmd); turn();
    }
});
check('an unknown access value fails closed to operators-only', () => {
    assert.equal(createLoungeControl({ now: clock, access: 'everyone' }).stats().access, 'operators');
    assert.equal(createLoungeControl({ now: clock, access: 'subscribers' }).stats().access, 'subscribers');
});

console.log(`\n${passed} lounge control checks passed (pure module; no network, database or bot boot).`);
