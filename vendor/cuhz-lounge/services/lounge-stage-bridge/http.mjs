import {consoleHtml,consoleScript,consoleStyle} from './console.mjs';
const base='/api/lounge/v2/stage-bridge';
const routes=new Map([['/activity','activity'],['/activity/revoke','activity_revoke'],['/import','import'],['/review','review'],['/review/decide','decide'],['/publication/revoke','revoke']]);
const safe=new Set(['BRIDGE_DISABLED','BRIDGE_BUSY','OUTPUT_VERIFICATION_UNAVAILABLE','BRIDGE_UNAVAILABLE','BRIDGE_OUTCOME_UNKNOWN','AUTH_REQUIRED','AUTH_UNAVAILABLE','AUTH_DISABLED','AUTH_CSRF_DENIED','AUTH_ORIGIN_DENIED','AUTH_REFRESH_PENDING','INVALID_REQUEST','REQUEST_TOO_LARGE','REQUEST_TIMEOUT','SESSION_RECHECK_REQUIRED','SIGN_IN_REQUIRED','OPERATOR_REQUIRED','LIBRARY_BRIDGE_DISABLED','OUTPUT_NOT_VERIFIED','ASSET_UNAVAILABLE']);
export function createStageBridgeHandler({runtime,origin,enabled=false,timeoutMs=5000}={}){
 if(!runtime||new URL(origin).origin!==origin||!origin.startsWith('https://')||timeoutMs<1||timeoutMs>12000)throw Error('BRIDGE_CONFIG_INVALID');
 const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"};
 const response=(body,status=200,type='application/json')=>new Response(type==='application/json'?JSON.stringify(body):body,{status,headers:{...headers,'Content-Type':type}});
 async function body(req){let timer;const reader=req.body?.getReader();if(!reader)throw Object.assign(Error(),{code:'INVALID_REQUEST'});try{return await Promise.race([(async()=>{let bytes=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>4096)throw Object.assign(Error(),{code:'REQUEST_TOO_LARGE'});text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();try{return JSON.parse(text);}catch{throw Object.assign(Error(),{code:'INVALID_REQUEST'});}})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error(),{code:'REQUEST_TIMEOUT'})),timeoutMs);})]);}finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}}
 return async req=>{if(!enabled)return response({error:'BRIDGE_DISABLED'},503);const url=new URL(req.url),route=url.pathname.slice(base.length);let requestId;
  const operatorHtml=req.method==='GET'&&url.pathname===base+'/ops'&&!url.search;
  if(operatorHtml&&/prefetch|prerender/i.test(`${req.headers.get('purpose')||''} ${req.headers.get('sec-purpose')||''}`))return response({error:'AUTH_ORIGIN_DENIED'},403);
  const navigation=operatorHtml&&req.headers.get('origin')===null&&['none','same-origin'].includes(req.headers.get('sec-fetch-site'))
   &&req.headers.get('sec-fetch-mode')==='navigate'&&req.headers.get('sec-fetch-dest')==='document';
  if(url.origin!==origin||!(req.headers.get('origin')===origin||(req.method==='GET'&&req.headers.get('origin')===null&&req.headers.get('sec-fetch-site')==='same-origin')||navigation))return response({error:'AUTH_ORIGIN_DENIED'},403);
  if(!url.pathname.startsWith(base+'/')||url.search)return response({error:'NOT_FOUND'},404);
  try{
   if(req.method==='GET'){
    if(route==='/member')return response(await runtime.member(req));
    if(route==='/reviews')return response(await runtime.reviews(req));
    const match=/^\/reviews\/([a-f0-9-]{36})\/image$/.exec(route);if(match){const image=await runtime.reviewImage(req,match[1]);return response(image.bytes,200,image.contentType);}
    if(['/ops','/console.js','/console.css'].includes(route)){
     // Only the exact operator HTML navigation receives this normalization.
     // Online identity and the SQL review permission remain mandatory.
     let authRequest=req;if(navigation){const requestHeaders=new Headers(req.headers);requestHeaders.set('Origin',origin);authRequest=new Request(req,{headers:requestHeaders});}
     const context=await runtime.authenticate(authRequest,{operator:true});if(route==='/ops')return response(consoleHtml(context.csrfToken),200,'text/html; charset=utf-8');if(route==='/console.js')return response(consoleScript,200,'text/javascript; charset=utf-8');return response(consoleStyle,200,'text/css; charset=utf-8');}
   }
   if(req.method!=='POST')return response({error:'METHOD_NOT_ALLOWED'},405);const action=routes.get(route);if(!action)return response({error:'NOT_FOUND'},404);
   if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')||''))return response({error:'INVALID_REQUEST'},400);
   const input=await body(req);requestId=input?.requestId;const result=await runtime.command(req,action,input);return response(result,result?.ok?200:409);
  }catch(error){const code=safe.has(error?.code)?error.code:'BRIDGE_UNAVAILABLE';return response({error:code,...(code==='BRIDGE_OUTCOME_UNKNOWN'&&typeof requestId==='string'?{requestId}:{})},['AUTH_REQUIRED','AUTH_CSRF_DENIED','AUTH_ORIGIN_DENIED','OPERATOR_REQUIRED','SIGN_IN_REQUIRED'].includes(code)?403:['INVALID_REQUEST','REQUEST_TOO_LARGE','OUTPUT_NOT_VERIFIED'].includes(code)?400:503);}
 };
}
