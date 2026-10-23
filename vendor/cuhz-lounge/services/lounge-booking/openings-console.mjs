import {createOpeningsClient} from './openings-client.mjs';
export function mountOpeningsConsole(document,window){
 const find=id=>document.getElementById(id),resource=find('resource'),opening=find('opening'),confirm=find('confirm-action');
 let storage;try{storage=window.sessionStorage;}catch{/* client fails closed */}
 const format=value=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
 let lastData=null,lastNotice='';
 const option=(value,label)=>{const element=document.createElement('option');element.value=value;element.textContent=label;return element;};
 function render(state){
  find('status').textContent=state.notice;if(state.notice&&state.notice!==lastNotice){lastNotice=state.notice;find('status').focus();}
  find('read-status').textContent=state.data&&!state.fresh?'Opening status expired. Refresh before another change.':state.readNotice;
  find('refresh').disabled=state.busy||state.reading;find('recovery').hidden=!state.pending;
  find('pending-receipt').textContent=state.pending?`Unconfirmed ${state.pending.action} request ${state.pending.requestId}. Status refresh cannot confirm its receipt.`:'';
  find('recover').disabled=state.busy||state.blocked;
  const dataKey=state.data?JSON.stringify(state.data):null;
  if(dataKey!==lastData){lastData=dataKey;const selected=opening.value,selectedResource=resource.value;confirm.checked=false;
   opening.replaceChildren(option('','Select an opening'));resource.replaceChildren(option('','Select configured stage'));
   for(const r of state.data?.resources||[])resource.append(option(r.id,`Shared stage · policy ${r.policyVersion}`));
   for(const w of state.data?.openings||[])opening.append(option(w.id,`${format(w.startsAt)} → ${format(w.endsAt)} · ${w.state}`));
   if((state.data?.openings||[]).some(w=>w.id===selected))opening.value=selected;
   if((state.data?.resources||[]).some(r=>r.id===selectedResource))resource.value=selectedResource;
   else if(state.data?.resources.length===1)resource.value=state.data.resources[0].id;
  }
  const r=state.data?.resources.find(v=>v.id===resource.value),w=state.data?.openings.find(v=>v.id===opening.value);
  find('policy').textContent=r?`Policy ${r.policyVersion}: ${r.slotMinutes}-minute sessions, ${r.intervalMinutes}-minute spacing, ${r.holdMinutes}-minute holds, ${r.minNoticeMinutes}-minute notice, ${r.horizonDays}-day horizon, ${r.cancelCutoffHours}-hour cancellation cutoff, ${r.checkinGraceMinutes}-minute check-in grace.`:'';
  find('opening-detail').textContent=w?`${format(w.startsAt)} through ${format(w.endsAt)} (America/New_York). ${w.state}; ${w.available?'currently bookable':'not currently bookable'}. Policy ${w.policyVersion}, revision ${w.revision}. ${w.outstandingBookings} outstanding reservation(s). UTC: ${w.startsAt} → ${w.endsAt}.`:'';
  find('create').disabled=!state.canWrite||!state.data?.enabled||!r;
  find('publish').disabled=!state.canWrite||!state.data?.enabled||!confirm.checked||w?.state!=='draft';
  find('withdraw').disabled=!state.canWrite||!confirm.checked||!w||w.state==='withdrawn';
 }
 const client=createOpeningsClient({owner:document.querySelector('meta[name=lounge-owner]')?.content,csrf:document.querySelector('meta[name=csrf]')?.content,
  storage,fetcher:window.fetch.bind(window),onChange:render});
 find('commands').addEventListener('submit',event=>{event.preventDefault();const r=client.state().data?.resources.find(v=>v.id===resource.value);if(!r)return;
  void client.submit({action:'create',windowId:window.crypto.randomUUID(),expectedRevision:0,reason:'owner_schedule',resourceId:r.id,policyVersion:r.policyVersion,
   openingDate:find('opening-date').value,startTime:find('start-time').value,endTime:find('end-time').value});});
 for(const action of ['publish','withdraw'])find(action).addEventListener('click',()=>{const w=client.state().data?.openings.find(v=>v.id===opening.value);if(!w||!confirm.checked)return;
  void client.submit({action,windowId:w.id,expectedRevision:w.revision,reason:find('reason').value});});
 find('refresh').addEventListener('click',()=>void client.refresh());find('recover').addEventListener('click',()=>void client.recover());
 opening.addEventListener('change',()=>{confirm.checked=false;render(client.state());});resource.addEventListener('change',()=>render(client.state()));
 confirm.addEventListener('change',()=>render(client.state()));
 const timer=window.setInterval(()=>render(client.state()),1000);
 window.addEventListener('pagehide',()=>{window.clearInterval(timer);client.dispose();},{once:true});
 window.addEventListener('pageshow',event=>{if(event.persisted)window.location.reload();});
 render(client.state());void client.refresh();return client;
}
if(typeof document!=='undefined'&&typeof window!=='undefined'&&document.querySelector('meta[name=lounge-openings]'))mountOpeningsConsole(document,window);
