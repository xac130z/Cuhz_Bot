import { isTrustedAuthContext } from '../lounge-auth/runtime.mjs';

const route = '/api/lounge/v2/chat/replies';
const numeric = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const key = value => typeof value === 'string' && /^chat:[A-Za-z0-9_-]{1,100}$/.test(value);
const fixed = new Set([
  'Open CUHZ Lounge to check your session. Stage commands: !lounge show <item>, end, hold, resume, next, clear.',
  'Stage action recorded.',
  'Your prepared three-image request is queued. Check the private Lounge library for its receipt. Publishing is separate.',
  'Creation was not accepted. Open the Lounge to check your saved brief, session and allowance before trying again.',
]);
const safeText = (text, twitchId) => typeof text === 'string' && text.length <= 500 && Buffer.byteLength(text) <= 2000
  && (fixed.has(text) || text === `Your Twitch ID is ${twitchId}.` || /^Stage action unavailable \([A-Z][A-Z0-9_]{0,59}\)\.$/.test(text));
const fail = code => Object.assign(Error(code), { code });
const denied = new Set(['CHAT_INBOX_INVALID_REPLY','CHAT_INBOX_RECIPIENT_UNAVAILABLE','CHAT_INBOX_REPLY_EXPIRED','CHAT_INBOX_FULL','IDEMPOTENCY_CONFLICT']);
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
const noticeKinds = new Set(['confirmed','rescheduled','cancelled','missed','reminder_24h','reminder_1h','reminder_10m','session_receipt']);
function privateNotice(value) {
  const keys = ['id','kind','bookingId','startsAt','endsAt','ownerTimezone','createdAt','deliveredAt','expiresAt','current'];
  if (!value || typeof value !== 'object' || Object.keys(value).length !== keys.length || !keys.every(k => Object.hasOwn(value, k))
    || !uuid(value.id) || !uuid(value.bookingId) || !noticeKinds.has(value.kind) || typeof value.current !== 'boolean'
    || typeof value.ownerTimezone !== 'string' || value.ownerTimezone.length > 100
    || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(value.ownerTimezone)
    || !['startsAt','endsAt','createdAt','deliveredAt','expiresAt'].every(k => typeof value[k] === 'string' && Number.isFinite(Date.parse(value[k])))
    || Date.parse(value.endsAt) - Date.parse(value.startsAt) !== 1800000
    || Date.parse(value.expiresAt) <= Date.now() || Date.parse(value.deliveredAt) > Date.now()
    || Date.parse(value.createdAt) > Date.parse(value.deliveredAt)) throw fail('CHAT_INBOX_UNAVAILABLE');
  new Intl.DateTimeFormat('en-US', { timeZone: value.ownerTimezone }).format();
  return Object.fromEntries(keys.map(k => [k, value[k]]));
}
const pageRoute = '/api/lounge/v2/chat/inbox';
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private CUHZ Lounge inbox</title><link rel="stylesheet" href="${pageRoute}.css"><script defer src="${pageRoute}.js"></script></head><body><main><p class="brand">PLANET CUHZ</p><h1>Your private Lounge inbox</h1><p>Booking notices and replies to your Lounge commands appear here. Artwork stays in your private Studio library.</p><p><a href="/studio">Open Studio, Sessions and your Library</a></p><button id="refresh" type="button">Refresh inbox</button><p id="status" role="status" aria-live="polite"></p><section aria-labelledby="booking-heading"><h2 id="booking-heading">Booking notices</h2><p id="booking-status"></p><ol id="booking-notices" aria-label="Private booking notices"></ol><p class="note">Open Sessions for current availability and check-in. A reminder never grants stage control. These are website inbox notices; email delivery is not active.</p></section><section aria-labelledby="replies-heading"><h2 id="replies-heading">CUHZ Bot replies</h2><ol id="replies" aria-label="Private replies"></ol></section><p class="note">Only your signed-in identity can read this inbox. Notices and replies expire after 30 days; the newest 20 of each are shown.</p></main></body></html>`;
const css = `@import url('/api/lounge/v2/stage/tokens.css');:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:var(--void);color:var(--text-high);font-family:var(--font-sans,system-ui,sans-serif);line-height:1.55}main{max-width:48rem;margin:auto;padding:2rem 1.25rem}.brand{color:var(--cyan);letter-spacing:.12em;font-weight:700}h1{font-size:clamp(1.8rem,5vw,2.6rem)}a{color:var(--cyan)}button{font:inherit;color:var(--void);background:var(--cyan);border:0;border-radius:.5rem;padding:.65rem 1rem;min-height:44px;cursor:pointer}button:disabled{opacity:.6;cursor:wait}a:focus-visible,button:focus-visible{outline:2px solid var(--cyan);outline-offset:4px}ol{list-style:none;padding:0}li{border:1px solid var(--hairline-strong);border-radius:.75rem;padding:1rem;margin:1rem 0;overflow-wrap:anywhere}li p{margin:0 0 .5rem}time,.note{color:var(--text-mid)}#status{min-height:1.6em}`;
const script = `(()=>{'use strict';
const button=document.getElementById('refresh'),status=document.getElementById('status'),list=document.getElementById('replies'),
 notices=document.getElementById('booking-notices'),bookingStatus=document.getElementById('booking-status');let busy=false;
const labels={confirmed:'Booking confirmed',rescheduled:'Booking time changed',cancelled:'Booking cancelled',missed:'Session missed',
 reminder_24h:'Upcoming session',reminder_1h:'Your session is coming up',reminder_10m:'Get ready for your session',session_receipt:'Your session receipt'};
const descriptions={confirmed:'Your reservation is confirmed. Check in at its scheduled start.',rescheduled:'Your reservation moved to this time. The previous time was released.',
 cancelled:'This reservation was cancelled. Open Sessions for the current schedule.',missed:'The check-in window has closed. Open Sessions to review your booking.',
 reminder_24h:'Here is your upcoming reservation. Open Sessions if you need to make a change.',reminder_1h:'Check your reservation and get ready. Check-in opens at the scheduled start.',
 reminder_10m:'Almost time, Cuz. Check-in opens at the scheduled start; this reminder does not grant stage control.',
 session_receipt:'Saved work from this session is in your private Library. Downloading and publishing are separate actions.'};
function clear(){list.replaceChildren();notices.replaceChildren();bookingStatus.textContent='';}
async function load(){if(busy)return;const restoreFocus=document.activeElement===button;busy=true;button.disabled=true;status.textContent='Loading your private inbox…';
 try{const response=await fetch('${route}',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
  if(!response.ok){clear();status.textContent=response.status===401?'Sign in through Studio to read your private replies.':'Your inbox is temporarily unavailable. Try Refresh again.';return;}
  const data=await response.json(),bookings=data.bookingNotices??[];
  if(!Array.isArray(data.replies)||data.replies.length>20||!Array.isArray(bookings)||bookings.length>20)throw Error('invalid');
  const rows=[],noticeRows=[];
  for(const reply of data.replies){if(typeof reply.text!=='string'||reply.text.length>500||!Number.isFinite(Date.parse(reply.createdAt)))throw Error('invalid');
   const row=document.createElement('li'),text=document.createElement('p'),time=document.createElement('time');text.textContent=reply.text;
   time.dateTime=reply.createdAt;time.textContent=new Date(reply.createdAt).toLocaleString();row.append(text,time);rows.push(row);}
  const localZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  for(const n of bookings){if(!Object.hasOwn(labels,n.kind)||typeof n.current!=='boolean'||typeof n.ownerTimezone!=='string'||n.ownerTimezone.length>100
    ||!['startsAt','endsAt','deliveredAt'].every(k=>typeof n[k]==='string'&&Number.isFinite(Date.parse(n[k]))))throw Error('invalid');
   const row=document.createElement('li'),title=document.createElement('strong'),text=document.createElement('p'),slot=document.createElement('p'),time=document.createElement('time');
   title.textContent=labels[n.kind];text.textContent=n.current?descriptions[n.kind]:'Earlier booking notice. Open Sessions for the current status.';
   slot.textContent=new Date(n.startsAt).toLocaleString()+' – '+new Date(n.endsAt).toLocaleTimeString()+' ('+localZone+'). Owner schedule: '+n.ownerTimezone+'.';
   time.dateTime=n.deliveredAt;time.textContent='Received '+new Date(n.deliveredAt).toLocaleString();row.append(title,text,slot,time);noticeRows.push(row);}
  list.replaceChildren(...rows);notices.replaceChildren(...noticeRows);
  bookingStatus.textContent=noticeRows.length?'Your latest booking notices.':'No booking notices yet.';
  status.textContent=rows.length||noticeRows.length?'Your latest private inbox.':'No replies yet. Use !lounge in the CUHZ Bot channel to check available commands, cuhz.';
 }catch{clear();status.textContent='Your inbox is temporarily unavailable. Try Refresh again.';}finally{busy=false;button.disabled=false;
  if(restoreFocus&&(document.activeElement===button||document.activeElement===document.body))button.focus();}}
button.addEventListener('click',load);void load();})();`;
const staticResponse = (body, type, status = 200) => new Response(body, { status, headers: { ...headers, 'Content-Type': type,
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
const signInPage = () => staticResponse('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to CUHZ Lounge</title><main><h1>Sign in to read your private replies</h1><p><a href="/studio">Open Studio and connect with Twitch</a></p></main></html>', 'text/html; charset=utf-8', 401);

/** Durable website-only replies. Host owns lifecycle/cleanup scheduling and
 * supplies the canonical auth broker; no listener, timer or network on import.
 * A timed-out write may commit. Retry only the same operationKey and same text. */
export function createPrivateChatInbox({ query, authenticate, origin, enabled = false, bookingNoticesEnabled = false, timeoutMs = 5000 } = {}) {
  if (typeof query !== 'function' || typeof authenticate !== 'function' || typeof origin !== 'string'
    || new URL(origin).origin !== origin || !origin.startsWith('https:') || typeof enabled !== 'boolean' || typeof bookingNoticesEnabled !== 'boolean'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000) throw fail('CHAT_INBOX_CONFIG_INVALID');
  const bounded = async (work, code = 'CHAT_INBOX_UNAVAILABLE') => {
    let timer;
    try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(fail(code)), timeoutMs);
    })]); } finally { clearTimeout(timer); }
  };
  const resultOf = result => result?.rows?.[0]?.result;
  async function sendPrivateReply(input) {
    if (!enabled) throw fail('CHAT_INBOX_DISABLED');
    if (!input || Object.keys(input).some(name => !['twitchId','operationKey','text'].includes(name))
      || !numeric(input.twitchId) || !key(input.operationKey) || !safeText(input.text, input.twitchId)) throw fail('CHAT_INBOX_INVALID_REPLY');
    let result;
    try { result = resultOf(await bounded(() => query('select public.lounge_chat_inbox_send($1,$2,$3) result',
      [input.twitchId, input.operationKey, input.text]), 'CHAT_INBOX_OUTCOME_UNKNOWN')); }
    catch { throw fail('CHAT_INBOX_OUTCOME_UNKNOWN'); }
    if (result?.ok !== true) throw fail(denied.has(result?.code) ? result.code : 'CHAT_INBOX_OUTCOME_UNKNOWN');
    if (!uuid(result.id) || typeof result.replayed !== 'boolean' || !Number.isFinite(Date.parse(result.expires_at))) throw fail('CHAT_INBOX_OUTCOME_UNKNOWN');
    return { delivered: true, id: result.id, replayed: result.replayed, expiresAt: result.expires_at };
  }
  async function handle(req) {
    if (!enabled) return response({ error: 'CHAT_INBOX_DISABLED' }, 503);
    const url = new URL(req.url);
    if (![route,pageRoute,`${pageRoute}.js`,`${pageRoute}.css`].includes(url.pathname) || url.search) return response({ error: 'NOT_FOUND' }, 404);
    if (req.method !== 'GET') return response({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const topNavigation = url.pathname === pageRoute && req.headers.get('origin') === null
      && ['none','same-origin'].includes(req.headers.get('sec-fetch-site')) && req.headers.get('sec-fetch-mode') === 'navigate' && req.headers.get('sec-fetch-dest') === 'document';
    if (url.origin !== origin || (req.headers.get('origin') !== origin
      && !(req.headers.get('origin') === null && req.headers.get('sec-fetch-site') === 'same-origin') && !topNavigation)) {
      return response({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
    }
    try {
      // Browsers omit Origin on bookmarked top-level GETs. After validating
      // this exact same-origin, read-only navigation above, convey its origin
      // to the unchanged broker. This never applies to API or mutation routes.
      let authRequest = req;
      if (topNavigation) { const requestHeaders = new Headers(req.headers); requestHeaders.set('Origin', origin); authRequest = new Request(req, { headers: requestHeaders }); }
      const context = await bounded(() => authenticate(authRequest));
      if (!isTrustedAuthContext(context) || !uuid(context.sessionId) || !uuid(context.userId) || !numeric(context.twitchId)
        || !Number.isSafeInteger(context.sessionRevision) || context.sessionRevision < 1
        || !Number.isFinite(context.verifiedAt) || context.verifiedAt > Date.now() || Date.now() - context.verifiedAt >= 60_000) {
        return url.pathname === pageRoute ? signInPage() : response({ error: 'AUTH_REQUIRED' }, 401);
      }
      const result = resultOf(await bounded(() => query(bookingNoticesEnabled
        ? 'select public.lounge_private_inbox_read($1,$2,$3,$4) result' : 'select public.lounge_chat_inbox_read($1,$2,$3,$4) result',
        [context.sessionId, context.sessionRevision, context.userId, context.twitchId])));
      if (result?.ok !== true) return result?.code === 'AUTH_REQUIRED' && url.pathname === pageRoute ? signInPage()
        : response({ error: result?.code === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'CHAT_INBOX_UNAVAILABLE' }, result?.code === 'AUTH_REQUIRED' ? 401 : 503);
      if (url.pathname === pageRoute) return staticResponse(html, 'text/html; charset=utf-8');
      if (url.pathname === `${pageRoute}.js`) return staticResponse(script, 'text/javascript; charset=utf-8');
      if (url.pathname === `${pageRoute}.css`) return staticResponse(css, 'text/css; charset=utf-8');
      if (!Array.isArray(result.replies) || result.replies.length > 20) throw fail('CHAT_INBOX_UNAVAILABLE');
      const replies = result.replies.map(reply => {
        if (!uuid(reply?.id) || !safeText(reply.text, context.twitchId) || !Number.isFinite(Date.parse(reply.createdAt))
          || !Number.isFinite(Date.parse(reply.expiresAt)) || Date.parse(reply.expiresAt) <= Date.now()) throw fail('CHAT_INBOX_UNAVAILABLE');
        return { id: reply.id, text: reply.text, createdAt: reply.createdAt, expiresAt: reply.expiresAt };
      });
      if (bookingNoticesEnabled && (!Array.isArray(result.bookingNotices) || result.bookingNotices.length > 20)) throw fail('CHAT_INBOX_UNAVAILABLE');
      return response({ replies, ...(bookingNoticesEnabled ? { bookingNotices: result.bookingNotices.map(privateNotice) } : {}) });
    } catch (error) {
      const authDenied = ['AUTH_REQUIRED','AUTH_IDENTITY_CHANGED','AUTH_CSRF_DENIED','AUTH_ORIGIN_DENIED'].includes(error?.code);
      return authDenied && url.pathname === pageRoute ? signInPage()
        : response({ error: authDenied ? 'AUTH_REQUIRED' : 'CHAT_INBOX_UNAVAILABLE' }, authDenied ? 401 : 503);
    }
  }
  async function cleanup() {
    if (!enabled) return { enabled: false, removed: 0 };
    const result = resultOf(await bounded(() => query('select public.lounge_chat_inbox_cleanup($1) result', [100])));
    if (!Number.isInteger(result?.removed) || result.removed < 0 || result.removed > 100) throw fail('CHAT_INBOX_UNAVAILABLE');
    return { enabled: true, removed: result.removed };
  }
  return Object.freeze({ sendPrivateReply, handle, cleanup });
}
