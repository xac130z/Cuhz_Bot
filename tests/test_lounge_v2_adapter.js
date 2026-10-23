'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createHmac } = require('node:crypto');
const express = require('express');
const { createLoungeV2Adapter } = require('../src/lounge_v2_adapter');

const origin = 'https://lounge.example.invalid';
const baseEnv = { LOUNGE_V2_ENABLED: 'true', LOUNGE_PUBLIC_ORIGIN: origin };
const defaultRuntime = overrides => ({ handle: async () => new Response('{}'), start() { return { started: true, generationEnabled: false }; }, stop() {}, ...overrides });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, { runtime = defaultRuntime(), env = baseEnv, adapterOptions = {}, before } = {}) {
    let loads = 0;
    const adapter = createLoungeV2Adapter({ env, loadHost: async () => { loads++; return { createHostedLounge: async () => runtime }; }, ...adapterOptions });
    const app = express();
    if (before) before(app);
    app.use(adapter.middleware);
    app.use(express.json());
    app.get('/api/lounge/state', (_req, res) => res.json({ legacy: true }));
    app.get(['/lounge', '/lounge/'], (_req, res) => res.send('legacy OBS'));
    app.get('/lounge/scene.js', (_req, res) => res.send('legacy asset'));
    app.use('/api/lounge', (_req, res) => res.status(405).json({ legacyGuard: true }));
    app.get('/health', (_req, res) => res.json({ ok: true }));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { await adapter.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const request = ({ path = '/api/lounge/v2/stage', method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method,
            headers: { host: 'lounge.example.invalid', ...headers } }, res => {
            const chunks = []; res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
            res.on('error', reject);
        });
        req.on('error', reject); req.end(body);
    });
    return { adapter, request, server, loads: () => loads };
}

test('default off imports nothing and preserves old OBS GET and unrelated health', async t => {
    const f = await fixture(t, { env: {} });
    assert.deepEqual(await f.adapter.start(), { started: false, code: 'LOUNGE_DISABLED' });
    assert.equal(f.loads(), 0);
    assert.equal((await f.request()).status, 503);
    assert.equal((await f.request({ path: '/stage' })).status, 503);
    assert.equal((await f.request({ path: '/lounge/delivery' })).status, 503);
    assert.deepEqual(JSON.parse((await f.request({ path: '/api/lounge/state' })).body), { legacy: true });
    assert.equal((await f.request({ path: '/health' })).status, 200);
});

test('exact private delivery page reaches V2 without taking over existing Lounge OBS paths', async t => {
    const seen = [];
    const f = await fixture(t, { runtime: defaultRuntime({ handle: async request => {
        seen.push(new URL(request.url).pathname);
        return new Response('<main>Private delivery</main>', { headers: { 'Content-Type': 'text/html' } });
    } }) });
    await f.adapter.start();
    const page = await f.request({ path: '/lounge/delivery' });
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.equal(page.body, '<main>Private delivery</main>');
    for (const path of ['/lounge', '/lounge/']) assert.equal((await f.request({ path })).body, 'legacy OBS');
    assert.equal((await f.request({ path: '/lounge/scene.js' })).body, 'legacy asset');
    assert.deepEqual(seen, ['/lounge/delivery']);
});

test('invalid config and loader failure return sanitized unavailable without legacy fallthrough', async t => {
    const f = await fixture(t, { env: { ...baseEnv, LOUNGE_PUBLIC_ORIGIN: 'http://wrong.invalid' } });
    assert.equal((await f.adapter.start()).code, 'LOUNGE_UNCONFIGURED'); assert.equal(f.loads(), 0);
    assert.equal((await f.request({ method: 'POST', body: '{}' })).status, 503);
    const broken = await fixture(t, { adapterOptions: { loadHost: async () => { throw Error('secret fixture must not leak'); } } });
    assert.equal((await broken.adapter.start()).code, 'LOUNGE_UNAVAILABLE');
    const reply = await broken.request(); assert.equal(reply.status, 503); assert.doesNotMatch(reply.body, /secret|fixture/);
});

