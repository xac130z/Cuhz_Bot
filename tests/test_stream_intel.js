'use strict';
// Reproduces the production failure before asserting the fix: 12,744 lines of
// "function max(integer, unknown) does not exist" in one captured week, one per
// stream poll, because two-argument MAX() is SQLite-only and an undefined bound
// param reaches Postgres as `unknown`. The fake adapter records every SQL string
// and parameter list so the assertions are on what would hit the wire.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

let passed = 0;
const check = (n, f) => { f(); passed++; console.log(`PASS ${n}`); };

function loadWithFakeDb(type) {
    const calls = [];
    const fakeDb = {
        type,
        prepare(sql) {
            return {
                get: async () => null,
                all: async () => [],
                run: async (...params) => { calls.push({ sql, params }); return { changes: 1, lastInsertRowid: 7 }; },
            };
        },
    };
    const fakeLogger = { info() {}, warn() {}, error(m) { calls.push({ error: String(m) }); } };
    const target = path.resolve(__dirname, '..', 'src', 'stream_intel.js');
    const origLoad = Module._load;
    Module._load = function (request, parent, ...rest) {
        if (request === './database') return fakeDb;
        if (request === './logger') return fakeLogger;
        if (request === './ai_service') return {};
        return origLoad.call(this, request, parent, ...rest);
    };
    delete require.cache[target];
    const intel = require(target);
    Module._load = origLoad;
    delete require.cache[target];
    return { intel, calls };
}

check('viewersOf coerces every bad shape to a safe integer', () => {
    const { intel } = loadWithFakeDb('postgres');
    const v = intel.viewersOf;
    assert.equal(v({ viewers: 12 }), 12);
    assert.equal(v({ viewers: '12' }), 12);
    assert.equal(v({ viewers: 12.9 }), 12);
    for (const bad of [undefined, null, NaN, -1, 'lots', Infinity]) assert.equal(v({ viewers: bad }), 0, String(bad));
    assert.equal(v(undefined), 0); assert.equal(v({}), 0);
});

check('postgres: the peak UPDATE uses GREATEST + COALESCE and never two-argument MAX', async () => {
    const { intel, calls } = loadWithFakeDb('postgres');
    await intel.handleLiveStream('#four_a_reason', { isLive: true, viewers: 5 });
    const upd = calls.find(c => c.sql && c.sql.startsWith('UPDATE stream_sessions SET peak_viewers'));
    assert.ok(upd, 'an UPDATE was issued');
    assert.match(upd.sql, /GREATEST\(COALESCE\(peak_viewers, 0\), \?\)/);
    assert.doesNotMatch(upd.sql, /\bMAX\(/, 'MAX(a,b) does not exist on Postgres');
    assert.deepEqual(upd.params, [5, 5, 5, 7]);
    assert.ok(!calls.some(c => c.error), 'no error was logged');
});

check('sqlite: the same UPDATE keeps MAX (GREATEST does not exist there)', async () => {
    const { intel, calls } = loadWithFakeDb('sqlite');
    await intel.handleLiveStream('#four_a_reason', { isLive: true, viewers: 5 });
    const upd = calls.find(c => c.sql && c.sql.startsWith('UPDATE stream_sessions SET peak_viewers'));
    assert.match(upd.sql, /\bMAX\(COALESCE\(peak_viewers, 0\), \?\)/);
    assert.doesNotMatch(upd.sql, /GREATEST/);
});

check('a poll with NO viewer count binds 0, never undefined (the `unknown` half of the error)', async () => {
    const { intel, calls } = loadWithFakeDb('postgres');
    await intel.handleLiveStream('#planetcuhz', { isLive: true });   // no viewers field at all
    for (const c of calls.filter(c => c.params)) {
        for (const p of c.params) assert.ok(p !== undefined && !Number.isNaN(p), `param ${JSON.stringify(p)} in ${c.sql.slice(0, 40)}`);
    }
    const ins = calls.find(c => c.sql && c.sql.startsWith('INSERT INTO stream_sessions'));
    assert.deepEqual(ins.params, ['#planetcuhz', 0, 0]);
});

console.log(`\n${passed} stream-intel checks passed.`);
