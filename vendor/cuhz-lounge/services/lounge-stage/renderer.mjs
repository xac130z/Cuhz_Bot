import {createStagePresenter} from './renderer-model.mjs';
import {createStageFeed,stageStreamPath} from './renderer-feed.mjs';
const stage=document.querySelector('#stage-scene'),slot=document.querySelector('#card-art');
const message=document.querySelector('#stage-message'),detail=document.querySelector('#stage-detail');
const phase=document.querySelector('#stage-phase'),member=document.querySelector('#stage-member'),steps=[...document.querySelectorAll('.stage-story li')];
const title=document.querySelector('#art-title'),creator=document.querySelector('#art-creator'),label=document.querySelector('#art-label');
const pause=document.querySelector('#motion-toggle'),media=matchMedia('(prefers-reduced-motion: reduce)');
// The public browser view scales the scene, leaving readable status and touch
// controls outside the scale. OBS sources retain their native1920×1080 canvas.
const viewerFrame=document.querySelector('.stage-viewer-frame'),viewerSummary=document.querySelector('#viewer-summary');
let viewerResize=null;
if(viewerFrame){
 const fit=()=>stage.style.transform=`scale(${viewerFrame.clientWidth/1920})`;
 fit();viewerResize=new ResizeObserver(fit);viewerResize.observe(viewerFrame);
 stage.setAttribute('aria-hidden','true');
}
// The environment is public brand art. It never reflects a private request or controls authority.
const world=document.createElement('div');world.className='stage-world';world.setAttribute('aria-hidden','true');
const horizon=document.createElement('div');horizon.className='stage-horizon';horizon.setAttribute('aria-hidden','true');
const portal=document.createElement('div');portal.className='stage-portal';portal.setAttribute('aria-hidden','true');
stage.prepend(world,horizon,portal);
const wordmark=stage.querySelector('.stage-wordmark');
if(wordmark?.firstChild?.nodeType===Node.TEXT_NODE){const brand=document.createElement('span');brand.className='stage-brand';brand.textContent=wordmark.firstChild.textContent;wordmark.firstChild.replaceWith(brand);}
const host=document.createElement('div');host.className='stage-host';host.setAttribute('aria-hidden','true');
const portrait=document.createElement('img');portrait.src='/api/lounge/v2/stage/host.webp';portrait.alt='';portrait.width=96;portrait.height=96;portrait.decoding='async';
const hostName=document.createElement('span');hostName.textContent='CUHZ BOT';
const hostRole=document.createElement('small');hostRole.textContent='YOUR HOST';hostName.append(hostRole);host.append(portrait,hostName);stage.append(host);
const publicCopy={
 idle:['Welcome home, cuhz.','A world to create. A place for the family.'],
 queued:['An idea is in orbit.','The request is queued and waiting for its turn.'],
 creating:['Imagination at work.','CUHZ Bot is creating. Settle in with the family.'],
 review:['One final check.','The creation stays private while it is reviewed.'],
 waiting:['The moment is coming.','Loading the approved creation.'],
 ready:['Made here. Shared here.','A creation from the CUHZ community.'],
 hold:['A moment of calm.','The stage is paused. We will be right here.'],
 error:['Finding our connection.','The world stays here. Artwork returns after a verified update.'],
 connecting:['Welcome to Planet CUHZ.','Connecting to the community stage.'],
 unavailable:['A little breathing room.','This creation needs attention. The stage is waiting.'],
};
let paused=false,revealTimer=null,currentResource=null;
try{paused=localStorage.getItem('cuhz-stage-motion-paused')==='true';}catch{/* motion preference remains local */}
let seen=[];try{seen=JSON.parse(sessionStorage.getItem('cuhz-stage-revealed-assets')||'[]');if(!Array.isArray(seen))seen=[];}catch{/* optional preference storage */}
function motion(){const off=paused||media.matches;stage.dataset.motion=off?'off':'on';pause.textContent=media.matches?'Reduced motion on':paused?'Resume motion':'Pause motion';pause.setAttribute('aria-pressed',String(off));pause.disabled=media.matches;
 if(off){clearTimeout(revealTimer);stage.dataset.reveal='still';}}
