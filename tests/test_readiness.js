'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createReadinessService } = require('../src/readiness_service');
const { evaluateBotBoot, readBotSource } = require('./helpers/isolated_bot_boot');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function fakeClock() {
    let time = 1000000, nextId = 0, scheduled = 0;
    const timers = new Map();
    return {
        now: () => time,
        setTimer(callback, delay) {
            scheduled++;
            const id = ++nextId;
            timers.set(id, { callback, at: time + delay });
            return id;
        },
        clearTimer: id => timers.delete(id),
        timerCount: () => timers.size,
        scheduledCount: () => scheduled,
        advance(ms) {
            const target = time + ms;
            while (true) {
                const next = [...timers.entries()].filter(([, timer]) => timer.at <= target)
                    .sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                time = next[1].at;
                timers.delete(next[0]);
                next[1].callback();
            }
            time = target;
        }
    };
}

function harness(probe = async () => true) {
    const clock = fakeClock();
    let client = { readyState: () => 'OPEN' }, calls = 0;
    const service = createReadinessService({
        ...clock,
        getClient: () => client,
        probeDatabase: () => { calls++; return probe(); }
    });
    return { service, clock, calls: () => calls, client: value => { client = value; } };
}

test('factory and module are inert, and deadline/cache configurations stay bounded', () => {
    const h = harness();
    assert.equal(h.calls(), 0);
    assert.equal(h.clock.scheduledCount(), 0);
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../src/readiness_service.js'), 'utf8'), /\brequire\s*\(/);
    const deps = { getClient: () => null, probeDatabase: async () => true };
    for (const patch of [{ deadlineMs: 0 }, { deadlineMs: 5001 }, { cacheMs: 0 }, { cacheMs: 30001 }]) {
        assert.throws(() => createReadinessService({ ...deps, ...patch }), /bounded/);
    }
});

test('null, disconnected, malformed and throwing IRC clients never probe the database', async () => {
    const h = harness();
    for (const client of [null, undefined, {}, { readyState: 'OPEN' },
        { readyState: () => 'CONNECTING' }, { readyState: () => 'CLOSED' },
        { readyState: () => { throw new Error('private client error'); } }]) {
        h.client(client);
        assert.equal(await h.service.check(), false);
    }
    const clock = fakeClock();
    const service = createReadinessService({ ...clock,
        getClient: () => { throw new Error('private client lookup'); },
        probeDatabase: () => { throw new Error('must not probe'); }
    });
    assert.equal(await service.check(), false);
    assert.equal(h.calls(), 0);
    assert.equal(h.clock.scheduledCount(), 0);
    assert.equal(clock.scheduledCount(), 0);
});

test('healthy cache limits probes, but current IRC and stale database state are checked honestly', async () => {
    let databaseReady = true;
    const h = harness(async () => databaseReady);
    assert.equal(await h.service.check(), true);
    h.clock.advance(4999);
    assert.equal(await h.service.check(), true);
    assert.equal(h.calls(), 1);
    h.client(null);
    assert.equal(await h.service.check(), false, 'a cached DB result cannot vouch for disconnected IRC');
    h.client({ readyState: () => 'OPEN' });
    databaseReady = false;
    h.clock.advance(1);
    assert.equal(await h.service.check(), false, 'expired healthy cache must be reprobed');
    assert.equal(h.calls(), 2);
    databaseReady = true;
    assert.equal(await h.service.check(), false, 'failed probes are cached too');
    h.clock.advance(5000);
    assert.equal(await h.service.check(), true);
    assert.equal(h.calls(), 3);
    assert.equal(h.clock.timerCount(), 0);
});

test('failed, null, rejected and synchronously throwing database probes fail closed and recover', async () => {
    for (const fail of [() => false, () => null, () => undefined,
        () => Promise.reject(new Error('private database details')),
        () => { throw new Error('private database details'); }]) {
        let recovering = false;
        const h = harness(() => recovering ? true : fail());
        assert.equal(await h.service.check(), false);
        recovering = true;
        h.clock.advance(5000);
        assert.equal(await h.service.check(), true);
        assert.equal(h.calls(), 2);
        assert.equal(h.clock.timerCount(), 0);
    }
});

test('concurrent polling shares one deadline and a hung physical probe never gets replacement probes', async () => {
    const h = harness(() => new Promise(() => {}));
    const pending = Array.from({ length: 100 }, () => h.service.check());
    await flush();
    assert.equal(h.calls(), 1);
    assert.equal(h.clock.scheduledCount(), 1);
    h.clock.advance(1999);
    let completed = false;
    pending[0].then(() => { completed = true; });
    await flush();
    assert.equal(completed, false);
    h.clock.advance(1);
    assert.ok((await Promise.all(pending)).every(value => value === false));
    h.clock.advance(60000);
    assert.ok((await Promise.all(Array.from({ length: 100 }, () => h.service.check()))).every(value => value === false));
    assert.equal(h.calls(), 1, 'public deadlines must not create unbounded underlying queries');
    assert.equal(h.clock.scheduledCount(), 1);
    assert.equal(h.clock.timerCount(), 0);
});

test('a late probe cannot revive timed-out health; fresh completed work permits recovery', async () => {
    let finish;
    const h = harness(() => h.calls() === 1 ? new Promise(resolve => { finish = resolve; }) : true);
    const pending = h.service.check();
    await flush();
    h.clock.advance(2000);
    assert.equal(await pending, false);
    finish(true);
    await flush();
    assert.equal(await h.service.check(), false, 'late success cannot refresh a failed deadline as healthy');
    h.clock.advance(5000);
    assert.equal(await h.service.check(), true);
    assert.equal(h.calls(), 2);
});

