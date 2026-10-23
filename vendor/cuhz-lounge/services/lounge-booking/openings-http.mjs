import {readFileSync} from 'node:fs';
import {isTrustedAuthContext} from '../lounge-auth/runtime.mjs';
import {createOwnerControlGate} from '../lounge-stage/owner-control.mjs';
import {validOpeningCommand} from './openings-client.mjs';
const BASE='/api/lounge/v2/bookings';
const script=readFileSync(new URL('./openings-console.mjs',import.meta.url),'utf8');
const client=readFileSync(new URL('./openings-client.mjs',import.meta.url),'utf8');
const styles=readFileSync(new URL('./openings.css',import.meta.url),'utf8');
const failure=(code,status=503)=>Object.assign(Error(code),{code,status});
const allowed=new Set(['STAGE_CONTROL_DISABLED','STAGE_OWNER_UNCONFIGURED','STAGE_OWNER_REQUIRED','AUTH_DISABLED','AUTH_REQUIRED','AUTH_ORIGIN_DENIED','AUTH_CSRF_DENIED','AUTH_IDENTITY_CHANGED','AUTH_UNAVAILABLE','AUTH_REFRESH_PENDING',
 'INVALID_REQUEST','REQUEST_TOO_LARGE','REQUEST_TIMEOUT','SESSION_RECHECK_REQUIRED','CONNECTION_CHANGED','OWNER_ROLE_REQUIRED','IDEMPOTENCY_CONFLICT',
 'ISOLATION_UNSUPPORTED','BOOKING_DISABLED','RESOURCE_NOT_CONFIGURED','WINDOW_ALREADY_EXISTS','WINDOW_NOT_FOUND','WINDOW_ALREADY_PUBLISHED',
 'REVISION_CONFLICT','WINDOW_WITHDRAWN','OUTSIDE_BOOKING_HORIZON','OUTSIDE_OWNER_HOURS','WINDOW_OVERLAP','POLICY_NOT_PUBLISHED']);
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderOpeningsConsole(context){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CUHZ Lounge stage openings</title><meta name="lounge-openings" content="owner"><meta name="lounge-owner" content="${escape(context.userId)}"><meta name="csrf" content="${escape(context.csrfToken)}"><link rel="stylesheet" href="/api/lounge/v2/stage/tokens.css"><link rel="stylesheet" href="/api/lounge/v2/stage/style.css"><link rel="stylesheet" href="${BASE}/openings.css"></head><body class="ops"><main><h1>Stage openings</h1><p><a href="/api/lounge/v2/stage/ops">Stage operator console</a> · <a href="/api/lounge/v2/stage/ops/emergency">Emergency hold</a></p><p>Owner time: America/New_York. Opening days are Monday–Friday, noon to 1 AM the following day. A draft is private until you publish it. Openings do not start the stream or grant image generation.</p><p id="status" role="status" aria-live="polite" tabindex="-1"></p><section id="recovery" class="recovery" hidden><p id="pending-receipt"></p><button id="recover" type="button">Recover same request</button></section><p id="read-status" role="status" aria-live="polite"></p><button id="refresh" type="button">Refresh openings</button><form id="commands"><h2>Create a draft opening</h2><label>Stage and approved policy<select id="resource" required></select></label><p id="policy"></p><label>Opening day (New York)<input id="opening-date" type="date" required></label><label>Start time (New York)<input id="start-time" type="time" step="60" value="12:00" required></label><label>End time (New York)<input id="end-time" type="time" step="60" value="01:00" required></label><p>Times after midnight belong to the following day. Sessions last 30 minutes; the approved policy controls spacing and limits.</p><button id="create" type="submit" disabled>Save private draft</button></form><section class="recovery"><h2>Review and manage openings</h2><label>Opening<select id="opening"></select></label><p id="opening-detail"></p><label>Reason<select id="reason"><option value="owner_schedule">Owner schedule</option><option value="schedule_change">Schedule change</option><option value="safety_stop">Safety stop</option></select></label><label><input id="confirm-action" type="checkbox">I reviewed this opening. Publishing makes its slots bookable. Withdrawing cancels outstanding reservations without member strikes and stops their live control.</label><div class="actions"><button id="publish" type="button" disabled>Publish opening</button><button id="withdraw" type="button" disabled>Withdraw opening</button></div></section><noscript>Enable JavaScript to manage stage openings.</noscript></main><script type="module" src="${BASE}/openings-console.mjs"></script></body></html>`;}

/** Owner reads are private and do not mutate. All writes use the existing cookie
 * session/CSRF broker, then a service-only SQL transaction with durable receipts. */
export function createOpeningsHandler({broker,store,origin,enabled=false,ownerControl,timeoutMs=5000,now=Date.now}={}){
 if(!broker?.authenticate||!store?.read||!store?.write||new URL(origin).origin!==origin||!origin.startsWith('https://')
 ||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('OPENINGS_HTTP_CONFIG_INVALID');
 let active=enabled===true,epoch=0;
 const ownerGate=createOwnerControlGate(ownerControl);
 const reply=(data,status=200,type='application/json')=>new Response(type==='application/json'?JSON.stringify(data):data,{status,headers:{'Content-Type':type,
  'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"}});
 async function bounded(work,signal,code){let timer,abort;try{
  if(signal.aborted)throw failure(code);
  return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure(code)),timeoutMs);abort=()=>reject(failure(code));signal.addEventListener('abort',abort,{once:true});})]);
 }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}}
 async function body(req){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')||''))throw failure('INVALID_REQUEST',400);
  const reader=req.body?.getReader();if(!reader)throw failure('INVALID_REQUEST',400);
  try{return await bounded(async()=>{let text='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});
   for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>4096)throw failure('REQUEST_TOO_LARGE',413);
    try{text+=decoder.decode(part.value,{stream:true});}catch{throw failure('INVALID_REQUEST',400);}}
   let input;try{input=JSON.parse(text+decoder.decode());}catch{throw failure('INVALID_REQUEST',400);}
   if(!validOpeningCommand(input))throw failure('INVALID_REQUEST',400);return input;
  },req.signal,'REQUEST_TIMEOUT');}finally{void reader.cancel().catch(()=>{});}
 }
 async function handle(req){
  const url=new URL(req.url),run=epoch,html=url.pathname===BASE+'/ops',api=url.pathname===BASE+'/openings';
  if(url.search||![BASE+'/ops',BASE+'/openings',BASE+'/openings-console.mjs',BASE+'/openings-client.mjs',BASE+'/openings.css'].includes(url.pathname))return reply({error:'NOT_FOUND'},404);
  if(!active)return reply({error:'BOOKING_DISABLED'},503);
  if(!['GET','POST'].includes(req.method)||(!api&&req.method!=='GET'))return reply({error:'METHOD_NOT_ALLOWED'},405);
  const navigation=html&&req.method==='GET'&&!req.headers.has('origin')&&['none','same-origin'].includes(req.headers.get('sec-fetch-site'))
   &&req.headers.get('sec-fetch-mode')==='navigate'&&req.headers.get('sec-fetch-dest')==='document'
   &&!/prefetch|prerender/i.test(`${req.headers.get('purpose')||''} ${req.headers.get('sec-purpose')||''}`);
  if(url.origin!==origin||(req.headers.get('origin')!==origin&&!(req.method==='GET'&&!req.headers.has('origin')&&req.headers.get('sec-fetch-site')==='same-origin')&&!navigation))return reply({error:'AUTH_ORIGIN_DENIED'},403);
  if(html&&/prefetch|prerender/i.test(`${req.headers.get('purpose')||''} ${req.headers.get('sec-purpose')||''}`))return reply({error:'AUTH_ORIGIN_DENIED'},403);
  let startedWrite=false,requestId;
  try{
   let authRequest=req;if(navigation){const headers=new Headers(req.headers);headers.set('Origin',origin);authRequest=new Request(req,{headers});}
   const context=await bounded(()=>broker.authenticate(authRequest,{mutation:req.method==='POST'}),req.signal,'OPENINGS_UNAVAILABLE');
   if(!isTrustedAuthContext(context))throw failure('AUTH_REQUIRED',401);
   const denied=ownerGate.check(context.twitchId);if(denied)throw failure(denied,denied==='STAGE_OWNER_REQUIRED'?403:503);
   const command=req.method==='POST'?await body(req):null;requestId=command?.requestId;
   if(!active||run!==epoch||req.signal.aborted)throw failure('BOOKING_DISABLED');
   if(context.verifiedAt>now()||context.verifiedAt<=now()-60000)throw failure('SESSION_RECHECK_REQUIRED',401);
   const result=await bounded(()=>{if(!active||run!==epoch||req.signal.aborted)throw failure('BOOKING_DISABLED');
    startedWrite=!!command;return command?store.write(context,command):store.read(context);
   },req.signal,command?'OPENINGS_OUTCOME_UNKNOWN':'OPENINGS_UNAVAILABLE');
   if(!active||run!==epoch)throw failure(startedWrite?'OPENINGS_OUTCOME_UNKNOWN':'BOOKING_DISABLED');
   if(result?.ok!==true){const code=allowed.has(result?.code)?result.code:startedWrite?'OPENINGS_OUTCOME_UNKNOWN':'OPENINGS_UNAVAILABLE';
    return reply({error:code,...(code==='OPENINGS_OUTCOME_UNKNOWN'?{requestId}:{})},code==='OWNER_ROLE_REQUIRED'?403:code.includes('UNAVAILABLE')||code.includes('UNKNOWN')||code==='BOOKING_DISABLED'?503:409);}
   if(html)return reply(renderOpeningsConsole(context),200,'text/html; charset=utf-8');
   if(url.pathname.endsWith('/openings.css'))return reply(styles,200,'text/css; charset=utf-8');
   if(!api)return reply(url.pathname.endsWith('openings-console.mjs')?script:client,200,'text/javascript; charset=utf-8');
   return reply(result);
  }catch(error){const code=allowed.has(error?.code)?error.code:startedWrite?'OPENINGS_OUTCOME_UNKNOWN':'OPENINGS_UNAVAILABLE';
   return reply({error:code,...(code==='OPENINGS_OUTCOME_UNKNOWN'&&requestId?{requestId}:{})},error?.status||503);}
 }
 return Object.freeze({handle,start(){if(enabled===true&&!active){active=true;epoch++;}},stop(){active=false;epoch++;}});
}
