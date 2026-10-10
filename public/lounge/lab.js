/* ─── CUHZ Infinity Lab v2 ─── */

// ── Config & constants ─────────────────────────────────────────
const palettes=[
  ['Pure white','#ffffff'],['Off-white','#faf7ef'],['Transparent',null],
  ['Light gray','#e5e7eb'],['Charcoal','#303541'],['Black','#000000'],
  ['Sky blue','#dcefff'],['Lavender','#ece5ff'],['Mint','#dff5e9'],['Peach','#ffe6d5']
];

// The manifest distinguishes five approved artworks from fifteen visual treatments.
const ART_MANIFEST=window.CUHZ_ART_MANIFEST;
if(!ART_MANIFEST || ART_MANIFEST.version!==1) throw new Error('CUHZ art manifest missing');
const treatments=ART_MANIFEST.treatments;
const names=treatments.map(t=>t.name);
const artworkById=new Map(ART_MANIFEST.artworks.map(a=>[a.id,a]));
const imageIndexById=new Map(ART_MANIFEST.artworks.map((a,i)=>[a.id,i]));

const accents=['#087e70','#805400','#a72b77','#267239','#166ba0'];

// Preset physics definitions ──────────────────────────────────
const PRESETS={
  chill:{
    speed:0.25,          // slow hypnotic drift
    depth:5,
    zoom:1.0,
    tiltAmplitude:4,     // gentle layer sway (deg)
    tiltPeriod:9000,     // ms per full tilt oscillation
    pulseScale:0,        // no scale pulse
    glowStrength:0.012,
    label:'Chill 🌙'
  },
  hype:{
    speed:0.65,          // punchy
    depth:6,
    zoom:1.08,
    tiltAmplitude:10,
    tiltPeriod:3200,
    pulseScale:0.06,     // subtle scale bounce each layer
    glowStrength:0.025,
    label:'Hype ⚡'
  },
  turbo:{
    speed:1.0,           // maximum
    depth:7,
    zoom:1.15,
    tiltAmplitude:18,
    tiltPeriod:1400,
    pulseScale:0.12,
    glowStrength:0.04,
    label:'Turbo 🚀'
  }
};

// ── URL params ────────────────────────────────────────────────
const params=new URLSearchParams(location.search);
const STREAM_MODE = params.get('mode')==='stream';
const INIT_PRESET = params.get('preset')||null;   // 'chill'|'hype'|'turbo'
const INIT_BG     = params.get('bg')==='transparent' ? 2 : null; // palette index 2 = transparent

// Look overrides from the URL, so an OBS browser source fully specifies its own
// look and the rollback is always "edit the URL". Bounds are the lab's own slider
// ranges (see `controls` below) — a URL cannot reach a value the sliders can't.
// Vocabulary matches the chat-control grammar on purpose: thickness/depth/zoom/
// speed/tilt/rotation mean the same thing here as they do in !lounge.
const NUM_PARAMS={zoom:[0.6,1.5],depth:[1,8],thickness:[0,10],speed:[0.05,1],
                  tiltAmplitude:[0,25],rotation:[-20,20],position:[-0.2,0.2]};
const PARAM_ALIASES={tilt:'tiltAmplitude'};
function numParam(name){
  const key=PARAM_ALIASES[name]||name, span=NUM_PARAMS[key];
  if(!span) return null;
  const raw=params.get(name);
  if(raw===null) return null;
  const v=Number(raw);
  if(!Number.isFinite(v)) return null;
  return {key, value:Math.min(span[1],Math.max(span[0],v))};
}
const URL_LOOK=['zoom','depth','thickness','speed','tilt','rotation','position']
  .map(numParam).filter(Boolean);
const URL_GLOW = params.get('glow')==='on' ? true : params.get('glow')==='off' ? false : null;

const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
let reduced=motionPreference.matches;

