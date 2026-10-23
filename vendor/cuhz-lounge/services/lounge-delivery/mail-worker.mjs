import {randomUUID} from 'node:crypto';
import {createVault} from '../lounge-auth/crypto.mjs';
import {mailPurpose} from './store.mjs';
/** Serial, externally scheduled worker. No timer/provider work on import or
 * construction. A process death after claim leaves an unknown attempt. */
export function createDeliveryMailWorker({store,key,send,enabled=false,now=Date.now}={}) {
 if(!store?.claim||!store?.finish||typeof send!=='function')throw Error('DELIVERY_WORKER_CONFIG_INVALID');
 const vault=createVault(key);let active=enabled===true,flight=null,controller=null;
 return Object.freeze({start(){if(enabled===true)active=true;},stop(){active=false;controller?.abort();},
  async run(){
   if(!active)return{state:'disabled'};if(flight)return flight;
   const task=(async()=>{
    const claimId=randomUUID();let claimed=false,providerId=null;
    controller=new AbortController();
    try{
     const result=await store.claim(claimId);if(result?.ok!==true)throw Error('claim');
     if(!result.job)return{state:'idle'};claimed=true;const job=result.job;
     if(!active||controller.signal.aborted||job.claimId!==claimId||!Number.isFinite(Date.parse(job.expiresAt))||Date.parse(job.expiresAt)<=now())throw Error('stopped');
     const payload=vault.open(job.sealedPayload,mailPurpose(job.id));
     const response=await send(payload,{idempotencyKey:`cuhz-delivery/${job.id}`,signal:controller.signal});
     if(typeof response?.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(response.id))throw Error('provider');
     providerId=response.id;
     const settled=await store.finish(claimId,'sent',providerId);if(settled?.ok!==true)throw Error('settle');
     return{state:'sent',id:job.id};
    }catch{
     // A late successful provider response remains recoverable by its claim.
     // Never turn an unknown settlement into a new external request.
     if(claimed){try{await store.finish(claimId,providerId?'sent':'unknown',providerId);}catch{/* durable started row remains */}}
     return{state:'unknown',claimId};
    }finally{controller=null;}
   })();flight=task;try{return await task;}finally{if(flight===task)flight=null;}
  }
 });
}
