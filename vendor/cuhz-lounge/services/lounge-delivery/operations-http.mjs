import {readFileSync} from 'node:fs';
import {isTrustedAuthContext} from '../lounge-auth/runtime.mjs';
import {createOwnerControlGate} from '../lounge-stage/owner-control.mjs';
import {nativeSignInRecovery} from '../lounge-auth/native-recovery.mjs';
import {normalizeOperationsInput} from './operations-store.mjs';
import {MAIL_UUID} from './resend-webhook.mjs';
export const DELIVERY_OPERATIONS_BASE='/api/lounge/v2/deliveries/ops';
const script=readFileSync(new URL('./operations-console.mjs',import.meta.url),'utf8');
const styles=readFileSync(new URL('./operations.css',import.meta.url),'utf8');
const fail=(code,status=503)=>{throw Object.assign(Error(code),{code,status});};
const safe=new Set(['AUTH_REQUIRED','AUTH_DISABLED','AUTH_UNAVAILABLE','AUTH_REFRESH_PENDING','AUTH_IDENTITY_CHANGED','AUTH_ORIGIN_DENIED','AUTH_CSRF_DENIED',
 'SESSION_RECHECK_REQUIRED','CONNECTION_CHANGED','OWNER_ROLE_REQUIRED','RULES_REQUIRED','DELIVERY_OPERATIONS_DISABLED','STAGE_OWNER_REQUIRED','STAGE_OWNER_UNCONFIGURED','STAGE_CONTROL_DISABLED',
 'INVALID_REQUEST','MAIL_NOT_FOUND','ISOLATION_UNSUPPORTED']);
