import {createHash} from 'node:crypto';
// No account information is present in this document. Private data is loaded
// only through the same-origin authenticated broker/API. URL secrets stay in
// this page's memory and never enter querystrings, storage, analytics or logs.
export function deliveryBrowser(){
 const get=id=>document.getElementById(id),status=get('status'),messages={DELIVERY_DISABLED:'Email delivery is currently paused.',AUTH_REQUIRED:'Sign in to the Lounge, then choose Refresh here.',
  SESSION_RECHECK_REQUIRED:'Your sign-in needs refreshing. Sign in to the Lounge, then return here.',AUTH_CSRF_DENIED:'Refresh your sign-in before trying again.',
  CONNECTION_CHANGED:'Your connected account changed. Sign in again.',VERIFICATION_INVALID:'This verification link is expired, used or belongs to another account.',
  DELIVERY_LINK_INVALID:'This delivery link is expired, revoked or belongs to another account.',DELIVERY_NOT_FOUND:'This delivery is not available to this account.',
  ADDRESS_VERIFICATION_REQUIRED:'Verify the selected email address before requesting delivery.',AGE_ATTESTATION_REQUIRED:'Delivery requires your 18+ confirmation.',
  RULES_REQUIRED:'Accept the current Lounge rules before requesting delivery.',DELIVERY_RATE_LIMIT:'Please wait before requesting another email.',
  DELIVERY_OUTCOME_UNKNOWN:'The result is not confirmed yet. Recover this same request before starting another.'};
 let csrf=null,view=null,pending=null,busy=false,proof=null,owner=null;
 const match=location.hash.match(/^#(verify|download)\/([a-f0-9-]{36})\/([A-Za-z0-9_-]{43})$/i);
 if(match)proof={kind:match[1].toLowerCase(),id:match[2].toLowerCase(),token:match[3]};
 if(location.hash)history.replaceState(null,'',location.pathname);
 const say=text=>{status.textContent=text;};
 async function fetchJson(url,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const response=await fetch(url,{...options,credentials:'same-origin',cache:'no-store',signal:controller.signal});
   const body=await response.json();if(!response.ok)throw Object.assign(Error(body.error||'DELIVERY_UNAVAILABLE'),{code:body.error,status:response.status});return body;
  }finally{clearTimeout(timer);}
 }
 function clearPrivate(){view=null;csrf=null;get('address').textContent='Not loaded';get('email').value='';get('items').replaceChildren();get('deliveries').replaceChildren();get('consent').checked=false;}
 function controls(){
  for(const id of ['age-button','verify-button','send-button'])get(id).disabled=busy||!!pending||!view?.enabled;
  get('send-button').disabled ||= !view?.address||!get('items').value||!get('consent').checked;
  get('verify-button').disabled ||= !get('verify-consent').checked||!view?.ageAttested;
  get('age-button').disabled ||= !get('age-consent').checked||view?.ageAttested;
  get('link-button').hidden=!proof;get('link-button').disabled=busy||!!pending||!csrf;
  get('link-button').textContent=proof?.kind==='verify'?'Confirm this email address':'Download this artwork';
  get('recover').hidden=!pending;get('recover').disabled=busy||!csrf;get('refresh').disabled=busy;
  for(const button of get('deliveries').querySelectorAll('button'))button.disabled=busy||!!pending;
 }
 async function refresh(announce=true){
  const previous=view?.addressRevision;
  try{const session=await fetchJson('/api/lounge/auth/session');if(!session.session||!session.csrfToken)throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED',status:401});if(owner&&owner!==session.session.user.id){clearPrivate();pending=null;proof=null;}owner=session.session.user.id;csrf=session.csrfToken;
   view=await fetchJson('/api/lounge/v2/deliveries');get('address').textContent=view.address||'No verified address';
   get('age-state').textContent=view.ageAttested?'18+ confirmation saved':'Delivery requires an 18+ confirmation.';
   if(previous!==view.addressRevision)get('consent').checked=false;
   const selected=get('items').value;get('items').replaceChildren();
   for(const item of view.items||[]){const option=document.createElement('option');option.value=item.id;option.textContent=item.title+' · '+new Date(item.createdAt).toLocaleDateString();get('items').appendChild(option);}
   if([...get('items').options].some(o=>o.value===selected))get('items').value=selected;
   get('deliveries').replaceChildren();
   for(const delivery of view.deliveries||[]){const row=document.createElement('li'),text=document.createElement('span');
    const label=['sending','unknown'].includes(delivery.mailState)?'Send result pending review':delivery.status==='sent'?'Accepted by email provider':delivery.status;
    text.textContent=label+' · '+new Date(delivery.createdAt).toLocaleString();row.appendChild(text);
    if(!['revoked','expired'].includes(delivery.status)){const button=document.createElement('button');button.type='button';button.textContent='Revoke link';button.addEventListener('click',()=>submit({action:'revoke',requestId:crypto.randomUUID(),id:delivery.id}));row.appendChild(button);}
    get('deliveries').appendChild(row);
   }
   if(announce)say(pending?messages.DELIVERY_OUTCOME_UNKNOWN:view.enabled?'Your private delivery settings are ready.':'Email delivery is paused. You can still revoke existing links.');
  }catch(error){clearPrivate();say(messages[error.code]||'Delivery is unavailable. Please try Refresh.');}
  controls();
 }
 async function submit(input){
  if(busy||(!csrf))return;const focused=document.activeElement;busy=true;pending=input.action==='download'?null:input;controls();
  try{const result=await fetchJson('/api/lounge/v2/deliveries',{method:'POST',headers:{'Content-Type':'application/json','X-Lounge-CSRF':csrf},body:JSON.stringify(input)});pending=null;
   if(input.action==='download'){
    // Server strictly validates the private storage URL and lifetime. Navigation
    // still permits HTTPS only; a malformed response never executes a URL.
    const target=new URL(result.url);if(target.protocol!=='https:'||!target.pathname.startsWith('/storage/v1/object/sign/')||target.username||target.password)throw Error('invalid download');
    const anchor=document.createElement('a');anchor.href=target.href;anchor.rel='noreferrer noopener';anchor.download='';anchor.click();say('Your download is ready. The storage link expires within ten minutes.');
   }else{
    if(input.action==='confirm_address')proof=null;
    if(input.action==='request')get('consent').checked=false;
    if(input.action==='verify_address')get('verify-consent').checked=false;
    await refresh(false);say(input.action==='verify_address'?'Verification email queued. Open it while signed in to this account.':input.action==='request'?'Your requested delivery is queued.':input.action==='revoke'?'Delivery link revoked. Previously issued storage links may last up to ten minutes.':'Your confirmation is saved.');
   }
  }catch(error){if(error.status&&error.status<500)pending=null;if(error.status===401||error.status===403)clearPrivate();say(messages[error.code]||(pending?messages.DELIVERY_OUTCOME_UNKNOWN:'The download is unavailable. Refresh and try again.'));}
  finally{busy=false;controls();if(document.activeElement===document.body&&focused&&focused!==document.body)status.focus();}
 }
 get('refresh').addEventListener('click',()=>refresh());get('recover').addEventListener('click',()=>pending&&submit(pending));
 get('age-button').addEventListener('click',()=>get('age-consent').checked&&submit({action:'attest_age',requestId:crypto.randomUUID(),ageAttested:true}));
 get('verify-form').addEventListener('submit',event=>{event.preventDefault();if(get('verify-consent').checked)submit({action:'verify_address',requestId:crypto.randomUUID(),email:get('email').value.trim(),consent:true});});
 get('send-button').addEventListener('click',()=>get('consent').checked&&view?.address&&submit({action:'request',requestId:crypto.randomUUID(),itemId:get('items').value,addressRevision:view.addressRevision,consent:true}));
 get('link-button').addEventListener('click',()=>proof&&submit(proof.kind==='verify'?{action:'confirm_address',requestId:crypto.randomUUID(),id:proof.id,token:proof.token}:{action:'download',id:proof.id,token:proof.token}));
 for(const id of ['age-consent','verify-consent','consent'])get(id).addEventListener('change',controls);
 get('items').addEventListener('change',()=>{get('consent').checked=false;controls();});get('email').addEventListener('input',()=>{get('verify-consent').checked=false;controls();});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!busy)void refresh();});
 controls();void refresh();
}
const script=`(${deliveryBrowser.toString()})();`;
const css=`:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#07080c;color:#f2f4fa}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at top right,#173d40 0,transparent 55%)}main{max-width:780px;margin:auto;padding:32px 20px 70px}h1{font-size:clamp(28px,5vw,42px);margin:8px 0 12px}h2{font-size:20px}.eyebrow{color:#34d399;letter-spacing:.14em}p{line-height:1.6}a{color:#22d3ee}section{padding:24px;background:#141826;border:1px solid #5a607a;border-radius:16px;margin-top:20px}label{display:block;margin:14px 0;line-height:1.6}input[type=email],select{display:block;width:100%;padding:12px;background:#0d0f16;border:1px solid #8b92ab;border-radius:6px;color:inherit;font:inherit}button{min-height:44px;padding:10px 18px;margin:8px 8px 0 0;border:1px solid #34d399;border-radius:8px;background:#34d399;color:#07080c;font:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}input[type=checkbox]{width:20px;height:20px;vertical-align:middle;margin-right:10px}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #22d3ee;outline-offset:3px}#status{padding:16px;border-left:3px solid #a78bfa;background:#0d0f16}li{padding:12px 0;border-bottom:1px solid #5a607a;overflow-wrap:anywhere}ul{list-style:none;padding:0}.muted{color:#b8bfd4}[hidden]{display:none!important}`;
const hash=value=>createHash('sha256').update(value).digest('base64');
export function deliveryPage(){return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private delivery · CUHZ Lounge</title><style>${css}</style></head><body><main><a href="/lounge">← CUHZ Lounge</a><p class="eyebrow">PLANET CUHZ · YOUR LIBRARY</p><h1>Your art, delivered privately.</h1><p>Choose a verified address and the artwork you want. Every delivery needs your consent. Nothing is published to the stream.</p><p id="status" tabindex="-1" role="status" aria-live="polite">Loading your delivery settings…</p><p><a href="/lounge" target="_blank" rel="noopener">Sign in to the Lounge in another tab</a>, then refresh here.</p><button id="refresh" type="button">Refresh</button><button id="recover" type="button" hidden>Recover previous request</button><button id="link-button" type="button" hidden>Open email link</button><section><h2>Delivery eligibility</h2><p id="age-state"></p><label><input id="age-consent" type="checkbox">I confirm that I am 18 or older.</label><button id="age-button" type="button" disabled>Save 18+ confirmation</button></section><section><h2>Verify your email</h2><p>Current verified address: <strong id="address">Not loaded</strong></p><form id="verify-form"><label for="email">Email address<input id="email" type="email" maxlength="254" autocomplete="email" required></label><label><input id="verify-consent" type="checkbox">Send a verification email to this address. This does not sign me up for marketing.</label><button id="verify-button" type="submit" disabled>Send verification</button></form></section><section><h2>Send one saved artwork</h2><label for="items">Saved artwork<select id="items"></select></label><label><input id="consent" type="checkbox">Email this artwork's private delivery link to my current verified address.</label><button id="send-button" type="button" disabled>Request delivery</button><p class="muted">Delivery links last 24 hours and require your Lounge sign-in. You can revoke them below.</p></section><section><h2>Recent deliveries</h2><ul id="deliveries"></ul></section></main><script>${script}</script></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
 'Content-Security-Policy':`default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(css)}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`}});}
