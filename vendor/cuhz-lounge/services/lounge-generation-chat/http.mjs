import { isTrustedAuthContext } from '../lounge-auth/runtime.mjs';
const safe = new Set(['AUTH_REQUIRED','AUTH_DISABLED','AUTH_CSRF_DENIED','AUTH_ORIGIN_DENIED','AUTH_UNAVAILABLE','AUTH_REFRESH_PENDING',
  'CHAT_GENERATION_DISABLED','WEBSITE_SESSION_REQUIRED','INVALID_REQUEST','PROJECT_REVISION_REQUIRED','REFERENCES_REQUIRE_WEBSITE',
  'INVALID_BRIEF','CHAT_GENERATION_UNAVAILABLE','CHAT_PREPARATION_UNKNOWN','REQUEST_TOO_LARGE','REQUEST_TIMEOUT']);
/** Deliberate website preparation only. It accepts project/revision, never prompt,
 * actor, provider configuration, funding, Twitch ID or queue counters. */
export function createGenerationChatHandler({ broker, runtime, origin, enabled = false, timeoutMs = 5000 } = {}) {
  if (!broker?.authenticate || !runtime?.prepare || new URL(origin).origin !== origin || !origin.startsWith('https://')) throw Error('CHAT_GENERATION_CONFIG_INVALID');
  const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" } });
  const bounded = async work => { let timer; try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(Error(), { code: 'REQUEST_TIMEOUT' })), timeoutMs);
  })]); } finally { clearTimeout(timer); } };
  return { async handle(req) {
    if (!enabled) return response({ error: 'CHAT_GENERATION_DISABLED' }, 503);
    const url = new URL(req.url);
    if (url.origin !== origin || req.headers.get('origin') !== origin) return response({ error: 'AUTH_ORIGIN_DENIED' }, 403);
    if (url.pathname !== '/api/lounge/v2/generation-chat/prepare' || url.search) return response({ error: 'NOT_FOUND' }, 404);
    if (req.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405);
    let requestId;
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') || '')) return response({ error: 'INVALID_REQUEST' }, 400);
      const context = await bounded(() => broker.authenticate(req, { mutation: true }));
      if (!isTrustedAuthContext(context)) return response({ error: 'AUTH_REQUIRED' }, 401);
      const reader = req.body?.getReader(); if (!reader) return response({ error: 'INVALID_REQUEST' }, 400);
      let input;
      try { input = await bounded(async () => { let size = 0, text = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
        for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
          if (size > 2048) throw Object.assign(Error(), { code: 'REQUEST_TOO_LARGE' }); text += decoder.decode(part.value, { stream: true }); }
        text += decoder.decode(); try { return JSON.parse(text); } catch { throw Object.assign(Error(), { code: 'INVALID_REQUEST' }); } });
      } finally { void reader.cancel().catch(() => {}); }
      requestId = input?.requestId;
      const result = await runtime.prepare(context, input);
      return response(result, result.ok ? 200 : 409);
    } catch (error) {
      const code = safe.has(error?.code) ? error.code : 'CHAT_GENERATION_UNAVAILABLE';
      return response({ error: code, ...(code === 'CHAT_PREPARATION_UNKNOWN' && typeof requestId === 'string' ? { requestId } : {}) },
        ['AUTH_REQUIRED','AUTH_CSRF_DENIED','AUTH_ORIGIN_DENIED'].includes(code) ? 403 : ['INVALID_REQUEST','REQUEST_TOO_LARGE','INVALID_BRIEF'].includes(code) ? 400 : 503);
    }
  } };
}