test('host uses configured origin, admits only explicit ingress host, never trusts forwarded headers', async t => {
    const seen = [];
    const f = await fixture(t, { env: { ...baseEnv, LOUNGE_INGRESS_HOST: 'bot.example.invalid' },
        runtime: defaultRuntime({ handle: async request => { seen.push(request.url); return new Response('ok'); } }) });
    await f.adapter.start();
    assert.equal((await f.request({ headers: { host: 'evil.invalid', 'x-forwarded-host': 'lounge.example.invalid' } })).status, 400);
    assert.equal((await f.request({ headers: { host: 'bot.example.invalid' } })).status, 200);
    assert.equal(seen[0], `${origin}/api/lounge/v2/stage`);
    assert.equal((await f.request({ path: '//evil.invalid/api/lounge/v2/stage' })).status, 400);
    assert.equal((await f.request({ path: 'https://evil.invalid/api/lounge/v2/stage' })).status, 400);
    assert.equal(seen.length, 1);
});

test('host start refusal is unavailable and disposes the partial runtime', async t => {
    let stopped = 0, calls = 0;
    const f = await fixture(t, { runtime: defaultRuntime({ start: async () => ({ started: false }),
        stop: () => { stopped++; }, handle: async () => { calls++; return new Response('bad'); } }) });
    assert.equal((await f.adapter.start()).code, 'LOUNGE_UNAVAILABLE');
    assert.equal((await f.request()).status, 503); assert.equal(calls, 0); assert.equal(stopped, 1);
});

test('raw body, cookies and canonical request headers cross real Express before JSON/legacy guard', async t => {
    const bytes = '{  "text": "exact raw payload" }\n'; let seen;
    const f = await fixture(t, { runtime: defaultRuntime({ handle: async request => {
        seen = { body: Buffer.from(await request.arrayBuffer()).toString(), csrf: request.headers.get('x-lounge-csrf') };
        const headers = new Headers({ 'Content-Type': 'application/json' });
        headers.append('Set-Cookie', '__Host-lounge=one; Path=/; Secure; HttpOnly');
        headers.append('Set-Cookie', '__Host-preauth=; Path=/; Secure; Max-Age=0');
        return new Response('{"ok":true}', { headers });
    } }) });
    await f.adapter.start();
    const response = await f.request({ path: '/api/lounge/auth/callback', method: 'POST', body: bytes,
        headers: { 'content-type': 'application/json', 'x-lounge-csrf': 'fixture-csrf' } });
    assert.equal(response.status, 200); assert.equal(seen.body, bytes); assert.equal(seen.csrf, 'fixture-csrf');
    assert.equal(response.headers['set-cookie'].length, 2);
});

test('oversize and encoded bodies are rejected before host execution', async t => {
    let calls = 0;
    const f = await fixture(t, { runtime: defaultRuntime({ handle: async () => { calls++; return new Response('bad'); } }) });
    await f.adapter.start();
    assert.equal((await f.request({ method: 'POST', body: 'x'.repeat(32769) })).status, 413);
    assert.equal((await f.request({ method: 'POST', body: 'x', headers: { 'content-encoding': 'gzip' } })).status, 415);
    assert.equal(calls, 0);
});

test('slow request and unknown handler outcome do not retry or escape to legacy', async t => {
    let calls = 0;
    const f = await fixture(t, { adapterOptions: { requestTimeoutMs: 20 }, runtime: defaultRuntime({ handle: async () => {
        calls++; await delay(60); return new Response('late');
    } }) });
    await f.adapter.start();
    const response = await f.request({ method: 'POST', body: '{}' });
    assert.equal(response.status, 504); assert.equal(calls, 1); await delay(70);
    assert.equal(f.adapter.status().activeRequests, 0);
});