// ── State ─────────────────────────────────────────────────────
const defaults={
  background: INIT_BG!==null ? INIT_BG : (STREAM_MODE ? 2 : 5), // default transparent in stream mode
  zoom:1, position:0, rotation:0, depth:5,
  speed:0.5, thickness: STREAM_MODE ? 0 : 2.5, glow:false, shadow:false, paused:reduced,
  // tilt physics (per-card independent)
  tiltAmplitude:6, tiltPeriod:6000, pulseScale:0,
  preset:null
};
const states=names.map((_,i)=>({
  ...defaults,
  background: STREAM_MODE ? (INIT_BG!==null ? INIT_BG : 2) : defaults.background, // transparent OBS default
  rotation:i<5?0:(i%3-1)*5,
  depth:4+Math.floor(i/5)
}));

const requestedCard=Number(params.get('card'));
let selected=Number.isInteger(requestedCard)&&requestedCard>=1&&requestedCard<=names.length?requestedCard-1:0;
let last=performance.now(), applyAll=true;
let activePreset=INIT_PRESET||null;

// Apply URL preset on init
if(activePreset && PRESETS[activePreset]){
  const p=PRESETS[activePreset];
  states.forEach(s=>{
    s.speed=p.speed; s.depth=p.depth; s.zoom=p.zoom;
    s.tiltAmplitude=p.tiltAmplitude; s.tiltPeriod=p.tiltPeriod;
    s.pulseScale=p.pulseScale; s.preset=activePreset;
    s.glow=true;
  });
}

// URL look overrides land AFTER the preset, so an explicit ?thickness=0 beats
// whatever the preset chose — same precedence rule as the chat controls.
if(URL_LOOK.length||URL_GLOW!==null){
  states.forEach(s=>{
    for(const {key,value} of URL_LOOK) s[key]=value;
    if(URL_GLOW!==null) s.glow=URL_GLOW;
  });
}

let renderRevision=0;
const painted=new WeakMap();

// ── Image loading ─────────────────────────────────────────────
// Stream mode defaults to true-alpha cutouts (alpha/1-5.png) so it renders cleanly
// as an overlay without a white box. Can be explicitly forced with ?art=white or ?art=alpha.
const ALPHA_ART = params.get('art') === 'white' ? false : (STREAM_MODE || params.get('art') === 'alpha');
const images=ART_MANIFEST.artworks.map(artwork=>{
  const im=new Image();
  im.onload=()=>{renderRevision++;};
  im.onerror=()=>{im.dataset.failed='true';renderRevision++;};
  im.src=ALPHA_ART?artwork.alpha:artwork.white;
  return im;
});
const artHint=document.querySelector('#artHint');
const intro=document.querySelector('#intro');
if(intro) intro.textContent=`${ART_MANIFEST.artworkCount} approved artworks, ${names.length} treatments. Presets: Chill 🌙 · Hype ⚡ · Turbo 🚀 · custom. Keys: 1/2/3 presets · ← → cards.`;
const scopeCount=document.querySelector('#scopeCount');
if(scopeCount) scopeCount.textContent=names.length;
if(artHint) artHint.textContent=ALPHA_ART
  ? `${ART_MANIFEST.artworkCount} approved alpha artworks · ${names.length} visual treatments. Transparent backdrop preserves the artwork cutout.`
  : `${ART_MANIFEST.artworkCount} approved artworks · ${names.length} visual treatments. These gallery rasters have white baked in. Open the alpha gallery for clean transparent exports.`;
if(motionPreference.addEventListener) motionPreference.addEventListener('change',e=>{
  reduced=e.matches;
  if(reduced) { states.forEach(s=>{s.paused=true;s.clock=0;}); sync(); }
});

// ── Stream Mode: minimal DOM ───────────────────────────────────
if(STREAM_MODE){
  // Both elements: the background is declared on `html, body`, so clearing only
  // body leaves <html> painting a rectangle behind the overlay.
  document.documentElement.classList.add('stream-mode');
  document.body.classList.add('stream-mode');
  const hide=['header','.toolbar','small'];
  hide.forEach(sel=>{const el=document.querySelector(sel);if(el)el.style.display='none';});
  // Make grid full-viewport in stream mode with one spotlight canvas
  document.querySelector('main').style.padding='0';
}

// ── DOM refs (lab mode only needs these) ─────────────────────
const grid   = document.querySelector('#grid');
grid.setAttribute('aria-label',`${names.length} visual treatments`);
const statusEl= document.querySelector('#status');

