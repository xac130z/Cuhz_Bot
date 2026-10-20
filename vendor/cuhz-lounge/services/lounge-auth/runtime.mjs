import { randomUUID } from 'node:crypto';
import { randomToken,digest,challenge,equal,createVault } from './crypto.mjs';
import { projectUser,projectSession,privateTokens } from './projection.mjs';
import { mintAuthContext, mintEmergencyContext } from './context.mjs';
export { isTrustedAuthContext, isTrustedEmergencyContext } from './context.mjs';
const COOKIE='__Host-cuhz-auth', FLOW='__Host-cuhz-auth-flow';
const opaque=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const cookies=req=>Object.fromEntries((req.headers.get('cookie')??'').split(';').map(x=>x.trim().split('=' )).filter(x=>x.length===2));
const cookie=(name,value,seconds)=>`${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
// eslint-disable-next-line no-control-regex -- reject control characters in redirects
const safeNext=value=>typeof value==='string'&&value.length<=512&&/^\/(?!\/)/.test(value)&&!/[\\\u0000-\u001f#]/.test(value)?value:'/lounge';
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"};
const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json',...extra}});
class Failure extends Error { constructor(code,status=503){super(code);this.code=code;this.status=status;} }
/** Explicitly injected server runtime, off by default. No listener, secret or
 * network call is created by importing this module. All routes are same-origin. */
export function createLoungeAuthBroker({origin,store,upstream,key,enabled=false,timeoutMs=8000,clock=Date.now}) {
  const base=new URL(origin); if(base.protocol!=='https:'||base.origin!==origin)throw Error('AUTH_ORIGIN_REQUIRED');
  const vault=createVault(key);
  async function bounded(work) { let timer;try{return await Promise.race([Promise.resolve(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Failure('AUTH_UNAVAILABLE')),timeoutMs);})]);}finally{clearTimeout(timer);} }
  const available=async()=>{if(!enabled||!(await bounded(store.enabled())))throw new Failure('AUTH_DISABLED');};
  function sameOrigin(req,mutation=false,allowTopNavigation=false){
    if(new URL(req.url).origin!==origin)throw new Failure('AUTH_ORIGIN_DENIED',403);
    const topNavigation=allowTopNavigation&&!mutation&&req.method==='GET'&&req.headers.get('origin')===null
      &&['none','same-origin'].includes(req.headers.get('sec-fetch-site'))&&req.headers.get('sec-fetch-mode')==='navigate'&&req.headers.get('sec-fetch-dest')==='document';
    if(req.headers.get('origin')!==origin && !(req.headers.get('origin')===null&&!mutation&&req.headers.get('sec-fetch-site')==='same-origin')&&!topNavigation)throw new Failure('AUTH_ORIGIN_DENIED',403);
  }
  async function body(req){
    if(!req.headers.get('content-type')?.startsWith('application/json'))throw new Failure('AUTH_BODY_INVALID',400);
    const reader=req.body?.getReader(); if(!reader)throw new Failure('AUTH_BODY_INVALID',400);
    let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
    try{await bounded((async()=>{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2048)throw new Failure('AUTH_BODY_INVALID',400);text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();})());return JSON.parse(text);}catch(error){if(error instanceof Failure)throw error;throw new Failure('AUTH_BODY_INVALID',400);}finally{void reader.cancel().catch(()=>{});}
  }
  async function resolve(req,{mutation=false}={}){
    await available();sameOrigin(req,mutation);
    const token=cookies(req)[COOKIE];if(!opaque(token))throw new Failure('AUTH_REQUIRED',401);
    const hash=digest(token),row=await bounded(store.session(hash));if(!row)throw new Failure('AUTH_REQUIRED',401);
    const csrf=vault.csrf(token);
    if(!equal(row.csrf_hash,digest(csrf))||(mutation&&!equal(req.headers.get('x-lounge-csrf'),csrf)))throw new Failure('AUTH_CSRF_DENIED',403);
    let tokens=vault.open(row.sealed_tokens,`session:${row.id}`);
    if(tokens.expires_at*1000<=clock()+30000){
      const claim=randomUUID();
      if(!await bounded(store.claimRefresh(row.id,row.revision,claim,row.sealed_tokens)))throw new Failure('AUTH_REFRESH_PENDING');
      // An uncertain refresh is never retried. Its claim stays fenced; a fresh
      // sign-in recovers without risking reuse of a rotated refresh token.
      await available();
      tokens=privateTokens(await bounded(upstream.refresh(tokens.refresh_token)),clock());
      if(!await bounded(store.settleRefresh(row.id,row.revision,claim,vault.seal(tokens,`session:${row.id}`))))throw new Failure('AUTH_REQUIRED',401);
    }
    const user=projectUser(await bounded(upstream.user(tokens.access_token)));
    if(user.id!==tokens.user_id||user.id!==row.user_id||user.identities[0].provider_id!==row.twitch_user_id)throw new Failure('AUTH_IDENTITY_CHANGED',401);
    await available();
    if(!await bounded(store.touch(row.id,row.revision)))throw new Failure('AUTH_REQUIRED',401);
    const current=await bounded(store.session(hash));
    if(!current||current.revision!==row.revision||current.user_id!==user.id||current.twitch_user_id!==row.twitch_user_id)throw new Failure('AUTH_REQUIRED',401);
    const context=mintAuthContext({sessionId:row.id,sessionRevision:row.revision,userId:user.id,twitchId:row.twitch_user_id,verifiedAt:clock(),csrfToken:csrf});
    return {context,user,tokens};
  }
  async function emergencyIdentity(req,{mutation,bootstrap=false}){
    await available();sameOrigin(req,mutation,bootstrap);
    const token=cookies(req)[COOKIE];if(!opaque(token))throw new Failure('AUTH_REQUIRED',401);
    const hash=digest(token),csrf=vault.csrf(token),row=await bounded(store.session(hash));
    if(!row||!equal(row.csrf_hash,digest(csrf))||(mutation&&!equal(req.headers.get('x-lounge-csrf'),csrf)))throw new Failure('AUTH_CSRF_DENIED',403);
    if(mutation&&!await bounded(store.touch(row.id,row.revision)))throw new Failure('AUTH_REQUIRED',401);
    const current=await bounded(store.session(hash));
    if(!current||current.revision!==row.revision||current.user_id!==row.user_id||current.twitch_user_id!==row.twitch_user_id)throw new Failure('AUTH_REQUIRED',401);
    return mintEmergencyContext({sessionId:row.id,sessionRevision:row.revision,userId:row.user_id,twitchId:row.twitch_user_id,verifiedAt:clock(),csrfToken:csrf});
  }
  return {
    // Host scheduler calls this; imports never create timers or background work.
    async cleanup(){await available();return bounded(store.cleanup());},
    async authenticate(req,options){return (await resolve(req,options)).context;},
    // Ordinary endpoints reject these separately branded contexts. SQL must
    // still verify explicit owner emergency permission before hold or its UI.
    async authenticateEmergency(req){return emergencyIdentity(req,{mutation:true});},
    async emergencyBootstrap(req){
      if(req.method!=='GET')throw new Failure('AUTH_ORIGIN_DENIED',403);
      return emergencyIdentity(req,{mutation:false,bootstrap:true});
    },
    async handle(req){
      try{
        const url=new URL(req.url);if(url.origin!==origin)throw new Failure('AUTH_ORIGIN_DENIED',403);
        const path=url.pathname.replace(/\/$/,'');
        await available();
        if(path==='/api/lounge/auth/start'&&req.method==='POST'){
          sameOrigin(req,true);if(req.headers.get('x-lounge-auth')!=='1')throw new Failure('AUTH_ORIGIN_DENIED',403);
          const input=await body(req);
          if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['next','intent'].includes(k)))throw new Failure('AUTH_BODY_INVALID',400);
          if(input.intent&&input.intent!=='signin')throw new Failure('AUTH_ADS_UNAVAILABLE',409);
          // Host must inject a trusted client address; no X-Forwarded-For value
          // is trusted here. Browser cookie bucket is a secondary abuse bound.
          const previous=cookies(req)[FLOW],browser=opaque(previous)?previous:randomToken();
          if(!await bounded(store.rate(vault.rateKey('global-login-start')))||!await bounded(store.rate(vault.rateKey(browser))))throw new Failure('AUTH_RATE_LIMITED',429);
          const state=randomToken(),verifier=randomToken(),next=safeNext(input.next);
          await available();await bounded(store.createFlow({stateHash:digest(state),browserHash:digest(browser),sealedVerifier:vault.seal({verifier},`flow:${digest(state)}`),next}));
          const callback=new URL('/api/lounge/auth/callback',origin);callback.searchParams.set('tx',state);
          const authorizationUrl=upstream.authorize({redirectTo:callback.href,codeChallenge:challenge(verifier)});
          return json({authorizationUrl},200,{'Set-Cookie':cookie(FLOW,browser,300)});
        }
        if(path==='/api/lounge/auth/callback'&&req.method==='GET'){
          const state=url.searchParams.get('tx'),browser=cookies(req)[FLOW],code=url.searchParams.get('code');
          if(!opaque(state)||!opaque(browser)||!code||code.length>2048||url.searchParams.has('error')||url.searchParams.getAll('code').length!==1||url.searchParams.getAll('tx').length!==1)throw new Failure('AUTH_CALLBACK_INVALID',400);
          const flow=await bounded(store.takeFlow(digest(state),digest(browser)));if(!flow)throw new Failure('AUTH_CALLBACK_INVALID',400);
          const {verifier}=vault.open(flow.sealed_verifier,`flow:${digest(state)}`);
          await available();const tokens=privateTokens(await bounded(upstream.exchange({code,verifier})),clock());
          const user=projectUser(await bounded(upstream.user(tokens.access_token)));
          if(user.id!==tokens.user_id)throw new Failure('AUTH_IDENTITY_CHANGED',401);
          if(!await bounded(store.rate(vault.rateKey(`user:${user.id}`))))throw new Failure('AUTH_RATE_LIMITED',429);
          const id=randomUUID(),token=randomToken(),csrf=vault.csrf(token);
          await available();await bounded(store.createSession({id,hash:digest(token),userId:user.id,twitchId:user.identities[0].provider_id,csrfHash:digest(csrf),sealedTokens:vault.seal(tokens,`session:${id}`),oldHash:opaque(cookies(req)[COOKIE])?digest(cookies(req)[COOKIE]):null}));
          const response=new Response(null,{status:303,headers:{...headers,Location:`/auth/callback?complete=1&next=${encodeURIComponent(safeNext(flow.next_path))}`}});
          response.headers.append('Set-Cookie',cookie(COOKIE,token,28800));response.headers.append('Set-Cookie',cookie(FLOW,'',0));return response;
        }
        if(path==='/api/lounge/auth/session'&&req.method==='GET'){
          const result=await resolve(req);return json({session:projectSession(result.tokens,result.user,clock()),csrfToken:result.context.csrfToken});
        }
        if(path==='/api/lounge/auth/logout'&&req.method==='POST'){
          // Local revoke works even when the provider is unavailable. No online
          // token refresh or Twitch request is needed to terminate this session.
          sameOrigin(req,true);const token=cookies(req)[COOKIE];if(!opaque(token)||!equal(req.headers.get('x-lounge-csrf'),vault.csrf(token)))throw new Failure('AUTH_CSRF_DENIED',403);
          await bounded(store.revoke(digest(token)));return json({ok:true},200,{'Set-Cookie':cookie(COOKIE,'',0)});
        }
        return json({error:'AUTH_ROUTE_NOT_FOUND'},404);
      }catch(error){return json({error:error instanceof Failure?error.code:'AUTH_UNAVAILABLE'},error instanceof Failure?error.status:503);}
    },
  };
}
