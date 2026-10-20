import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {inflateSync} from 'node:zlib';
import {approvedPng} from '../../supabase/functions/lounge-publish/core.mjs';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const invalid=()=>Object.assign(Error('OUTPUT_NOT_VERIFIED'),{code:'OUTPUT_NOT_VERIFIED'});
/** Decode every pixel after bounded structural/CRC checks. Canonical bytes stay
 * untouched. Re-encoding pixels emits a new still PNG with no text/EXIF/profile
 * or provenance metadata; the original retains those credentials privately. */
export function verifyArtwork(bytes,{sha256,size}={}){
 if(!Buffer.isBuffer(bytes)||bytes.length>16*1024*1024||hash(bytes)!==sha256)throw invalid();
 try{
  const stripped=Buffer.from(approvedPng(bytes)),width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(`${width}x${height}`!==size||width<1||height<1||width>1536||height>1536||width*height>1572864)throw invalid();
  // Validate compressed pixels with Node's public bounded decoder first.
  // pngjs7's historical sync inflater uses private Node internals; malformed
  // streams must never reach that compatibility path (or unbounded Adam7).
  const depth=bytes[24],channels=({0:1,2:3,3:1,4:2,6:4})[bytes[25]];
  if(!channels||![1,2,4,8,16].includes(depth)||bytes[26]!==0||bytes[27]!==0||bytes[28]!==0)throw invalid();
  const rowBytes=Math.ceil(width*channels*depth/8)+1,expected=rowBytes*height,data=[];
  for(let at=8;at<stripped.length;){const n=stripped.readUInt32BE(at),type=stripped.toString('ascii',at+4,at+8);if(type==='IDAT')data.push(stripped.subarray(at+8,at+8+n));at+=12+n;}
  const compressed=Buffer.concat(data),inflated=inflateSync(compressed,{maxOutputLength:expected,info:true});
  if(inflated.buffer.length!==expected||inflated.engine.bytesWritten!==compressed.length)throw invalid();
  for(let at=0;at<expected;at+=rowBytes)if(inflated.buffer[at]>4)throw invalid();
  const decoded=PNG.sync.read(stripped,{checkCRC:true});
  if(decoded.width!==width||decoded.height!==height||decoded.data.length!==width*height*4)throw invalid();
  const output=PNG.sync.write({width,height,data:decoded.data},{colorType:6,inputColorType:6,bitDepth:8});
  if(output.length>10*1024*1024)throw invalid();
  return {bytes:output,descriptor:{canonicalHash:sha256,canonicalBytes:bytes.length,width,height,publicHash:hash(output),publicBytes:output.length,verifierVersion:'png-v1'}};
 }catch{throw invalid();}
}
