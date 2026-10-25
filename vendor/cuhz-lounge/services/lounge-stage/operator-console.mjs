const BASE='/api/lounge/v2/stage';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const actions=new Set(['showcase','next','clear','results','idle','resume']);
const reasons=new Set(['operator_review','safety_stop','show_transition','member_support']);
const modes=new Set(['idle','showcase','live_session','results','hold']);
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,list)=>Object.keys(v).length===list.length&&list.every(k=>Object.hasOwn(v,k));
const integer=v=>Number.isSafeInteger(v)&&v>=0&&v<1e15;
const copy=v=>v===null?null:JSON.parse(JSON.stringify(v));
const terminalDenials=new Set(['COMMAND_RETIRED','COMMAND_CAPACITY_REVIEW_REQUIRED']);
const knownDenials=new Set(['STAGE_CONTROL_DISABLED','STAGE_OWNER_UNCONFIGURED','STAGE_OWNER_REQUIRED','INVALID_REQUEST','INVALID_COMMAND','INVALID_VERSION','VERSION_REQUIRED','INVALID_ITEM','REASON_REQUIRED',
 'AUTH_DISABLED','AUTH_REQUIRED','AUTH_ORIGIN_DENIED','AUTH_CSRF_DENIED','AUTH_IDENTITY_CHANGED','AUTH_UNAVAILABLE','AUTH_REFRESH_PENDING',
 'SIGN_IN_REQUIRED','AUTHENTICATION_UNAVAILABLE','OPERATOR_REQUIRED','EMERGENCY_PERMISSION_REQUIRED','SESSION_INVALID','CONNECTION_CHANGED',
 'STAGE_DISABLED','STAGE_ON_HOLD','STAGE_NOT_ON_HOLD','SESSION_ACTIVE','ITEM_UNAVAILABLE','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','COMMAND_RETIRED','COMMAND_CAPACITY_REVIEW_REQUIRED']);
const denialText={STAGE_OWNER_REQUIRED:'Live Lounge control is restricted to the owner during this test.',
 STAGE_CONTROL_DISABLED:'Owner test controls are not enabled.',
 STAGE_OWNER_UNCONFIGURED:'Owner test controls are waiting for verified account configuration.',
 VERSION_CONFLICT:'The stage changed. Refresh its status before choosing another action.',
 OPERATOR_REQUIRED:'This account no longer has operator access. Sign in again.',
 AUTH_CSRF_DENIED:'Your sign-in changed. Reload this console before recovering the same request.',
 AUTH_REQUIRED:'Sign in again, then recover the same request.',
 STAGE_ON_HOLD:'The stage is on hold. Use Resume only when it is safe to continue.',
 STAGE_DISABLED:'The stage is not enabled.',ITEM_UNAVAILABLE:'That item is not available for public display.',
 IDEMPOTENCY_CONFLICT:'This request needs review. Keep its receipt ID and contact team@vqnclabs.com.',
 COMMAND_RETIRED:'This older request has expired. Refresh the current stage before choosing a new action.',
 COMMAND_CAPACITY_REVIEW_REQUIRED:'Stage controls need owner review. Public output is held; no new action was recorded.'};

function validCommand(v,emergency=false){
 if(!object(v)||!UUID.test(v.request_id||''))return false;
 if(emergency)return keys(v,['action','request_id','reason'])&&v.action==='hold'&&v.reason==='safety_stop';
 return keys(v,['action','request_id','reason','expected_version',...(Object.hasOwn(v,'item_id')?['item_id']:[])])
  &&actions.has(v.action)&&reasons.has(v.reason)&&integer(v.expected_version)
  &&(!Object.hasOwn(v,'item_id')||v.action==='showcase'&&UUID.test(v.item_id||''));
}
class Outcome extends Error{constructor(code,unknown=false){super(code);this.code=code;this.unknown=unknown;}}

