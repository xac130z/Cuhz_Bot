import { publicStage } from './dto.mjs';
import { trustedObsStreamGrant } from './obs-access.mjs';
const encode = value => new TextEncoder().encode(value);
const fail = code => Object.assign(Error(code), { code });
/** One shared poll timer and read, with separate bounded public/OBS admission.
 * Pending reads consume their lane immediately. Nothing starts on import. */
export function createStageStreams({ read, heartbeatMs = 10_000, maxClients = 20, maxObsClients = 2,
  queueBytes = 65_536, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof read !== 'function' || !Number.isFinite(heartbeatMs) || heartbeatMs < 10
    || !Number.isInteger(maxClients) || maxClients < 1 || maxClients > 100
    || !Number.isInteger(maxObsClients) || maxObsClients < 1 || maxObsClients > 2
    || !Number.isInteger(queueBytes) || queueBytes < 1024 || queueBytes > 65_536
    || typeof now !== 'function' || typeof setTimer !== 'function' || typeof clearTimer !== 'function') throw Error('STAGE_STREAM_CONFIG_INVALID');
  const clients = new Set(), publicClients = new Set(), obsClients = new Map();
  let timer = null, epoch = 0, polling = null, reading = null;
  function remove(client, code = 'STAGE_STREAM_STOPPED') {
    if (!client || !clients.delete(client)) return;
    publicClients.delete(client);
    if (client.grant && obsClients.get(client.grant.id) === client) obsClients.delete(client.grant.id);
    client.detach?.(); if (client.expiryTimer !== null) clearTimer(client.expiryTimer);
    client.reject?.(fail(code));
    try { client.controller?.close(); } catch { /* already closed */ }
    if (!clients.size && timer) { clearInterval(timer); timer = null; }
  }
  function authorized(client) {
    if (!clients.has(client)) return false;
    if (client.grant && (now() < client.grant.issuedAt || now() >= client.grant.expiresAt)) {
      remove(client, 'STAGE_OBS_EXPIRED'); return false;
    }
    return true;
  }
  function write(client, chunk) {
    if (!authorized(client) || !client.controller) return;
    if (client.controller.desiredSize < chunk.byteLength) return remove(client);
    try { client.controller.enqueue(chunk); } catch { remove(client); }
  }
  function deliver(client, snapshot) {
    if (!authorized(client) || !client.controller) return;
    const safe = publicStage(snapshot), body = JSON.stringify(safe);
    if (safe.version === client.version && client.snapshot?.mode === 'live_session' && safe.mode === 'live_session'
      && Date.parse(safe.endsAt) > Date.parse(client.snapshot.endsAt)) return;
    const fresh = Date.parse(safe.freshUntil);
    const restrictive = safe.mode === 'hold' || (client.snapshot?.artwork && !safe.artwork) || (client.snapshot?.activity && !safe.activity)
      || (safe.mode === 'live_session' && Date.parse(safe.endsAt) < Date.parse(client.snapshot?.endsAt));
    if (safe.version < client.version || (safe.version === client.version && Number.isFinite(fresh) && fresh < client.fresh && !restrictive) || body === client.body) return;
    client.version = safe.version; client.body = body; client.snapshot = safe;
    if (Number.isFinite(fresh)) client.fresh = fresh;
    write(client, encode(`id: ${safe.version}\nevent: snapshot\ndata: ${body}\n\n`));
  }
  function publish(snapshot) { for (const client of clients) deliver(client, snapshot); }
  function readOnce() {
    if (!reading) {
      const entry = { epoch, promise: Promise.resolve().then(read) }; reading = entry;
      void entry.promise.finally(() => { if (reading === entry) reading = null; }).catch(() => {});
    }
    const entry = reading;
    return entry.promise.then(snapshot => {
      if (entry.epoch !== epoch) throw fail('STAGE_STREAM_STOPPED');
      return snapshot;
    });
  }
  async function poll() {
    if (polling || !clients.size) return;
    const current = epoch, pending = {}; polling = pending;
    try {
      const snapshot = await readOnce(); if (current !== epoch) return; publish(snapshot);
      for (const client of clients) write(client, encode(': heartbeat\n\n'));
    } catch { if (current === epoch) for (const client of [...clients]) remove(client); }
    finally { if (polling === pending) polling = null; }
  }
  async function admit(signal, grant) {
    if (signal?.aborted) throw fail('STAGE_STREAM_STOPPED');
    if (grant) {
      if (now() < grant.issuedAt || now() >= grant.expiresAt) throw fail('STAGE_OBS_EXPIRED');
      const prior = obsClients.get(grant.id);
      if (prior) remove(prior, 'STAGE_STREAM_REPLACED');
      if (obsClients.size >= maxObsClients) throw fail('STAGE_STREAM_CAPACITY');
    } else if (publicClients.size >= maxClients) throw fail('STAGE_STREAM_CAPACITY');
    const current = epoch, client = { grant, controller: null, version: -1, fresh: 0, body: null, detach: null, expiryTimer: null, reject: null };
    const cancellation = new Promise((_, reject) => { client.reject = reject; });
    clients.add(client);
    if (grant) obsClients.set(grant.id, client); else publicClients.add(client);
    const abort = () => remove(client);
    signal?.addEventListener('abort', abort, { once: true });
    client.detach = () => signal?.removeEventListener('abort', abort);
    if (grant) {
      client.expiryTimer = setTimer(() => remove(client, 'STAGE_OBS_EXPIRED'), grant.expiresAt - now());
      client.expiryTimer?.unref?.();
    }
    try {
      const snapshot = await Promise.race([readOnce(), cancellation]);
      if (current !== epoch || !authorized(client)) throw fail('STAGE_STREAM_STOPPED');
      const stream = new ReadableStream({
        start(controller) {
          client.controller = controller; write(client, encode('retry: 2000\n\n')); deliver(client, snapshot);
          if (clients.size && !timer) { timer = setInterval(poll, heartbeatMs); timer.unref?.(); }
        }, cancel() { remove(client); },
      }, new ByteLengthQueuingStrategy({ highWaterMark: queueBytes }));
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' } });
    } catch (error) { remove(client); throw error; }
  }
  function connect(signal) { return admit(signal, null); }
  function connectObs(signal, candidate) {
    const grant = trustedObsStreamGrant(candidate);
    if (!grant) return Promise.reject(fail('STAGE_OBS_DENIED'));
    return admit(signal, grant);
  }
  function stop() {
    epoch++; reading = null; polling = null;
    for (const client of [...clients]) remove(client);
    if (timer) { clearInterval(timer); timer = null; }
  }
  return Object.freeze({ connect, connectObs, publish, stop, count: () => clients.size,
    counts: () => ({ public: publicClients.size, obs: obsClients.size }) });
}
