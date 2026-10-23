import {isTrustedAuthContext} from '../lounge-auth/runtime.mjs';
export function createOpeningsStore({query,requiredRulesVersion}={}){
 if(typeof query!=='function'||typeof requiredRulesVersion!=='string'||!requiredRulesVersion.trim()||requiredRulesVersion.length>100)throw Error('OPENINGS_STORE_CONFIG_INVALID');
 async function execute(context,command){
  if(!isTrustedAuthContext(context)||!Number.isFinite(context.verifiedAt))throw Error('OPENINGS_CONTEXT_UNTRUSTED');
  return (await query('select public.lounge_booking_openings($1,$2,$3,$4,$5::jsonb) result',
   [context.sessionId,context.sessionRevision,new Date(context.verifiedAt).toISOString(),requiredRulesVersion,JSON.stringify(command)])).rows?.[0]?.result;
 }
 return Object.freeze({read:context=>execute(context,{action:'list'}),write:execute});
}
