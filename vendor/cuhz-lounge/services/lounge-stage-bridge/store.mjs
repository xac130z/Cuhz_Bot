/** Bot-side service connection only; no provider key or network client created. */
export function createStageBridgeStore({query,allowSubscription=false,allowPilot=false}={}){
 if(typeof query!=='function')throw Error('BRIDGE_CONFIG_INVALID');
 const one=async(sql,args=[])=>(await query(sql,args)).rows?.[0];
 const actor=async(c,permission=null)=>(await one('select public.lounge_bridge_actor($1,$2,$3) result',[c.sessionId,c.sessionRevision,permission]))?.result;
 return Object.freeze({
  actor,
  enabled:async()=>Boolean((await one("select enabled from lounge_feature_flags where key='library.review.enabled'"))?.enabled),
  connection:async c=>(await one('select connection_revision from lounge_members where user_id=$1',[c.userId]))?.connection_revision,
  output:(c,id)=>one(`select id,output_path,output_sha256,input->>'size' size from lounge_studio_generations where user_id=$1 and id=$2 and status='succeeded' and provider_started_at is not null`,[c.userId,id]),
  write:async(c,requestId,action,payload)=>(await one('select public.lounge_bridge_write($1,$2,$3,$4,$5,$6,$7) result',[c.sessionId,c.sessionRevision,requestId,action,JSON.stringify(payload),allowSubscription,allowPilot]))?.result,
  activity:async(c,command)=>(await one('select public.lounge_stage_apply($1,$2,$3,$4,$5,$6) result',[c.sessionId,c.sessionRevision,c.connectionRevision,JSON.stringify(command),allowSubscription,allowPilot]))?.result,
  member:async c=>{
   const batches=(await query(`select id,status from lounge_studio_generations where user_id=$1 and execution_mode='batch' and batch_size=3 and exists(select 1 from lounge_image_usage u where u.batch_id=lounge_studio_generations.id) order by created_at desc,id limit 20`,[c.userId])).rows;
   for(const batch of batches)batch.outputs=(await query('select id,status from lounge_studio_generations where user_id=$1 and batch_id=$2 order by batch_index limit 5',[c.userId,batch.id])).rows;
   const items=(await query(`select i.id,i.generation_id as "generationId",i.status,i.public_title title,i.public_creator_name as "displayName",(select id from lounge_review_requests r where r.item_id=i.id order by created_at desc,id limit 1) as "reviewId" from lounge_library_items i where i.user_id=$1 order by i.created_at desc,i.id limit 60`,[c.userId])).rows;
   const stage=(await one('select lounge_stage_public($1,$2) result',[allowSubscription,allowPilot])).result;
   const activity=await one('select batch_id as "batchId",phase,display_name as "displayName" from lounge_stage_activity where user_id=$1 and revoked_at is null',[c.userId]);
   return {enabled:await (one("select enabled from lounge_feature_flags where key='library.review.enabled'")).then(r=>Boolean(r?.enabled)),stage:{version:stage.version,mode:stage.mode,endsAt:stage.endsAt},batches,items,activity:stage.activity&&activity?activity:null};
  },
  reviews:async()=>(await query(`select r.id,r.item_id as "itemId",i.public_title title,i.public_creator_name as "displayName",i.label from lounge_review_requests r join lounge_library_items i on i.id=r.item_id join lounge_library_verifications v on v.item_id=i.id where r.decision='pending' and i.status='in_review' and i.publish_consent_at is not null order by r.created_at,r.id limit 50`)).rows,
  reviewAsset:id=>one(`select v.public_path path,v.public_sha256 sha256 from lounge_review_requests r join lounge_library_items i on i.id=r.item_id join lounge_library_verifications v on v.item_id=i.id where r.id=$1 and r.decision='pending' and i.status='in_review' and i.publish_consent_at is not null and coalesce((select enabled from lounge_feature_flags where key='library.review.enabled'),false)`,[id]),
 });
}
