const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,list)=>object(v)&&Object.keys(v).length===list.length&&list.every(k=>Object.hasOwn(v,k));
const integer=(v,max=1000000000)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const date=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v));
const clone=v=>v===null?null:JSON.parse(JSON.stringify(v));
const reasons=new Set(['owner_schedule','schedule_change','safety_stop']);
const knownDenials=new Set(['STAGE_CONTROL_DISABLED','STAGE_OWNER_UNCONFIGURED','STAGE_OWNER_REQUIRED','AUTH_DISABLED','AUTH_REQUIRED','AUTH_ORIGIN_DENIED','AUTH_CSRF_DENIED','AUTH_IDENTITY_CHANGED','AUTH_UNAVAILABLE','AUTH_REFRESH_PENDING',
 'INVALID_REQUEST','SESSION_RECHECK_REQUIRED','CONNECTION_CHANGED','OWNER_ROLE_REQUIRED','IDEMPOTENCY_CONFLICT','ISOLATION_UNSUPPORTED',
 'BOOKING_DISABLED','RESOURCE_NOT_CONFIGURED','WINDOW_ALREADY_EXISTS','WINDOW_NOT_FOUND','WINDOW_ALREADY_PUBLISHED','REVISION_CONFLICT','WINDOW_WITHDRAWN',
 'OUTSIDE_BOOKING_HORIZON','OUTSIDE_OWNER_HOURS','WINDOW_OVERLAP','POLICY_NOT_PUBLISHED']);
const messages={STAGE_OWNER_REQUIRED:'Live Lounge control is restricted to the owner during this test.',
 STAGE_CONTROL_DISABLED:'Owner test controls are not enabled.',
 STAGE_OWNER_UNCONFIGURED:'Owner test controls are waiting for verified account configuration.',
 OWNER_ROLE_REQUIRED:'Only the verified owner can manage openings.',AUTH_CSRF_DENIED:'Your sign-in changed. Reload before recovering the same request.',
 RESOURCE_NOT_CONFIGURED:'The stage needs an enabled resource and an approved matching booking policy.',WINDOW_OVERLAP:'This opening overlaps another published opening.',
 OUTSIDE_OWNER_HOURS:'Use a Monday–Friday opening day, from noon until 1 AM the following day in New York.',
 OUTSIDE_BOOKING_HORIZON:'Choose a start within the approved notice and advance-booking limits.',REVISION_CONFLICT:'This opening changed. Refresh and review it again.',
 BOOKING_DISABLED:'New openings and bookings are not enabled. Existing openings can still be withdrawn.',
 WINDOW_WITHDRAWN:'This opening was withdrawn. Create a new draft to offer another opening.'};
export function validOpeningCommand(v){
 if(!object(v)||!['create','publish','withdraw'].includes(v.action)||!UUID.test(v.requestId||'')||!UUID.test(v.windowId||'')
 ||!integer(v.expectedRevision,99)||!reasons.has(v.reason))return false;
 const common=['action','requestId','windowId','expectedRevision','reason'];
 if(v.action!=='create')return keys(v,common);
 return keys(v,[...common,'resourceId','policyVersion','openingDate','startTime','endTime'])&&v.expectedRevision===0&&UUID.test(v.resourceId||'')
 &&integer(v.policyVersion,999999999)&&v.policyVersion>0&&/^\d{4}-\d{2}-\d{2}$/.test(v.openingDate||'')
 &&/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v.startTime||'')&&/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v.endTime||'');
}
function validOpening(v){return keys(v,['id','resourceId','startsAt','endsAt','ownerTimezone','policyVersion','revision','state','available','publishedAt','outstandingBookings'])
 &&UUID.test(v.id||'')&&UUID.test(v.resourceId||'')&&date(v.startsAt)&&date(v.endsAt)&&Date.parse(v.endsAt)>Date.parse(v.startsAt)
 &&typeof v.ownerTimezone==='string'&&v.ownerTimezone.length<=100&&integer(v.policyVersion,999999999)&&v.policyVersion>0
 &&integer(v.revision,100)&&['draft','published','withdrawn'].includes(v.state)&&typeof v.available==='boolean'
 &&(v.publishedAt===null||date(v.publishedAt))&&integer(v.outstandingBookings);}