/** One journal per signed-in owner and browser tab. It contains only command
 * receipts, never CSRF, cookie/session identifiers, tokens or private prompts.
 * Emergency hold is a separate lane and remains possible if storage or normal
 * command recovery is unavailable. No operation is retried automatically. */
export function createOperatorConsole({owner,csrf,storage,fetcher=fetch,randomId=()=>crypto.randomUUID(),now=Date.now,
 timeoutMs=12_000,onChange=()=>{},emergencyOnly=false}={}){
 if(!UUID.test(owner||'')||typeof csrf!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(csrf)
  ||typeof fetcher!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30_000)throw Error('CONSOLE_CONFIG_INVALID');
 const storageKey=`cuhz-stage-operator:v1:${owner}`;
 let pending={control:null,emergency:null},busy={read:false,control:false,emergency:false};
 let stopped=false,storageBlocked=false,snapshot=null,notice='',readNotice='',volatileHold=false,readEpoch=0;
 const controllers=new Set();
 const state=()=>({pending:copy(pending),busy:{...busy},snapshot:copy(snapshot),notice,readNotice,storageBlocked,volatileHold,
  canAct:!stopped&&!emergencyOnly&&!storageBlocked&&!busy.read&&!busy.control&&!busy.emergency&&!pending.control&&!pending.emergency
   &&!!snapshot&&snapshot.freshUntil>now(),canHold:!stopped&&!busy.emergency});
 const emit=()=>{if(!stopped)onChange(state());};
 try{
  const raw=storage?.getItem(storageKey);if(raw===undefined)throw Error('storage unavailable');
  if(raw!==null){if(raw.length>2048)throw Error('journal too large');const saved=JSON.parse(raw);
   if(!object(saved)||!keys(saved,['control','emergency'])||(saved.control!==null&&!validCommand(saved.control))
    ||(saved.emergency!==null&&!validCommand(saved.emergency,true)))throw Error('invalid journal');pending=saved;
  }
 }catch{storageBlocked=true;notice='Recovery storage is unavailable. Ordinary controls are paused. Emergency hold still works.';}
 function persist(){
  if(storageBlocked)return false;
  try{
   if(!pending.control&&!pending.emergency){storage.removeItem(storageKey);if(storage.getItem(storageKey)!==null)throw Error();}
   else{const text=JSON.stringify(pending);storage.setItem(storageKey,text);if(storage.getItem(storageKey)!==text)throw Error();}
   return true;
  }catch{storageBlocked=true;return false;}
 }
 async function request(path,input){
  const controller=new AbortController();controllers.add(controller);let timer;
  const work=async()=>{
   const r=await fetcher(path,{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,
    ...(input?{headers:{'Content-Type':'application/json','X-Lounge-CSRF':csrf},body:JSON.stringify(input)}:{})});
   if(stopped||controller.signal.aborted)throw new Outcome('CONSOLE_STOPPED',!!input);
   if(!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||''))throw new Outcome('RESPONSE_INVALID',!!input);
   const reader=r.body?.getReader();if(!reader)throw new Outcome('RESPONSE_INVALID',!!input);
   let text='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});
   try{for(;;){const part=await reader.read();if(stopped||controller.signal.aborted)throw new Outcome('CONSOLE_STOPPED',!!input);
    if(part.done)break;bytes+=part.value.byteLength;if(bytes>(input?8192:65536))throw new Outcome('RESPONSE_INVALID',!!input);text+=decoder.decode(part.value,{stream:true});
   }text+=decoder.decode();}finally{void reader.cancel().catch(()=>{});}
   const value=JSON.parse(text);
   if(!r.ok||value?.ok===false){const code=object(value)?value.error||value.code:null;
    const known=knownDenials.has(code)&&(!terminalDenials.has(code)||r.status===409);
    throw new Outcome(known?code:'OUTCOME_UNKNOWN',!!input&&!known);}
   return value;
  };
  try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Outcome('OUTCOME_UNKNOWN',!!input));},timeoutMs);})]);}
  catch(error){if(error instanceof Outcome)throw error;throw new Outcome('OUTCOME_UNKNOWN',!!input);}
  finally{clearTimeout(timer);controller.abort();controllers.delete(controller);}
 }
 async function refresh(){
  if(stopped||emergencyOnly||busy.read||busy.control||busy.emergency)return false;
  const epoch=readEpoch;busy.read=true;snapshot=null;readNotice='Checking stage status…';emit();
  try{
   const v=await request(`${BASE}/ops/state`);if(stopped||epoch!==readEpoch)return false;
   const fresh=Date.parse(v?.freshUntil);
   if(!object(v)||!keys(v,['version','mode','endsAt','freshUntil','artwork','activity'])||!integer(v.version)||!modes.has(v.mode)
    ||!Number.isFinite(fresh)||fresh<=now()||fresh>now()+30_000)throw new Outcome('RESPONSE_INVALID');
   snapshot={version:v.version,mode:v.mode,freshUntil:fresh};readNotice=`Stage: ${v.mode.replace('_',' ')} · version ${v.version}`;return true;
  }catch(error){if(!stopped&&epoch===readEpoch)readNotice=denialText[error?.code]||'Stage status could not be verified. Refresh when ready. Emergency hold remains available.';return false;}
  finally{busy.read=false;emit();}
 }
 async function dispatch(lane,recover){
  const command=pending[lane];if(stopped||busy[lane]||!command)return false;
  busy[lane]=true;readEpoch++;snapshot=null;readNotice='Refresh to verify the current stage status.';
  notice=`Checking ${command.action} request ${command.request_id}…`;emit();
  try{
   const v=await request(`${BASE}/commands`,command);if(stopped)return false;
   if(!object(v)||!keys(v,['ok','replayed','request_id','version'])||v.ok!==true||typeof v.replayed!=='boolean'
    ||v.request_id!==command.request_id||!integer(v.version))throw new Outcome('RESPONSE_INVALID',true);
   pending[lane]=null;
   if(!persist()&&!(lane==='emergency'&&volatileHold)){
    pending[lane]=command;notice=`Request ${command.request_id} was recorded, but its local recovery receipt could not be cleared. Reload and recover this same request.`;
   }else{
    notice=`${lane==='emergency'?'Emergency hold':'Stage action'} recorded. Receipt ${command.request_id}.`;
    if(lane==='emergency'){if(volatileHold)notice+=' Browser recovery storage is unavailable; keep this receipt ID.';volatileHold=false;}
   }
   return true;
  }catch(error){
   if(stopped)return false;
   const unknown=!(error instanceof Outcome)||error.unknown||(recover&&!terminalDenials.has(error.code));
   if(!unknown){pending[lane]=null;if(!persist()){pending[lane]=command;storageBlocked=true;}}
   notice=(denialText[error?.code]||'The result could not be verified.')+(pending[lane]?` Keep request ${command.request_id}; recover that same request before another ordinary action.`:' No action was confirmed.');
   if(lane==='emergency'&&volatileHold&&pending.emergency)notice+=' Recovery storage is unavailable. Keep this tab open and use Recover emergency hold.';
   return false;
  }finally{busy[lane]=false;emit();}
 }
 async function submit(action,reason,item=''){
  if(!state().canAct)return false;
  let requestId;try{requestId=randomId();}catch{notice='A safe request ID could not be created. No action was sent.';emit();return false;}
  const command={action,request_id:requestId,reason,expected_version:snapshot.version,...(item?{item_id:item}:{})};
  if(!validCommand(command)){notice='Choose a valid action, reason and approved item ID.';emit();return false;}
  pending.control=command;
  if(!persist()){notice='This browser could not save a recovery receipt. No ordinary action was sent. Emergency hold remains available.';emit();return false;}
  return dispatch('control',false);
 }
 async function hold(){
  if(stopped||busy.emergency)return false;
  if(pending.emergency)return dispatch('emergency',true);
  let requestId;try{requestId=randomId();}catch{notice='A safe emergency request ID could not be created. Reload the emergency console.';emit();return false;}
  pending.emergency={action:'hold',reason:'safety_stop',request_id:requestId};
  if(!validCommand(pending.emergency,true)){pending.emergency=null;notice='A safe emergency request ID could not be created. Reload the emergency console.';emit();return false;}
  volatileHold=!persist();return dispatch('emergency',false);
 }
 return Object.freeze({state,refresh,submit,hold,recover:lane=>{
   if(!['control','emergency'].includes(lane)||stopped||busy[lane]||!pending[lane]||lane==='control'&&(emergencyOnly||storageBlocked||busy.emergency||pending.emergency))return Promise.resolve(false);
   return dispatch(lane,true);
  },dispose(){stopped=true;for(const controller of controllers)controller.abort();}});
}