export function renderDeliveryOperations(){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CUHZ Lounge delivery review</title><link rel="stylesheet" href="/api/lounge/v2/stage/tokens.css"><link rel="stylesheet" href="/api/lounge/v2/stage/style.css"><link rel="stylesheet" href="${DELIVERY_OPERATIONS_BASE}/style.css"></head><body class="ops delivery-ops"><main><p class="eyebrow">PLANET CUHZ · PRIVATE OPERATIONS</p><h1>Delivery review</h1><p><a href="/api/lounge/v2/stage/ops">Stage operator console</a> · <a href="/api/lounge/v2/stage/ops/emergency">Emergency hold</a></p><p>Review mail attempts and verified provider acceptance. An accepted message is not proof of inbox delivery. This view cannot send, retry or settle mail.</p><section class="delivery-controls" aria-label="Review controls"><label>Show<select id="scope"><option value="unresolved">Unresolved attempts</option><option value="recent">All recent attempts</option></select></label><button id="refresh" type="button">Refresh review</button><button id="clear" type="button">Clear private view</button></section><p id="status" role="status" aria-live="polite" tabindex="-1">Checking your owner session…</p><p id="checked-at"></p><section aria-labelledby="attempts-title"><h2 id="attempts-title">Mail attempts</h2><p id="empty" hidden>No matching attempts on this page.</p><ul id="attempts" class="attempts"></ul><button id="more" type="button" hidden>Show older attempts</button></section><section id="detail" class="delivery-detail" aria-labelledby="detail-title" hidden><h2 id="detail-title" tabindex="-1">Attempt details</h2><div id="detail-content"></div><button id="close-detail" type="button">Close details</button></section><section class="delivery-explanation"><h2>When an outcome is unknown</h2><p>An unknown outcome stays unresolved until verified evidence identifies the original attempt. Opening this review never sends another message. Older untagged attempts need separate provider investigation.</p><p>Revocation or expiry can close a download link even when the provider accepted its message. Reviewing acceptance does not reopen that link.</p></section><p id="sign-in" hidden><a href="/auth?next=%2Fapi%2Flounge%2Fv2%2Fdeliveries%2Fops">Sign in with the same owner account</a></p><noscript>Enable JavaScript to review delivery evidence.</noscript></main><script type="module" src="${DELIVERY_OPERATIONS_BASE}/console.mjs"></script></body></html>`;}
function queryInput(search){
 const entries=[...search];if(entries.length>2||new Set(entries.map(([k])=>k)).size!==entries.length)fail('INVALID_REQUEST',400);
 if(search.has('mail')){if(entries.length!==1)fail('INVALID_REQUEST',400);return normalizeOperationsInput({action:'detail',mailId:search.get('mail')});}
 if(entries.some(([k])=>!['scope','cursor'].includes(k)))fail('INVALID_REQUEST',400);
 let cursor=null;
 if(search.has('cursor')){
  const encoded=search.get('cursor');if(!encoded||encoded.length>192||!/^[A-Za-z0-9_-]+$/.test(encoded))fail('INVALID_REQUEST',400);
  const bytes=Buffer.from(encoded,'base64url');if(bytes.toString('base64url')!==encoded)fail('INVALID_REQUEST',400);
  try{cursor=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('INVALID_REQUEST',400);}
 }
 return normalizeOperationsInput({action:'list',scope:search.get('scope')??'unresolved',cursor});
}
// Project an explicit metadata allowlist even if a future SQL DTO adds fields.
const itemKeys=['mailId','kind','state','createdAt','startedAt','settledAt','expiresAt','claimId','providerId','bound','evidenceCount','deliveryStatus'];
export function deliveryOperationsProjection(result,action){
 const stamp=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
 const provider=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
 const item=value=>{if(!value||typeof value!=='object'||Array.isArray(value))fail('DELIVERY_OPERATIONS_UNAVAILABLE');
  if(itemKeys.some(k=>!Object.hasOwn(value,k))||typeof value.mailId!=='string'||!MAIL_UUID.test(value.mailId)||!['verification','delivery'].includes(value.kind)
   ||!['queued','sending','unknown','sent','cancelled','expired'].includes(value.state)||!stamp(value.createdAt)||!stamp(value.expiresAt)
   ||![value.startedAt,value.settledAt].every(v=>v===null||stamp(v))||!(value.claimId===null||typeof value.claimId==='string'&&MAIL_UUID.test(value.claimId))
   ||!(value.providerId===null||provider(value.providerId))||typeof value.bound!=='boolean'||!Number.isSafeInteger(value.evidenceCount)||value.evidenceCount<0
   ||![null,'queued','sent','opened','expired','revoked'].includes(value.deliveryStatus))fail('DELIVERY_OPERATIONS_UNAVAILABLE');
  const out=Object.fromEntries(itemKeys.map(k=>[k,value[k]]));
  if(action==='detail'){
   out.boundAt=value.boundAt??null;
   if(!(out.boundAt===null||stamp(out.boundAt))||!Array.isArray(value.evidence)||value.evidence.length>25
    ||value.evidence.some(v=>!v||!stamp(v.occurredAt)||!stamp(v.receivedAt)||!provider(v.providerId)))fail('DELIVERY_OPERATIONS_UNAVAILABLE');
   out.evidence=value.evidence.map(v=>({occurredAt:v.occurredAt,receivedAt:v.receivedAt,providerId:v.providerId}));
  }return out;};
 if(action==='authorize')return {ok:true};
 if(!stamp(result.serverNow))fail('DELIVERY_OPERATIONS_UNAVAILABLE');
 if(action==='detail')return {ok:true,serverNow:result.serverNow,item:item(result.item)};
 if(!['unresolved','recent'].includes(result.scope)||!Array.isArray(result.items)||result.items.length>25)fail('DELIVERY_OPERATIONS_UNAVAILABLE');
 const next=result.nextCursor===null?null:normalizeOperationsInput({action:'list',scope:result.scope,cursor:result.nextCursor}).cursor;
 return {ok:true,serverNow:result.serverNow,scope:result.scope,items:result.items.map(item),nextCursor:next};
}
export function createDeliveryOperationsHandler({broker,store,origin,ownerControl,enabled=false,timeoutMs=5000,now=Date.now}={}){
 if(!broker?.authenticate||!store?.read||new URL(origin).origin!==origin||!origin.startsWith('https://')||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('DELIVERY_OPERATIONS_CONFIG_INVALID');
 let active=enabled===true,epoch=0;const ownerGate=createOwnerControlGate(ownerControl);
 const reply=(body,status=200,type='application/json')=>new Response(type==='application/json'?JSON.stringify(body):body,{status,headers:{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"}});
 return Object.freeze({start(){if(enabled===true&&!active){active=true;epoch++;}},stop(){active=false;epoch++;},async handle(req){
  const url=new URL(req.url),base=DELIVERY_OPERATIONS_BASE,turn=epoch;let timer,abort;
  const fence=()=>{if(!active||epoch!==turn||req.signal.aborted)fail('DELIVERY_OPERATIONS_DISABLED');};
  try{
   if(![base,base+'/data',base+'/console.mjs',base+'/style.css'].includes(url.pathname)||(url.pathname!==base+'/data'&&url.search))return reply({error:'NOT_FOUND'},404);
   if(!active)return reply({error:'DELIVERY_OPERATIONS_DISABLED'},503);
   if(req.method!=='GET')return reply({error:'METHOD_NOT_ALLOWED'},405);
   if(req.body||Number(req.headers.get('content-length')||0)>0)return reply({error:'INVALID_REQUEST'},400);
   const navigation=url.pathname===base&&!req.headers.has('origin')&&['none','same-origin'].includes(req.headers.get('sec-fetch-site'))&&req.headers.get('sec-fetch-mode')==='navigate'&&req.headers.get('sec-fetch-dest')==='document';
   if(/prefetch|prerender/i.test(`${req.headers.get('purpose')||''} ${req.headers.get('sec-purpose')||''}`)||url.origin!==origin
    ||(req.headers.get('origin')!==origin&&!(req.headers.get('origin')===null&&req.headers.get('sec-fetch-site')==='same-origin')&&!navigation))return reply({error:'AUTH_ORIGIN_DENIED'},403);
   let authRequest=req;if(navigation){const headers=new Headers(req.headers);headers.set('Origin',origin);authRequest=new Request(req,{headers});}
   return await Promise.race([(async()=>{
    fence();const context=await broker.authenticate(authRequest);fence();
    if(!isTrustedAuthContext(context))fail('AUTH_REQUIRED',401);
    const denied=ownerGate.check(context.twitchId);if(denied)fail(denied,denied==='STAGE_OWNER_REQUIRED'?403:503);
    if(!Number.isFinite(context.verifiedAt)||context.verifiedAt>now()||context.verifiedAt<=now()-60000)fail('SESSION_RECHECK_REQUIRED',401);
    const input=url.pathname===base+'/data'?queryInput(url.searchParams):{action:'authorize'};
    fence();const result=await store.read(context,input);fence();
    if(result?.ok!==true){const code=safe.has(result?.code)?result.code:'DELIVERY_OPERATIONS_UNAVAILABLE';fail(code,['AUTH_REQUIRED','SESSION_RECHECK_REQUIRED'].includes(code)?401:['OWNER_ROLE_REQUIRED','STAGE_OWNER_REQUIRED'].includes(code)?403:code==='MAIL_NOT_FOUND'?404:code==='INVALID_REQUEST'?400:503);}
    if(url.pathname===base)return reply(renderDeliveryOperations(),200,'text/html; charset=utf-8');
    if(url.pathname===base+'/console.mjs')return reply(script,200,'text/javascript; charset=utf-8');
    if(url.pathname===base+'/style.css')return reply(styles,200,'text/css; charset=utf-8');
    return reply(deliveryOperationsProjection(result,input.action));
   })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),timeoutMs);abort=()=>reject(Error('aborted'));req.signal.addEventListener('abort',abort,{once:true});})]);
  }catch(error){const code=safe.has(error?.code)?error.code:'DELIVERY_OPERATIONS_UNAVAILABLE';
   const recovery=nativeSignInRecovery(req,code);return reply(recovery??{error:code},error?.status||503,recovery?'text/html; charset=utf-8':'application/json');
  }finally{clearTimeout(timer);req.signal.removeEventListener('abort',abort);}
 }});
}
