'use strict';

// No runtime import, listener, timer, database access or provider work on import.
// The signed EventSub boundary lives in the vendored host; IRC is help only.
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const PREFIXES = ['/api/lounge/auth/', '/api/lounge/v2/'];
const exactPaths = new Set(['/api/lounge/auth', '/api/lounge/v2', '/stage', '/lounge/delivery']);
const CHAIN_UPLOAD = /^\/api\/lounge\/v2\/chain\/assets\/([a-f0-9]{64})$/;
const CHAIN_UPLOAD_LIMIT = 15 * 1024 * 1024;
const matchesPath = path => exactPaths.has(path) || PREFIXES.some(prefix => path.startsWith(prefix)) || path.startsWith('/stage/');
const fault = code => Object.assign(new Error(code), { code });
const json = (res, status, code, detail = {}) => {
    if (res.headersSent || res.destroyed) return;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Rejected requests may still have unread/oversized bodies. Do not retain a
    // paused socket for keep-alive or let it become a second request boundary.
    res.setHeader('Connection', 'close');
    res.end(JSON.stringify({ error: code, ...detail }));
};

function parseOrigin(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
        return url;
    } catch { return null; }
}
function ingressHost(value) {
    if (typeof value !== 'string' || !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(value)) return null;
    try {
        const url = new URL(`https://${value}`);
        return url.host === value.toLowerCase() && !url.username && !url.password ? url.host : null;
    } catch { return null; }
}

async function readBody(req, signal, limit) {
    if (req.readableEnded || req.body !== undefined) throw fault('LOUNGE_RAW_BODY_REQUIRED');
    const declared = req.headers['content-length'];
    if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw fault('LOUNGE_REQUEST_TOO_LARGE');
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw fault('LOUNGE_ENCODING_UNSUPPORTED');
    return new Promise((resolve, reject) => {
        let total = 0; const chunks = [];
        const cleanup = () => {
            req.off('data', data); req.off('end', end); req.off('error', error);
            signal.removeEventListener('abort', aborted);
        };
        const fail = error => { cleanup(); req.pause(); reject(error); };
        const data = chunk => {
            total += chunk.length;
            if (total > limit) return fail(fault('LOUNGE_REQUEST_TOO_LARGE'));
            chunks.push(chunk);
        };
        const end = () => { cleanup(); resolve(Buffer.concat(chunks, total)); };
        const error = () => fail(fault('LOUNGE_REQUEST_ABORTED'));
        const aborted = () => fail(fault('LOUNGE_REQUEST_TIMEOUT'));
        if (signal.aborted) return aborted();
        req.on('data', data); req.once('end', end); req.once('error', error);
        signal.addEventListener('abort', aborted, { once: true });
    });
}

// A zero-high-water-mark body does not read IncomingMessage until the host
// authenticates and asks for bytes. Cancellation pauses input without destroying
// the response socket; the adapter sends Connection: close for unread bodies.
// The old raw JSON/EventSub reader is intentionally unchanged.
function chainBody(req, signal) {
    let total = 0, complete = false, cancelled = false, waiting = null;
    const cancel = () => {
        cancelled = true; req.pause();
        waiting?.(fault('LOUNGE_REQUEST_ABORTED'));
    };
    const stream = new ReadableStream({
        async pull(output) {
            try {
                for (;;) {
                    if (cancelled || signal.aborted || req.aborted) throw fault('LOUNGE_REQUEST_ABORTED');
                    if (req.errored) throw fault('LOUNGE_REQUEST_ABORTED');
                    // Read the available partial chunk. Waiting for64KiB while
                    // re-subscribing to an already-readable smaller buffer can
                    // spin the microtask queue and starve incoming I/O/timers.
                    const chunk = req.read(Math.min(64 * 1024, CHAIN_UPLOAD_LIMIT - total + 1, req.readableLength || 64 * 1024));
                    if (chunk) {
                        total += chunk.length;
                        if (total > CHAIN_UPLOAD_LIMIT) throw fault('LOUNGE_REQUEST_TOO_LARGE');
                        output.enqueue(chunk); return;
                    }
                    if (req.readableEnded || (req.complete && req.readableLength === 0)) {
                        complete = true; output.close(); return;
                    }
                    if (req.destroyed) throw fault('LOUNGE_REQUEST_ABORTED');
                    await new Promise((resolve, reject) => {
                        const finish = error => {
                            req.off('readable', readable); req.off('end', readable); req.off('error', failed);
                            req.off('aborted', aborted); signal.removeEventListener('abort', aborted);
                            waiting = null;
                            if (error) reject(error); else resolve();
                        };
                        const readable = () => finish(), failed = () => finish(fault('LOUNGE_REQUEST_ABORTED'));
                        const aborted = () => finish(fault('LOUNGE_REQUEST_ABORTED'));
                        waiting = finish;
                        req.once('readable', readable); req.once('end', readable); req.once('error', failed);
                        req.once('aborted', aborted); signal.addEventListener('abort', aborted, { once: true });
                        if (cancelled || signal.aborted || req.aborted || req.destroyed) aborted();
                    });
                }
            } catch (error) {
                cancel(); output.error(error);
            }
        },
        cancel,
    }, { highWaterMark: 0 });
    return { stream, cancel, get complete() { return complete; } };
}

