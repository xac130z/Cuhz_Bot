import { createHash } from 'node:crypto';
export const CHAIN_ASSET_LIMIT = 15 * 1024 * 1024;
const invalid = () => Object.assign(Error('ASSET_INVALID'), { code: 'ASSET_INVALID', status: 400 });
export function assetMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 5
    || !['sha256','mime','bytes','width','height'].every(k => Object.hasOwn(value,k))
    || !/^[a-f0-9]{64}$/.test(value.sha256 || '') || !['image/png','image/jpeg','image/webp'].includes(value.mime)
    || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > CHAIN_ASSET_LIMIT
    || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 1 || value.height < 1
    || value.width > 8192 || value.height > 8192 || value.width * value.height > 24_000_000) throw invalid();
  return { ...value };
}
/** Header/digest verification for opaque private originals, not a pixel decoder
 * or public derivative sanitizer. No server image renderer consumes this data.
 * The client must decode dimensions before upload and after recovered download.
 * Downloads are authenticated attachments with nosniff, never public image URLs.
 */
export function verifyPrivateAsset(bytes, input) {
  const meta = assetMetadata(input);
  if (!Buffer.isBuffer(bytes) || bytes.length !== meta.bytes
    || createHash('sha256').update(bytes).digest('hex') !== meta.sha256) throw invalid();
  let width, height;
  try {
    if (meta.mime === 'image/png') {
      if (bytes.length < 33 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii',12,16) !== 'IHDR') throw invalid();
      width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
    } else if (meta.mime === 'image/jpeg') {
      if (bytes.length < 12 || bytes.readUInt16BE(0) !== 0xffd8) throw invalid();
      let at = 2;
      while (at < bytes.length) {
        if (bytes[at++] !== 0xff) throw invalid();
        while (bytes[at] === 0xff) at++;
        const marker = bytes[at++];
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
        const length = bytes.readUInt16BE(at);
        if (length < 2 || at + length > bytes.length) throw invalid();
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4,0xc8,0xcc].includes(marker)) {
          if (length < 8) throw invalid(); height = bytes.readUInt16BE(at + 3); width = bytes.readUInt16BE(at + 5); break;
        }
        at += length;
      }
    } else {
      if (bytes.length < 25 || bytes.toString('ascii',0,4) !== 'RIFF' || bytes.toString('ascii',8,12) !== 'WEBP'
        || bytes.readUInt32LE(4) !== bytes.length - 8) throw invalid();
      const chunk = bytes.toString('ascii',12,16), length = bytes.readUInt32LE(16);
      if (20 + length > bytes.length) throw invalid();
      if (chunk === 'VP8X' && length >= 10) {
        width = 1 + bytes.readUIntLE(24,3); height = 1 + bytes.readUIntLE(27,3);
      } else if (chunk === 'VP8L' && length >= 5 && bytes[20] === 0x2f) {
        const bits = bytes.readUInt32LE(21); width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff);
      } else if (chunk === 'VP8 ' && length >= 10 && bytes.subarray(23,26).equals(Buffer.from([0x9d,1,0x2a]))) {
        width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff;
      } else throw invalid();
    }
  } catch { throw invalid(); }
  if (width !== meta.width || height !== meta.height) throw invalid();
  return meta;
}
