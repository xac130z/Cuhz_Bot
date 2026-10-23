const fail=()=>{throw Object.assign(Error('DELIVERY_PROVIDER_UNKNOWN'),{code:'DELIVERY_PROVIDER_UNKNOWN'});};
/** Exactly one HTTP attempt. The durable outbox, not Resend's 24h key retention,
 * owns replay/reconciliation. Never retry an uncertain provider response here. */
export function createResendSender({apiKey,fetchImpl=globalThis.fetch,timeoutMs=10000}={}) {
 if(typeof apiKey!=='string'||!apiKey||typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('DELIVERY_PROVIDER_CONFIG_INVALID');
 return async function send(payload,{idempotencyKey,signal}={}){
  if(!payload||typeof payload!=='object'||Object.keys(payload).sort().join(',')!=='from,subject,text,to'
   ||typeof payload.from!=='string'||/[\r\n]/.test(payload.from)||payload.from.length>254
   ||!Array.isArray(payload.to)||payload.to.length!==1||typeof payload.to[0]!=='string'||/[\r\n]/.test(payload.to[0])||payload.to[0].length>254
   ||typeof payload.subject!=='string'||/[\r\n]/.test(payload.subject)||payload.subject.length>120||typeof payload.text!=='string'||payload.text.length>4096
   ||!/^cuhz-delivery\/[0-9a-f-]{36}$/.test(idempotencyKey||''))fail();
  const controller=new AbortController(),abort=()=>controller.abort();let timer;
  if(signal?.aborted)fail();signal?.addEventListener('abort',abort,{once:true});
  try{return await Promise.race([(async()=>{
   const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'error',cache:'no-store',signal:controller.signal,
    headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(payload)});
   if(!response.ok||controller.signal.aborted){void response.body?.cancel().catch(()=>{});fail();}
   const reader=response.body?.getReader();if(!reader)fail();let bytes=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
   try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>16384)fail();text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
   finally{void reader.cancel().catch(()=>{});}
   let data;try{data=JSON.parse(text);}catch{fail();}
   if(typeof data.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.id)||controller.signal.aborted)fail();
   return {id:data.id};
  })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('DELIVERY_PROVIDER_UNKNOWN'));},timeoutMs);})]);}
  catch{fail();}finally{clearTimeout(timer);controller.abort();signal?.removeEventListener('abort',abort);}
 };
}