function createLoungeV2Adapter({ env = process.env, sendPrivateReply, fetchImpl,
    loadHost = () => import('../vendor/cuhz-lounge/services/lounge-host/runtime.mjs'),
    requestTimeoutMs = 15_000, maxBodyBytes = 32_768, maxRequests = 64 } = {}) {
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 60_000
        || !Number.isInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 32_768
        || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 128) throw fault('LOUNGE_ADAPTER_CONFIG');
    const enabled = env.LOUNGE_V2_ENABLED === 'true';
    const origin = parseOrigin(env.LOUNGE_PUBLIC_ORIGIN);
    const extraHost = env.LOUNGE_INGRESS_HOST ? ingressHost(env.LOUNGE_INGRESS_HOST) : null;
    const configured = !!origin && (!env.LOUNGE_INGRESS_HOST || !!extraHost);
    const hosts = new Set([origin?.host, extraHost].filter(Boolean));
    const publicLink = `${origin?.origin || 'https://planetcuhz.com'}/lounge-pass`;
    const inboxLink = `${origin?.origin || 'https://planetcuhz.com'}/api/lounge/v2/chat/inbox`;
    let runtime = null, state = enabled ? 'not_started' : 'disabled', epoch = 0, starting = null;
    let generationEnabled = false, binaryUploads = 0;
    const requests = new Set();

    async function start() {
        if (!enabled) return { started: false, code: 'LOUNGE_DISABLED' };
        if (!configured) { state = 'unavailable'; return { started: false, code: 'LOUNGE_UNCONFIGURED' }; }
        if (runtime && state === 'ready') return { started: true };
        if (starting) return starting;
        const run = ++epoch; state = 'starting';
        const pending = (async () => {
            let candidate;
            try {
                const module = await loadHost();
                if (run !== epoch) return { started: false, code: 'LOUNGE_STOPPED' };
                if (typeof module?.createHostedLounge !== 'function') throw fault('LOUNGE_UNAVAILABLE');
                candidate = await module.createHostedLounge({ env, chainBinaryTransport: true, ...(sendPrivateReply ? { sendPrivateReply } : {}), ...(fetchImpl ? { fetchImpl } : {}) });
                if (!candidate || !['handle', 'start', 'stop'].every(key => typeof candidate[key] === 'function')) throw fault('LOUNGE_UNAVAILABLE');
                if (run !== epoch) { await candidate.stop(); return { started: false, code: 'LOUNGE_STOPPED' }; }
                const result = await candidate.start();
                if (run !== epoch) { await candidate.stop(); return { started: false, code: 'LOUNGE_STOPPED' }; }
                if (result?.started !== true) throw fault('LOUNGE_UNAVAILABLE');
                generationEnabled = result.generationEnabled === true;
                runtime = candidate; state = 'ready'; return { started: true };
            } catch {
                try { await candidate?.stop(); } catch { /* No dependency errors in logs/responses. */ }
                if (run === epoch) state = 'unavailable';
                return { started: false, code: 'LOUNGE_UNAVAILABLE' };
            }
        })();
        starting = pending;
        try { return await pending; } finally { if (starting === pending) starting = null; }
    }
    async function stop() {
        epoch++; state = 'stopped'; generationEnabled = false;
        const current = runtime; runtime = null;
        for (const request of requests) request.abort();
        if (current) await current.stop();
    }

    // This cannot execute a command or manufacture signed-event provenance.
    function handleIrc({ message, tags = {}, legacyEnabled = false } = {}) {
        if (typeof message !== 'string' || !/^!lounge(?:\s|$)/i.test(message)) return { handled: false };
        if (!enabled && legacyEnabled) return { handled: false };
        if (String(tags['room-id'] || '') !== '175727753'
            || (tags['source-room-id'] && String(tags['source-room-id']) !== '175727753')) return { handled: true };
        let reply = `CUHZ Lounge is unavailable right now, cuhz. Check ${publicLink} for updates.`;
        if (state === 'ready') {
            reply = /^!lounge\s+create(?:\s|$)/i.test(message) && !generationEnabled
                ? `Creation is unavailable right now, cuhz. No image request was started. Check your access at ${publicLink}. Your private website inbox: ${inboxLink}.`
                : `Cuhz, sign in and check your access at ${publicLink}. Your private website inbox: ${inboxLink}. The first live test is controlled only by Planet CUHZ; other accounts cannot control the stage.`;
        }
        return { handled: true, reply };
    }

    async function middleware(req, res, next) {
        const target = req.originalUrl || req.url || '';
        // Reject absolute/protocol-relative targets before URL normalization can
        // reinterpret them. Never let a malformed V2 target hit a legacy writer.
        if (!target.startsWith('/') || target.startsWith('//') || /[\\\r\n\0]/.test(target)) return json(res, 400, 'LOUNGE_INVALID_TARGET');
        let url;
        try { url = new URL(target, origin?.origin || 'https://unconfigured.invalid'); } catch { return json(res, 400, 'LOUNGE_INVALID_TARGET'); }
        if (!matchesPath(url.pathname)) return next();
        if (!enabled) return json(res, 503, 'LOUNGE_DISABLED');
        if (!configured) return json(res, 503, 'LOUNGE_UNCONFIGURED');
        if (!hosts.has(String(req.headers.host || '').toLowerCase())) return json(res, 400, 'LOUNGE_HOST_DENIED');
        if (state !== 'ready' || !runtime) return json(res, 503, 'LOUNGE_UNAVAILABLE');
        if (requests.size >= maxRequests) return json(res, 503, 'LOUNGE_CAPACITY');
        const method = req.method || 'GET';
        const binary = method === 'PUT' ? CHAIN_UPLOAD.exec(url.pathname) : null;
        if (binary && env.LOUNGE_CHAIN_PROJECTS_ENABLED !== 'true') return json(res, 503, 'CHAIN_DISABLED');
        if (binary && (url.search || target !== url.pathname)) return json(res, 400, 'LOUNGE_INVALID_TARGET');
        if (binary && binaryUploads >= 2) return json(res, 503, 'LOUNGE_CAPACITY');
        const controller = new AbortController(), run = epoch, current = runtime;
        requests.add(controller);
        if (binary) binaryUploads++;
        const disconnected = () => controller.abort();
        req.once('aborted', disconnected); res.once('close', disconnected);
        let timer = setTimeout(() => controller.abort(), requestTimeoutMs), reply, input, binaryDispatched = false;
        try {
            if (['GET', 'HEAD'].includes(method) && (Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'])) {
                json(res, 400, 'LOUNGE_INVALID_REQUEST'); return;
            }
            let body;
            if (binary) {
                if (req.readableEnded || req.body !== undefined) throw fault('LOUNGE_RAW_BODY_REQUIRED');
                const declared = req.headers['content-length'];
                if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > CHAIN_UPLOAD_LIMIT)) throw fault('LOUNGE_REQUEST_TOO_LARGE');
                if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw fault('LOUNGE_ENCODING_UNSUPPORTED');
                input = chainBody(req, controller.signal); body = input.stream;
            } else body = ['GET', 'HEAD'].includes(method) ? undefined : await readBody(req, controller.signal, maxBodyBytes);
            if (controller.signal.aborted || run !== epoch) throw fault('LOUNGE_REQUEST_ABORTED');
            const headers = new Headers();
            for (const [name, value] of Object.entries(req.headers)) {
                if (['connection', 'transfer-encoding', 'upgrade', 'expect'].includes(name) || value === undefined) continue;
                if (Array.isArray(value)) value.forEach(item => headers.append(name, item)); else headers.set(name, value);
            }
            const request = new Request(url, { method, headers, ...(body === undefined ? {} : { body }), ...(binary ? { duplex: 'half' } : {}), signal: controller.signal });
            const abortPromise = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(fault('LOUNGE_REQUEST_TIMEOUT')), { once: true }));
            const pending = Promise.resolve().then(() => {
                if (run !== epoch || controller.signal.aborted) throw fault('LOUNGE_REQUEST_ABORTED');
                binaryDispatched = !!binary;
                return current.handle(request);
            });
            pending.then(value => { if (controller.signal.aborted) void value?.body?.cancel().catch(() => {}); }, () => {});
            reply = await Promise.race([pending, abortPromise]);
            clearTimeout(timer); timer = null;
            if (run !== epoch || controller.signal.aborted) throw fault('LOUNGE_REQUEST_ABORTED');
            if (!(reply instanceof Response)) throw fault('LOUNGE_UNAVAILABLE');
            res.statusCode = reply.status;
            for (const [name, value] of reply.headers) {
                if (['set-cookie', 'connection', 'transfer-encoding', 'keep-alive'].includes(name)) continue;
                res.setHeader(name, value);
            }
            const cookies = reply.headers.getSetCookie();
            if (cookies.length) res.setHeader('Set-Cookie', cookies);
            if (input && !input.complete) res.setHeader('Connection', 'close');
            if (method === 'HEAD' || !reply.body) { await reply.body?.cancel(); res.end(); return; }
            res.flushHeaders();
            // pipeline honors downstream backpressure and destroys the reader on
            // disconnect; SSE is not buffered into a string or put on a timeout.
            await pipeline(Readable.fromWeb(reply.body), res, { signal: controller.signal });
        } catch (error) {
            if (reply?.body && !reply.body.locked) void reply.body.cancel().catch(() => {});
            const code = error?.code;
            const status = code === 'LOUNGE_REQUEST_TOO_LARGE' ? 413 : code === 'LOUNGE_ENCODING_UNSUPPORTED' ? 415
                : code === 'LOUNGE_RAW_BODY_REQUIRED' ? 500 : code === 'LOUNGE_REQUEST_TIMEOUT' ? 504 : 503;
            if (!res.headersSent && binaryDispatched) json(res, 503, 'ASSET_OUTCOME_UNKNOWN', { sha256: binary[1] });
            else if (!res.headersSent) json(res, status, ['LOUNGE_REQUEST_TOO_LARGE', 'LOUNGE_ENCODING_UNSUPPORTED', 'LOUNGE_REQUEST_TIMEOUT'].includes(code) ? code : 'LOUNGE_UNAVAILABLE');
            else if (!res.destroyed) res.destroy();
        } finally {
            clearTimeout(timer); input?.cancel(); requests.delete(controller); controller.abort();
            if (binary) binaryUploads--;
            req.off('aborted', disconnected); res.off('close', disconnected);
        }
    }
    return Object.freeze({ enabled, start, stop, middleware, handleIrc, status: () => ({ state, activeRequests: requests.size }) });
}

module.exports = { createLoungeV2Adapter };
