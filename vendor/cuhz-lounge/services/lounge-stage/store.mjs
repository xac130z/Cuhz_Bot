import { randomUUID } from 'node:crypto';
import { createCommandRetentionPort } from '../lounge-retention/port.mjs';
/** Existing Supabase database only; prepared query port, no secrets/env/network. */
export function createStageStore({query,allowSubscription=false,allowPilot=false}={}) {
  if(typeof query!=='function')throw Error('STAGE_STORE_CONFIG_INVALID');
  const one=async(sql,args=[])=>(await query(sql,args)).rows?.[0]??null;
  const commands=createCommandRetentionPort({query,unavailableCode:'ASSET_UNAVAILABLE'});
  const apply=async(context,command)=>(await one('select public.lounge_stage_apply($1,$2,$3,$4::jsonb,$5,$6) result',
    [context?.sessionId??null,context?.sessionRevision??null,context?.connectionRevision??null,JSON.stringify(command),allowSubscription===true,allowPilot===true]))?.result;
  return Object.freeze({
    apply,
    connection:async userId=>(await one('select connection_revision from public.lounge_members where user_id=$1 and disconnected_at is null',[userId]))?.connection_revision,
    operator:async context=>(await one('select public.lounge_stage_operator($1,$2) allowed',[context.sessionId,context.sessionRevision]))?.allowed===true,
    emergency:async context=>(await one('select public.lounge_stage_emergency($1,$2) allowed',[context.sessionId,context.sessionRevision]))?.allowed===true,
    tick:()=>apply(null,{action:'tick',request_id:`tick:${randomUUID()}`}),
    async read(){return (await one('select public.lounge_stage_public($1,$2) state',[allowSubscription===true,allowPilot===true]))?.state;},
    async executeChat(event,command,ownerControl){const {request_id:_messageKey,...payload}=command;void _messageKey;
      return (await one('select public.lounge_stage_chat_execute($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) result',
        [event.twitchId,event.operationKey,new Date(event.occurredAt).toISOString(),event.homeBroadcasterId,
          JSON.stringify(payload),ownerControl?.enabled===true,ownerControl?.twitchId??null,allowSubscription===true,allowPilot===true]))?.result;},
    // Delivery/expiry only: maintenance never replays a stage command.
    expireChat:async()=>one('select public.lounge_stage_chat_maintain() result'),
    async asset(hash){if(!await commands.frontierOpen())return null;return one(`select v.public_path as storage_path_canonical,v.public_sha256 as sha256 from public.lounge_library_items i
      join public.lounge_library_verifications v on v.item_id=i.id and v.canonical_sha256=i.sha256
      where v.public_sha256=$1 and i.status='approved' and i.publish_consent_at is not null and i.published_at is not null
      and exists(select 1 from public.lounge_feature_flags where key='stage.enabled' and enabled)
      and exists(select 1 from public.lounge_feature_flags where key='library.review.enabled' and enabled)
      order by i.id limit 1`,[hash]);},
  });
}
