import { isTrustedAuthContext } from '../lounge-auth/runtime.mjs';
import { createOwnerControlGate } from '../lounge-stage/owner-control.mjs';

const BASE = '/api/lounge/v2/bookings';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['hold', 'reschedule', 'confirm', 'cancel', 'check_in', 'end']);
const AUTH_ERRORS = new Set(['AUTH_DISABLED','AUTH_REQUIRED','AUTH_ORIGIN_DENIED','AUTH_CSRF_DENIED',
  'AUTH_IDENTITY_CHANGED','AUTH_UNAVAILABLE','AUTH_REFRESH_PENDING']);
const SQL_ERRORS = new Set(['ISOLATION_UNSUPPORTED','INVALID_REQUEST','SESSION_RECHECK_REQUIRED','CONNECTION_CHANGED',
  'OWNER_ROLE_REQUIRED','IDEMPOTENCY_CONFLICT','BOOKING_DISABLED','ELIGIBILITY_REQUIRED','POLICY_NOT_PUBLISHED',
  'WINDOW_ALREADY_PUBLISHED','OUTSIDE_BOOKING_HORIZON','SLOT_NOT_OPEN','BOOKING_ALREADY_EXISTS','MEMBER_BOOKING_LIMIT',
  'WEEKLY_BOOKING_LIMIT','BOOKING_COOLDOWN','SLOT_UNAVAILABLE','BOOKING_NOT_FOUND','REVISION_CONFLICT','REVISION_LIMIT',
  'HOLD_NOT_CURRENT','BOOKING_NOT_CHECKIN_READY','SESSION_NOT_STARTED','BOOKING_ALREADY_ENDED','STAGE_DISABLED',
  'STAGE_ON_HOLD','CHECKIN_CLOSED','STAGE_OCCUPIED','LEASE_REVOKED','SESSION_INVALID','VERSION_CONFLICT',
  'LEASE_SESSION_MISMATCH','RESOURCE_MISMATCH','BOOKING_REQUIRED','SESSION_NOT_ACTIVE','LEASE_UNAVAILABLE',
  'BOOKING_NOT_RESCHEDULABLE','RESCHEDULE_CLOSED','SLOT_UNCHANGED','BOOKING_IDENTITY_RETIRED']);
const failure = (code, status = 400) => Object.assign(Error(code), { code, status });

/** No listener/timer on import. Mount handle only at BASE and its publish child.
 * stop fences unfinished authentication/body reads; an already-started SQL write
 * may still commit and is reported unknown with its original request ID. */