test('SSE streams immediately and client disconnect aborts host request and cancels body', async t => {
    let cancelled = false, signal;
    const f = await fixture(t, { runtime: defaultRuntime({ handle: async request => {
        signal = request.signal;
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('event: stage\ndata: {"version":1}\n\n')); }, cancel() { cancelled = true; } }),
            { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
    } }) });
    await f.adapter.start();
    await new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port: f.server.address().port, path: '/stage/stream', headers: { host: 'lounge.example.invalid' } }, res => {
            res.once('data', chunk => { assert.match(chunk.toString(), /event: stage/); req.destroy(); resolve(); });
        }); req.on('error', reject);
    });
    for (let i = 0; i < 20 && !cancelled; i++) await delay(5);
    assert.equal(signal.aborted, true); assert.equal(cancelled, true);
});

test('downstream backpressure does not drain an unbounded source', async t => {
    let produced = 0, cancelled = false;
    const f = await fixture(t, { runtime: defaultRuntime({ handle: async () => new Response(new ReadableStream({
        pull(controller) { produced++; controller.enqueue(Buffer.alloc(256 * 1024)); }, cancel() { cancelled = true; }
    }), { headers: { 'Content-Type': 'text/event-stream' } }) }) });
    await f.adapter.start();
    await new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port: f.server.address().port, path: '/stage/stream', headers: { host: 'lounge.example.invalid' } }, res => {
            res.pause(); setTimeout(() => { req.destroy(); resolve(); }, 30);
        }); req.on('error', reject);
    });
    for (let i = 0; i < 20 && !cancelled; i++) await delay(5);
    assert.ok(produced < 100, `produced ${produced} chunks into a paused client`); assert.equal(cancelled, true);
});

test('stop while loading cannot resurrect a runtime and concurrent starts share one import', async () => {
    let release, imports = 0, starts = 0, stops = 0;
    const adapter = createLoungeV2Adapter({ env: baseEnv, loadHost: async () => {
        imports++; await new Promise(resolve => { release = resolve; });
        return { createHostedLounge: async () => defaultRuntime({ start() { starts++; }, stop() { stops++; } }) };
    } });
    const first = adapter.start(), second = adapter.start(); await adapter.stop(); release();
    await Promise.all([first, second]);
    assert.equal(imports, 1); assert.equal(starts, 0); assert.equal(stops, 0); assert.equal(adapter.status().state, 'stopped');
});

test('stop during runtime initialization disposes the late candidate without starting it', async () => {
    let release, starts = 0, stops = 0;
    const adapter = createLoungeV2Adapter({ env: baseEnv, loadHost: async () => ({ createHostedLounge: async () => {
        await new Promise(resolve => { release = resolve; });
        return defaultRuntime({ start() { starts++; }, stop() { stops++; } });
    } }) });
    const pending = adapter.start(); while (!release) await delay(1);
    await adapter.stop(); release(); await pending;
    assert.equal(starts, 0); assert.equal(stops, 1); assert.equal(adapter.status().state, 'stopped');
});

test('capacity is bounded and stopping aborts an in-flight handler without replay', async t => {
    let entered, calls = 0, observed;
    const inHandler = new Promise(resolve => { entered = resolve; });
    const f = await fixture(t, { adapterOptions: { maxRequests: 1 }, runtime: defaultRuntime({ handle: async request => {
        calls++; observed = request.signal; entered(); await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true }));
        return new Response('cancelled');
    } }) });
    await f.adapter.start(); const pending = f.request(); await inHandler;
    assert.equal((await f.request()).status, 503); await f.adapter.stop(); await pending;
    assert.equal(calls, 1); assert.equal(observed.aborted, true);
    assert.equal(f.adapter.status().activeRequests, 0);
});

