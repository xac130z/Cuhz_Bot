import {isTrustedAuthContext} from '../lounge-auth/runtime.mjs';
import {createOwnerControlGate} from '../lounge-stage/owner-control.mjs';
import {hash} from './image.mjs';
import {curatedCatalog as catalog,curatedItemId,readCuratedSource} from './curated-catalog.mjs';
import {commandPreflightResult} from '../lounge-retention/port.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const failure=code=>Object.assign(Error(code),{code});
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);

/** The bridge owns the shared three-import admission cap and image worker.
 * This path creates no generation, role, entitlement, provider call or timer. */
export function createOwnerCuratedRuntime({store,broker,verifier,readObject,writeObject,ownerControl,requiredRulesVersion,enabled=false,timeoutMs=5000}={}){
 const gate=createOwnerControlGate(ownerControl),ownerId=ownerControl?.twitchId,rulesVersion=requiredRulesVersion;
 if(enabled&&(!store||!broker?.authenticate||!verifier?.verify||typeof readObject!=='function'||typeof writeObject!=='function'
  ||gate.check(ownerId)||typeof rulesVersion!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(rulesVersion)))throw Error('CURATED_CONFIG_INVALID');
 let stopped=false,epoch=0;
 const active=()=>{if(!enabled||stopped)throw failure('CURATED_DISABLED');};
 const fence=run=>{active();if(run!==epoch)throw failure('CURATED_DISABLED');};
 async function bound(work,code='BRIDGE_UNAVAILABLE'){let timer;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure(code)),timeoutMs);})]);}finally{clearTimeout(timer);}}
 async function uncertain(work){try{return await bound(work,'BRIDGE_OUTCOME_UNKNOWN');}catch{throw failure('BRIDGE_OUTCOME_UNKNOWN');}}
 async function checked(state){
  fence(state.run);const c=state.context;
  if(Date.now()-c.verifiedAt>=60000||c.verifiedAt>Date.now())throw failure('AUTH_REQUIRED');
  const denied=gate.check(c.twitchId);if(denied)throw failure(denied);
  const actor=await bound(()=>store.curatedActor(c,state.connectionRevision,ownerId,rulesVersion));fence(state.run);
  if(actor?.ok!==true||actor.user_id!==c.userId)throw failure(actor?.code||'AUTH_REQUIRED');
  if(!await bound(()=>store.curatedEnabled()))throw failure('CURATED_DISABLED');fence(state.run);
 }
 async function authenticate(req,{mutation=false}={}){
  active();const run=epoch,c=await bound(()=>broker.authenticate(req,{mutation}),'AUTH_UNAVAILABLE');fence(run);
  if(!isTrustedAuthContext(c))throw failure('AUTH_REQUIRED');const denied=gate.check(c.twitchId);if(denied)throw failure(denied);
  const connectionRevision=await bound(()=>store.connection(c));fence(run);
  const state={context:c,connectionRevision,run};await checked(state);return state;
 }
 const sessionKey=state=>hash(Buffer.from(`owner-curated-session-v1|${state.context.userId}|${state.context.sessionId}|${state.context.sessionRevision}`));
 const ownerKey=state=>hash(Buffer.from(`owner-curated-identity-v1|${state.context.userId}|${state.context.twitchId}`));
 async function consoleContext(req){const state=await authenticate(req);return {csrf:state.context.csrfToken,sessionKey:sessionKey(state),ownerKey:ownerKey(state)};}
 function record(state,item){
  if(!item||item.id!==curatedItemId(state.context.userId)||item.catalogKey!==catalog.key||item.catalogRevision!==catalog.revision
   ||item.canonicalHash!==catalog.sha256||item.derivativeHash!==catalog.derivativeHash||!Number.isSafeInteger(item.revision)||item.revision<1
   ||!['private','in_review','approved','rejected'].includes(item.status)
   ||item.canonicalPath!==`${state.context.userId}/curated/${item.id}/original.png`
   ||item.publicPath!==`${state.context.userId}/stage/${item.id}/${catalog.derivativeHash}.png`)throw failure('CURATED_ITEM_UNAVAILABLE');
  return item;
 }
 const publicItem=item=>({id:item.id,status:item.status,title:item.title,displayName:item.displayName,reviewId:item.reviewId,
  revision:item.revision,catalogKey:item.catalogKey,catalogRevision:item.catalogRevision,canonicalHash:item.canonicalHash,derivativeHash:item.derivativeHash,
  previewUrl:`/api/lounge/v2/stage-bridge/curated/items/${item.id}/image`});
 async function member(req){const state=await authenticate(req),snapshot=await bound(()=>store.curatedSnapshot(state.context,catalog.key,catalog.revision));
  await checked(state);return {sessionKey:sessionKey(state),ownerKey:ownerKey(state),catalog:{key:catalog.key,revision:catalog.revision,title:catalog.title,sha256:catalog.sha256,width:catalog.width,height:catalog.height,label:catalog.label},
   item:snapshot.item?publicItem(record(state,snapshot.item)):null,stageHeld:snapshot.stageHeld===true};}
 async function image(req,id){
  if(!uuid.test(id))throw failure('INVALID_REQUEST');const state=await authenticate(req);
  const item=record(state,await bound(()=>store.curatedItem(state.context,id)));let object;const controller=new AbortController();
  try{object=await bound(()=>readObject(item.publicPath,{signal:controller.signal,maxBytes:10*1024*1024}),'ASSET_UNAVAILABLE');}finally{controller.abort();}
  if(!Buffer.isBuffer(object?.bytes)||object.contentType!=='image/png'||object.bytes.length!==catalog.derivativeBytes||hash(object.bytes)!==item.derivativeHash)throw failure('ASSET_UNAVAILABLE');
  const current=record(state,await bound(()=>store.curatedItem(state.context,id)));
  if(current.revision!==item.revision||current.publicPath!==item.publicPath)throw failure('CURATED_ITEM_CHANGED');
  await checked(state);return {bytes:object.bytes,contentType:'image/png'};
 }
 async function holdRequired(state){if(!await bound(()=>store.curatedHeld()))throw failure('STAGE_HOLD_REQUIRED');fence(state.run);}
 async function preflight(state,action,requestId){
  if(typeof store.commandPreflight!=='function')throw failure('BRIDGE_UNAVAILABLE');
  const value=await bound(()=>store.commandPreflight({context:state.context,connectionRevision:state.connectionRevision,
   ownerId,rulesVersion,requestId,port:`curated.${action}`}));fence(state.run);
  if(value===null)return 'legacy';
  const result=commandPreflightResult(value);if(!result)throw failure('BRIDGE_UNAVAILABLE');
  if(!result.ok)throw failure(result.code);return result.state;
 }
 async function persist(state,path,bytes,expectedHash,requestId){
  await checked(state);await holdRequired(state);const upload=new AbortController();
  await preflight(state,'import',requestId);
  try{await uncertain(()=>writeObject(path,{bytes,contentType:'image/png',ifAbsent:true,signal:upload.signal}));}finally{upload.abort();}
  if(stopped||state.run!==epoch)throw failure('BRIDGE_OUTCOME_UNKNOWN');
  let saved;const readback=new AbortController();
  await preflight(state,'import',requestId);
  try{saved=await uncertain(()=>readObject(path,{signal:readback.signal,maxBytes:10*1024*1024}));}finally{readback.abort();}
  if(stopped||state.run!==epoch)throw failure('BRIDGE_OUTCOME_UNKNOWN');
  if(!Buffer.isBuffer(saved?.bytes)||saved.contentType!=='image/png'||saved.bytes.length!==bytes.length||hash(saved.bytes)!==expectedHash)throw failure('OUTPUT_NOT_VERIFIED');
 }
 async function command(req,action,input){
  if(!uuid.test(input?.requestId||''))throw failure('INVALID_REQUEST');const state=await authenticate(req,{mutation:true});let payload;
  if(action==='import'){
   if(!exact(input,['requestId','catalogKey'])||input.catalogKey!==catalog.key)throw failure('INVALID_REQUEST');
   const disposition=await preflight(state,action,input.requestId);
   const itemId=curatedItemId(state.context.userId);
   payload={catalogKey:catalog.key,catalogRevision:catalog.revision,itemId,canonicalHash:catalog.sha256,canonicalBytes:catalog.bytes,
    width:catalog.width,height:catalog.height,publicHash:catalog.derivativeHash,publicBytes:catalog.derivativeBytes,verifierVersion:'png-v1'};
   // A historical receipt is recovered through the same SQL authority and
   // fingerprint checks. It does not require re-uploading or a new hold.
   if(disposition==='replay'||(disposition==='legacy'&&await bound(()=>store.curatedReceiptExists(state.context,input.requestId)))){await checked(state);
    const prior=await uncertain(()=>store.curatedWrite(state.context,state.connectionRevision,ownerId,rulesVersion,input.requestId,action,payload));
    if(stopped||state.run!==epoch)throw failure('BRIDGE_OUTCOME_UNKNOWN');return prior;}
   await holdRequired(state);await preflight(state,action,input.requestId);const original=await bound(readCuratedSource,'CURATED_SOURCE_UNAVAILABLE');await checked(state);
   await preflight(state,action,input.requestId);
   let verified;try{verified=await verifier.verify(original,{sha256:catalog.sha256,size:`${catalog.width}x${catalog.height}`});}catch(error){throw failure(error?.code==='OUTPUT_NOT_VERIFIED'?'OUTPUT_NOT_VERIFIED':error?.code==='IMAGE_VERIFIER_BUSY'?'BRIDGE_BUSY':'OUTPUT_VERIFICATION_UNAVAILABLE');}
   fence(state.run);const d=verified.descriptor;
   if(d.publicHash!==catalog.derivativeHash||d.publicBytes!==catalog.derivativeBytes||d.canonicalHash!==catalog.sha256||d.canonicalBytes!==catalog.bytes)throw failure('OUTPUT_NOT_VERIFIED');
   await persist(state,`${state.context.userId}/curated/${itemId}/original.png`,original,catalog.sha256,input.requestId);
   await persist(state,`${state.context.userId}/stage/${itemId}/${d.publicHash}.png`,verified.bytes,d.publicHash,input.requestId);
   payload={catalogKey:catalog.key,catalogRevision:catalog.revision,itemId,...d};
  }else if(action==='review'){
   if(!exact(input,['requestId','itemId','expectedRevision','title','displayName','consent','adultConfirmed','rightsConfirmed'])||!uuid.test(input.itemId||'')
    ||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||!text(input.title,100)||!text(input.displayName,40)
    ||input.consent!==true||input.adultConfirmed!==true||input.rightsConfirmed!==true)throw failure('INVALID_REQUEST');
   if(input.itemId!==curatedItemId(state.context.userId))throw failure('CURATED_ITEM_UNAVAILABLE');
   const {requestId,...review}=input;void requestId;payload=review;
   const disposition=await preflight(state,action,input.requestId);
   if(disposition==='fresh'||(disposition==='legacy'&&!await bound(()=>store.curatedReceiptExists(state.context,input.requestId))))await holdRequired(state);
  }else throw failure('INVALID_REQUEST');
  await checked(state);
  await preflight(state,action,input.requestId);
  const result=await uncertain(()=>store.curatedWrite(state.context,state.connectionRevision,ownerId,rulesVersion,input.requestId,action,payload));
  if(stopped||state.run!==epoch)throw failure('BRIDGE_OUTCOME_UNKNOWN');return result;
 }
 return Object.freeze({member,image,command,consoleContext,stop(){stopped=true;epoch++;}});
}
