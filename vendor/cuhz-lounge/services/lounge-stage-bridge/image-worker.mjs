import {parentPort} from 'node:worker_threads';
import {verifyArtwork} from './image.mjs';

// One private decode per worker. No provider/network access, logs or persisted
// bytes. The parent sends an owned copy so its canonical Buffer stays intact.
if(parentPort)parentPort.once('message',message=>{
 try{
  const verified=verifyArtwork(Buffer.from(message.bytes),message.metadata);
  const bytes=Uint8Array.from(verified.bytes);
  parentPort.postMessage({ok:true,bytes,descriptor:verified.descriptor},[bytes.buffer]);
 }catch{
  parentPort.postMessage({ok:false,code:'OUTPUT_NOT_VERIFIED'});
 }finally{parentPort.close();}
});