// ── Build grid cards ─────────────────────────────────────────
const cards=names.map((name,i)=>{
  const button=document.createElement('button');
  button.className='card';
  button.setAttribute('aria-label',`Select ${i+1}: ${name}`);
  const c=document.createElement('canvas');
  c.width=c.height=360;
  c.setAttribute('aria-hidden','true');
  const label=document.createElement('span');
  label.textContent=`${String(i+1).padStart(2,'0')} / ${name}`;
  button.title=`Artwork ${treatments[i].artworkId} · treatment ${i+1}`;
  button.append(c,label);
  button.onclick=()=>{selected=i;sync();};
  grid.append(button);
  return {button,c};
});

// ── Preset bar (lab mode only) ────────────────────────────────
if(!STREAM_MODE){
  const presetBar=document.createElement('div');
  presetBar.className='preset-bar';
  presetBar.innerHTML='<h2>Motion Preset</h2>';
  Object.entries(PRESETS).forEach(([key,p])=>{
    const b=document.createElement('button');
    b.textContent=p.label;
    b.id='preset-'+key;
    b.onclick=()=>applyPreset(key);
    presetBar.append(b);
  });
  const clearBtn=document.createElement('button');
  clearBtn.textContent='Custom ✏️';
  clearBtn.id='preset-custom';
  clearBtn.onclick=()=>clearPreset();
  presetBar.append(clearBtn);
  const toolbar=document.querySelector('.toolbar');
  if(toolbar) toolbar.prepend(presetBar);
}

// ── Backdrop buttons (lab) ────────────────────────────────────
const backgroundEl=document.querySelector('#background');
if(backgroundEl){
  palettes.forEach(([name],i)=>{
    const b=document.createElement('button');
    b.textContent=name;
    b.onclick=()=>update('background',i);
    backgroundEl.append(b);
  });
}

// ── Sliders (lab) ─────────────────────────────────────────────
const controls=[
  ['zoom','Zoom',0.6,1.5,0.05],
  ['position','Vertical position',-0.2,0.2,0.01],
  ['rotation','Rotation',-20,20,1],
  ['depth','Recursion depth',1,8,1],
  ['speed','Motion speed',0.05,1,0.05],
  ['thickness','Frame thickness',0,10,0.5],
  ['tiltAmplitude','Layer tilt (°)',0,25,1],
];
const adjustmentsEl=document.querySelector('#adjustments');
if(adjustmentsEl){
  controls.forEach(([key,label,min,max,step])=>{
    const wrap=document.createElement('label');
    wrap.textContent=label;
    const input=document.createElement('input');
    input.type='range'; input.id=key;
    Object.assign(input,{min,max,step});
    input.oninput=()=>update(key,Number(input.value));
    const out=document.createElement('output');
    out.id=key+'Value';
    wrap.append(input,out);
    adjustmentsEl.append(wrap);
  });
  for(const [key,label] of [['glow','Soft glow'],['shadow','Drop shadow'],['paused','Pause animation']]){
    const b=document.createElement('button');
    b.id=key; b.textContent=label;
    b.onclick=()=>update(key,!states[selected][key]);
    adjustmentsEl.append(b);
  }
}

// ── Action buttons (lab) ──────────────────────────────────────
const resetBtn=document.querySelector('#reset');
const allCheck=document.querySelector('#all');
const spotBtn=document.querySelector('#spotlight');
const closeBtn=document.querySelector('#close');
const exportBtn=document.querySelector('#export');

