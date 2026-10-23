import { createHmac, timingSafeEqual } from 'node:crypto';
import { isEventSubEnvelopeId } from '../lounge-stage/chat.mjs';
const broadcasterId = '175727753';
const reply = (value, status = 403, type = 'application/json') => new Response(type === 'application/json' ? JSON.stringify(value) : value,
  { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...(type === 'text/plain' ? { 'Content-Length': String(Buffer.byteLength(value)) } : {}) } });
/** Bound one raw-body read, then delegate its exact verified bytes. The signed
 * envelope's shape/status must agree with the unsigned message-type header.
 * Durable revocation prevents a restart replay from restoring a dead grant. */
export function createEventSubIngress({ secret, subscriptionId = null, handleNotification, store, now = Date.now }) {
  if (!store || typeof store.revoked !== 'function' || typeof store.revoke !== 'function'
      || typeof handleNotification !== 'function') throw Error('LOUNGE_EVENTSUB_CONFIG_INVALID');
  const revocationStatuses = new Set(['user_removed', 'authorization_revoked', 'notification_failures_exceeded', 'version_removed']);
  return async request => {
    const type = request.headers.get('twitch-eventsub-message-type');
    if (request.method !== 'POST' || !['notification', 'webhook_callback_verification', 'revocation'].includes(type)) {
      void request.body?.cancel().catch(() => {}); return reply({ error: 'UNTRUSTED_CHAT' });
    }
    if (Number(request.headers.get('content-length') || 0) > 32768) { void request.body?.cancel().catch(() => {}); return reply({ error: 'INVALID_REQUEST' }, 400); }
    const reader = request.body?.getReader(); let timer, bytes;
    try {
      bytes = await Promise.race([(async () => {
        const chunks = []; let length = 0;
        if (!reader) throw Error();
        for (;;) { const part = await reader.read(); if (part.done) break;
          length += part.value.byteLength; if (length > 32768) throw Error(); chunks.push(part.value); }
        return Buffer.concat(chunks, length);
      })(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error()), 4500); })]);
    } catch { return reply({ error: 'INVALID_REQUEST' }, 400); }
    finally { clearTimeout(timer); void reader?.cancel().catch(() => {}); }
    const id = request.headers.get('twitch-eventsub-message-id'), stamp = request.headers.get('twitch-eventsub-message-timestamp');
    const signature = request.headers.get('twitch-eventsub-message-signature') || '', time = Date.parse(stamp), current = now();
    if (!isEventSubEnvelopeId(id) || !Number.isFinite(time) || time > current + 30000 || current - time > 600000 || !/^sha256=[a-f0-9]{64}$/.test(signature)) return reply({ error: 'UNTRUSTED_CHAT' });
    const expected = 'sha256=' + createHmac('sha256', secret).update(id + stamp).update(bytes).digest('hex');
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return reply({ error: 'UNTRUSTED_CHAT' });
    let body; try { body = JSON.parse(bytes.toString('utf8')); } catch { return reply({ error: 'INVALID_REQUEST' }, 400); }
    const sub = body?.subscription;
    if (sub?.type !== 'channel.chat.message' || sub.condition?.broadcaster_user_id !== broadcasterId
        || !/^[A-Za-z0-9_-]{1,100}$/.test(sub.id || '') || (subscriptionId && sub.id !== subscriptionId)) return reply({ error: 'UNTRUSTED_CHAT' });
    if (type === 'revocation') {
      if (!revocationStatuses.has(sub.status) || Object.hasOwn(body, 'event') || Object.hasOwn(body, 'challenge')) return reply({ error: 'UNTRUSTED_CHAT' });
      try { await store.revoke({ id: sub.id, status: sub.status, messageId: id, occurredAt: new Date(time).toISOString() }); }
      catch { return reply({ error: 'CHAT_TRANSPORT_UNAVAILABLE' }, 503); }
      return reply({ received: true }, 200);
    }
    if ((type === 'notification' && (sub.status !== 'enabled' || !body.event || Object.hasOwn(body, 'challenge')))
        || (type === 'webhook_callback_verification' && (sub.status !== 'webhook_callback_verification_pending' || Object.hasOwn(body, 'event')))) return reply({ error: 'UNTRUSTED_CHAT' });
    try { if (await store.revoked(sub.id)) return reply({ error: 'CHAT_SUBSCRIPTION_REVOKED' }); }
    catch { return reply({ error: 'CHAT_TRANSPORT_UNAVAILABLE' }, 503); }
    if (type === 'webhook_callback_verification') {
      if (typeof body.challenge !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(body.challenge)) return reply({ error: 'INVALID_REQUEST' }, 400);
      return reply(body.challenge, 200, 'text/plain');
    }
    return handleNotification(new Request(request.url, { method: 'POST', headers: request.headers, body: bytes, signal: request.signal }));
  };
}
