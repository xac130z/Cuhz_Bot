import { createHash } from 'node:crypto';
import { isTrustedAuthContext,isTrustedEmergencyContext } from '../lounge-auth/runtime.mjs';
import { isTrustedChatEvent,parseStageChat } from './chat.mjs';
import { publicStage,isPublicAssetHash } from './dto.mjs';
import { createStageStreams } from './sse.mjs';
const codeError=(code)=>Object.assign(new Error(code),{code});
export function createStageRuntime({store,broker,enabled=false,readObject,sendPrivateReply,generationChat,timeoutMs=5000,heartbeatMs=10_000,now=Date.now}={}) {
  if(!store||!broker||typeof broker.authenticate!=='function'||timeoutMs<1||timeoutMs>12000)throw Error('STAGE_CONFIG_INVALID');
  let active=false,epoch=0,timer=null,polling=false;const limits=new Map();
  const bounded=async(work,code='STAGE_UNAVAILABLE')=>{let t;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{t=setTimeout(()=>reject(codeError(code)),timeoutMs);})]);}finally{clearTimeout(t);}};
  const requireActive=()=>{if(!enabled||!active)throw codeError('STAGE_DISABLED');};
  async function read(){requireActive();const run=epoch,started=now();const result=await bounded(()=>store.read());if(run!==epoch||!active)throw codeError('STAGE_DISABLED');
    const safe=publicStage(result),ending=Date.parse(safe.endsAt),until=Math.min(started+25_000,safe.mode==='live_session'&&Number.isFinite(ending)?ending:Infinity);
    if(until<=now())throw codeError('STAGE_UNAVAILABLE');
    return publicStage({...safe,freshUntil:new Date(until).toISOString()});}
  const streams=createStageStreams({read,heartbeatMs:Math.min(heartbeatMs,10_000)});
  async function authenticate(req,mutation=false){requireActive();const run=epoch;const context=await bounded(()=>broker.authenticate(req,{mutation}),'AUTHENTICATION_UNAVAILABLE');
    if(run!==epoch||!active)throw codeError('STAGE_DISABLED');if(!isTrustedAuthContext(context))throw codeError('SIGN_IN_REQUIRED');return context;}
  async function operator(req){const run=epoch,context=await authenticate(req);if(!await bounded(()=>store.operator(context)))throw codeError('OPERATOR_REQUIRED');if(run!==epoch||!active)throw codeError('STAGE_DISABLED');return context;}
  async function emergencyConsole(req){requireActive();const run=epoch;
    if(typeof broker.emergencyBootstrap!=='function')throw codeError('AUTHENTICATION_UNAVAILABLE');
    const context=await bounded(()=>broker.emergencyBootstrap(req),'AUTHENTICATION_UNAVAILABLE');
    if(run!==epoch||!active)throw codeError('STAGE_DISABLED');
    if(!isTrustedEmergencyContext(context)||!await bounded(()=>store.emergency(context)))throw codeError('OPERATOR_REQUIRED');
    if(run!==epoch||!active)throw codeError('STAGE_DISABLED');return context;
  }
  async function apply(req,command){requireActive();const run=epoch;let context;
    if(command?.action==='hold'){if(typeof broker.authenticateEmergency!=='function')throw codeError('AUTHENTICATION_UNAVAILABLE');context=await bounded(()=>broker.authenticateEmergency(req),'AUTHENTICATION_UNAVAILABLE');if(!isTrustedEmergencyContext(context))throw codeError('SIGN_IN_REQUIRED');}
    else context=await authenticate(req,true);
    if(run!==epoch||!active)throw codeError('STAGE_DISABLED');
    const connectionRevision=await bounded(()=>store.connection(context.userId));
    if(run!==epoch||!active)throw codeError('STAGE_DISABLED');
    const result=await bounded(()=>store.apply({...context,connectionRevision},command),'STAGE_OUTCOME_UNKNOWN');
    if(run!==epoch||!active)throw codeError('STAGE_OUTCOME_UNKNOWN');
    if(result?.ok){try{streams.publish(await read());}catch{/* receipt remains durable */}}
    return result;
  }
  async function asset(hash){requireActive();if(!isPublicAssetHash(hash)||typeof readObject!=='function')throw codeError('ASSET_UNAVAILABLE');const run=epoch;
    const record=await bounded(()=>store.asset(hash));if(!record||run!==epoch||!active)throw codeError('ASSET_UNAVAILABLE');
    const controller=new AbortController();let object;
    try{object=await bounded(()=>readObject(record.storage_path_canonical,{signal:controller.signal,maxBytes:10*1024*1024}),'ASSET_UNAVAILABLE');}
    finally{controller.abort();}
    const bytes=object?.bytes;
    if(!Buffer.isBuffer(bytes)||bytes.length>10*1024*1024||!['image/png','image/webp','image/jpeg'].includes(object?.contentType)
      ||createHash('sha256').update(bytes).digest('hex')!==hash)throw codeError('ASSET_UNAVAILABLE');
    const current=await bounded(()=>store.asset(hash));
    if(!current||current.storage_path_canonical!==record.storage_path_canonical||run!==epoch||!active)throw codeError('ASSET_UNAVAILABLE');
    return {bytes,contentType:object.contentType};
  }
  async function handleChat(event){if(!isTrustedChatEvent(event)||Date.now()-event.verifiedAt>60_000||event.verifiedAt>Date.now())return {ok:false,code:'UNTRUSTED_CHAT'};
    const parsed=parseStageChat(event);if(!parsed)return {ok:false,code:'NOT_A_STAGE_COMMAND'};
    // Track A has its own default-off runtime, admission and rate limit. It does
    // not require stage startup, a stage lease or a stream being live.
    if(parsed.kind==='generation')return typeof generationChat==='function'
      ? bounded(()=>generationChat(event),'CHAT_GENERATION_UNKNOWN') : {ok:false,code:'CHAT_GENERATION_DISABLED'};
    requireActive();
    if(typeof sendPrivateReply!=='function')return {ok:false,code:'PRIVATE_REPLY_UNAVAILABLE'};
    const now=Date.now();for(const [key,times] of limits)if(now-times.at(-1)>=10_000)limits.delete(key);
    const recent=(limits.get(event.twitchId)||[]).filter(at=>now-at<10_000);
    if(recent.length>=4)return {ok:false,code:'RATE_LIMITED'};
    if(limits.size>=1000&&!limits.has(event.twitchId))return {ok:false,code:'RATE_LIMITED'};
    limits.set(event.twitchId,[...recent,now]);
    const run=epoch;
    let result;
    if(parsed.kind==='whoami')result={ok:true,code:'IDENTITY',privateText:`Your Twitch ID is ${event.twitchId}.`};
    else if(parsed.kind!=='command')result={ok:true,code:'HELP',privateText:'Open CUHZ Lounge to check your session. Stage commands: !lounge show <item>, end, hold, resume, next, clear.'};
    else {const prepared=await bounded(()=>store.prepareChat(event,parsed.command));if(!prepared?.ok)return {ok:false,code:prepared?.code||'WEBSITE_SESSION_REQUIRED'};
      const {context,command}=prepared;if(context?.twitchId!==event.twitchId)return {ok:false,code:'WEBSITE_SESSION_REQUIRED'};if(run!==epoch||!active)return {ok:false,code:'STAGE_DISABLED'};
      result=await bounded(()=>store.apply(context,command),'STAGE_OUTCOME_UNKNOWN');
      if(result?.ok){try{streams.publish(await read());}catch{/* committed receipt remains */}}
    }
    if(run!==epoch||!active)return {ok:false,code:'STAGE_OUTCOME_UNKNOWN'};
    await bounded(()=>sendPrivateReply({twitchId:event.twitchId,operationKey:event.operationKey,text:result.privateText||(result.ok?'Stage action recorded.':`Stage action unavailable (${result.code||'UNAVAILABLE'}).`)}));
    // Never return the private ID text to a public chat caller or logger.
    return {ok:result?.ok===true,code:result?.code||'APPLIED',...(result?.request_id?{request_id:result.request_id}:{})};
  }
  async function tick(){if(polling||!active)return;const run=epoch;polling=true;try{await bounded(()=>store.tick(),'STAGE_OUTCOME_UNKNOWN');if(run!==epoch||!active)return;await bounded(()=>store.expireChat());if(run!==epoch||!active)return;streams.publish(await read());}catch{/* next poll retries a READ/reconciliation, never a member command */}finally{polling=false;}}
  function start(){if(!enabled)return {started:false};if(active)return {started:true};active=true;epoch++;timer=setInterval(tick,heartbeatMs);timer.unref?.();return {started:true};}
  function stop(){active=false;epoch++;if(timer)clearInterval(timer);timer=null;streams.stop();limits.clear();}
  return Object.freeze({start,stop,tick,read,authenticate,operator,emergencyConsole,apply,asset,handleChat,stream:signal=>{requireActive();return streams.connect(signal);}});
}
