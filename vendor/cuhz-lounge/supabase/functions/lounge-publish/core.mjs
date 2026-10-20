/** Publish inputs are identifiers only. URLs, channels and owners are never client authority. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CHANNEL = /^\d{1,12}$/;
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const MAX_BODY_BYTES = 2048;
export class PublishError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export function verifiedChannel(user) {
  if (!UUID.test(user?.id || '')) return null;
  const identity = (user.identities || []).find(value => value.provider === 'twitch');
  const id = typeof identity?.identity_data?.sub === 'string' ? identity.identity_data.sub : '';
  return CHANNEL.test(id) && identity?.id === id ? id : null;
}
export async function readCommand(req) {
  const announced = req.headers.get('content-length');
  if (announced && (!/^\d+$/.test(announced) || Number(announced) > MAX_BODY_BYTES)) {
    throw new PublishError('REQUEST_TOO_LARGE', 'Publish requests contain identifiers only.', 413);
  }
  const reader = req.body?.getReader();
  if (!reader) throw new PublishError('INVALID_REQUEST', 'Provide a publish command.');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      length += item.value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel(); throw new PublishError('REQUEST_TOO_LARGE', 'Publish requests contain identifiers only.', 413);
      }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body; try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new PublishError('INVALID_REQUEST', 'Provide a valid publish command.'); }
  return parseCommand(body);
}
export function parseCommand(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !['publish', 'revoke', 'rollback'].includes(body.action)) {
    throw new PublishError('INVALID_REQUEST', 'Choose publish, revoke or rollback.');
  }
  const keys = ['action', 'request_id', 'expected_revision', body.action === 'publish' ? 'generation_id' : 'version'];
  if (Object.keys(body).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(body, key))) {
    throw new PublishError('INVALID_REQUEST', 'Only command identifiers are accepted.');
  }
  if (!UUID.test(body.request_id || '') || !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) {
    throw new PublishError('INVALID_REQUEST', 'Use a request UUID and the current channel revision.');
  }
  if (body.action === 'publish' && !UUID.test(body.generation_id || '')) {
    throw new PublishError('INVALID_REQUEST', 'Choose a completed generation from your library.');
  }
  if (body.action !== 'publish' && (!Number.isSafeInteger(body.version) || body.version < 1)) {
    throw new PublishError('INVALID_REQUEST', 'Choose a valid published version.');
  }
  return { action: body.action, request_id: body.request_id.toLowerCase(), expected_revision: body.expected_revision,
    ...(body.action === 'publish' ? { generation_id: body.generation_id.toLowerCase() } : { version: body.version }) };
}
export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function commandFingerprint(channel, command) {
  return sha256(new TextEncoder().encode(JSON.stringify({ channel_id: channel,
    action: command.action, request_id: command.request_id, expected_revision: command.expected_revision,
    ...(command.action === 'publish' ? { generation_id: command.generation_id } : { version: command.version }) })));
}
export function artifactPath(channel, generation, hash) {
  if (!CHANNEL.test(channel) || !UUID.test(generation) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid artifact identity');
  return `${channel}/${generation.toLowerCase()}/${hash}.png`;
}

// Publish a still PNG, not its embedded text/EXIF/prompt metadata. Preserve only
// rendering chunks, verify their CRC and reject truncation/trailing payloads.
// This is bounded byte validation, not an image-provider call or arbitrary URL fetch.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function approvedPng(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 57 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new PublishError('ARTWORK_INVALID', 'Only a bounded still PNG can be published.', 422);
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, i) => bytes[i] === byte)) throw new PublishError('ARTWORK_INVALID', 'The artwork is not a PNG.', 422);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keep = [bytes.subarray(0, 8)]; let offset = 8; let chunks = 0; let ended = false; let hasData = false;
  while (offset < bytes.length && chunks++ < 4096) {
    if (offset + 12 > bytes.length) break;
    const length = view.getUint32(offset); const end = offset + 12 + length;
    if (end > bytes.length) break;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) break;
    if (chunks === 1) {
      if (type !== 'IHDR' || length !== 13) break;
      const width = view.getUint32(offset + 8), height = view.getUint32(offset + 12);
      if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16 * 1024 * 1024) break;
    } else if (type === 'IHDR') break;
    if (type === 'IDAT') hasData = true;
    if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type)) keep.push(bytes.subarray(offset, end));
    else if (type.charCodeAt(0) < 97) break; // Unknown critical rendering chunk.
    offset = end;
    if (type === 'IEND') { ended = length === 0 && hasData && offset === bytes.length; break; }
  }
  if (!ended) throw new PublishError('ARTWORK_INVALID', 'The PNG is incomplete or unsupported.', 422);
  const output = new Uint8Array(keep.reduce((sum, chunk) => sum + chunk.length, 0)); let next = 0;
  for (const chunk of keep) { output.set(chunk, next); next += chunk.length; }
  return output;
}
