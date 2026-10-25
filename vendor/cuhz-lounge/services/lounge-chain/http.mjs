import { isTrustedAuthContext } from '../lounge-auth/runtime.mjs';
import { verifyPrivateAsset, assetMetadata, CHAIN_ASSET_LIMIT } from './asset.mjs';
const BASE = '/api/lounge/v2/chain';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const AUTH = new Set(['AUTH_DISABLED','AUTH_REQUIRED','AUTH_ORIGIN_DENIED','AUTH_CSRF_DENIED','AUTH_IDENTITY_CHANGED','AUTH_UNAVAILABLE','AUTH_REFRESH_PENDING']);
const SQL = new Set(['ISOLATION_UNSUPPORTED','SESSION_RECHECK_REQUIRED','CHAIN_DISABLED','OWNER_REQUIRED','CONNECTION_CHANGED','RULES_REQUIRED','AGE_ATTESTATION_REQUIRED',
  'INVALID_REQUEST','ASSET_INVALID','ASSET_MISSING','ASSET_CONFLICT','ASSET_QUOTA','ASSET_NOT_FOUND','REQUEST_NOT_FOUND','PROJECT_NOT_FOUND','PROJECT_LIMIT',
  'REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','VERSION_NOT_FOUND','SESSION_ASSOCIATION_DENIED','SESSION_SAVE_LIMIT','REQUEST_LIMIT']);
const fail = (code, status = 400) => Object.assign(Error(code), { code, status });
const headers = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'" };
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...headers, 'Content-Type':'application/json' } });
/** Same-origin broker endpoint, inert until explicitly mounted and started.
 * Timeout/stop never retries a write. The original receipt/hash remains the
 * recovery key if an already-dispatched database operation may have committed.
 */
