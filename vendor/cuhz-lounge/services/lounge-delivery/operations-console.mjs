const BASE='/api/lounge/v2/deliveries/ops';
const labels={queued:'Queued; no attempt recorded',sending:'Attempt in progress',unknown:'Unknown outcome — do not resend',sent:'Provider accepted',cancelled:'Cancelled before sending',expired:'Expired before sending'};
const states=new Set(Object.keys(labels)),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function mountDeliveryOperations({document,fetch,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 const ids=['scope','refresh','clear','status','checked-at','empty','attempts','more','detail','detail-title','detail-content','close-detail','sign-in'];
 const ui=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
 if(Object.values(ui).some(value=>!value))throw Error('DELIVERY_OPERATIONS_DOM_REQUIRED');
 let epoch=0,flight=null,timer=null,cursor=null,rows=[],paused=false,closed=false,lastDetailButton=null;
 const format=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString(): 'Not recorded';
 const status=(text,focus=false)=>{ui.status.textContent=text;if(focus)ui.status.focus();};
 function clearPrivate(){rows=[];cursor=null;ui.attempts.replaceChildren();ui['detail-content'].replaceChildren();ui.detail.hidden=true;ui.more.hidden=true;ui.empty.hidden=true;ui['checked-at'].textContent='';}
 function cancel(){epoch++;flight?.abort();flight=null;clearTimer(timer);timer=null;}
 function lock(text,focus=false){cancel();clearPrivate();ui.refresh.disabled=false;ui.more.disabled=false;status(text,focus);}
 function schedule(){clearTimer(timer);timer=setTimer(()=>{if(!closed&&!paused&&document.visibilityState!=='hidden')void load(false);},30000);}
 const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
 function field(list,label,value){list.append(element('dt',label),element('dd',value??'Not recorded'));}
 function summary(row){
  if(!row||!uuid.test(row.mailId)||!states.has(row.state)||!['verification','delivery'].includes(row.kind))throw Error('invalid data');
  const block=element('li',undefined,'attempt-card'),title=element('h3',row.kind==='verification'?'Address verification':'Requested artwork delivery');
  const label=element('p',labels[row.state],'attempt-state');
  const note=element('p',row.bound?'Original attempt binding recorded.':'No original attempt binding. Signed evidence cannot automatically reconcile this record.');
  const detail=element('dl');field(detail,'Created',format(row.createdAt));field(detail,'Mail reference',row.mailId);field(detail,'Verified acceptance records',String(row.evidenceCount));
  if(row.deliveryStatus)field(detail,'Download status',row.deliveryStatus==='opened'?'Opened (legacy download record)':row.deliveryStatus);
  const button=element('button','Review attempt');button.type='button';button.ariaLabel=`Review ${row.kind==='verification'?'address verification':'artwork delivery'} attempt ${row.mailId}`;button.addEventListener('click',()=>{lastDetailButton=button;void showDetail(row.mailId);});
  block.append(title,label,note,detail,button);return block;
 }
 function draw(){ui.attempts.replaceChildren(...rows.map(summary));ui.empty.hidden=rows.length!==0;ui.more.hidden=!cursor;}
 async function request(input){
  const controller=flight;let deadline;
  try{return await Promise.race([(async()=>{
   const response=await fetch(BASE+'/data'+input,{credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:controller.signal});
   if(!response.ok){const error=Error('unavailable');error.status=response.status;throw error;}
   const body=await response.json();if(body?.ok!==true||typeof body.serverNow!=='string'||!Number.isFinite(Date.parse(body.serverNow))||Math.abs(Date.parse(body.serverNow)-now())>60000)throw Error('stale');return body;
  })(),new Promise((_,reject)=>{deadline=setTimer(()=>{controller.abort();reject(Error('timeout'));},6000);})]);}
  finally{clearTimer(deadline);}
 }
 function denied(error,turn){if(turn!==epoch||closed)return;lock(error.status===401||error.status===403?'Owner session unavailable. Sign in again, then refresh.':'Delivery review is unavailable. Private data has been cleared.');ui['sign-in'].hidden=![401,403].includes(error.status);}
 async function load(older=false){
  if(closed||document.visibilityState==='hidden')return;paused=false;cancel();const turn=epoch;flight=new AbortController();clearTimer(timer);ui['sign-in'].hidden=true;
  ui.refresh.disabled=true;ui.more.disabled=true;
  const scope=ui.scope.value;if(!['unresolved','recent'].includes(scope))return lock('Choose a review view.');
  const next=older?cursor:null;if(!older)clearPrivate();
  const params=new URLSearchParams({scope});if(next)params.set('cursor',btoa(JSON.stringify(next)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''));
  status(older?'Loading older attempts…':'Checking your owner session…');
  try{const body=await request('?'+params);if(turn!==epoch||closed)return;if(document.visibilityState==='hidden')return lock('Private view cleared while this page is hidden.');
   if(body.scope!==scope||!Array.isArray(body.items)||body.items.length>25||body.nextCursor!==null&&(!uuid.test(body.nextCursor?.id)||!Number.isFinite(Date.parse(body.nextCursor?.createdAt))))throw Error('invalid page');
   const incoming=body.items;for(const row of incoming)summary(row);
   // Keep the rendered page bounded even when repeatedly paging older records.
   rows=incoming;cursor=body.nextCursor;draw();ui['checked-at'].textContent='Checked '+format(body.serverNow)+'. This view refreshes every 30 seconds.';
   status(incoming.length?`${incoming.length} attempt${incoming.length===1?'':'s'} on this page.`:'No matching attempts on this page.',older);schedule();
  }catch(error){denied(error,turn);}finally{if(turn===epoch){flight=null;ui.refresh.disabled=false;ui.more.disabled=false;}}
 }
 async function showDetail(id){
  if(closed||paused||!uuid.test(id)||!rows.some(row=>row.mailId===id))return;
  if(document.visibilityState==='hidden')return lock('Private view cleared while this page is hidden.');
  cancel();const turn=epoch;flight=new AbortController();ui['detail-content'].replaceChildren();ui.detail.hidden=true;status('Checking attempt evidence…');
  try{const body=await request('?mail='+id);if(turn!==epoch||closed)return;if(document.visibilityState==='hidden')return lock('Private view cleared while this page is hidden.');const row=body.item;
   if(row?.mailId!==id||!Array.isArray(row.evidence)||row.evidence.length>25)throw Error('invalid detail');
   const list=element('dl');field(list,'Mail reference',row.mailId);field(list,'Attempt reference',row.claimId);field(list,'Mail state',labels[row.state]);field(list,'Provider reference',row.providerId);
   field(list,'Started',format(row.startedAt));field(list,'Binding recorded',format(row.boundAt));field(list,'Settled',format(row.settledAt));field(list,'Link or verification expires',format(row.expiresAt));
   field(list,'Download status',row.deliveryStatus==='opened'?'Opened (legacy download record)':row.deliveryStatus);
   const heading=element('h3','Verified provider acceptance'),events=element('ul');
   const count=element('p',row.evidenceCount>row.evidence.length?`Showing the latest ${row.evidence.length} of ${row.evidenceCount} acceptance records.`:`${row.evidence.length} verified acceptance record${row.evidence.length===1?'':'s'}.`);
   for(const evidence of row.evidence)events.append(element('li',`Provider ${evidence.providerId}; event ${format(evidence.occurredAt)}; received ${format(evidence.receivedAt)}.`));
   if(!row.evidence.length)events.append(element('li','No verified acceptance evidence is recorded. A provider response may still have settled the attempt.'));
   ui['detail-content'].replaceChildren(list,heading,count,events);ui.detail.hidden=false;ui['detail-title'].focus();status('Attempt details loaded. Reviewing does not change the outcome.');schedule();
  }catch(error){denied(error,turn);}finally{if(turn===epoch)flight=null;}
 }
 ui.refresh.addEventListener('click',()=>void load(false));ui.scope.addEventListener('change',()=>void load(false));ui.more.addEventListener('click',()=>void load(true));
 ui.clear.addEventListener('click',()=>{paused=true;lock('Private view cleared. Refresh review to continue.',true);});
 ui['close-detail'].addEventListener('click',()=>{ui.detail.hidden=true;ui['detail-content'].replaceChildren();if(lastDetailButton?.isConnected)lastDetailButton.focus();else ui.status.focus();});
 const onVisibility=()=>{if(document.visibilityState==='hidden')lock('Private view cleared while this page is hidden.');else if(!paused&&!closed)void load(false);};
 const onPageHide=()=>lock('Private view cleared. Refresh review to continue.');
  const onPageShow=event=>{if(event.persisted&&!closed&&!paused)void load(false);};
 document.addEventListener('visibilitychange',onVisibility);document.defaultView?.addEventListener('pagehide',onPageHide);document.defaultView?.addEventListener('pageshow',onPageShow);
 void load(false);
 return Object.freeze({refresh:()=>load(false),stop(){closed=true;lock('Delivery review closed.');document.removeEventListener('visibilitychange',onVisibility);document.defaultView?.removeEventListener('pagehide',onPageHide);document.defaultView?.removeEventListener('pageshow',onPageShow);}});
}
if(typeof document!=='undefined')mountDeliveryOperations({document,fetch:globalThis.fetch.bind(globalThis)});
