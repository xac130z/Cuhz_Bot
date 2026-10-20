import {createAuthStore} from '../lounge-auth/store.mjs';
import {createLoungeAuthBroker} from '../lounge-auth/runtime.mjs';
import {createPostgresEligibilityStore} from '../lounge-eligibility/store.mjs';
import {createLoungeEligibilityService} from '../lounge-eligibility/service.mjs';
import {createLoungeEligibilityHandler} from '../lounge-eligibility/http.mjs';
import {createStageStore} from '../lounge-stage/store.mjs';
import {createStageRuntime} from '../lounge-stage/runtime.mjs';
import {createStageHandler} from '../lounge-stage/http.mjs';
import {createGenerationChatStore} from '../lounge-generation-chat/store.mjs';
import {createGenerationChatRuntime} from '../lounge-generation-chat/runtime.mjs';
import {createGenerationChatHandler} from '../lounge-generation-chat/http.mjs';
import {createStageBridgeStore} from '../lounge-stage-bridge/store.mjs';
import {createStageBridgeRuntime} from '../lounge-stage-bridge/runtime.mjs';
import {createStageBridgeHandler} from '../lounge-stage-bridge/http.mjs';

/** Mountable in the existing bot only after the separately reviewed same-origin
 * cutover. No listener, migration, secret lookup, role grant or timer on import.
 * Every runtime flag defaults false and SQL independently enforces durable flags. */
export function createLoungeApplication({db,origin,authKey,authUpstream,requiredRulesVersion,
  flags={},readObject,writeObject,sendPrivateReply,eventSubSecret,heartbeatMs=10_000,getGenerationConfig=()=>({enabled:false})}={}) {
  if(!db||typeof db.query!=='function')throw Error('LOUNGE_DATABASE_REQUIRED');
  const allowed=['auth','eligibility','pilot','subscription','pilotManagement','stage','generationChat','stageBridge'];
  if(Object.entries(flags).some(([name,value])=>!allowed.includes(name)||typeof value!=='boolean'))throw Error('LOUNGE_FLAGS_INVALID');
  const query=(sql,args)=>db.query(sql,args);
  const auth=createLoungeAuthBroker({origin,key:authKey,store:createAuthStore({query}),upstream:authUpstream,enabled:flags.auth===true});
  const eligibilityStore=createPostgresEligibilityStore({query});
  const eligibility=createLoungeEligibilityService({store:eligibilityStore,requiredRulesVersion,
    pilotEnabled:flags.pilot===true,subscriptionEnabled:flags.subscription===true,managementEnabled:flags.pilotManagement===true});
  const eligibilityHttp=createLoungeEligibilityHandler({broker:auth,store:eligibilityStore,service:eligibility,
    origin,requiredRulesVersion,enabled:flags.eligibility===true});
  const generationChat=createGenerationChatRuntime({store:createGenerationChatStore({query}),
    getConfig:getGenerationConfig,sendPrivateReply,enabled:flags.generationChat===true});
  const generationChatHttp=createGenerationChatHandler({broker:auth,runtime:generationChat,origin,enabled:flags.generationChat===true});
  const stageBridge=createStageBridgeRuntime({store:createStageBridgeStore({query,allowPilot:flags.pilot===true,allowSubscription:flags.subscription===true}),
    broker:auth,readObject,writeObject,enabled:flags.stageBridge===true});
  const stageBridgeHttp=createStageBridgeHandler({runtime:stageBridge,origin,enabled:flags.stageBridge===true});
  const stage=createStageRuntime({store:createStageStore({query,allowPilot:flags.pilot===true,allowSubscription:flags.subscription===true}),
    broker:auth,enabled:flags.stage===true,readObject,sendPrivateReply,heartbeatMs,
    generationChat:flags.generationChat===true?event=>generationChat.handleChat(event):undefined});
  const stageHttp=createStageHandler({runtime:stage,eventSubSecret});
  async function handle(request){
    const path=new URL(request.url).pathname;
    if(path.startsWith('/api/lounge/auth/'))return auth.handle(request);
    if(path==='/api/lounge/v2/eligibility'||path.startsWith('/api/lounge/v2/eligibility/'))return eligibilityHttp.handle(request);
    if(path==='/api/lounge/v2/generation-chat/prepare')return generationChatHttp.handle(request);
    if(path==='/api/lounge/v2/stage-bridge'||path.startsWith('/api/lounge/v2/stage-bridge/'))return stageBridgeHttp(request);
    if(path==='/stage'||path.startsWith('/stage/')||path==='/api/lounge/v2/stage'||path.startsWith('/api/lounge/v2/stage/'))return stageHttp(request);
    return new Response(JSON.stringify({error:'NOT_FOUND'}),{status:404,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  return Object.freeze({handle,start:()=>{generationChat.start();return stage.start();},
    stop:()=>{stage.stop();generationChat.stop();return stageBridge.stop();},auth,eligibility,stage,generationChat,stageBridge});
}
