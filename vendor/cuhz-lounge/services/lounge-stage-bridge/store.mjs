import { createCommandRetentionPort } from '../lounge-retention/port.mjs';
/** Bot-side service connection only; no provider key or network client created. */
export function createStageBridgeStore({query,allowSubscription=false,allowPilot=false}={}){
 if(typeof query!=='function')throw Error('BRIDGE_CONFIG_INVALID');
 const one=async(sql,args=[])=>(await query(sql,args)).rows?.[0];
 const commands=createCommandRetentionPort({query});
 const actor=async(c,permission=null)=>(await one('select public.lounge_bridge_actor($1,$2,$3) result',[c.sessionId,c.sessionRevision,permission]))?.result;
 const curatedColumns=`i.id,i.status,i.public_title title,i.public_creator_name as "displayName",p.revision,p.catalog_key as "catalogKey",p.catalog_revision as "catalogRevision",p.source_sha256 as "canonicalHash",v.public_sha256 as "derivativeHash",i.storage_path_canonical as "canonicalPath",v.public_path as "publicPath",(select r.id from lounge_review_requests r where r.item_id=i.id order by r.created_at desc,r.id limit 1) as "reviewId"`;
 const curatedFrom='from lounge_owner_curated_items p join lounge_library_items i on i.id=p.item_id and i.user_id=p.user_id join lounge_library_verifications v on v.item_id=i.id and v.canonical_sha256=i.sha256';
 return Object.freeze({
  actor,
  commandPreflight:commands.preflight,
  enabled:async()=>Boolean((await one("select enabled from lounge_feature_flags where key='library.review.enabled'"))?.enabled),
  connection:async c=>(await one('select connection_revision from lounge_members where user_id=$1',[c.userId]))?.connection_revision,
  curatedActor:async(c,connection,ownerId,rules)=>(await one('select public.lounge_owner_curated_actor($1,$2,$3,$4,$5) result',[c.sessionId,c.sessionRevision,connection,ownerId,rules]))?.result,
  curatedEnabled:async()=>Boolean((await one("select count(*)=2 as enabled from lounge_feature_flags where key in ('library.curated.enabled','library.review.enabled') and enabled"))?.enabled),
  curatedHeld:async()=>(await one("select mode='hold' as held from lounge_stage_state where id=1"))?.held===true,
  curatedReceiptExists:async(c,id)=>Boolean(await one('select 1 from lounge_bridge_receipts where user_id=$1 and request_id=$2',[c.userId,id])),
  curatedItem:(c,id)=>one(`select ${curatedColumns} ${curatedFrom} where i.user_id=$1 and i.id=$2`,[c.userId,id]),
  curatedSnapshot:async(c,key,revision)=>({item:await one(`select ${curatedColumns} ${curatedFrom} where i.user_id=$1 and p.catalog_key=$2 and p.catalog_revision=$3`,[c.userId,key,revision]),stageHeld:(await one("select mode='hold' as held from lounge_stage_state where id=1"))?.held===true}),
  curatedWrite:async(c,connection,ownerId,rules,requestId,action,payload)=>(await one('select public.lounge_owner_curated_write($1,$2,$3,$4,$5,$6,$7,$8) result',[c.sessionId,c.sessionRevision,connection,ownerId,rules,requestId,action,JSON.stringify(payload)]))?.result,
  output:(c,id)=>one(`select id,output_path,output_sha256,input->>'size' size from lounge_studio_generations where user_id=$1 and id=$2 and status='succeeded' and provider_started_at is not null`,[c.userId,id]),
  write:async(c,requestId,action,payload)=>(await one('select public.lounge_bridge_write($1,$2,$3,$4,$5,$6,$7) result',[c.sessionId,c.sessionRevision,requestId,action,JSON.stringify(payload),allowSubscription,allowPilot]))?.result,
  activity:async(c,command)=>(await one('select public.lounge_stage_apply($1,$2,$3,$4,$5,$6) result',[c.sessionId,c.sessionRevision,c.connectionRevision,JSON.stringify(command),allowSubscription,allowPilot]))?.result,
  member:async(c,{reviewFeedback=false}={})=>{
   const batches=(await query(`select id,status from lounge_studio_generations where user_id=$1 and execution_mode='batch' and batch_size=3 and exists(select 1 from lounge_image_usage u where u.batch_id=lounge_studio_generations.id) order by created_at desc,id limit 20`,[c.userId])).rows;
   for(const batch of batches)batch.outputs=(await query('select id,status from lounge_studio_generations where user_id=$1 and batch_id=$2 order by batch_index limit 5',[c.userId,batch.id])).rows;
   // Feedback is an opt-in extension: legacy strict clients keep their exact DTO.
   // Select a single latest own review so its ID and category cannot disagree.
   // private_notes is deliberately outside this query and every member response.
   const feedback=reviewFeedback===true?`,case when i.status='rejected' and latest_review.decision='rejected' and latest_review.reason_category ~ '^[a-z][a-z_]{1,63}$' then latest_review.reason_category else null end as "rejectionReason"`:'';
   const items=(await query(`select i.id,i.generation_id as "generationId",i.status,i.public_title title,i.public_creator_name as "displayName",latest_review.id as "reviewId"${feedback} from lounge_library_items i left join lateral (select r.id,r.decision,r.reason_category from lounge_review_requests r where r.item_id=i.id and r.user_id=i.user_id order by r.created_at desc,r.id limit 1) latest_review on true where i.user_id=$1 order by i.created_at desc,i.id limit 60`,[c.userId])).rows;
   const stage=(await one('select lounge_stage_public($1,$2) result',[allowSubscription,allowPilot])).result;
   const activity=await one('select batch_id as "batchId",phase,display_name as "displayName" from lounge_stage_activity where user_id=$1 and revoked_at is null',[c.userId]);
   return {enabled:await (one("select enabled from lounge_feature_flags where key='library.review.enabled'")).then(r=>Boolean(r?.enabled)),stage:{version:stage.version,mode:stage.mode,endsAt:stage.endsAt},batches,items,activity:stage.activity&&activity?activity:null};
  },
  reviews:async()=>(await query(`select r.id,r.item_id as "itemId",i.public_title title,i.public_creator_name as "displayName",i.label from lounge_review_requests r join lounge_library_items i on i.id=r.item_id join lounge_library_verifications v on v.item_id=i.id where r.decision='pending' and i.status='in_review' and i.publish_consent_at is not null order by r.created_at,r.id limit 50`)).rows,
  reviewAsset:id=>one(`select v.public_path path,v.public_sha256 sha256 from lounge_review_requests r join lounge_library_items i on i.id=r.item_id join lounge_library_verifications v on v.item_id=i.id where r.id=$1 and r.decision='pending' and i.status='in_review' and i.publish_consent_at is not null and coalesce((select enabled from lounge_feature_flags where key='library.review.enabled'),false)`,[id]),
 });
}