if(resetBtn) resetBtn.onclick=()=>{
  (applyAll?states:[states[selected]]).forEach(s=>Object.assign(s,{...defaults,background:s.background,paused:reduced,clock:0}));
  activePreset=null; sync();
};
if(allCheck) allCheck.onchange=e=>{applyAll=e.target.checked;sync();};
if(spotBtn) spotBtn.onclick=()=>{
  document.querySelector('#stage').hidden=false;
  document.querySelector('main').inert=true;
  document.querySelector('#close').focus();
};
if(closeBtn) closeBtn.onclick=closeStage;
if(exportBtn) exportBtn.onclick=()=>{
  const c=document.createElement('canvas');
  c.width=c.height=1024; draw(c,selected);
  c.toBlob(blob=>{
    if(!blob)return;
    const a=document.createElement('a');
    const url=URL.createObjectURL(blob);
    a.href=url;
    a.download=`CUHZ-${String(selected+1).padStart(2,'0')}-${names[selected].replaceAll(' ','-')}.png`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
};

document.addEventListener('keydown',e=>{
  if(e.key==='Escape') { closeStage(); return; }
  // On the stream overlay (or any live-controlled view) the keyboard must be
  // dead: a stray keypress through OBS "Interact" would silently change the
  // broadcast look until the next real state change.
  if(STREAM_MODE || params.get('control')==='live') return;
  // Let form controls keep their native arrow-key and number-key behavior.
  if(e.target.matches('input, select, textarea') || e.target.isContentEditable) return;
  if(e.altKey || e.ctrlKey || e.metaKey) return;
  if(['1','2','3','ArrowRight','ArrowLeft'].includes(e.key)) e.preventDefault();
  // keyboard preset shortcuts in any mode
  if(e.key==='1') applyPreset('chill');
  if(e.key==='2') applyPreset('hype');
  if(e.key==='3') applyPreset('turbo');
  // cycle cards with left/right arrows
  if(e.key==='ArrowRight'){selected=(selected+1)%names.length;sync();}
  if(e.key==='ArrowLeft'){selected=(selected+names.length-1)%names.length;sync();}
});

function closeStage(){
  const stage=document.querySelector('#stage');
  if(!stage || stage.hidden) return;
  stage.hidden=true;
  document.querySelector('main').inert=false;
  if(spotBtn) spotBtn.focus();
}

// ── Preset logic ──────────────────────────────────────────────
function applyPreset(key){
  const p=PRESETS[key];
  if(!p) return;
  activePreset=key;
  (applyAll?states:[states[selected]]).forEach(s=>{
    s.speed=p.speed; s.depth=p.depth; s.zoom=p.zoom;
    s.tiltAmplitude=p.tiltAmplitude; s.tiltPeriod=p.tiltPeriod;
    s.pulseScale=p.pulseScale; s.preset=key; s.glow=true;
  });
  sync();
}
function clearPreset(){
  activePreset=null;
  (applyAll?states:[states[selected]]).forEach(s=>{
    s.tiltAmplitude=6; s.tiltPeriod=6000; s.pulseScale=0; s.preset=null; s.glow=false;
  });
  sync();
}

// ── Update helper ─────────────────────────────────────────────
function update(key,value){
  (applyAll?states:[states[selected]]).forEach(s=>s[key]=value);
  sync();
}

// ── Sync UI ───────────────────────────────────────────────────
function sync(){
  renderRevision++;
  const s=states[selected];
  cards.forEach(({button},i)=>button.setAttribute('aria-pressed',String(i===selected)));
  if(backgroundEl) [...backgroundEl.children].forEach((b,i)=>b.setAttribute('aria-pressed',String(s.background===i)));
  if(adjustmentsEl){
    controls.forEach(([key])=>{
      const el=document.getElementById(key);
      const val=document.getElementById(key+'Value');
      if(el) el.value=s[key];
      if(val) val.textContent=s[key];
    });
    ['glow','shadow','paused'].forEach(k=>{
      const el=document.getElementById(k);
      if(el) el.setAttribute('aria-pressed',String(s[k]));
    });
  }
  // Highlight active preset button
  Object.keys(PRESETS).forEach(key=>{
    const btn=document.getElementById('preset-'+key);
    if(btn) btn.setAttribute('aria-pressed',String(s.preset===key));
  });
  const customBtn=document.getElementById('preset-custom');
  if(customBtn) customBtn.setAttribute('aria-pressed',String(!s.preset));
  if(statusEl) statusEl.textContent=`${names[selected]} · ${applyAll?`All ${names.length}`:'Selected'} · ${palettes[s.background][0]} · ${s.preset?PRESETS[s.preset].label:'Custom'}`;
  const stageTitle=document.querySelector('#stageTitle');
  if(stageTitle) stageTitle.textContent=names[selected];
}

// Live changes cross-fade over 600ms, independently of the bot's dwell timer.
const transitions=new Map();
function withLiveUpdate(change){
  if(!reduced){
    const visible=STREAM_MODE?[streamCanvas]:document.querySelector('#stage').hidden
      ?cards.map(({c})=>c):[document.querySelector('#stageCanvas')];
    for(const canvas of visible){
      if(!canvas) continue;
      const snapshot=document.createElement('canvas');
      snapshot.width=canvas.width; snapshot.height=canvas.height;
      snapshot.getContext('2d').drawImage(canvas,0,0);
      transitions.set(canvas,{snapshot,start:performance.now()});
    }
  } else transitions.clear();
  const previousScope=applyAll;
  applyAll=true; // A bot state always applies to the full Lounge, not a local editor scope.
  try { change(); if(reduced) states.forEach(s=>s.clock=0); }
  finally { applyAll=previousScope; sync(); }
}
function blendTransition(canvas){
  const transition=transitions.get(canvas);
  if(!transition) return;
  const progress=Math.min(1,Math.max(0,(performance.now()-transition.start)/600));
  if(progress>=1 || reduced){transitions.delete(canvas);return;}
  const x=canvas.getContext('2d');
  x.save();
  x.globalCompositeOperation='destination-in';
  x.globalAlpha=progress; x.fillStyle='#fff'; x.fillRect(0,0,canvas.width,canvas.height);
  x.globalCompositeOperation='lighter'; x.globalAlpha=1-progress;
  x.drawImage(transition.snapshot,0,0);
  x.restore();
}

// ── Draw ──────────────────────────────────────────────────────
function draw(canvas,i){
  const x=canvas.getContext('2d');
  const W=canvas.width;
  const s=states[i];
  const artIndex=imageIndexById.get(treatments[i].artworkId);
  const im=images[artIndex];

  x.clearRect(0,0,W,W);

  // Background
  const color=palettes[s.background][1];
  if(color){x.fillStyle=color;x.fillRect(0,0,W,W);}

  // Loading placeholder
  if(!im.complete||!im.naturalWidth){
    x.fillStyle='#26364a';
    x.font=`${W/22}px Arial`;
    x.textAlign='center';
    x.fillText(im.dataset.failed?'Artwork unavailable':'Loading…',W/2,W/2);
    blendTransition(canvas);
    return;
  }

  const clock=s.clock||0;
  const loopDuration = 6000;
  const phase=(clock/loopDuration)%1;  // 0→1 mathematically seamless Droste loop
  const stepRatio = 0.48; // Geometric scaling ratio between consecutive shells

  // Per-layer independent tilt physics:
  // Each layer k oscillates at a slightly different phase of tiltPeriod,
  // so inner layers feel independently alive. All approach 0° (upright smile)
  // at t=0,π,2π... (full cycle completion) creating the upright-smile resolution.
  const tP=s.tiltPeriod||6000;
  const tA=s.tiltAmplitude??6;
  const pulse=s.pulseScale||0;

  for(let k=0;k<s.depth;k++){
    // True Droste scaling: at phase=1, layer k reaches the EXACT size of layer k-1 at phase=0.
    const rawSize=W*0.83*s.zoom*Math.pow(stepRatio, k - phase);
    // Per-layer scale pulse (hype/turbo gives visible life to each shell)
    const pulseMod=1+pulse*Math.sin(clock/300+k*0.9);
    const size=rawSize*pulseMod;
    if(size<2) continue;

    // Boundary opacity fading: outermost layer fades out as it expands past view,
    // deepest layer fades in smoothly from the vortex center.
    let layerAlpha = 1.0;
    if (k === 0) {
      layerAlpha = Math.max(0, Math.min(1, 1 - Math.pow(phase, 1.8)));
    } else if (k === s.depth - 1) {
      layerAlpha = Math.max(0, Math.min(1, phase));
    }

    // Tilt: outer layers tilt more, inner layers converge to 0 (upright smile)
    // layerPhaseOffset staggers each layer so they don't all peak together
    const layerPhaseOffset=k*(Math.PI*0.42);
    const layerDepthFade=1-k/(s.depth+1);  // outer=1, deepest≈0 → upright at center
    const tiltRad=(tA*layerDepthFade*Math.sin(clock*2*Math.PI/tP+layerPhaseOffset))*Math.PI/180;
    // Also add the user-set static rotation
    const totalRot=s.rotation*Math.PI/180+tiltRad;

    x.save();
    x.globalAlpha = layerAlpha;
    x.translate(W/2, W*(0.5+s.position));
    x.rotate(totalRot);

    if(s.glow){
      const glowStr=PRESETS[s.preset]?.glowStrength||0.018;
      x.shadowColor=accents[i%5];
      x.shadowBlur=W*glowStr*(1+k*0.3);
    } else if(s.shadow){
      x.shadowColor='#0008';
      x.shadowBlur=W*0.02;
      x.shadowOffsetY=W*0.01;
    }

    // Fill background beneath each frame for cleaner nesting
    if(color){x.fillStyle=color;x.fillRect(-size/2,-size/2,size,size);}

    x.drawImage(im,-size/2,-size/2,size,size);

    x.shadowBlur=0; x.shadowOffsetY=0;

    // Frame border. Guarded on > 0 because the canvas spec says a lineWidth of
    // zero is IGNORED — setting it leaves the previous width in place, so
    // thickness=0 still painted a hairline frame across the artwork on stream.
    if(s.thickness>0){
      x.strokeStyle=accents[i%5];
      x.lineWidth=s.thickness*W/360;
      x.strokeRect(-size/2,-size/2,size,size);
    }

    x.restore();
  }
  blendTransition(canvas);
}

// ── Stream mode single spotlight canvas ───────────────────────
let streamCanvas=null;
if(STREAM_MODE){
  // Hide grid, show a single large canvas centred on screen
  grid.style.display='none';
  streamCanvas=document.createElement('canvas');
  streamCanvas.id='streamCanvas';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const baseSize = 1080;
  streamCanvas.width = baseSize * dpr;
  streamCanvas.height = baseSize * dpr;
  streamCanvas.style.cssText='display:block;width:100vmin;height:100vmin;margin:auto;';
  document.querySelector('main').appendChild(streamCanvas);

  // Floating preset indicator. Off with ?pip=off — on a broadcast with no chat
  // control it just labels the screen "CHILL" forever, which tells a viewer
  // nothing and reads as a leftover dev affordance.
  if(params.get('pip')!=='off'){
    const pip=document.createElement('div');
    pip.id='stream-preset-pip';
    document.body.appendChild(pip);
  }
}

function renderFrame(canvas,i){
  const previous=painted.get(canvas);
  if(states[i].paused && previous?.revision===renderRevision && previous?.card===i && !transitions.has(canvas)) return;
  draw(canvas,i);
  painted.set(canvas,{revision:renderRevision,card:i});
}

// ── Animation loop ────────────────────────────────────────────
function frame(t){
  const dt=document.hidden?0:Math.min(t-last,60);
  last=t;
  states.forEach(s=>{if(!s.paused) s.clock=(s.clock||0)+dt*s.speed;});

  if(STREAM_MODE){
    if(streamCanvas) renderFrame(streamCanvas,selected);
    // Update PIP indicator
    const pip=document.getElementById('stream-preset-pip');
    if(pip) { pip.hidden=!states[selected].preset; pip.textContent=states[selected].preset?PRESETS[states[selected].preset].label:''; }
  } else {
    const stage=document.querySelector('#stage');
    const sc=document.querySelector('#stageCanvas');
    if(stage&&!stage.hidden&&sc) renderFrame(sc,selected);
    else if(!document.hidden) cards.forEach(({c},i)=>renderFrame(c,i));
  }
  requestAnimationFrame(frame);
}

sync();
requestAnimationFrame(frame);

// ── Control API ───────────────────────────────────────────────
// Read by control.js in ?control=live mode (Lane K3). These are the same
// functions the buttons call; chat cannot reach anything the buttons can't.
window.CUHZ_LAB=Object.freeze({
  applyPreset, update, withLiveUpdate, PRESETS, palettes, names, cardCount:names.length,
  fineDefaults:Object.freeze({thickness:defaults.thickness}),
  select:i=>{ if(Number.isInteger(i)&&i>=0&&i<names.length){ selected=i; sync(); } }
});
