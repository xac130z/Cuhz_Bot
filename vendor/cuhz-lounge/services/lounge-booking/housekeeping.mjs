import {randomUUID} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const keys=(v,list)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===list.length&&list.every(k=>Object.hasOwn(v,k));
const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=64;
/** Uses the host's existing minute timer. A timed-out SQL call keeps the flight
 * locked until it settles; recovery uses the same operation ID, never overlaps. */
export function createBookingHousekeeping({query,enabled=false,allowSubscription=false,allowPilot=false,
 timeoutMs=6000,randomId=randomUUID,now=Date.now}={}){
 if(typeof query!=='function'||typeof randomId!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('BOOKING_CLEANUP_CONFIG_INVALID');
 let active=false,epoch=0,flight=null,pending=null,last=null,lastCode='DISABLED';
 const status=()=>({enabled:active,running:!!flight,pending:!!pending,code:lastCode,lastCompletedAt:last?.at??null,lastProcessed:last?.processed??null});
 async function run(){
  if(!active)return {ok:false,code:'BOOKING_CLEANUP_DISABLED'};
  if(flight)return {ok:false,code:'BOOKING_CLEANUP_BUSY'};
  if(!pending){let id;try{id=randomId();}catch{/* no query without a valid operation ID */}
   if(!UUID.test(id||'')){lastCode='UNAVAILABLE';return {ok:false,code:'BOOKING_CLEANUP_UNAVAILABLE'};}pending=id;}
  const id=pending,turn=epoch;lastCode='RUNNING';let timer,settled=false,finished=false;
  const operation=Promise.resolve().then(()=>{
   if(!active||turn!==epoch)throw Error('stopped');
   return query('select public.lounge_booking_housekeep($1,$2,$3,$4) result',[id,64,allowSubscription===true,allowPilot===true]);
  });
  flight=operation;
  // Retain the flight on timeout. This observer only clears transport occupancy;
  // it cannot convert an unobserved outcome into success or discard its receipt.
  const release=()=>{settled=true;if(finished&&flight===operation)flight=null;};
  void operation.then(release,release);
  try{
   const row=await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),timeoutMs);})]);
   if(!active||turn!==epoch)return {ok:false,code:'BOOKING_CLEANUP_STOPPED'};
   const result=row?.rows?.[0]?.result,r=result?.response;
   if(!keys(result,['ok','replayed','response'])||result.ok!==true||typeof result.replayed!=='boolean'
    ||!keys(r,['requestId','observedAt','processed','expired','noShows','cancelled','completed','leasesRevoked','hasMore','stageChanged'])
    ||r.requestId!==id||typeof r.observedAt!=='string'||!Number.isFinite(Date.parse(r.observedAt))
    ||!['processed','expired','noShows','cancelled','completed'].every(k=>count(r[k]))
    ||r.processed!==r.expired+r.noShows+r.cancelled+r.completed
    ||!Number.isSafeInteger(r.leasesRevoked)||r.leasesRevoked<0||typeof r.hasMore!=='boolean'||typeof r.stageChanged!=='boolean')throw Error('invalid response');
   pending=null;last={at:new Date(now()).toISOString(),processed:r.processed};lastCode='OK';return result;
  }catch{if(active&&turn===epoch)lastCode='OUTCOME_UNKNOWN';return {ok:false,code:'BOOKING_CLEANUP_OUTCOME_UNKNOWN'};}
  finally{clearTimeout(timer);finished=true;if(settled&&flight===operation)flight=null;}
 }
 return Object.freeze({run,status,start(){if(enabled===true&&!active){active=true;epoch++;lastCode='IDLE';}},stop(){active=false;epoch++;lastCode='DISABLED';}});
}
