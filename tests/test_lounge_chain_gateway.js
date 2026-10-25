'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createHash, randomUUID } = require('node:crypto');
const express = require('express');
const { PNG } = require('pngjs');
const { createLoungeV2Adapter } = require('../src/lounge_v2_adapter');
const origin = 'https://lounge.example.invalid', base = '/api/lounge/v2/chain';
const limit = 15 * 1024 * 1024;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check) { for (let n = 0; n < 200; n++) { if (check()) return; await delay(5); } throw Error('fixture condition not reached'); }
function image(length = 100000) {
    const png = PNG.sync.write({ width: 2, height: 3, data: Buffer.alloc(24, 255) });
    // Valid private ancillary padding exercises byte limits without allocating
    // a giant decoded image. This is still a real decodable2x3 PNG fixture.
    const padding = Math.max(0, length - png.length - 12), chunk = Buffer.alloc(padding + 12, 0x51);
    chunk.writeUInt32BE(padding); chunk.write('paDd',4);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4,-4)) { crc ^= byte; for (let bit=0;bit<8;bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0,chunk.length-4);
    const bytes = Buffer.concat([png.subarray(0,33),chunk,png.subarray(33)]);
    return { bytes, metadata: { sha256: createHash('sha256').update(bytes).digest('hex'), mime: 'image/png', bytes: bytes.length, width: 2, height: 3 } };
}
async function fixture(t, options = {}) {
    const { createChainHandler } = await import('../vendor/cuhz-lounge/services/lounge-chain/http.mjs');
    const { mintAuthContext } = await import('../vendor/cuhz-lounge/services/lounge-auth/context.mjs');
    const auth = [], writes = [], objects = new Map(), metrics = [];
    const handler = createChainHandler({ origin, enabled: true, timeoutMs: options.handlerTimeoutMs ?? 500,
        broker: { async authenticate(request, config) {
            auth.push({ request, config });
            if (request.headers.get('cookie') !== 'fixture-owner' || request.headers.get('x-lounge-csrf') !== 'fixture-csrf')
                throw Object.assign(Error('private auth detail'), { code: 'AUTH_CSRF_DENIED', status: 403 });
            if (options.authenticate) await options.authenticate(request);
            return mintAuthContext({ sessionId: randomUUID(), sessionRevision: 1, userId: randomUUID(), twitchId: '789', verifiedAt: Date.now() });
        } },
        store: {
            async command() { return { ok: true, projects: [] }; },
            async putAsset(context, metadata, bytes) {
                writes.push({ context, metadata, bytes });
                if (options.putAsset) await options.putAsset(metadata, bytes);
                objects.set(metadata.sha256, { metadata, bytes });
                return { ok: true, asset: metadata, replayed: false };
            },
            async readAsset(_, hash) {
                const item = objects.get(hash);
                return item ? { result: { ok: true, asset: item.metadata }, content: item.bytes } : { result: { ok: false, code: 'ASSET_NOT_FOUND' } };
            },
        } });
    let capability;
    const adapter = createLoungeV2Adapter({ env: { LOUNGE_V2_ENABLED: 'true', LOUNGE_CHAIN_PROJECTS_ENABLED: options.enabled === false ? 'false' : 'true', LOUNGE_PUBLIC_ORIGIN: origin },
        requestTimeoutMs: options.requestTimeoutMs ?? 2000,
        loadHost: async () => ({ createHostedLounge: async config => {
            capability = config.chainBinaryTransport;
            return { start() { handler.start(); return { started: true }; }, stop() { handler.stop(); }, handle: req => handler.handle(req) };
        } }) });
    const app = express();
    app.use((req, res, next) => {
        const metric = { bytes: 0, discardedAfterResponse: 0, reads: 0, req, get responseStatus() { return res.statusCode; } }; metrics.push(metric);
        const read = req.read;
        req.read = function (count) {
            const chunk = read.call(this, count); metric.reads++;
            // Node may discard an unread socket chunk after the final refusal.
            // Count reads before that response separately: those are the bytes
            // a prematurely-pulled request body could expose to the host.
            if (res.writableEnded) metric.discardedAfterResponse += chunk?.length || 0;
            else metric.bytes += chunk?.length || 0;
            return chunk;
        };
        next();
    });
    if (options.before) options.before(app);
    app.use(adapter.middleware); app.use(express.json());
    app.use((_, res) => res.status(599).json({ legacy: true }));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { await adapter.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    assert.equal((await adapter.start()).started, true);
    function open({ path = base, method = 'GET', headers = {}, body, chunked = false, end = true } = {}) {
        let received = false;
        const response = deferred();
        const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method,
            headers: { host: 'lounge.example.invalid', Origin: origin, Cookie: 'fixture-owner', 'X-Lounge-CSRF': 'fixture-csrf', ...headers } }, res => {
            received = true; const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => response.resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks), json: () => JSON.parse(Buffer.concat(chunks).toString()) }));
            res.on('error', error => response.resolve({ networkError: error.code }));
        });
        req.on('error', error => { if (!received) response.resolve({ networkError: error.code }); });
        if (body && chunked) { for (let n = 0; n < body.length; n += 65536) req.write(body.subarray(n, n + 65536)); }
        else if (body && !end) req.write(body);
        if (end) req.end(body && !chunked ? body : undefined); else req.flushHeaders();
        return { req, response: response.promise };
    }
    const upload = (photo, extra = {}) => open({ path: base + '/assets/' + photo.metadata.sha256, method: 'PUT', body: photo.bytes,
        ...extra, headers: { 'Content-Type': 'image/png', 'X-Chain-Metadata': JSON.stringify(photo.metadata), ...extra.headers } });
    return { adapter, handler, server, auth, writes, objects, metrics, open, upload, capability: () => capability };
}