export function mountOperatorConsole(document,window){
 const owner=document.querySelector('meta[name=lounge-owner]')?.content,csrf=document.querySelector('meta[name=csrf]')?.content;
 const emergencyOnly=document.querySelector('meta[name=lounge-console]')?.content==='emergency';
 const status=document.querySelector('#status'),stage=document.querySelector('#stage-status'),form=document.querySelector('#commands');
 const holdButton=document.querySelector('#emergency-hold'),refreshButton=document.querySelector('#refresh');
 let storage;try{storage=window.sessionStorage;}catch{/* emergency must remain usable */}
 let lastNotice='';
 function render(value){
  status.textContent=value.notice;
  if(value.notice&&value.notice!==lastNotice){lastNotice=value.notice;status.focus();}
  if(stage)stage.textContent=value.snapshot&&value.snapshot.freshUntil<=Date.now()?'Stage status expired. Refresh before an ordinary action.':value.readNotice;
  for(const button of form?.querySelectorAll('button')||[])button.disabled=!value.canAct;
  if(refreshButton)refreshButton.disabled=value.busy.read||value.busy.control||value.busy.emergency;
  holdButton.disabled=!value.canHold;holdButton.textContent=value.busy.emergency?'Checking emergency hold…':value.pending.emergency?'RECOVER EMERGENCY HOLD':'EMERGENCY HOLD';
  for(const lane of ['control','emergency']){
   const section=document.querySelector(`#pending-${lane}`),button=document.querySelector(`#recover-${lane}`),label=document.querySelector(`#receipt-${lane}`);
   if(!section)continue;section.hidden=!value.pending[lane];label.textContent=value.pending[lane]?`Unconfirmed ${value.pending[lane].action} request: ${value.pending[lane].request_id}. Recovery uses this same request; refreshing stage status cannot confirm its receipt.`:'';
   button.disabled=value.busy[lane]||lane==='control'&&(value.storageBlocked||value.busy.emergency||!!value.pending.emergency);
  }
 }
 const controller=createOperatorConsole({owner,csrf,storage,emergencyOnly,onChange:render,fetcher:window.fetch.bind(window)});
 form?.addEventListener('submit',event=>{
  event.preventDefault();const action=event.submitter?.value;if(!actions.has(action))return;
  void controller.submit(action,document.querySelector('#reason').value,action==='showcase'?document.querySelector('#item').value.trim():'');
 });
 holdButton.addEventListener('click',()=>void controller.hold());
 refreshButton?.addEventListener('click',()=>void controller.refresh());
 for(const lane of ['control','emergency'])document.querySelector(`#recover-${lane}`)?.addEventListener('click',()=>void controller.recover(lane));
 const timer=window.setInterval(()=>render(controller.state()),1000);
 window.addEventListener('pagehide',()=>{window.clearInterval(timer);controller.dispose();},{once:true});
 window.addEventListener('pageshow',event=>{if(event.persisted)window.location.reload();});
 render(controller.state());if(!emergencyOnly)void controller.refresh();return controller;
}
if(typeof document!=='undefined'&&typeof window!=='undefined'&&document.querySelector('meta[name=lounge-console]'))mountOperatorConsole(document,window);