pause.addEventListener('click',()=>{paused=!paused;try{localStorage.setItem('cuhz-stage-motion-paused',String(paused));}catch{/* optional preference storage */}motion();});
media.addEventListener('change',motion);motion();
document.addEventListener('keydown',event=>{if(event.key.toLowerCase()==='p'&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!['INPUT','TEXTAREA','SELECT'].includes(event.target?.tagName)&&!pause.disabled){event.preventDefault();pause.click();}});
function loadAsset(hash,{signal}){return new Promise((resolve,reject)=>{
 const image=new Image();image.decoding='async';image.alt='';let settled=false;
 const finish=(error)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);image.onload=null;image.onerror=null;if(error){image.removeAttribute('src');reject(error);}else resolve(image);};
 const abort=()=>finish(Error('CANCELLED'));
 if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});
 image.onload=()=>{if(typeof image.decode==='function')image.decode().then(()=>finish(),()=>finish(Error('DECODE_FAILED')));else finish();};
 image.onerror=()=>finish(Error('IMAGE_UNAVAILABLE'));image.src='/stage/assets/'+hash;
});}
const presenter=createStagePresenter({loadAsset,seenAssets:seen,onChange(state,resource){
 const sameReady=state.view==='ready'&&currentResource===resource;
 if(!sameReady){clearTimeout(revealTimer);stage.dataset.reveal='still';}stage.dataset.view=state.view;
 const copy=publicCopy[state.view];
 if(viewerSummary)viewerSummary.textContent=state.view==='ready'?`${state.artwork.title} · Created by ${state.artwork.creator} · ${state.artwork.label}`:`${copy?.[0]||state.message} ${copy?.[1]||state.detail}${state.displayName?(state.phase==='reveal'?' Created by ':' Creating for ')+state.displayName:''}`;
 message.textContent=copy?.[0]||state.message;detail.textContent=copy?.[1]||state.detail;stage.setAttribute('aria-busy',String(['waiting','queued','creating','connecting'].includes(state.view)));
 phase.textContent=({queued:'IN THE QUEUE',creating:'CREATING NOW',review:'REVIEW BEFORE REVEAL',unavailable:'CREATION PAUSED',reveal:'APPROVED ARTWORK'})[state.phase]||'CUHZ LOUNGE';
 member.hidden=!state.displayName;member.textContent=state.displayName?`${state.phase==='reveal'?'Created by':'Creating for'} ${state.displayName}`:'';
 for(const step of steps){step.dataset.active=String(step.dataset.phase===state.phase);step.setAttribute('aria-current',step.dataset.phase===state.phase?'step':'false');}
 if(state.view!=='ready'){slot.replaceChildren();currentResource=null;title.textContent='';creator.textContent='';label.textContent='';return;}
 if(currentResource!==resource){slot.replaceChildren(resource);currentResource=resource;}
 resource.alt=state.artwork.title;title.textContent=state.artwork.title;creator.textContent='Created by '+state.artwork.creator;label.textContent=state.artwork.label;
 if(state.reveal&&!paused&&!media.matches){stage.dataset.reveal='opening';revealTimer=setTimeout(()=>{stage.dataset.reveal='still';},1200);}
 try{sessionStorage.setItem('cuhz-stage-revealed-assets',JSON.stringify(presenter.seen()));}catch{/* replay suppression still works for this page */}
}});
presenter.start();
const feed=createStageFeed({createSource:()=>new EventSource(stageStreamPath(window.location)),onSnapshot:snapshot=>presenter.accept(snapshot),onUnavailable:()=>presenter.connectionError()});
feed.start();
window.addEventListener('pagehide',()=>{viewerResize?.disconnect();feed.stop();presenter.stop();clearTimeout(revealTimer);media.removeEventListener('change',motion);},{once:true});