test('binary capability is internal, disabled uploads are unread, and JSON keeps its32KiB limit', async t => {
    const f = await fixture(t, { enabled: false }), photo = image();
    assert.equal(f.capability(), true);
    assert.equal((await f.upload(photo).response).status, 503); assert.equal(f.metrics[0].bytes, 0); assert.equal(f.auth.length, 0);
    assert.equal((await f.open({ method: 'POST', body: 'x'.repeat(32769) }).response).status, 413); assert.equal(f.writes.length, 0);
});
test('authentication and CSRF refusal consume no upload bytes and close the unread connection', async t => {
    const f = await fixture(t), photo = image(512 * 1024);
    for (const headers of [{ Cookie: '' }, { 'X-Lounge-CSRF': '' }, { Origin: 'https://other.invalid' }]) {
        const call = f.upload(photo, { end:false,body:undefined,headers:{ 'Content-Length':String(photo.bytes.length),...headers } });
        const response = await call.response;
        assert.equal(response.status, 403, JSON.stringify({ response,headers })); assert.equal(response.headers.connection, 'close');
        assert.equal(f.metrics.at(-1).bytes, 0);
        call.req.destroy();
    }
    assert.equal(f.writes.length, 0);
});
test('an already-writing refused client cannot turn transport discard into an application body read',async t=>{
    const f=await fixture(t),photo=image(512*1024),response=await f.upload(photo,{headers:{Cookie:''}}).response;
    // A peer still writing after Connection: close can see a TCP close instead
    // of the refusal. The server status and absence of application reads are
    // authoritative in either case; no persistence call is allowed.
    assert.ok(response.status===403||['ECONNRESET','EPIPE'].includes(response.networkError),JSON.stringify(response));
    assert.equal(f.metrics[0].responseStatus,403);assert.equal(f.metrics[0].bytes,0);assert.equal(f.writes.length,0);
});
test('no body is pulled while authentication is pending; a photo larger than32KiB then reaches the actual handler intact', async t => {
    const pending = deferred(), f = await fixture(t, { authenticate: () => pending.promise }), photo = image(1024 * 1024);
    const call = f.upload(photo); await until(() => f.auth.length === 1); await delay(20);
    assert.equal(f.metrics[0].bytes, 0); assert.equal(f.writes.length, 0);
    pending.resolve(); const response = await call.response;
    assert.equal(response.status, 200); assert.equal(f.writes.length, 1); assert.deepEqual(f.writes[0].bytes, photo.bytes);
    const download = await f.open({ path: base + '/assets/' + photo.metadata.sha256 }).response;
    assert.equal(download.status, 200); assert.deepEqual(download.bytes, photo.bytes); assert.equal(download.headers['content-type'], 'application/octet-stream');
});
test('exact15MiB uploads pass; chunked overflow returns413 before any additional SQL write', async t => {
    const f = await fixture(t, { handlerTimeoutMs: 2000, requestTimeoutMs: 5000 }), photo = image(limit);
    const decoded = PNG.sync.read(photo.bytes); assert.equal(decoded.width, 2); assert.equal(decoded.height, 3);
    assert.equal((await f.upload(photo).response).status, 200); assert.equal(f.writes.length, 1);
    const overflow = Buffer.concat([photo.bytes, Buffer.from([1])]);
    const response = await f.upload(photo, { body: overflow, chunked: true }).response;
    assert.equal(response.status, 413); assert.deepEqual(response.json(), { error: 'REQUEST_TOO_LARGE' }); assert.equal(f.writes.length, 1);
    assert.ok(f.metrics.at(-1).bytes <= limit + 1);
});
test('declared oversize, encoding and prior body parsing are rejected before host work', async t => {
    const f = await fixture(t), photo = image();
    assert.equal((await f.upload(photo, { body: undefined, headers: { 'Content-Length': String(limit + 1) } }).response).status, 413);
    assert.equal((await f.upload(photo, { headers: { 'Content-Encoding': 'gzip' } }).response).status, 415);
    assert.equal((await f.upload(photo, { path: base + '/assets/' + photo.metadata.sha256 + '?unexpected=1' }).response).status, 400);
    assert.equal((await f.upload(photo, { path: base + '/assets/../assets/' + photo.metadata.sha256 }).response).status, 400);
    assert.equal(f.auth.length, 0); assert.equal(f.metrics.every(row => row.bytes === 0), true);
    const parsed = await fixture(t, { before: app => app.use(express.raw({ type: '*/*' })) });
    assert.equal((await parsed.upload(image(1000)).response).status, 500); assert.equal(parsed.auth.length, 0);
});
test('a stalled binary body is cancelled and its listeners/slot are released without a write', async t => {
    const f = await fixture(t, { handlerTimeoutMs: 30 }), photo = image(100000);
    const call = f.upload(photo, { end: false, body: photo.bytes.subarray(0, 1000), headers: { 'Content-Length': String(photo.bytes.length) } });
    const response = await call.response; assert.equal(response.status, 408); assert.equal(f.writes.length, 0);
    await until(() => f.adapter.status().activeRequests === 0);
    assert.equal(f.metrics[0].req.listenerCount('readable'), 0); assert.equal(f.metrics[0].req.listenerCount('data'), 0);
    assert.equal((await f.upload(image(1000)).response).status, 200); call.req.destroy();
});
test('client disconnect while reading a photo aborts the host and cannot later dispatch a write', async t => {
    const f = await fixture(t), photo = image();
    const call = f.upload(photo, { end: false, body: photo.bytes.subarray(0, 1000), headers: { 'Content-Length': String(photo.bytes.length) } });
    await until(() => f.auth.length === 1); call.req.destroy();
    await until(() => f.adapter.status().activeRequests === 0);
    assert.equal(f.auth[0].request.signal.aborted, true); assert.equal(f.writes.length, 0);
    assert.equal(f.metrics[0].req.listenerCount('readable'), 0);
});
test('adapter timeout preserves the original digest after dispatch and never retries the database write', async t => {
    const pending = deferred(), f = await fixture(t, { requestTimeoutMs: 25, handlerTimeoutMs: 1000, putAsset: () => pending.promise }), photo = image(1000);
    const response = await f.upload(photo).response;
    assert.equal(response.status, 503); assert.deepEqual(response.json(), { error: 'ASSET_OUTCOME_UNKNOWN', sha256: photo.metadata.sha256 }); assert.equal(f.writes.length, 1);
    pending.resolve(); await delay(10); assert.equal(f.writes.length, 1); assert.equal(f.adapter.status().activeRequests, 0);
});
test('two unresolved physical uploads refuse another body without consumption until the original writes settle', async t => {
    const pending = [deferred(), deferred()]; let index = 0;
    const f = await fixture(t, { handlerTimeoutMs: 20, putAsset: () => pending[index++]?.promise }), photo = image(1000);
    const first = f.upload(photo), second = f.upload(photo);
    for (const response of await Promise.all([first.response, second.response])) assert.equal(response.json().error, 'ASSET_OUTCOME_UNKNOWN');
    assert.equal(f.writes.length, 2);
    const denied = await f.upload(photo).response; assert.equal(denied.status, 429); assert.equal(f.metrics.at(-1).bytes, 0);
    pending.forEach(row => row.resolve()); await delay(10);
    assert.equal((await f.upload(photo).response).status, 200); assert.equal(f.writes.length, 3);
});
