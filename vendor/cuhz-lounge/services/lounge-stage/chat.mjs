import { createHmac,timingSafeEqual } from 'node:crypto';
const events=new WeakSet();
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
// EventSub envelope IDs are opaque header values, not chat-message identifiers.
export const isEventSubEnvelopeId=value=>typeof value==='string'&&/^[\x21-\x7e]{1,256}$/.test(value);
const numeric=value=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value);
export function isTrustedChatEvent(value){return events.has(value);}
/** Call with exact raw HTTP bytes. No browser JSON or badge can mint this object. */
export function verifyStageChat({body,headers,secret,now=Date.now(),broadcasterId='175727753'}={}) {
  if(!Buffer.isBuffer(body)||body.length>32_768||typeof secret!=='string'||secret.length<32)return null;
  const messageId=headers?.get('twitch-eventsub-message-id'),stamp=headers?.get('twitch-eventsub-message-timestamp');
  const signature=headers?.get('twitch-eventsub-message-signature'),time=Date.parse(stamp);
  if(!isEventSubEnvelopeId(messageId)||!Number.isFinite(time)||time>now+30_000||now-time>600_000||!/^sha256=[a-f0-9]{64}$/.test(signature||''))return null;
  const expected=Buffer.from('sha256='+createHmac('sha256',secret).update(messageId+stamp).update(body).digest('hex'));
  if(!timingSafeEqual(expected,Buffer.from(signature)))return null;
  if(headers.get('twitch-eventsub-message-type')!=='notification')return null;
  let data;try{data=JSON.parse(body.toString('utf8'));}catch{return null;}
  const event=data?.event;
  if(data?.subscription?.type!=='channel.chat.message'||event?.broadcaster_user_id!==broadcasterId
    ||event.source_broadcaster_user_id!=null||!numeric(event.chatter_user_id)||!id(event.source_message_id||event.message_id)
    ||typeof event.message?.text!=='string'||event.message.text.length>500)return null;
  const trusted=Object.freeze({twitchId:event.chatter_user_id,operationKey:`chat:${event.source_message_id||event.message_id}`,
    text:event.message.text,homeBroadcasterId:event.broadcaster_user_id,envelopeMessageId:messageId,
    // Signed notification timestamp, not original chat-message creation time.
    verifiedAt:now,occurredAt:time});events.add(trusted);return trusted;
}
export function parseStageChat(event) {
  if(!isTrustedChatEvent(event))return null;
  const words=event.text.trim().split(/\s+/u);
  if(words[0]?.toLowerCase()!=='!lounge')return null;
  if(words.length===2&&words[1]==='whoami')return {kind:'whoami'};
  if(words.length===2&&words[1].toLowerCase()==='create')return {kind:'generation'};
  if(words.length===1||(words.length===2&&words[1]==='status'))return {kind:'status'};
  if(words.length===3&&words[1]==='show'&&/^[a-f0-9-]{36}$/i.test(words[2]))return {kind:'command',command:{action:'show',item_id:words[2],request_id:event.operationKey}};
  if(words.length===2&&['end','hold','resume','next','clear'].includes(words[1]))return {kind:'command',command:{action:words[1]==='end'?'end_session':words[1],request_id:event.operationKey,reason:`chat_${words[1]}`}};
  return {kind:'help'};
}
