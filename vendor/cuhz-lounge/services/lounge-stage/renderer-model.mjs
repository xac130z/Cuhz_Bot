import {publicStage} from './dto.mjs';
/** Public presentation only. Authority and private job data never enter this model. */
export function createStagePresenter({loadAsset,onChange,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,loadTimeoutMs=15000,seenAssets=[]}={}){
 if(typeof loadAsset!=='function'||typeof onChange!=='function')throw Error('STAGE_PRESENTER_CONFIG');
 let version=-1,epoch=0,stopped=false,pending=null,desired=null,resource=null,expiry=null,deadline=null,freshness=null,lastFresh=0,deniedVersion=-1,lastSnapshot=null;
 const seen=new Set(seenAssets.filter(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)).slice(-32));
 let state=Object.freeze({view:'connecting',message:'Connecting to the Lounge',detail:'The stage will appear when its connection is ready.',artwork:null,reveal:false,version:0,phase:null,displayName:null});
 function emit(view,message,detail,artwork=null,reveal=false,phase=null,displayName=null){state=Object.freeze({view,message,detail,artwork,reveal,version:Math.max(0,version),phase,displayName});onChange(state,resource);}
 function cancel(){epoch++;pending?.controller.abort();pending=null;desired=null;resource=null;if(deadline!==null)clearTimer(deadline);deadline=null;}
 function clearClock(){if(expiry!==null)clearTimer(expiry);expiry=null;if(freshness!==null)clearTimer(freshness);freshness=null;}
 function safe(view,message,detail){cancel();clearClock();emit(view,message,detail);}
 function expire(){safe('hold','Stage paused','This live session has ended.');}
 function connectionError(){if(!stopped)safe('error','Stage reconnecting','The artwork is hidden until the connection returns.');}
 function accept(raw){
  if(stopped)return;
  if(!raw||!Number.isSafeInteger(raw.version)||raw.version<0){safe('hold','Stage paused','Waiting for a verified stage update.');return;}
  if(raw.version<version)return;
  const snapshot=publicStage(raw),fresh=Date.parse(snapshot.freshUntil);
  // A durable version may shorten live authority, but only a new version can
  // extend it. Freshness is clamped to lease expiry, not observation ordering.
  if(snapshot.version===version&&lastSnapshot?.mode==='live_session'&&snapshot.mode==='live_session'
    &&Date.parse(snapshot.endsAt)>Date.parse(lastSnapshot.endsAt))return;
  const restrictive=snapshot.mode==='hold'||(lastSnapshot?.artwork&&!snapshot.artwork)||(lastSnapshot?.activity&&!snapshot.activity)
    ||(snapshot.mode==='live_session'&&Date.parse(snapshot.endsAt)<Date.parse(lastSnapshot?.endsAt));
  if(snapshot.version===version&&Number.isFinite(fresh)&&fresh<lastFresh&&!restrictive)return;
  if(snapshot.version>version){lastFresh=0;lastSnapshot=null;}
  version=snapshot.version;
  // A same-version safe downgrade cannot be undone by an older in-flight read.
  if(snapshot.mode==='hold'){deniedVersion=version;lastSnapshot=snapshot;safe('hold','Stage paused','CUHZ Lounge will resume when the stage is ready.');return;}
  if(lastSnapshot?.version===version&&((lastSnapshot.artwork&&!snapshot.artwork)||(lastSnapshot.activity&&!snapshot.activity)))deniedVersion=version;
  if(deniedVersion===version&&(snapshot.artwork||snapshot.activity)){safe('hold','Stage paused','Waiting for a new verified stage update.');return;}
  clearClock();
  if(snapshot.mode==='live_session'){
   const remaining=Date.parse(snapshot.endsAt)-now();
   if(!Number.isFinite(remaining)||remaining<=0){expire();return;}
   expiry=setTimer(expire,Math.min(remaining,2147483647));
  }
  if(!Number.isFinite(fresh)||fresh<=now()){connectionError();return;}
  lastFresh=fresh;lastSnapshot=snapshot;
  freshness=setTimer(connectionError,Math.min(fresh-now(),25000));
  if(snapshot.activity){
   const {phase,displayName}=snapshot.activity;cancel();
   const copy={queued:['Please wait','Your creation is queued. CUHZ Bot will begin when the worker is ready.'],creating:['Please wait','CUHZ Bot is creating the artwork.'],review:['Final check','The artwork stays private until it is submitted and approved.'],unavailable:['Creation paused','This creation needs attention. No private artwork is shown.']}[phase];
   emit(phase,...copy,null,false,phase,displayName);return;
  }
  if(snapshot.mode==='idle'||!snapshot.artwork){cancel();emit('idle','Your next reveal starts here',snapshot.mode==='live_session'?'The stage is ready for approved artwork.':'A little space for the next CUHZ creation.');return;}
  const art=snapshot.artwork;
  if(desired?.asset===art.asset){desired=art;if(pending){pending.version=version;return;}if(state.view==='ready'){emit('ready','The reveal','A creation from the CUHZ Lounge',art,false,'reveal',art.creator);return;}}
  cancel();desired=art;const run=epoch,controller=new AbortController();pending={controller,version,asset:art.asset};
  emit('waiting','Preparing the reveal','Loading approved artwork.',null,false,'reveal',art.creator);
  deadline=setTimer(()=>{if(!stopped&&run===epoch)safe('error','Reveal unavailable','The approved artwork could not be loaded.');},loadTimeoutMs);
  Promise.resolve().then(()=>{if(stopped||run!==epoch)throw Error('CANCELLED');return loadAsset(art.asset,{signal:controller.signal});}).then(loaded=>{
   if(stopped||run!==epoch||!pending||pending.version!==version||pending.asset!==desired?.asset)return;
   if(deadline!==null)clearTimer(deadline);deadline=null;pending=null;resource=loaded;
   const reveal=!seen.has(art.asset);seen.add(art.asset);if(seen.size>32)seen.delete(seen.values().next().value);
   emit('ready','The reveal','A creation from the CUHZ Lounge',desired,reveal,'reveal',desired.creator);
  }).catch(()=>{if(!stopped&&run===epoch)safe('error','Reveal unavailable','The approved artwork could not be loaded.');});
 }
 function start(){if(stopped)return;onChange(state,resource);deadline=setTimer(()=>{if(version<0&&!stopped)connectionError();},loadTimeoutMs);}
 function stop(){stopped=true;cancel();clearClock();}
 return Object.freeze({start,accept,connectionError,stop,state:()=>state,seen:()=>[...seen]});
}