test('accidental earlier JSON parser fails closed instead of reconstructing signed bytes', async t => {
    let calls = 0;
    const f = await fixture(t, { before: app => app.use(express.json()), runtime: defaultRuntime({ handle: async () => { calls++; return new Response('bad'); } }) });
    await f.adapter.start();
    const result = await f.request({ method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    assert.equal(result.status, 500); assert.equal(calls, 0);
});

test('IRC only supplies public help, consumes actions during outage and ignores mirrored/foreign rooms', async t => {
    const f = await fixture(t); const input = { message: '!lounge create', tags: { 'room-id': '175727753', 'user-id': '123' } };
    assert.match(f.adapter.handleIrc(input).reply, /unavailable/);
    await f.adapter.start();
    const reply = f.adapter.handleIrc(input); assert.equal(reply.handled, true); assert.match(reply.reply, /private website inbox/);
    assert.ok(reply.reply.includes(`${origin}/lounge-pass`), 'help must reach the sign-in page, not the public stage');
    assert.ok(reply.reply.includes(`${origin}/api/lounge/v2/chat/inbox`), 'private results must have a reachable link');
    assert.match(reply.reply, /Creation is unavailable/); assert.match(reply.reply, /No image request was started/);
    assert.match(f.adapter.handleIrc({ ...input, message: '!lounge status' }).reply, /controlled only by Planet CUHZ/);
    assert.doesNotMatch(reply.reply, /queued|success|123/);
    assert.deepEqual(f.adapter.handleIrc({ ...input, tags: { 'room-id': '777' } }), { handled: true });
    assert.deepEqual(f.adapter.handleIrc({ ...input, tags: { 'room-id': '175727753', 'source-room-id': '777' } }), { handled: true });
    assert.deepEqual(f.adapter.handleIrc({ message: '!points' }), { handled: false });
    await f.adapter.stop(); assert.match(f.adapter.handleIrc(input).reply, /unavailable/);
});

test('real vendored signed EventSub boundary accepts exact home-channel event, rejects tamper and mirrors', async t => {
    const { createStageHandler } = await import('../vendor/cuhz-lounge/services/lounge-stage/http.mjs');
    const { isTrustedChatEvent } = await import('../vendor/cuhz-lounge/services/lounge-stage/chat.mjs');
    const secret = 'fixture-only-eventsub-secret-32-characters'; let applied = 0;
    const handler = createStageHandler({ eventSubSecret: secret, runtime: { handleChat: async event => {
        assert.equal(isTrustedChatEvent(event), true); assert.equal(event.text, '!lounge create');
        applied++; return { ok: true, code: 'FIXTURE_ACCEPTED' };
    } } });
    const f = await fixture(t, { runtime: defaultRuntime({ handle: handler }) }); await f.adapter.start();
    const data = { subscription: { type: 'channel.chat.message' }, event: { broadcaster_user_id: '175727753',
        chatter_user_id: '123', message_id: 'fixture-message', message: { text: '!lounge create' } } };
    const send = async (data, tamper = false) => {
        const body = JSON.stringify(data), stamp = new Date().toISOString(), id = 'fixture-notification';
        const signature = 'sha256=' + createHmac('sha256', secret).update(id + stamp).update(body).digest('hex');
        return f.request({ path: '/api/lounge/v2/stage/chat', method: 'POST', body: body + (tamper ? ' ' : ''), headers: {
            'Content-Type': 'application/json', 'Twitch-Eventsub-Message-Id': id,
            'Twitch-Eventsub-Message-Timestamp': stamp, 'Twitch-Eventsub-Message-Signature': signature,
            'Twitch-Eventsub-Message-Type': 'notification' } });
    };
    assert.equal((await send(data)).status, 200); assert.equal(applied, 1);
    assert.equal((await send(data, true)).status, 403);
    assert.equal((await send({ ...data, event: { ...data.event, source_broadcaster_user_id: '777' } })).status, 403);
    assert.equal(applied, 1);
});
