import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// A committed catalog is source provenance, never publication consent. No
// request value is used as a filesystem path, URL, hash, actor or origin label.
export const curatedCatalog=Object.freeze({key:'planet-cuhz-logo-v1',revision:'1',
 title:'Planet CUHZ brand logo',sha256:'fa5b119445e349d4732e60bb2939cdee52cbd44238ef185bf72818c7299f6e05',
 bytes:1597185,width:1024,height:1024,label:'owner_curated',
 derivativeHash:'66708d20c7b2aaaac3155318a40fe3ce3414f52fff277f496909abcedc6f63fc',derivativeBytes:1410157});
export function curatedItemId(userId){
 if(typeof userId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId))throw Error('CURATED_SOURCE_UNAVAILABLE');
 const bytes=createHash('sha256').update(`planet-cuhz-owner-curated-v1|${userId.toLowerCase()}|${curatedCatalog.key}|${curatedCatalog.revision}`).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;
 const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export async function readCuratedSource(){
 try{
  const bytes=await readFile(new URL('./assets/cuhz-logo.png',import.meta.url));
  if(bytes.length!==curatedCatalog.bytes||createHash('sha256').update(bytes).digest('hex')!==curatedCatalog.sha256)throw Error();
  return bytes;
 }catch{throw Object.assign(Error('CURATED_SOURCE_UNAVAILABLE'),{code:'CURATED_SOURCE_UNAVAILABLE'});}
}
