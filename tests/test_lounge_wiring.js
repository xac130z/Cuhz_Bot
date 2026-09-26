'use strict';
// Lane K2 wiring tests. Two layers:
//   1. static — the source-level guarantees the design depends on
//   2. harness — boot the COMPLETE bot.js in the inert isolated context and
//      drive the registered /api/lounge/state handler with fake req/res.
// No network, no database, no Twitch, no timers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateBotBoot, readBotSource } = require('./helpers/isolated_bot_boot');

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
const src = readBotSource();
const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

// ---------------------------------------------------------------- static
check('lounge_control.js and lounge_menu.js have ZERO require() calls (financial boundary is provable by grep)', () => {
    for (const f of ['lounge_control.js', 'lounge_menu.js']) {
        // A real require has a quoted module argument; prose like "no require() here" does not.
        const m = read(f).match(/\brequire\s*\(\s*['"`]/g) || [];
        assert.deepEqual(m, [], `${f} must not require anything`);
        assert.doesNotMatch(read(f), /\b(points_|database|loyalty|axios|fs|tmi\.js|http)\b.*require/, f);
    }
});
check('the BASE operator list is numeric literals only — never logins, never env', () => {
    const m = src.match(/const LOUNGE_OPERATOR_BASE_IDS = Object\.freeze\(\[([^\]]*)\]\)/);
    assert.ok(m, 'LOUNGE_OPERATOR_BASE_IDS present');
    const ids = m[1].split(',').map(x => x.trim().replace(/['"]/g, '')).filter(Boolean);
    assert.ok(ids.length >= 1);
    for (const id of ids) assert.match(id, /^\d{1,12}$/, `operator "${id}" must be a numeric Twitch id`);
    assert.doesNotMatch(m[0], /process\.env/, 'the base list must not read env — the boot harness freezes it to {}');
});
check('access defaults to operators-only and only LOUNGE_ACCESS=subscribers widens it', () => {
    assert.match(src, /const LOUNGE_ACCESS = process\.env\.LOUNGE_ACCESS === 'subscribers' \? 'subscribers' : 'operators';/);
    assert.match(src, /createLoungeControl\(\{[^}]*access: LOUNGE_ACCESS/);
});
check('the base operator list is planetcuhz only (owner decision 2026-09-18)', () => {
    const m = src.match(/const LOUNGE_OPERATOR_BASE_IDS = Object\.freeze\(\[([^\]]*)\]\)/);
    const ids = m[1].split(',').map(x => x.trim().replace(/['"]/g, '')).filter(Boolean);
    assert.deepEqual(ids, ['1293717308']);
});
check('the env operator list is ADDITIVE and numeric-filtered (env can add, never replace)', () => {
    const block = src.slice(src.indexOf('const LOUNGE_OPERATOR_IDS = Object.freeze(['),
                            src.indexOf('const LOUNGE_ROOMS'));
    assert.match(block, /\.\.\.LOUNGE_OPERATOR_BASE_IDS/, 'base ids must always be included');
    assert.match(block, /LOUNGE_OPERATOR_EXTRA_IDS/);
    assert.match(block, /\/\^\\d\{1,12\}\$\//, 'env ids must be filtered to numeric');
    // Prove the filter: run the same expression against hostile env values.
    const parse = v => String(v || '').split(',').map(x => x.trim()).filter(x => /^\d{1,12}$/.test(x));
    assert.deepEqual(parse('757210754'), ['757210754']);
    assert.deepEqual(parse('757210754, 823707557'), ['757210754', '823707557']);
    assert.deepEqual(parse('phoenixnyc'), [], 'a LOGIN must never become an operator');
    assert.deepEqual(parse('*'), []);
    assert.deepEqual(parse('12345678901234567890'), [], 'over-long ids rejected');
    assert.deepEqual(parse(''), []);
    assert.deepEqual(parse(undefined), []);
});
check('lounge dispatch sits ABOVE the bare !vibe handler', () => {
    const lounge = src.indexOf('0.7. THE CUHZ LAB');
    const vibe = src.indexOf("if (msg === '!vibe') {");
    assert.ok(lounge > 0 && vibe > 0 && lounge < vibe, 'lounge block must precede bare !vibe');
});
check('the lounge block keys on room-id from tags, not on the channel login', () => {
    const block = src.slice(src.indexOf('0.7. THE CUHZ LAB'), src.indexOf('0.8. CUHZ Vibe Commands'));
    assert.match(block, /tags\['room-id'\]/);
    // Check CODE, not prose: strip // comments so the block's own "no database"
    // note cannot satisfy or defeat the assertion.
    const code = block.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(code, /pointsService|\bdb\.|database|mutatePoints|award/);
});
check('exactly one lounge route, GET, and no POST/PUT on /api/lounge', () => {
    const gets = (src.match(/app\.get\('\/api\/lounge\/state'/g) || []).length;
    assert.equal(gets, 1);
    assert.doesNotMatch(src, /app\.(post|put|delete|patch)\('\/api\/lounge/);
});
check('the tick clock lives inside app.listen(), not at module level', () => {
    const listenAt = src.indexOf('app.listen(config.port');
    const clockAt = src.indexOf('const loungeClock = setInterval(');
    assert.ok(clockAt > listenAt, 'setInterval for the lounge must be inside the listen callback');
});

// ---------------------------------------------------------------- harness
const evidence = evaluateBotBoot(src);
check('complete bot boots in the inert context with the lounge wired (no forbidden ops, no timers at boot)', () => {
    assert.equal(evidence.reachedEnd, true);
    assert.deepEqual(evidence.forbiddenAttempts, []);
    assert.ok(evidence.requiredModules.includes('./lounge_control'));
    assert.ok(evidence.requiredModules.includes('./lounge_menu'));
});
const route = evidence.routes.find(r => r.method === 'GET' && r.route === '/api/lounge/state');
check('GET /api/lounge/state is registered with a route-level CORS layer ahead of the handler', () => {
    assert.ok(route, 'route registered');
    assert.equal(route.handlers.length, 2, 'cors middleware + handler');
});

// Drive the real handler. Express is inert here, so res is a hand-rolled spy.
function call(query) {
    const handler = route.handlers[route.handlers.length - 1];
    const headers = {}; let status = 200, body = null, type = null;
    const res = {
        set: (k, v) => { headers[k] = v; return res; },
        type: t => { type = t; return res; },
        status: s => { status = s; return res; },
        send: b => { body = b; return res; },
        json: b => { body = JSON.stringify(b); return res; },
    };
    handler({ query, method: 'GET' }, res);
    return { status, headers, type, json: JSON.parse(body) };
}
check('enabled channel returns a v1 state payload with no-store caching', () => {
    const r = call({ channel: 'cuhz_bot' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.equal(r.type, 'application/json');
    assert.equal(r.json.version, 1);
    assert.match(r.json.bootId, /^\d+$/);
    assert.equal(r.json.locked, true, 'restart implies locked (fail closed)');
    assert.equal(r.json.cardCount, 5);
    assert.equal(r.json.pollMs, 2000);
    for (const k of ['vibe', 'palette', 'card', 'zoom', 'glow', 'setByLogin', 'seq', 'updatedAtMs']) assert.ok(k in r.json, k);
});
check('unknown, hash-prefixed, empty and hostile channels all get the SAME house payload (no enumeration oracle)', () => {
    const house = call({ channel: 'definitely_not_a_channel' }).json;
    const variants = [{ channel: '' }, {}, { channel: '#cuhz_bo' }, { channel: ['cuhz_bot'] },
                      { channel: '__proto__' }, { channel: 'constructor' }, { channel: 'x'.repeat(500) }];
    for (const q of variants) {
        const r = call(q);
        assert.equal(r.status, 200);
        assert.deepEqual(r.json, house, JSON.stringify(q));
    }
    assert.equal(house.seq, 0); assert.equal(house.locked, true); assert.equal(house.setByLogin, null);
    assert.equal(house.vibe, 'chill'); assert.equal(house.palette, 'transparent');
});
check('the enabled payload and the house payload share a shape (a client cannot tell them apart structurally)', () => {
    const a = Object.keys(call({ channel: 'cuhz_bot' }).json).sort();
    const b = Object.keys(call({ channel: 'nope' }).json).sort();
    assert.deepEqual(a, b);
});
check('#cuhz_bot (hash form) resolves like cuhz_bot', () => {
    assert.equal(call({ channel: '#cuhz_bot' }).json.cardCount, 5);
    assert.equal(call({ channel: 'CUHZ_BOT' }).json.cardCount, 5);
});
check('the 405 guard middleware is mounted on /api/lounge and never registered as a route', () => {
    // app.use is a no-op in the harness, so assert at source level that the guard
    // sets Allow: GET and refuses everything else.
    const guard = src.slice(src.indexOf("app.use('/api/lounge'"), src.indexOf("app.get('/api/lounge/state'"));
    assert.match(guard, /res\.set\('Allow', 'GET'\)/);
    assert.match(guard, /status\(405\)/);
    assert.match(guard, /req\.method === 'GET'/);
});

console.log(`\n${passed} lounge wiring checks passed (static + inert boot; no network, database or Twitch).`);
