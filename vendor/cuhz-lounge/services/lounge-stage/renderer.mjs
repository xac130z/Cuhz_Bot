import {createStagePresenter} from './renderer-model.mjs';
import {createStageFeed} from './renderer-feed.mjs';
const stage=document.querySelector('#stage-scene'),slot=document.querySelector('#card-art');
const message=document.querySelector('#stage-message'),detail=document.querySelector('#stage-detail');
const phase=document.querySelector('#stage-phase'),member=document.querySelector('#stage-member'),steps=[...document.querySelectorAll('.stage-story li')];
const title=document.querySelector('#art-title'),creator=document.querySelector('#art-creator'),label=document.querySelector('#art-label');
const pause=document.querySelector('#motion-toggle'),media=matchMedia('(prefers-reduced-motion: reduce)');
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
 message.textContent=state.message;detail.textContent=state.detail;stage.setAttribute('aria-busy',String(['waiting','queued','creating','connecting'].includes(state.view)));
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
const feed=createStageFeed({createSource:()=>new EventSource('/stage/stream'),onSnapshot:snapshot=>presenter.accept(snapshot),onUnavailable:()=>presenter.connectionError()});
feed.start();
window.addEventListener('pagehide',()=>{feed.stop();presenter.stop();clearTimeout(revealTimer);media.removeEventListener('change',motion);},{once:true});
