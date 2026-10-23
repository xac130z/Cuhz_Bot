import {isTrustedAuthContext} from '../lounge-auth/runtime.mjs';
import {normalizeDeliveryInput} from './store.mjs';
const BASE='/api/lounge/v2/deliveries';
const errors=new Set(['INVALID_REQUEST','AUTH_REQUIRED','AUTH_ORIGIN_DENIED','AUTH_CSRF_DENIED','AUTH_DISABLED','AUTH_UNAVAILABLE','AUTH_REFRESH_PENDING',
 'SESSION_RECHECK_REQUIRED','CONNECTION_CHANGED','DELIVERY_DISABLED','RULES_REQUIRED','AGE_ATTESTATION_REQUIRED','DELIVERY_RATE_LIMIT','VERIFICATION_INVALID',
 'DELIVERY_CONSENT_REQUIRED','ADDRESS_VERIFICATION_REQUIRED','ITEM_NOT_FOUND','DELIVERY_NOT_FOUND','DELIVERY_LINK_INVALID','IDEMPOTENCY_CONFLICT']);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"}});
/** Authenticated owner endpoint. No token in querystrings, GET mutations,
 * caller-selected email templates, arbitrary URLs or storage paths. */
export function createDeliveryHandler({broker,store,origin,enabled=false,signDownload,storageOrigin,timeoutMs=5000,now=Date.now}={}){
 if(!broker?.authenticate||!store?.command||new URL(origin).origin!==origin||!origin.startsWith('https://')
  ||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('DELIVERY_HTTP_CONFIG_INVALID');
 if(signDownload&&(typeof signDownload!=='function'||!storageOrigin||new URL(storageOrigin).origin!==storageOrigin||!storageOrigin.startsWith('https://')))throw Error('DELIVERY_DOWNLOAD_CONFIG_INVALID');
 let active=enabled===true,epoch=0;
 return Object.freeze({start(){if(enabled===true&&!active){active=true;epoch++;}},stop(){active=false;epoch++;},async handle(req){
  const url=new URL(req.url),turn=epoch;let timer,reader,started=false,input;const aborter=new AbortController();
  const abort=()=>aborter.abort();req.signal.addEventListener('abort',abort,{once:true});
  const fence=()=>{if(!active||epoch!==turn||req.signal.aborted||aborter.signal.aborted)throw Error('stopped');};
  try{
   if(url.pathname!==BASE||url.search)return json({error:'NOT_FOUND'},404);
   if(!active)return json({error:'DELIVERY_DISABLED'},503);
   if(!['GET','POST'].includes(req.method))return json({error:'METHOD_NOT_ALLOWED'},405);
   if(url.origin!==origin||(req.headers.get('origin')!==origin&&!(req.method==='GET'&&!req.headers.has('origin')&&req.headers.get('sec-fetch-site')==='same-origin')))return json({error:'ORIGIN_NOT_ALLOWED'},403);
   return await Promise.race([(async()=>{
    const context=await broker.authenticate(req,{mutation:req.method==='POST'});fence();
    if(!isTrustedAuthContext(context))return json({error:'AUTH_REQUIRED'},401);
    if(context.verifiedAt>now()||context.verifiedAt<=now()-60000)return json({error:'SESSION_RECHECK_REQUIRED'},401);
    input={action:'list'};
    if(req.method==='POST'){
     if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')||''))return json({error:'INVALID_REQUEST'},400);
     reader=req.body?.getReader();if(!reader)return json({error:'INVALID_REQUEST'},400);
     let bytes=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
     for(;;){const part=await reader.read();fence();if(part.done)break;bytes+=part.value.byteLength;if(bytes>4096)return json({error:'REQUEST_TOO_LARGE'},413);text+=decoder.decode(part.value,{stream:true});}
     text+=decoder.decode();try{input=normalizeDeliveryInput(JSON.parse(text));}catch{return json({error:'INVALID_REQUEST'},400);}
     if(input.action==='list')return json({error:'INVALID_REQUEST'},400);
    }
    fence();started=req.method==='POST';let result=await store.command(context,input);fence();
    if(result?.ok!==true){const code=errors.has(result?.code)?result.code:'DELIVERY_UNAVAILABLE';return json({error:code},code==='SESSION_RECHECK_REQUIRED'?401:code==='DELIVERY_DISABLED'||code==='DELIVERY_UNAVAILABLE'?503:409);}
    if(input.action==='download'){
     if(!signDownload)return json({error:'DELIVERY_DOWNLOAD_UNAVAILABLE'},503);
     if(typeof result.path!=='string'||!result.path.startsWith(context.userId+'/')||!Number.isInteger(result.expiresIn)||result.expiresIn<1||result.expiresIn>600)throw Error('invalid storage authority');
     const signed=await signDownload(result.path,{expiresIn:result.expiresIn,signal:aborter.signal});fence();
     // Revoke/address-change/session expiry while signing must fence the result.
     const checked=await store.command(context,input);fence();
     if(!checked?.ok||checked.path!==result.path||checked.sha256!==result.sha256)return json({error:'DELIVERY_LINK_INVALID'},409);
     const target=new URL(signed.url);
     if(target.origin!==storageOrigin||!target.pathname.startsWith('/storage/v1/object/sign/')||target.username||target.password||target.hash)throw Error('invalid signed URL');
     return json({ok:true,url:target.href,expiresIn:Math.min(result.expiresIn,checked.expiresIn)});
    }
    return json(result);
   })(),new Promise((_,reject)=>{timer=setTimeout(()=>{aborter.abort();reject(Error('timeout'));},timeoutMs);})]);
  }catch(error){const code=errors.has(error?.code)?error.code:started?'DELIVERY_OUTCOME_UNKNOWN':'DELIVERY_UNAVAILABLE';
   return json({error:code,...(code==='DELIVERY_OUTCOME_UNKNOWN'&&input?.requestId?{requestId:input.requestId}:{})},error?.status||503);
  }finally{clearTimeout(timer);aborter.abort();req.signal.removeEventListener('abort',abort);void reader?.cancel().catch(()=>{});}
 }});
}
