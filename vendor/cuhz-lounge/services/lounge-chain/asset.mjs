import { createHash } from 'node:crypto';
import { chainImageHeader } from './image-header.mjs';
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
  const { width, height } = chainImageHeader(bytes, meta.mime);
  if (width !== meta.width || height !== meta.height) throw invalid();
  return meta;
}
