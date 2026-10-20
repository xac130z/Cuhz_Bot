import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { verifyStageChat } from './chat.mjs';
const base='/api/lounge/v2/stage';
const safeCodes=new Set(['STAGE_DISABLED','STAGE_OBS_DISABLED','STAGE_OBS_DENIED','STAGE_OBS_EXPIRED','STAGE_STREAM_REPLACED','SIGN_IN_REQUIRED','AUTHENTICATION_UNAVAILABLE','OPERATOR_REQUIRED','STAGE_UNAVAILABLE','STAGE_OUTCOME_UNKNOWN','ASSET_UNAVAILABLE','STAGE_STREAM_CAPACITY','STAGE_STREAM_STOPPED','INVALID_REQUEST','REQUEST_TOO_LARGE','REQUEST_TIMEOUT','NOT_FOUND','METHOD_NOT_ALLOWED','UNTRUSTED_CHAT','AUTH_DISABLED','AUTH_REQUIRED','AUTH_ORIGIN_DENIED','AUTH_CSRF_DENIED','AUTH_IDENTITY_CHANGED','AUTH_UNAVAILABLE','AUTH_REFRESH_PENDING']);
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stylesheet=`:root{color-scheme:dark}body{font:16px system-ui;margin:2rem;background:#000014;color:#F4F6FF}button,input,select{font:inherit;padding:.7rem;margin:.4rem;min-height:44px}button:focus-visible,input:focus-visible{outline:2px solid #00EAFF}#status{min-height:2rem}body.stage{background:transparent;margin:0;width:1920px;height:1080px;overflow:hidden}#art{position:absolute;inset:54px 96px;max-width:1728px;max-height:972px;object-fit:contain}#caption{position:absolute;left:96px;bottom:54px;max-width:1600px;background:#000014ee;padding:18px;font-size:36px}#credit{font-size:28px}.stage [hidden]{display:none}`;
const opsScript=`const status=document.querySelector('#status');let version=0;async function refresh(){const r=await fetch('${base}/ops/state',{credentials:'same-origin'});const j=await r.json();if(!r.ok)throw Error(j.error||'Unavailable');version=j.version;status.textContent='Stage: '+j.mode+' · version '+version;}document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const action=e.submitter.value;const reason=document.querySelector('#reason').value;const item=document.querySelector('#item').value.trim();const body={action,reason,request_id:crypto.randomUUID(),expected_version:version};if(item&&action==='showcase')body.item_id=item;try{const r=await fetch('${base}/commands',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Lounge-CSRF':document.querySelector('meta[name=csrf]').content},body:JSON.stringify(body)});const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||j.code||'Unavailable');await refresh();}catch(err){status.textContent=err.message+'; refresh status before another action.';}});document.querySelector('#refresh').addEventListener('click',()=>refresh().catch(e=>status.textContent=e.message));refresh().catch(e=>status.textContent=e.message);`;
const emergencyScript=`document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const status=document.querySelector('#status');try{const r=await fetch('${base}/commands',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Lounge-CSRF':document.querySelector('meta[name=csrf]').content},body:JSON.stringify({action:'hold',reason:'safety_stop',request_id:crypto.randomUUID()})});const result=await r.json();status.textContent=r.ok&&result.ok?'Emergency hold recorded.':(result.error||result.code||'Hold unavailable');}catch{status.textContent='Outcome unknown. Refresh stage status before another action.';}});`;
const stageAssets=new Map([
 ['renderer.js',['./renderer.mjs','text/javascript; charset=utf-8']],
 ['renderer-model.mjs',['./renderer-model.mjs','text/javascript; charset=utf-8']],
 ['renderer-feed.mjs',['./renderer-feed.mjs','text/javascript; charset=utf-8']],
 ['dto.mjs',['./dto.mjs','text/javascript; charset=utf-8']],
 ['renderer.css',['./renderer.css','text/css; charset=utf-8']],
 ['tokens.css',['../../src/styles/tokens.css','text/css; charset=utf-8']],
].map(([path,[file,type]])=>[`${base}/${path}`,{body:readFileSync(new URL(file,import.meta.url),'utf8'),type}]));
const stageBody=`<main id="stage-scene" data-view="connecting" data-motion="on" data-reveal="still" aria-busy="true">
 <div class="stage-atmosphere" aria-hidden="true"></div><div class="stage-orbit" aria-hidden="true"></div>
 <header class="stage-header"><span class="stage-planet" aria-hidden="true"></span><div class="stage-wordmark">PLANET CUHZ<span class="stage-eyebrow">CUHZ Bot · CREATOR STAGE</span></div></header>
 <div class="stage-badge">PRIVATE CREATION. APPROVED REVEAL.</div>
 <div class="reveal-platform"><div class="capsule-shadow" aria-hidden="true"></div>
  <div class="capsule-axis" aria-hidden="true"><div class="capsule-face capsule-back"></div><div class="capsule-face capsule-left"></div><div class="capsule-face capsule-right"></div><div class="capsule-face capsule-top"></div><div class="capsule-face capsule-bottom"></div><div class="capsule-face capsule-front"><div class="capsule-seal"><span class="capsule-monogram">CUHZ</span><span class="capsule-micro">PLANET EDITION</span><span class="capsule-line"></span></div></div></div>
  <article class="stage-card" aria-label="Revealed artwork"><div class="stage-card-inner"><div class="card-topline"><span>CUHZ LOUNGE</span><span class="card-dot" aria-hidden="true"></span></div><div id="card-art"></div><div class="card-caption"><h1 id="art-title"></h1><p id="art-creator"></p><div id="art-label"></div></div></div></article>
 </div>
 <section class="stage-status" role="status" aria-live="polite" aria-atomic="true"><span id="stage-phase" class="stage-phase">CUHZ LOUNGE</span><h2 id="stage-message">Connecting to the Lounge</h2><p id="stage-detail">The stage will appear when its connection is ready.</p><p id="stage-member" hidden></p></section>
 <ol class="stage-story" aria-label="Creation stages"><li data-phase="queued">Queued</li><li data-phase="creating">Creating</li><li data-phase="review">Final check</li><li data-phase="reveal">Reveal</li></ol>
 <div class="stage-motion"><button id="motion-toggle" type="button" aria-pressed="false">Pause motion</button><small>Keyboard shortcut: P</small></div>
</main>`;
function page(body,{ops=false,emergency=false,csrf='',layout='presentation'}={}){return `<!doctype html><html lang="en" class="${ops?'ops-document':'stage-document'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CUHZ Lounge ${ops?'Operator Console':'Stage'}</title>${ops?`<meta name="csrf" content="${escape(csrf)}">`:''}<link rel="stylesheet" href="${base}/tokens.css"><link rel="stylesheet" href="${base}/style.css">${ops?'':`<link rel="stylesheet" href="${base}/renderer.css">`}</head><body class="${ops?'ops':'stage'}" data-layout="${layout}">${body}<script ${ops?'':'type="module" '}src="${base}/${emergency?'emergency':ops?'ops':'renderer'}.js" defer></script></body></html>`;}
async function bodyBytes(req,limit=4096,timeoutMs=5000){if(Number(req.headers.get('content-length')||0)>limit)throw Object.assign(Error(),{code:'REQUEST_TOO_LARGE'});const reader=req.body?.getReader();if(!reader)return new Uint8Array();const chunks=[];let total=0,timer;try{return await Promise.race([(async()=>{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit)throw Object.assign(Error(),{code:'REQUEST_TOO_LARGE'});chunks.push(value);}return Buffer.concat(chunks,total);})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error(),{code:'REQUEST_TIMEOUT'})),timeoutMs);})]);}finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}}
export function createStageHandler({runtime,eventSubSecret,bodyTimeoutMs=5000}={}){
 if(!runtime)throw Error('STAGE_HTTP_CONFIG_INVALID');
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
 const response=(body,status=200,type='application/json')=>new Response(type==='application/json'?JSON.stringify(body):body,{status,headers:{...headers,'Content-Type':type}});
 return async req=>{let requestId;try{
  const url=new URL(req.url),route=url.pathname;
  if(req.method==='GET'&&route==='/stage/obs/stream'){
   const entries=[...url.searchParams];
   if(entries.length!==1||entries[0][0]!=='token'||!entries[0][1]||entries[0][1].length>768)return response({error:'STAGE_OBS_DENIED'},403);
   if(typeof runtime.obsStream!=='function')return response({error:'STAGE_OBS_DISABLED'},503);
   return await runtime.obsStream(req.signal,entries[0][1]);
  }
  if(url.search)return response({error:'NOT_FOUND'},404);
  if(req.method==='GET'&&route===`${base}/style.css`)return response(stylesheet,200,'text/css; charset=utf-8');
  if(req.method==='GET'&&stageAssets.has(route)){const asset=stageAssets.get(route);return response(asset.body,200,asset.type);}
  if(req.method==='GET'&&route===`${base}/emergency.js`){await runtime.emergencyConsole(req);return response(emergencyScript,200,'text/javascript; charset=utf-8');}
  if(req.method==='GET'&&route===`${base}/ops/emergency`){const context=await runtime.emergencyConsole(req);return response(page('<main><h1>CUHZ Lounge emergency hold</h1><p>This recovery control uses your current owner session. It does not load private data or other controls.</p><p id="status" role="status" aria-live="polite"></p><form><button type="submit">EMERGENCY HOLD</button></form></main>',{ops:true,emergency:true,csrf:context.csrfToken}),200,'text/html; charset=utf-8');}
  if(req.method==='GET'&&route===`${base}/ops.js`){await runtime.operator(req);return response(opsScript,200,'text/javascript; charset=utf-8');}
  // A safe cold shell survives a database/flag outage; data routes remain gated.
  if(req.method==='GET'&&['/stage','/stage/overlay','/stage/obs'].includes(route))return response(page(stageBody,{layout:route.endsWith('/overlay')?'overlay':'presentation'}),200,'text/html; charset=utf-8');
  if(req.method==='GET'&&route==='/stage/stream')return await runtime.stream(req.signal);
  if(req.method==='GET'&&route.startsWith('/stage/assets/')){const object=await runtime.asset(route.slice('/stage/assets/'.length));return response(object.bytes,200,object.contentType);}
  if(req.method==='GET'&&route===base)return response(await runtime.read());
  if(req.method==='GET'&&route===`${base}/ops/state`){await runtime.operator(req);return response(await runtime.read());}
  if(req.method==='GET'&&route===`${base}/ops`){
   // A bookmark/reload omits Origin. Normalize only this read-only HTML
   // navigation; the broker still checks its configured origin, online session
   // and durable operator role. API, asset and mutation requests stay unchanged.
   if(/prefetch|prerender/i.test(`${req.headers.get('purpose')||''} ${req.headers.get('sec-purpose')||''}`))return response({error:'AUTH_ORIGIN_DENIED'},403);
   const navigation=req.headers.get('origin')===null&&['none','same-origin'].includes(req.headers.get('sec-fetch-site'))
    &&req.headers.get('sec-fetch-mode')==='navigate'&&req.headers.get('sec-fetch-dest')==='document';
   let authRequest=req;if(navigation){const requestHeaders=new Headers(req.headers);requestHeaders.set('Origin',url.origin);authRequest=new Request(req,{headers:requestHeaders});}
   const context=await runtime.operator(authRequest);if(typeof context.csrfToken!=='string')throw Object.assign(Error(),{code:'AUTHENTICATION_UNAVAILABLE'});return response(page(`<main><h1>CUHZ Lounge operator console</h1><p><a href="${base}/ops/emergency">Emergency recovery control</a> · <a href="/api/lounge/v2/stage-bridge/ops">Artwork review queue</a></p><p>Every action records a reason. Emergency hold revokes the active lease.</p><p id="status" role="status" aria-live="polite">Loading stage</p><button id="refresh" type="button">Refresh status</button><form><label>Reason <select id="reason" required><option value="operator_review">Operator review</option><option value="safety_stop">Safety stop</option><option value="show_transition">Show transition</option><option value="member_support">Member support</option></select></label><label>Approved item ID (optional) <input id="item" autocomplete="off"></label><div>${['showcase','next','clear','results','idle','resume','hold'].map(action=>`<button type="submit" value="${action}">${action==='hold'?'EMERGENCY HOLD':action}</button>`).join('')}</div></form></main>`,{ops:true,csrf:context.csrfToken}),200,'text/html; charset=utf-8');}
  if(req.method==='POST'&&route===`${base}/commands`){if(!/^application\/json(?:;|$)/i.test(req.headers.get('content-type')||''))return response({error:'INVALID_REQUEST'},400);
   let command;try{command=JSON.parse(Buffer.from(await bodyBytes(req,4096,bodyTimeoutMs)).toString('utf8'));}catch(error){if(error.code)throw error;return response({error:'INVALID_REQUEST'},400);}
   if(!command||Array.isArray(command)||typeof command!=='object'||Object.keys(command).some(k=>!['action','request_id','expected_version','item_id','booking_id','reason'].includes(k))||command.action==='tick'||typeof command.request_id!=='string'||!/^[A-Za-z0-9:_-]{8,140}$/.test(command.request_id))return response({error:'INVALID_REQUEST'},400);
   requestId=command.request_id;const result=await runtime.apply(req,command);return response(result,result?.ok?200:['VERSION_CONFLICT','IDEMPOTENCY_CONFLICT'].includes(result?.code)?409:403);}
  if(req.method==='POST'&&route===`${base}/chat`&&eventSubSecret){const body=Buffer.from(await bodyBytes(req,32768,bodyTimeoutMs)),event=verifyStageChat({body,headers:req.headers,secret:eventSubSecret});if(!event)return response({error:'UNTRUSTED_CHAT'},403);return response(await runtime.handleChat(event));}
  return response({error:'NOT_FOUND'},404);
 }catch(error){const code=safeCodes.has(error?.code||error?.message)?(error.code||error.message):'STAGE_UNAVAILABLE';return response({error:code,...(code==='STAGE_OUTCOME_UNKNOWN'&&requestId?{request_id:requestId}:{})},[401,403].includes(error.status)?error.status:['SIGN_IN_REQUIRED','OPERATOR_REQUIRED','STAGE_OBS_DENIED','STAGE_OBS_EXPIRED'].includes(code)?403:['REQUEST_TOO_LARGE','INVALID_REQUEST'].includes(code)?400:503);}};
}
/** Existing bot may mount handler or use this local server in tests. Never listens on import. */
export function createStageHttpServer({handler,origin='http://127.0.0.1'}={}){
 if(typeof handler!=='function')throw Error('STAGE_HTTP_CONFIG_INVALID');
 const configured=new URL(origin);if(configured.origin!==origin||!['http:','https:'].includes(configured.protocol))throw Error('STAGE_HTTP_ORIGIN_INVALID');
 return createServer(async(req,res)=>{if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\')||[...req.url].some(char=>char.charCodeAt(0)<32)){res.writeHead(400);res.end();return;}
  const target=new URL(req.url,origin);if(target.origin!==origin){res.writeHead(400);res.end();return;}const controller=new AbortController();res.once('close',()=>controller.abort());
  try{const request=new Request(target,{method:req.method,headers:req.headers,signal:controller.signal,
    ...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});const reply=await handler(request);const responseHeaders=Object.fromEntries(reply.headers);const cookies=reply.headers.getSetCookie();if(cookies.length)responseHeaders['set-cookie']=cookies;res.writeHead(reply.status,responseHeaders);
   if(reply.body)Readable.fromWeb(reply.body).on('error',()=>res.destroy()).pipe(res);else res.end();
  }catch{if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"STAGE_UNAVAILABLE"}');}
 });
}
