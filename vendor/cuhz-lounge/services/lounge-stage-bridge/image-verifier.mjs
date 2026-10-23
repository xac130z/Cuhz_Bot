import {Worker} from 'node:worker_threads';
const INPUT_LIMIT=16*1024*1024,OUTPUT_LIMIT=10*1024*1024;
const failure=code=>Object.assign(Error(code),{code});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const defaultFactory=()=>new Worker(new URL('./image-worker.mjs',import.meta.url),{
 name:'cuhz-image-verifier',execArgv:[],resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16,stackSizeMb:4},
});
function validInput(bytes,metadata){
 if(!Buffer.isBuffer(bytes)||bytes.length<33||bytes.length>INPUT_LIMIT||!exact(metadata,['sha256','size'])||!digest(metadata.sha256)||typeof metadata.size!=='string'||!/^\d{1,4}x\d{1,4}$/.test(metadata.size))return false;
 const [width,height]=metadata.size.split('x').map(Number);
 return width>0&&height>0&&width<=1536&&height<=1536&&width*height<=1572864;
}
function result(message,job){
 const d=message?.descriptor,bytes=message?.bytes;
 if(!exact(message,['ok','bytes','descriptor'])||message.ok!==true||!(bytes instanceof Uint8Array)||bytes.byteLength<33||bytes.byteLength>OUTPUT_LIMIT
  ||!exact(d,['canonicalHash','canonicalBytes','width','height','publicHash','publicBytes','verifierVersion'])
  ||d.canonicalHash!==job.metadata.sha256||d.canonicalBytes!==job.length||`${d.width}x${d.height}`!==job.metadata.size
  ||!Number.isSafeInteger(d.width)||!Number.isSafeInteger(d.height)||!digest(d.publicHash)||d.publicBytes!==bytes.byteLength||d.verifierVersion!=='png-v1')throw failure('OUTPUT_NOT_VERIFIED');
 return {bytes:Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength),descriptor:{...d}};
}

/** Lazy, bounded decode executor. One active worker and at most two waiting
 * byte copies per instance. Deadline includes queue wait; no decode is retried.
 * workerFactory is a deterministic test seam, never a request-supplied option. */
export function createImageVerifier({timeoutMs=5000,maxQueued=2,workerFactory=defaultFactory}={}){
 if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>12000||!Number.isInteger(maxQueued)||maxQueued<0||maxQueued>2||typeof workerFactory!=='function')throw failure('IMAGE_VERIFIER_CONFIG_INVALID');
 let stopped=false,active=null;const queued=[];
 function clear(job){clearTimeout(job.timer);job.bytes=null;}
 function rejectWaiting(job,code){if(job.settled)return;job.settled=true;clear(job);job.reject(failure(code));}
 function pump(){
  if(stopped||active||!queued.length)return;
  const job=queued.shift();active=job;
  try{
   if(Date.now()>=job.deadline){finish(job,null,'IMAGE_VERIFIER_TIMEOUT');return;}
   const worker=workerFactory();job.worker=worker;
   if(!worker||typeof worker.on!=='function'||typeof worker.off!=='function'||typeof worker.postMessage!=='function'||typeof worker.terminate!=='function')throw failure('OUTPUT_NOT_VERIFIED');
   job.onMessage=message=>{if(job.settled)return;if(Date.now()>=job.deadline){finish(job,null,'IMAGE_VERIFIER_TIMEOUT');return;}try{finish(job,result(message,job));}catch{finish(job,null,'OUTPUT_NOT_VERIFIED');}};
   job.onError=()=>finish(job,null,'OUTPUT_NOT_VERIFIED');
   job.onExit=()=>finish(job,null,'OUTPUT_NOT_VERIFIED');
   worker.on('message',job.onMessage);worker.on('error',job.onError);worker.on('exit',job.onExit);
   const bytes=job.bytes;worker.postMessage({bytes,metadata:job.metadata},[bytes.buffer]);job.bytes=null;
  }catch{finish(job,null,'OUTPUT_NOT_VERIFIED');}
 }
 function finish(job,value,code){
  if(job.settled)return job.termination;
  job.settled=true;clear(job);
  if(code)job.reject(failure(code));else job.resolve(value);
  // Keep the active slot occupied through asynchronous termination. A timeout
  // must not allow the next decode to overlap the worker being stopped.
  job.termination=Promise.resolve().then(()=>job.worker?.terminate()).then(()=>{
   if(job.worker&&job.onMessage){job.worker.off('message',job.onMessage);job.worker.off('error',job.onError);job.worker.off('exit',job.onExit);}
   if(active===job)active=null;pump();
  },()=>{
   // Unknown termination must not start another worker alongside this one.
   stopped=true;for(const pending of queued.splice(0))rejectWaiting(pending,'IMAGE_VERIFIER_STOPPED');
  });
  return job.termination;
 }
 function verify(bytes,metadata){
  if(stopped)return Promise.reject(failure('IMAGE_VERIFIER_STOPPED'));
  if(!validInput(bytes,metadata))return Promise.reject(failure('OUTPUT_NOT_VERIFIED'));
  if(active&&queued.length>=maxQueued)return Promise.reject(failure('IMAGE_VERIFIER_BUSY'));
  // Snapshot a bounded private copy before returning. The caller may retain or
  // mutate its Buffer without affecting the admitted verification request.
  const copy=Uint8Array.from(bytes),pinned=Object.freeze({sha256:metadata.sha256,size:metadata.size});
  return new Promise((resolve,reject)=>{
   const job={bytes:copy,length:copy.byteLength,metadata:pinned,resolve,reject,settled:false,deadline:Date.now()+timeoutMs,worker:null,timer:null,termination:null};
   job.timer=setTimeout(()=>{
    if(job===active)finish(job,null,'IMAGE_VERIFIER_TIMEOUT');
    else{const index=queued.indexOf(job);if(index!==-1)queued.splice(index,1);rejectWaiting(job,'IMAGE_VERIFIER_TIMEOUT');}
   },timeoutMs);
   queued.push(job);pump();
  });
 }
 function stop(){
  stopped=true;for(const job of queued.splice(0))rejectWaiting(job,'IMAGE_VERIFIER_STOPPED');
  if(active&&!active.settled)return finish(active,null,'IMAGE_VERIFIER_STOPPED');
  return active?.termination??Promise.resolve();
 }
 return Object.freeze({verify,stop});
}