test('IRC loss during a shared DB probe or before its waiters resume cannot return ready', async () => {
    let finish;
    const h = harness(() => new Promise(resolve => { finish = resolve; }));
    const pending = [h.service.check(), h.service.check()];
    await flush();
    h.client({ readyState: () => 'CLOSED' });
    finish(true);
    assert.deepEqual(await Promise.all(pending), [false, false]);
    assert.equal(h.calls(), 1);

    const clock = fakeClock();
    let checks = 0, connected = true, release;
    const service = createReadinessService({ ...clock,
        getClient: () => ({ readyState() {
            const state = connected ? 'OPEN' : 'CLOSED';
            // Two initial caller checks, then publish sees OPEN but the client
            // disconnects before the promise waiters get their own turn.
            if (++checks === 3) connected = false;
            return state;
        } }),
        probeDatabase: () => new Promise(resolve => { release = resolve; })
    });
    const waiting = [service.check(), service.check()];
    await flush();
    release(true);
    assert.deepEqual(await Promise.all(waiting), [false, false]);
    assert.ok(checks >= 5, 'each shared-result waiter must recheck its own current client');
});

function inertBot({ open = false, getRow = async () => ({ ready: 1 }) } = {}) {
    const clock = fakeClock(), sql = [];
    const evidence = evaluateBotBoot(`${readBotSource()}\nclient = app.locals.fixtureClient;`, {
        appLocals: { fixtureClient: open ? { readyState: () => 'OPEN' } : null },
        './database': { ready: Promise.resolve(), prepare(query) {
            sql.push(query);
            assert.equal(query, 'SELECT 1 AS ready');
            return { get: getRow };
        } },
        // Run the real readiness factory with deterministic clocks. All DB and
        // chat ports remain inert; listener callbacks are never invoked.
        readinessService: { createReadinessService: deps => createReadinessService({ ...deps, ...clock }) }
    });
    const route = evidence.routes.find(row => row.method === 'GET' && row.route === '/ready');
    async function request() {
        const reply = { code: 200, headers: {}, body: null };
        const res = {
            set(key, value) { reply.headers[key] = value; return res; },
            status(code) { reply.code = code; return res; },
            json(body) { reply.body = JSON.parse(JSON.stringify(body)); return res; }
        };
        await route.handlers[0]({}, res);
        return reply;
    }
    return { evidence, clock, sql, route, request };
}

test('complete inert bot registers a minimal no-store /ready without changing legacy health routes', async () => {
    const h = inertBot();
    assert.equal(h.evidence.reachedEnd, true);
    assert.deepEqual(h.evidence.forbiddenAttempts, []);
    assert.equal(h.sql.length, 0);
    assert.equal(h.clock.scheduledCount(), 0, 'no readiness timer at boot');
    assert.equal(h.evidence.routes.filter(row => row.route === '/ready').length, 1);
    assert.equal(h.route.handlers.length, 1);
    const result = await h.request();
    assert.deepEqual(result, { code: 503, headers: { 'Cache-Control': 'no-store' }, body: { status: 'not_ready' } });
    assert.equal(h.sql.length, 0, 'offline IRC needs no DB work');
    const health = h.evidence.routes.find(row => row.method === 'GET' && row.route === '/health');
    let legacy;
    health.handlers[0]({}, { json: body => { legacy = JSON.parse(JSON.stringify(body)); } });
    assert.deepEqual(legacy, { status: 'ok', connected: false });
    const full = h.evidence.routes.find(row => row.method === 'GET' && row.route === '/health/full');
    assert.equal(full.handlers.length, 2, 'full diagnostics still require existing dashboard authentication');
});

test('actual route reports IRC plus SELECT 1 only, shares polling, and never exposes database/error fields', async () => {
    const h = inertBot({ open: true, getRow: async () => ({ ready: 1, private_details: 'must not leak' }) });
    const results = await Promise.all(Array.from({ length: 50 }, () => h.request()));
    for (const result of results) assert.deepEqual(result,
        { code: 200, headers: { 'Cache-Control': 'no-store' }, body: { status: 'ready' } });
    assert.deepEqual(h.sql, ['SELECT 1 AS ready']);
    assert.equal(h.clock.scheduledCount(), 1);
    assert.equal(h.clock.timerCount(), 0);
    for (const getRow of [async () => null, async () => ({ ready: 0 }),
        async () => { throw new Error('private database host/password/query error'); }]) {
        const failed = await inertBot({ open: true, getRow }).request();
        assert.deepEqual(failed, { code: 503, headers: { 'Cache-Control': 'no-store' }, body: { status: 'not_ready' } });
    }
});

test('actual route times out once and stays bounded while an adapter query remains hung', async () => {
    const h = inertBot({ open: true, getRow: () => new Promise(() => {}) });
    const pending = Array.from({ length: 20 }, () => h.request());
    await flush();
    assert.deepEqual(h.sql, ['SELECT 1 AS ready']);
    h.clock.advance(2000);
    for (const result of await Promise.all(pending)) assert.deepEqual(result.body, { status: 'not_ready' });
    h.clock.advance(60000);
    assert.equal((await h.request()).code, 503);
    assert.equal(h.sql.length, 1);
    assert.equal(h.clock.scheduledCount(), 1);
});
