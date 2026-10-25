import {createHmac,timingSafeEqual} from 'node:crypto';
import {createVault,digest} from '../lounge-auth/crypto.mjs';

export const DELIVERY_EVIDENCE_PATH='/api/lounge/v2/deliveries/provider-evidence';
export const MAIL_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const invalid=()=>{throw Error('DELIVERY_EVIDENCE_INVALID');};
const text=(s,max)=>typeof s==='string'&&s.length>0&&s.length<=max&&!/[\r\n]/.test(s);
// A keyed digest permits matching after destination/link erasure. Never retain
// raw webhook bodies, addresses, subjects or bearer links as evidence.
export function deliveryEnvelopeHash(key,payload){
 if(!text(payload?.from,254)||!Array.isArray(payload.to)||payload.to.length!==1||!text(payload.to[0],254)||!text(payload.subject,120))invalid();
 return createVault(key).rateKey('delivery-envelope-v1:'+JSON.stringify([payload.from,payload.to[0],payload.subject]));
}
export function decodeWebhookSecret(secret){
 if(typeof secret!=='string'||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))invalid();
 const encoded=secret.slice(6),key=Buffer.from(encoded,'base64');
 if(key.length<16||key.length>64||key.toString('base64').replace(/=+$/,'')!==encoded.replace(/=+$/,''))invalid();
 return key;
}
// Implements the published Svix HMAC-SHA256 protocol using Node's primitives.
// Kept dependency-free for the closed bot runtime; official known vector is
// tested. The signed ID + timestamp + exact bytes all participate in the MAC.
export function verifyResendWebhook({body,headers,secret,now=Date.now()}){
 if(!(body instanceof Uint8Array)||body.byteLength>16384||!Number.isFinite(now))invalid();
 const id=headers.get('svix-id'),stamp=headers.get('svix-timestamp'),signatures=headers.get('svix-signature');
 if(!text(id,128)||!/^[A-Za-z0-9_-]+$/.test(id)||!/^\d{10}$/.test(stamp||'')||!text(signatures,1024)||Math.abs(now/1000-Number(stamp))>300)invalid();
 const expected=createHmac('sha256',decodeWebhookSecret(secret)).update(id+'.'+stamp+'.').update(body).digest();
 let matched=false;
 for(const entry of signatures.split(' ')){
  if(!/^v1,[A-Za-z0-9+/]{43}=$/.test(entry))continue;
  const actual=Buffer.from(entry.slice(3),'base64');
  if(actual.length===expected.length&&timingSafeEqual(expected,actual))matched=true;
 }
 if(!matched)invalid();
 let event;try{event=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{invalid();}
 if(!event||typeof event!=='object'||Array.isArray(event))invalid();
 return {event,eventHash:digest(id),bodyHash:digest(body)};
}
const reply=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function readBody(request){
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>16384))invalid();
 const reader=request.body?.getReader();if(!reader)invalid();
 let timer;const parts=[];let size=0;
 try{return await Promise.race([(async()=>{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384)invalid();parts.push(value);}
  return Buffer.concat(parts,size);
 })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DELIVERY_EVIDENCE_INVALID')),2000);})]);}
 finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
}
/** Independent receive-only gate. Sending may remain disabled while signed
 * evidence settles an already attempted message. Never calls a mail provider. */
export function createResendWebhook({secret,key,query,enabled=false,now=Date.now}={}){
 if(enabled!==true)return async()=>reply(503,{error:'DELIVERY_EVIDENCE_DISABLED'});
 decodeWebhookSecret(secret);createVault(key);if(typeof query!=='function')invalid();
 return async request=>{
  const url=new URL(request.url);
  if(url.pathname!==DELIVERY_EVIDENCE_PATH||url.search)return reply(404,{error:'NOT_FOUND'});
  if(request.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  let proof,evidence;
  try{
   if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||'')||!['', 'identity'].includes(request.headers.get('content-encoding')||''))invalid();
   proof=verifyResendWebhook({body:await readBody(request),headers:request.headers,secret,now:now()});
   if(!text(proof.event.type,80))invalid();
   if(proof.event.type!=='email.sent')return reply(202,{ignored:true});
   const event=proof.event,data=event.data,tags=data?.tags;
   if(!MAIL_UUID.test(tags?.cuhz_mail||'')||!MAIL_UUID.test(tags?.cuhz_attempt||'')||!text(data?.email_id,128)||!/^[A-Za-z0-9_-]+$/.test(data.email_id)
    ||typeof event.created_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(event.created_at)||!Number.isFinite(Date.parse(event.created_at)))invalid();
   evidence={eventHash:proof.eventHash,bodyHash:proof.bodyHash,mailId:tags.cuhz_mail,claimId:tags.cuhz_attempt,
    providerId:data.email_id,envelopeHash:deliveryEnvelopeHash(key,data),occurredAt:event.created_at};
  }catch{return reply(400,{error:'DELIVERY_EVIDENCE_INVALID'});}
  try{
   const result=(await query('select public.lounge_delivery_mail_reconcile($1::jsonb) result',[JSON.stringify(evidence)])).rows?.[0]?.result;
   if(result?.ok!==true)return reply(409,{error:'DELIVERY_EVIDENCE_NOT_APPLIED'});
   return reply(200,{ok:true,replayed:result.replayed===true});
  }catch{return reply(503,{error:'DELIVERY_EVIDENCE_UNAVAILABLE'});}
 };
}
