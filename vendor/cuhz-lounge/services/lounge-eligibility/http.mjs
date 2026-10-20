import { isTrustedAuthContext } from '../lounge-auth/runtime.mjs';
import { publicEligibilityStatus } from './service.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const base = '/api/lounge/v2/eligibility';
const noAuthority = { authorizesPaidGeneration: false, authorizesStageControl: false };
const fail = (code, status = 400) => { throw Object.assign(Error(code), { code, status }); };
const safeErrors = new Set(['AUTH_DISABLED','AUTH_REQUIRED','AUTH_ORIGIN_DENIED','AUTH_CSRF_DENIED','AUTH_IDENTITY_CHANGED',
  'AUTH_UNAVAILABLE','AUTH_REFRESH_PENDING','BODY_INVALID','REQUEST_TOO_LARGE','REQUEST_TIMEOUT','INVALID_CONSENT']);
const consentErrors = new Set(['ALREADY_CONNECTED','IDENTITY_IN_USE','RECONSENT_REQUIRED','INVALID_CONSENT',
  'CONNECTION_CHANGED','MEMBER_DISCONNECTED','SESSION_RECHECK_REQUIRED','IDEMPOTENCY_CONFLICT']);
/** Concrete same-origin handler, deliberately not mounted/listening on import.
 * Host supplies the existing broker and immutable required rules version. */
export function createLoungeEligibilityHandler({ broker, store, service, origin, requiredRulesVersion,
  enabled = false, now = Date.now, timeoutMs = 5_000 } = {}) {
  if (!broker?.authenticate || !store?.connection || !store?.accept || !service?.resolve
    || typeof requiredRulesVersion !== 'string' || !requiredRulesVersion.trim()
    || new URL(origin).origin !== origin || !origin.startsWith('https://')
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw Error('ELIGIBILITY_HTTP_CONFIG_INVALID');
  async function bounded(work, code = 'ELIGIBILITY_UNAVAILABLE') {
    let timer;
    try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(Error(code), { code, status: 503 })), timeoutMs);
    })]); } finally { clearTimeout(timer); }
  }
  async function body(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') || '')) fail('BODY_INVALID');
    const reader = req.body?.getReader(); if (!reader) fail('BODY_INVALID');
    try {
      return await bounded(async () => {
        const decoder = new TextDecoder('utf-8', { fatal: true }); let text = '', size = 0;
        for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
          if (size > 4096) fail('REQUEST_TOO_LARGE', 413); text += decoder.decode(part.value, { stream: true }); }
        text += decoder.decode();
        try { const result = JSON.parse(text); if (!result || typeof result !== 'object' || Array.isArray(result)) fail('BODY_INVALID'); return result; }
        catch { fail('BODY_INVALID'); }
      }, 'REQUEST_TIMEOUT');
    } finally { void reader.cancel().catch(() => {}); }
  }
  return { async handle(req) {
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" } });
    if (!enabled) return reply({ error: 'ELIGIBILITY_DISABLED' }, 503);
    const url = new URL(req.url);
    if (url.origin !== origin || (req.headers.get('origin') !== origin
      && !(req.method === 'GET' && req.headers.get('origin') === null && req.headers.get('sec-fetch-site') === 'same-origin'))) {
      return reply({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
    }
    if (url.search || ![base, `${base}/accept`, `${base}/pilot/start`, `${base}/pilot/grants`, `${base}/pilot/revoke`].includes(url.pathname)) return reply({ error: 'NOT_FOUND' }, 404);
    if (req.method !== (url.pathname === base ? 'GET' : 'POST')) return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    let requestId;
    try {
      const context = await bounded(() => broker.authenticate(req, { mutation: req.method === 'POST' }));
      if (!isTrustedAuthContext(context)) return reply({ error: 'AUTH_REQUIRED' }, 401);
      if (req.method === 'GET') {
        const row = await bounded(() => store.connection(context.userId));
        const accepted = row?.user_id === context.userId && row.twitch_user_id === context.twitchId && row.disconnected_at == null
          && row.rules_accepted_version === requiredRulesVersion && Number.isFinite(Date.parse(row.rules_accepted_at))
          && Date.parse(row.rules_accepted_at) <= now();
        const eligibility = publicEligibilityStatus(await service.resolve(context), now());
        return reply({ loungePass: { accepted, rulesVersion: requiredRulesVersion,
          ...(accepted ? { acceptedAt: new Date(row.rules_accepted_at).toISOString() } : {}) }, eligibility });
      }
      const input = await body(req); requestId = input.requestId;
      if (url.pathname === `${base}/accept`) {
        if (Object.keys(input).some(key => !['requestId','rulesVersion','acceptedAt','acceptRules'].includes(key))
          || !UUID.test(input.requestId || '') || input.acceptRules !== true || input.rulesVersion !== requiredRulesVersion
          || typeof input.acceptedAt !== 'string' || !Number.isFinite(Date.parse(input.acceptedAt))) fail('INVALID_CONSENT');
        const result = await bounded(() => store.accept({ context, requestId, rulesVersion: requiredRulesVersion,
          acceptedAt: input.acceptedAt }), 'CONSENT_OUTCOME_UNKNOWN');
        if (result?.ok !== true) return reply({ error: consentErrors.has(result?.code) ? result.code : 'ELIGIBILITY_UNAVAILABLE' }, 409);
        return reply({ ok: true, requestId, replayed: result.replayed === true, ...noAuthority });
      }
      const action = url.pathname.endsWith('/start') ? 'startPilot' : url.pathname.endsWith('/grants') ? 'issueGrant' : 'revokeGrant';
      const result = await service[action](context, input);
      return reply(result, result.ok ? 200 : result.code === 'OWNER_ROLE_REQUIRED' ? 403
        : ['PILOT_OUTCOME_UNKNOWN', 'PILOT_MANAGEMENT_DISABLED', 'ELIGIBILITY_UNAVAILABLE'].includes(result.code) ? 503 : 409);
    } catch (error) {
      const code = error?.code === 'CONSENT_OUTCOME_UNKNOWN' ? error.code : safeErrors.has(error?.code) ? error.code : 'ELIGIBILITY_UNAVAILABLE';
      return reply({ error: code, ...(code === 'CONSENT_OUTCOME_UNKNOWN' && UUID.test(requestId || '') ? { requestId } : {}) },
        safeErrors.has(code) ? error.status || 503 : 503);
    }
  } };
}