export function createBookingHandler({ broker, store, origin, enabled = false, ownerControl, timeoutMs = 5_000, now = Date.now } = {}) {
  if (!broker?.authenticate || !store?.read || !store?.write || new URL(origin).origin !== origin
    || !origin.startsWith('https://') || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw Error('BOOKING_HTTP_CONFIG_INVALID');
  }
  let active = enabled === true, epoch = 0;
  const ownerGate = createOwnerControlGate(ownerControl);
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" } });
  async function bounded(work, signal, code = 'BOOKING_UNAVAILABLE') {
    let timer, aborted;
    try {
      if (signal?.aborted) throw failure(code, 503);
      return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
        timer = setTimeout(() => reject(failure(code, 503)), timeoutMs);
        aborted = () => reject(failure(code, 503)); signal?.addEventListener('abort', aborted, { once: true });
      })]);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', aborted); }
  }
  async function body(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') || '')) throw failure('INVALID_REQUEST');
    const reader = req.body?.getReader(); if (!reader) throw failure('INVALID_REQUEST');
    try {
      return await bounded(async () => {
        let text = '', bytes = 0; const decoder = new TextDecoder('utf-8', { fatal: true });
        for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
          if (bytes > 4096) throw failure('REQUEST_TOO_LARGE', 413);
          try { text += decoder.decode(part.value, { stream: true }); } catch { throw failure('INVALID_REQUEST'); } }
        try { text += decoder.decode(); } catch { throw failure('INVALID_REQUEST'); }
        let parsed; try { parsed = JSON.parse(text); } catch { throw failure('INVALID_REQUEST'); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw failure('INVALID_REQUEST');
        return parsed;
      }, req.signal, 'REQUEST_TIMEOUT');
    } finally { void reader.cancel().catch(() => {}); }
  }
  function command(input, publish) {
    const allowed = publish ? ['requestId','windowId','policyVersion'] : ['action','requestId','bookingId','expectedRevision',
      ...(['hold','reschedule'].includes(input.action) ? ['windowId','startsAt','policyVersion'] : [])];
    if (Object.keys(input).some(key => !allowed.includes(key)) || !UUID.test(input.requestId || '')) throw failure('INVALID_REQUEST');
    if (!publish && (!ACTIONS.has(input.action) || !UUID.test(input.bookingId || '') || !Number.isInteger(input.expectedRevision)
      || input.expectedRevision < (input.action === 'hold' ? 0 : 1) || input.expectedRevision > 99
      || (input.action === 'hold' && input.expectedRevision !== 0))) throw failure('INVALID_REQUEST');
    if (publish || ['hold','reschedule'].includes(input.action)) {
      if (!UUID.test(input.windowId || '') || !Number.isInteger(input.policyVersion) || input.policyVersion < 1 || input.policyVersion > 999999999) throw failure('INVALID_REQUEST');
    }
    if (['hold','reschedule'].includes(input.action) && (typeof input.startsAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(input.startsAt)
      || !Number.isFinite(Date.parse(input.startsAt)))) throw failure('INVALID_REQUEST');
    return publish ? { action: 'publish', ...input } : input;
  }
  return Object.freeze({
    start() { if (enabled === true && !active) { active = true; epoch++; } },
    stop() { active = false; epoch++; },
    async handle(req) {
      const url = new URL(req.url), run = epoch;
      if (![BASE, `${BASE}/openings/publish`].includes(url.pathname) || url.search) return reply({ error: 'NOT_FOUND' }, 404);
      if (!active) return reply({ error: 'BOOKING_DISABLED' }, 503);
      const publish = url.pathname !== BASE;
      if (!['GET','POST'].includes(req.method) || (publish && req.method !== 'POST')) return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
      if (url.origin !== origin || (req.headers.get('origin') !== origin
        && !(req.method === 'GET' && !req.headers.has('origin') && req.headers.get('sec-fetch-site') === 'same-origin'))) {
        return reply({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
      }
      let requestId, startedWrite = false;
      try {
        const context = await bounded(() => broker.authenticate(req, { mutation: req.method === 'POST' }), req.signal);
        if (!isTrustedAuthContext(context)) throw failure('AUTH_REQUIRED', 401);
        const input = req.method === 'POST' ? command(await body(req), publish) : null;
        requestId = input?.requestId;
        if (publish || input?.action === 'check_in') {
          const code = ownerGate.check(context.twitchId);
          if (code) throw failure(code, code === 'STAGE_OWNER_REQUIRED' ? 403 : 503);
        }
        if (!active || run !== epoch || req.signal.aborted) throw failure('BOOKING_DISABLED', 503);
        if (context.verifiedAt > now() || context.verifiedAt <= now() - 60_000) throw failure('SESSION_RECHECK_REQUIRED', 401);
        const result = await bounded(() => {
          if (!active || run !== epoch || req.signal.aborted) throw failure('BOOKING_DISABLED', 503);
          startedWrite = input !== null;
          return input ? store.write(context, input) : store.read(context);
        }, req.signal, input ? 'BOOKING_OUTCOME_UNKNOWN' : 'BOOKING_UNAVAILABLE');
        if (!active || run !== epoch) throw failure(startedWrite ? 'BOOKING_OUTCOME_UNKNOWN' : 'BOOKING_DISABLED', 503);
        if (result?.ok !== true) {
          const code = SQL_ERRORS.has(result?.code) ? result.code : 'BOOKING_UNAVAILABLE';
          return reply({ error: code }, code === 'OWNER_ROLE_REQUIRED' ? 403
            : ['SESSION_RECHECK_REQUIRED','SESSION_INVALID'].includes(code) ? 401
            : ['BOOKING_DISABLED','STAGE_DISABLED','BOOKING_UNAVAILABLE'].includes(code) ? 503 : 409);
        }
        return reply(result);
      } catch (error) {
        const local = new Set(['STAGE_CONTROL_DISABLED','STAGE_OWNER_UNCONFIGURED','STAGE_OWNER_REQUIRED','INVALID_REQUEST','REQUEST_TOO_LARGE','REQUEST_TIMEOUT','BOOKING_DISABLED','SESSION_RECHECK_REQUIRED']);
        const code = AUTH_ERRORS.has(error?.code) || local.has(error?.code) ? error.code
          : startedWrite ? 'BOOKING_OUTCOME_UNKNOWN' : 'BOOKING_UNAVAILABLE';
        return reply({ error: code, ...(code === 'BOOKING_OUTCOME_UNKNOWN' && UUID.test(requestId || '') ? { requestId } : {}) }, error?.status || 503);
      }
    },
  });
}
