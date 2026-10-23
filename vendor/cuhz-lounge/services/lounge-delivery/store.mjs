import { randomUUID } from 'node:crypto';
import { createVault, randomToken, digest } from '../lounge-auth/crypto.mjs';
import { isTrustedAuthContext } from '../lounge-auth/runtime.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
export const mailPurpose=id=>`lounge-delivery-mail:${id}`;
const bad=()=>{throw Object.assign(Error('INVALID_REQUEST'),{code:'INVALID_REQUEST',status:400});};
export function normalizeDeliveryInput(input) {
 if(!input||typeof input!=='object'||Array.isArray(input))bad();
 const keys={list:['action'],attest_age:['action','requestId','ageAttested'],verify_address:['action','requestId','email','consent'],
  confirm_address:['action','requestId','id','token'],request:['action','requestId','itemId','addressRevision','consent'],
  revoke:['action','requestId','id'],download:['action','id','token']}[input.action];
 if(!keys||Object.keys(input).length!==keys.length||keys.some(k=>!Object.hasOwn(input,k)))bad();
 const result=Object.fromEntries(keys.map(k=>[k,input[k]]));
 for(const key of ['requestId','id','itemId'])if(key in result){if(typeof result[key]!=='string'||!UUID.test(result[key]))bad();result[key]=result[key].toLowerCase();}
 if('consent' in result&&result.consent!==true)bad();
 if('ageAttested' in result&&result.ageAttested!==true)bad();
 if('addressRevision' in result&&(!Number.isSafeInteger(result.addressRevision)||result.addressRevision<1))bad();
 if('token' in result&&(typeof result.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(result.token)))bad();
 if('email' in result){
  if(typeof result.email!=='string'||result.email.length>254||!EMAIL.test(result.email)||result.email.startsWith('.')||result.email.includes('..'))bad();
  const [local,domain]=result.email.split('@');if(local.length>64||local.endsWith('.')||domain.split('.').some(p=>p.length>63||p.startsWith('-')||p.endsWith('-')))bad();
  result.email=`${local}@${domain.toLowerCase()}`;
 }
 return result;
}
/** Database port only. Token plaintext exists briefly in memory, then only in an
 * AES-GCM envelope bound to its outbox id. Receipts never return the token. */
export function createDeliveryStore({query,key,origin,from,requiredRulesVersion}={}) {
 if(typeof query!=='function'||new URL(origin).origin!==origin||!origin.startsWith('https://')
  ||typeof from!=='string'||from.length>254||!EMAIL.test(from)||!requiredRulesVersion)throw Error('DELIVERY_CONFIG_INVALID');
 const vault=createVault(key);
 const sql=(context,input,fingerprint=null,secret={})=>query('select public.lounge_delivery_command($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb) result',
  [context.sessionId,context.sessionRevision,new Date(context.verifiedAt).toISOString(),requiredRulesVersion,JSON.stringify(input),fingerprint,JSON.stringify(secret)]).then(r=>r.rows[0].result);
 async function command(context,raw) {
  if(!isTrustedAuthContext(context))throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED',status:401});
  const input=normalizeDeliveryInput(raw), fingerprint=digest(JSON.stringify(input));
  if(input.token){input.tokenHash=digest(input.token);delete input.token;}
  let secret={};
  if(input.action==='verify_address'||input.action==='request') {
   const id=randomUUID(),token=randomToken(),verification=input.action==='verify_address';let email=input.email;
   if(!verification){const view=await sql(context,{action:'list'});if(!view.ok)return view;email=view.address;
    if(typeof email!=='string')return{ok:false,code:'ADDRESS_VERIFICATION_REQUIRED'};}
   const link=`${origin}/lounge/delivery#${verification?'verify/':'download/'}${id}/${token}`;
   const payload={from,to:[email],subject:verification?'Verify your CUHZ Lounge delivery address':'Your CUHZ Lounge artwork',
    text:verification?`You asked to verify this address for CUHZ Lounge deliveries. Sign in to the same Lounge account, then confirm using this link within 30 minutes:\n\n${link}\n\nIf you did not request this, ignore this email. No subscription or marketing is started.`
     :`You requested this private artwork delivery from CUHZ Lounge. Sign in to your Lounge account to download it within 24 hours:\n\n${link}\n\nYou can revoke this delivery from the Lounge. This message contains only your requested delivery.`};
   secret={id,tokenHash:digest(token),sealedPayload:vault.seal(payload,mailPurpose(id)),
    ...(verification?{addressHash:vault.rateKey('delivery-address:'+email.toLowerCase())}:{email})};
  }
  return sql(context,input,fingerprint,secret);
 }
 return Object.freeze({command,
  claim:claimId=>query("select public.lounge_delivery_mail_step('claim',$1) result",[claimId]).then(r=>r.rows[0].result),
  finish:(claimId,outcome,providerId=null)=>query("select public.lounge_delivery_mail_step('finish',$1,$2,$3) result",[claimId,outcome,providerId]).then(r=>r.rows[0].result),
 });
}
