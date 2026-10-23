import {isTrustedAuthContext} from '../lounge-auth/runtime.mjs';
import {hash} from './image.mjs';
import {createOwnerControlGate} from '../lounge-stage/owner-control.mjs';
import {createImageVerifier} from './image-verifier.mjs';
import {createOwnerCuratedRuntime} from './curated.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const failure=code=>Object.assign(Error(code),{code});
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k));
const text=(v,n)=>typeof v==='string'&&v.length>0&&v.length<=n&&!/[\u0000-\u001f\u007f]/.test(v);
export function createStageBridgeRuntime({store,broker,readObject,writeObject,ownerControl,requiredRulesVersion,curatedEnabled=false,enabled=false,timeoutMs=5000}={}){
 if(!store||!broker?.authenticate||!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>12000)throw Error('BRIDGE_CONFIG_INVALID');
 const verifier=enabled?createImageVerifier({timeoutMs:5000,maxQueued:2}):null;
 if(curatedEnabled&&!enabled)throw Error('CURATED_CONFIG_INVALID');
 const curated=createOwnerCuratedRuntime({store,broker,readObject,writeObject,ownerControl,requiredRulesVersion,verifier,enabled:curatedEnabled,timeoutMs});
 let stopped=false,epoch=0,imports=0;
 const ownerGate=createOwnerControlGate(ownerControl);
 const requireOwner=c=>{const code=ownerGate.check(c?.twitchId);if(code)throw failure(code);};
 const active=()=>{if(!enabled||stopped)throw failure('BRIDGE_DISABLED');};
 const bound=async(work,code='BRIDGE_UNAVAILABLE')=>{let timer;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure(code)),timeoutMs);})]);}finally{clearTimeout(timer);}};
 const uncertain=async work=>{try{return await bound(work,'BRIDGE_OUTCOME_UNKNOWN');}catch{throw failure('BRIDGE_OUTCOME_UNKNOWN');}};
 const fence=run=>{active();if(run!==epoch)throw failure('BRIDGE_DISABLED');};
 async function authenticate(req,{mutation=false,operator=false}={}){active();const run=epoch,c=await bound(()=>broker.authenticate(req,{mutation}),'AUTH_UNAVAILABLE');fence(run);
  if(!isTrustedAuthContext(c)||Date.now()-c.verifiedAt>60000||c.verifiedAt>Date.now())throw failure('AUTH_REQUIRED');
  if(operator)requireOwner(c);
  const a=await bound(()=>store.actor(c,operator?'review:decide':null));fence(run);if(!a?.ok||a.user_id!==c.userId)throw failure(a?.code||'AUTH_REQUIRED');return c;
 }
 async function checked(c,run,operator=false){fence(run);if(Date.now()-c.verifiedAt>60000||c.verifiedAt>Date.now())throw failure('AUTH_REQUIRED');const a=await bound(()=>store.actor(c,operator?'review:decide':null));fence(run);if(!a?.ok||a.user_id!==c.userId)throw failure(a?.code||'AUTH_REQUIRED');}
 async function enabledNow(run){fence(run);if(!await bound(()=>store.enabled()))throw failure('LIBRARY_BRIDGE_DISABLED');fence(run);}
 async function member(req){const run=epoch,c=await authenticate(req),r=await bound(()=>store.member(c));await checked(c,run);return r;}
 async function reviews(req){const run=epoch,c=await authenticate(req,{operator:true});if(!await bound(()=>store.enabled()))throw failure('LIBRARY_BRIDGE_DISABLED');const rows=await bound(()=>store.reviews());await checked(c,run,true);return {reviews:rows.map(r=>({...r,imageUrl:`/api/lounge/v2/stage-bridge/reviews/${r.id}/image`}))};}
 async function reviewImage(req,id){if(!uuid.test(id))throw failure('INVALID_REQUEST');const run=epoch,c=await authenticate(req,{operator:true});if(typeof readObject!=='function')throw failure('ASSET_UNAVAILABLE');
  const record=await bound(()=>store.reviewAsset(id));fence(run);if(!record)throw failure('ASSET_UNAVAILABLE');const controller=new AbortController();let object;
  try{object=await bound(()=>readObject(record.path,{signal:controller.signal,maxBytes:10*1024*1024}),'ASSET_UNAVAILABLE');}finally{controller.abort();}
  if(!Buffer.isBuffer(object?.bytes)||object.contentType!=='image/png'||object.bytes.length>10*1024*1024||hash(object.bytes)!==record.sha256)throw failure('ASSET_UNAVAILABLE');
  await checked(c,run,true);const current=await bound(()=>store.reviewAsset(id));fence(run);if(!current||current.path!==record.path||current.sha256!==record.sha256)throw failure('ASSET_UNAVAILABLE');return {bytes:object.bytes,contentType:'image/png'};
 }
 async function execute(req,action,input){active();if(!uuid.test(input?.requestId||''))throw failure('INVALID_REQUEST');const run=epoch,c=await authenticate(req,{mutation:true,operator:action==='decide'});let payload;
  if(action==='activity'||action==='activity_revoke'){
   requireOwner(c);
   if(!keys(input,action==='activity'?['requestId','batchId','displayName','consent','expectedVersion']:['requestId','expectedVersion'])||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0
    ||(action==='activity'&&(!uuid.test(input.batchId||'')||input.consent!==true||(input.displayName!==null&&!text(input.displayName,40)))))throw failure('INVALID_REQUEST');
   const connectionRevision=await bound(()=>store.connection(c));fence(run);
   const result=await uncertain(()=>store.activity({...c,connectionRevision},{action:action==='activity'?'activity_attach':'activity_revoke',request_id:input.requestId,expected_version:input.expectedVersion,...(action==='activity'?{batch_id:input.batchId,display_name:input.displayName,consent:true}:{})}));
   if(stopped||run!==epoch)throw failure('BRIDGE_OUTCOME_UNKNOWN');return result;
  }
  if(action==='import'){
   if(!keys(input,['requestId','generationId'])||!uuid.test(input.generationId||'')||typeof readObject!=='function'||typeof writeObject!=='function')throw failure('INVALID_REQUEST');
   await enabledNow(run);const g=await bound(()=>store.output(c,input.generationId));fence(run);
   await enabledNow(run);const expected=`${c.userId}/${input.generationId}/output.png`;if(!g||g.output_path!==expected||!g.output_sha256)throw failure('OUTPUT_NOT_VERIFIED');
   let object;const controller=new AbortController();try{object=await bound(()=>readObject(expected,{signal:controller.signal,maxBytes:16*1024*1024}),'ASSET_UNAVAILABLE');}finally{controller.abort();}
   await enabledNow(run);if(object?.contentType!=='image/png')throw failure('OUTPUT_NOT_VERIFIED');let verified;try{verified=await verifier.verify(object.bytes,{sha256:g.output_sha256,size:g.size});}catch(error){throw failure(error?.code==='OUTPUT_NOT_VERIFIED'?'OUTPUT_NOT_VERIFIED':error?.code==='IMAGE_VERIFIER_BUSY'?'BRIDGE_BUSY':'OUTPUT_VERIFICATION_UNAVAILABLE');}fence(run);
   await checked(c,run);await enabledNow(run);const path=`${c.userId}/stage/${g.id}/${verified.descriptor.publicHash}.png`,upload=new AbortController();
   try{await uncertain(()=>writeObject(path,{bytes:verified.bytes,contentType:'image/png',ifAbsent:true,signal:upload.signal}));}finally{upload.abort();}
   if(stopped||run!==epoch)throw failure('BRIDGE_OUTCOME_UNKNOWN');
   // Immutable writes may return "already exists". Read back exact bytes rather
   // than trusting storage metadata or silently overwriting a foreign object.
   let saved;const confirm=new AbortController();try{saved=await uncertain(()=>readObject(path,{signal:confirm.signal,maxBytes:10*1024*1024}));}finally{confirm.abort();}
   if(stopped||run!==epoch)throw failure('BRIDGE_OUTCOME_UNKNOWN');
   if(!Buffer.isBuffer(saved?.bytes)||saved.contentType!=='image/png'||saved.bytes.length!==verified.bytes.length||hash(saved.bytes)!==verified.descriptor.publicHash)throw failure('OUTPUT_NOT_VERIFIED');
   payload={generationId:g.id,...verified.descriptor};
  }else if(action==='review'){
   if(!keys(input,['requestId','itemId','title','displayName','consent','adultConfirmed'])||!uuid.test(input.itemId||'')||!text(input.title,100)||!text(input.displayName,40)||input.consent!==true||input.adultConfirmed!==true)throw failure('INVALID_REQUEST');
   payload={itemId:input.itemId,title:input.title,displayName:input.displayName,consent:true,adultConfirmed:true};
  }else if(action==='decide'){
   if(!keys(input,['requestId','reviewId','decision','reason'])||!uuid.test(input.reviewId||'')||!['approved','rejected'].includes(input.decision)||!/^[a-z][a-z_]{1,63}$/.test(input.reason||''))throw failure('INVALID_REQUEST');
   payload={reviewId:input.reviewId,decision:input.decision,reason:input.reason};
  }else if(action==='revoke'){
   if(!keys(input,['requestId','itemId'])||!uuid.test(input.itemId||''))throw failure('INVALID_REQUEST');payload={itemId:input.itemId};
  }else throw failure('INVALID_REQUEST');
  await checked(c,run,action==='decide');
  const result=await uncertain(()=>store.write(c,input.requestId,action,payload));if(stopped||run!==epoch)throw failure('BRIDGE_OUTCOME_UNKNOWN');return result;
 }
 async function command(req,action,input){active();const run=()=>action.startsWith('curated_')?curated.command(req,action.slice(8),input):execute(req,action,input);
  if(!['import','curated_import'].includes(action))return run();if(imports>=3)throw failure('BRIDGE_BUSY');imports++;try{return await run();}finally{imports--;}}
 return Object.freeze({member,reviews,reviewImage,command,authenticate,curated,stop(){stopped=true;epoch++;curated.stop();return verifier?.stop();}});
}
