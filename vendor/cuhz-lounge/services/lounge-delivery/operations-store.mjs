import {isTrustedAuthContext} from '../lounge-auth/runtime.mjs';
import {MAIL_UUID} from './resend-webhook.mjs';
const invalid=()=>{throw Object.assign(Error('INVALID_REQUEST'),{code:'INVALID_REQUEST',status:400});};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.sort().join(',');
export function normalizeOperationsInput(input){
 if(input?.action==='authorize'&&exact(input,['action']))return {action:'authorize'};
 if(input?.action==='detail'&&exact(input,['action','mailId'])&&typeof input.mailId==='string'&&MAIL_UUID.test(input.mailId))return {action:'detail',mailId:input.mailId};
 if(input?.action!=='list'||!exact(input,['action','scope','cursor'])||!['unresolved','recent'].includes(input.scope))invalid();
 const cursor=input.cursor;
 if(cursor!==null&&(!exact(cursor,['createdAt','id'])||typeof cursor.id!=='string'||!MAIL_UUID.test(cursor.id)||typeof cursor.createdAt!=='string'
  ||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(cursor.createdAt)||!Number.isFinite(Date.parse(cursor.createdAt))))invalid();
 return {action:'list',scope:input.scope,cursor:cursor===null?null:{createdAt:cursor.createdAt,id:cursor.id}};
}
export function createDeliveryOperationsStore({query,requiredRulesVersion,ownerTwitchId}={}){
 if(typeof query!=='function'||typeof requiredRulesVersion!=='string'||!requiredRulesVersion||requiredRulesVersion.length>100
  ||typeof ownerTwitchId!=='string'||!/^[1-9][0-9]{0,19}$/.test(ownerTwitchId))throw Error('DELIVERY_OPERATIONS_CONFIG_INVALID');
 return Object.freeze({async read(context,input){
  if(!isTrustedAuthContext(context)||!Number.isFinite(context.verifiedAt))throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED',status:401});
  const command=normalizeOperationsInput(input);
  return (await query('select public.lounge_delivery_operations($1,$2,$3,$4,$5,$6::jsonb) result',
   [context.sessionId,context.sessionRevision,new Date(context.verifiedAt).toISOString(),requiredRulesVersion,ownerTwitchId,JSON.stringify(command)])).rows?.[0]?.result;
 }});
}