export function createChainHandler({ broker, store, origin, enabled = false, timeoutMs = 5000, now = Date.now } = {}) {
  if (typeof broker?.authenticate !== 'function' || !['command','putAsset','readAsset'].every(k => typeof store?.[k] === 'function')
    || new URL(origin).origin !== origin || !origin.startsWith('https://') || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw Error('CHAIN_HTTP_CONFIG_INVALID');
  let active = false, epoch = 0, uploads = 0;
  async function bounded(work, signal) {
    let timer, abort;
    try {
      if (signal.aborted) throw fail('REQUEST_TIMEOUT',408);
      return await Promise.race([Promise.resolve().then(work),new Promise((_,reject) => {
        timer = setTimeout(() => reject(fail('REQUEST_TIMEOUT',408)),timeoutMs);
        abort = () => reject(fail('REQUEST_TIMEOUT',408)); signal.addEventListener('abort',abort,{once:true});
      })]);
    } finally { clearTimeout(timer); signal.removeEventListener('abort',abort); }
  }
  async function body(req, limit) {
    const declared = req.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw fail('REQUEST_TOO_LARGE',413);
    const reader = req.body?.getReader(); if (!reader) throw fail('INVALID_REQUEST');
    try {
      return await bounded(async () => {
        let total = 0; const chunks = [];
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          total += part.value.byteLength; if (total > limit) throw fail('REQUEST_TOO_LARGE',413); chunks.push(part.value);
        }
        return Buffer.concat(chunks,total);
      },req.signal);
    } catch (error) {
      // The bounded Node ingress can reject a chunk before this reader sees it.
      if (error?.code === 'LOUNGE_REQUEST_TOO_LARGE') throw fail('REQUEST_TOO_LARGE',413);
      throw error;
    } finally { void reader.cancel().catch(() => {}); }
  }
  function command(req, url, bytes) {
    if (req.method === 'GET') {
      const query = [...url.searchParams];
      if (!query.length) return { action:'list' };
      if (query.length !== 1 || !['projectId','requestId','bookingId'].includes(query[0][0]) || !UUID.test(query[0][1])) throw fail('INVALID_REQUEST');
      return { action:query[0][0] === 'projectId' ? 'detail' : query[0][0] === 'requestId' ? 'receipt' : 'session_saves', [query[0][0]]:query[0][1].toLowerCase() };
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') || '')) throw fail('INVALID_CONTENT_TYPE',415);
    let value; try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { throw fail('INVALID_REQUEST'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || !['save','link','attest_age'].includes(value.action)
      || !UUID.test(value.requestId || '') || !UUID.test(value.projectId || '')) throw fail('INVALID_REQUEST');
    return value;
  }
  return Object.freeze({ start() { if (enabled && !active) { active = true; epoch++; } }, stop() { active = false; epoch++; },
    async handle(req) {
      const url = new URL(req.url), run = epoch;
      const asset = url.pathname.startsWith(BASE + '/assets/') ? url.pathname.slice((BASE + '/assets/').length) : null;
      if ((url.pathname !== BASE && !/^[a-f0-9]{64}$/.test(asset || '')) || (asset && url.search)) return reply({error:'NOT_FOUND'},404);
      if (!active) return reply({error:'CHAIN_DISABLED'},503);
      if (!(asset ? ['GET','PUT'] : ['GET','POST']).includes(req.method)) return reply({error:'METHOD_NOT_ALLOWED'},405);
      if (url.origin !== origin || (req.headers.get('origin') !== origin && !(req.method === 'GET' && !req.headers.has('origin')
        && req.headers.get('sec-fetch-site') === 'same-origin'))) return reply({error:'ORIGIN_NOT_ALLOWED'},403);
      const mutation = req.method !== 'GET'; let started = false, requestId, ownsUpload = false, uploadFlight = null;
      const releaseUpload = () => { if (ownsUpload) { ownsUpload = false; uploads--; } };
      const current = () => active && run === epoch && !req.signal.aborted;
      try {
        const context = await bounded(() => broker.authenticate(req,{mutation}),req.signal);
        if (!isTrustedAuthContext(context)) throw fail('AUTH_REQUIRED',401);
        const check = () => {
          if (!current()) throw fail('CHAIN_DISABLED',503);
          if (context.verifiedAt > now() || context.verifiedAt <= now() - 60000) throw fail('SESSION_RECHECK_REQUIRED',401);
        };
        check(); let metadata, content, input;
        if (asset && mutation) {
          if (uploads >= 2) throw fail('UPLOAD_BUSY',429);
          uploads++; ownsUpload = true;
          const raw = req.headers.get('x-chain-metadata'); if (!raw || raw.length > 1024) throw fail('ASSET_INVALID');
          try { metadata = assetMetadata(JSON.parse(raw)); } catch { throw fail('ASSET_INVALID'); }
          if (metadata.sha256 !== asset || req.headers.get('content-type') !== metadata.mime) throw fail('ASSET_INVALID');
          content = await body(req,Math.min(metadata.bytes,CHAIN_ASSET_LIMIT)); verifyPrivateAsset(content,metadata);
        } else if (!asset) {
          if (mutation && url.search) throw fail('INVALID_REQUEST');
          input = command(req,url,mutation ? await body(req,16384) : null); requestId = input.requestId;
        }
        check();
        const value = await bounded(() => {
          check(); started = mutation;
          if (asset && mutation) {
            uploadFlight = Promise.resolve().then(() => store.putAsset(context,metadata,content));
            void uploadFlight.then(releaseUpload,releaseUpload);
            return uploadFlight;
          }
          return asset ? store.readAsset(context,asset) : store.command(context,input);
        },req.signal);
        if (!current()) throw fail('CHAIN_DISABLED',503);
        const result = asset && !mutation ? value?.result : value;
        if (result?.ok !== true) {
          const code = SQL.has(result?.code) ? result.code : 'CHAIN_UNAVAILABLE';
          return reply({error:code}, code === 'SESSION_RECHECK_REQUIRED' ? 401 : ['OWNER_REQUIRED','CONNECTION_CHANGED','RULES_REQUIRED','AGE_ATTESTATION_REQUIRED','SESSION_ASSOCIATION_DENIED'].includes(code) ? 403
            : code.endsWith('_NOT_FOUND') ? 404 : ['CHAIN_DISABLED','CHAIN_UNAVAILABLE'].includes(code) ? 503 : code.startsWith('INVALID_') || code === 'ASSET_INVALID' ? 400 : 409);
        }
        if (asset && !mutation) {
          const bytes = Buffer.from(value.content); const meta = verifyPrivateAsset(bytes,result.asset);
          if (meta.sha256 !== asset) throw fail('ASSET_INVALID');
          return new Response(bytes,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(bytes.length),
            'Content-Disposition':`attachment; filename="chain-photo-${asset}.bin"`,'X-Chain-Metadata':JSON.stringify(meta)}});
        }
        return reply(result);
      } catch (error) {
        // A reader/parser failure cannot mutate. A dispatched write is unknown,
        // even if the process stops or its cancellation arrives just afterward.
        if (started) return reply({error:asset?'ASSET_OUTCOME_UNKNOWN':'CHAIN_OUTCOME_UNKNOWN',...(asset?{sha256:asset}:{requestId})},503);
        const local = new Set(['INVALID_REQUEST','INVALID_CONTENT_TYPE','REQUEST_TOO_LARGE','REQUEST_TIMEOUT','ASSET_INVALID','UPLOAD_BUSY','CHAIN_DISABLED','SESSION_RECHECK_REQUIRED']);
        const code = AUTH.has(error?.code) || local.has(error?.code) ? error.code : 'CHAIN_UNAVAILABLE';
        return reply({error:code},(AUTH.has(error?.code) || local.has(error?.code)) && error.status >= 400 && error.status < 600 ? error.status : 503);
      } finally { if (!uploadFlight) releaseUpload(); }
    },
  });
}