function validResource(v){return keys(v,['id','policyVersion','slotMinutes','intervalMinutes','holdMinutes','minNoticeMinutes','horizonDays','cancelCutoffHours','checkinGraceMinutes'])
 &&UUID.test(v.id||'')&&v.slotMinutes===30&&integer(v.policyVersion,999999999)&&v.policyVersion>0
 &&integer(v.intervalMinutes,1440)&&v.intervalMinutes>=30&&integer(v.holdMinutes,15)&&v.holdMinutes>0
 &&integer(v.minNoticeMinutes,525600)&&integer(v.horizonDays,365)&&v.horizonDays>0&&integer(v.cancelCutoffHours,8760)
 &&integer(v.checkinGraceMinutes,30)&&v.checkinGraceMinutes>0;}
class Failure extends Error{constructor(code,unknown=false){super(code);this.code=code;this.unknown=unknown;}}
export function createOpeningsClient({owner,csrf,storage,fetcher=fetch,randomId=()=>crypto.randomUUID(),now=Date.now,timeoutMs=12000,onChange=()=>{}}={}){
 if(!UUID.test(owner||'')||!/^[A-Za-z0-9_-]{43}$/.test(csrf||'')||typeof fetcher!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('OPENINGS_CLIENT_CONFIG_INVALID');
 const key=`cuhz-opening-recovery:v1:${owner}`,controllers=new Set();
 let pending=null,data=null,readAt=0,busy=false,reading=false,stopped=false,blocked=false,epoch=0,notice='',readNotice='';
 const state=()=>({pending:clone(pending),data:clone(data),busy,reading,blocked,notice,readNotice,
  canWrite:!stopped&&!blocked&&!pending&&!busy&&!reading&&!!data&&now()-readAt<15000,
  fresh:!!data&&now()-readAt<15000});
 const emit=()=>{if(!stopped)onChange(state());};
 try{const raw=storage?.getItem(key);if(raw===undefined)throw Error();if(raw!==null){if(raw.length>2048)throw Error();pending=JSON.parse(raw);if(!validOpeningCommand(pending))throw Error();}}
 catch{blocked=true;pending=null;notice='Recovery storage is unavailable. Opening changes are paused; stage emergency hold is still available.';}
 function persist(){if(blocked)return false;try{
  if(pending){const raw=JSON.stringify(pending);storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error();}
  else{storage.removeItem(key);if(storage.getItem(key)!==null)throw Error();}return true;
 }catch{blocked=true;return false;}}
 async function request(input){const controller=new AbortController();controllers.add(controller);let timer;
  const work=async()=>{const response=await fetcher('/api/lounge/v2/bookings/openings',{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,
    ...(input?{headers:{'Content-Type':'application/json','X-Lounge-CSRF':csrf},body:JSON.stringify(input)}:{})});
   if(stopped||controller.signal.aborted)throw new Failure('STOPPED',!!input);
   if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))throw new Failure('INVALID_RESPONSE',!!input);
   const reader=response.body?.getReader();if(!reader)throw new Failure('INVALID_RESPONSE',!!input);let text='',bytes=0;
   const decoder=new TextDecoder('utf-8',{fatal:true});try{for(;;){const part=await reader.read();if(stopped||controller.signal.aborted)throw new Failure('STOPPED',!!input);
    if(part.done)break;bytes+=part.value.byteLength;if(bytes>(input?8192:196608))throw new Failure('INVALID_RESPONSE',!!input);text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
   finally{void reader.cancel().catch(()=>{});}
   const value=JSON.parse(text);if(!response.ok||value?.ok===false){const code=value?.error||value?.code;throw new Failure(knownDenials.has(code)?code:'OUTCOME_UNKNOWN',!!input&&!knownDenials.has(code));}return value;
  };
  try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Failure('OUTCOME_UNKNOWN',!!input));},timeoutMs);})]);}
  catch(error){if(error instanceof Failure)throw error;throw new Failure('OUTCOME_UNKNOWN',!!input);}
  finally{clearTimeout(timer);controller.abort();controllers.delete(controller);}
 }
 async function refresh(){if(stopped||busy||reading)return false;const run=epoch;reading=true;data=null;readNotice='Checking published openings…';emit();
  try{const result=await request();if(stopped||run!==epoch)return false;
   if(!keys(result,['ok','serverNow','ownerTimezone','enabled','resources','openings'])||result.ok!==true||!date(result.serverNow)
    ||Math.abs(Date.parse(result.serverNow)-now())>60000||result.ownerTimezone!=='America/New_York'||typeof result.enabled!=='boolean'
    ||!Array.isArray(result.resources)||result.resources.length>1||!result.resources.every(validResource)
    ||!Array.isArray(result.openings)||result.openings.length>256||!result.openings.every(validOpening)
    ||new Set(result.openings.map(v=>v.id)).size!==result.openings.length)throw new Failure('INVALID_RESPONSE');
   data=result;readAt=now();readNotice=!result.enabled?'New booking publication is disabled.':result.resources.length?'Openings checked. Drafts are not bookable.':'No configured stage resource with an approved policy is available.';return true;
  }catch(error){if(!stopped&&run===epoch)readNotice=messages[error?.code]||'Openings could not be verified. Refresh when ready.';return false;}
  finally{reading=false;emit();}
 }
 async function dispatch(recover){if(stopped||busy||blocked||!pending)return false;
  const command=pending;busy=true;data=null;epoch++;notice=`Checking ${command.action} request ${command.requestId}…`;emit();
  try{const result=await request(command);if(stopped)return false;
   const response=result?.response;
   if(!keys(result,['ok','replayed','response'])||result.ok!==true||typeof result.replayed!=='boolean'
    ||!keys(response,['requestId','action','opening','cancelledBookings'])||response.requestId!==command.requestId||response.action!==command.action
    ||!validOpening(response.opening)||response.opening.id!==command.windowId||!integer(response.cancelledBookings)
    ||response.opening.revision!==command.expectedRevision+1
    ||response.opening.state!==({create:'draft',publish:'published',withdraw:'withdrawn'})[command.action]
    ||(command.action!=='withdraw'&&response.cancelledBookings!==0)
    ||(command.action==='create'&&(response.opening.resourceId!==command.resourceId||response.opening.policyVersion!==command.policyVersion)))throw new Failure('INVALID_RESPONSE',true);
   pending=null;if(!persist()){pending=command;notice=`Request ${command.requestId} was recorded, but recovery storage could not be cleared. Reload to recover the same receipt.`;}
   else notice=`${result.replayed?'Earlier receipt recovered':'Opening action recorded'}. Receipt ${command.requestId}. ${response.cancelledBookings?`${response.cancelledBookings} outstanding reservation(s) cancelled without member strikes. `:''}Refresh to view current openings.`;
   return true;
  }catch(error){if(stopped)return false;
   if(error instanceof Failure&&!error.unknown&&!recover){pending=null;if(!persist())pending=command;}
   notice=(messages[error?.code]||'The result could not be verified.')+(pending?` Keep request ${command.requestId}; recover the same request before another change.`:' No change was confirmed.');return false;
  }finally{busy=false;emit();}
 }
 async function submit(fields){if(!state().canWrite)return false;let requestId;try{requestId=randomId();}catch{return false;}
  const command={...fields,requestId};if(!validOpeningCommand(command)){notice='Review the opening, action and times before continuing.';emit();return false;}
  if(command.action!=='withdraw'&&!data.enabled)return false;
  pending=command;if(!persist()){notice='The recovery receipt could not be saved. No change was sent.';emit();return false;}return dispatch(false);
 }
 return Object.freeze({state,refresh,submit,recover:()=>dispatch(true),dispose(){stopped=true;epoch++;for(const c of controllers)c.abort();}});
}
