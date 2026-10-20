/** Shared, dependency-free request validation for the user-owned Lounge studio. */
export const LIMITS = Object.freeze({
  max_references: 3,
  max_reference_bytes: 4 * 1024 * 1024,
  max_reference_edge: 4096,
  max_reference_pixels: 16 * 1024 * 1024,
  max_prompt_chars: 4000,
  max_body_bytes: 18 * 1024 * 1024,
  max_output_bytes: 16 * 1024 * 1024,
});
export const SIZES = Object.freeze(['1024x1024', '1536x1024', '1024x1536']);
export const KINDS = Object.freeze(['emote', 'overlay', 'background', 'portrait', 'custom']);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MODELS = Object.freeze([
  'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08',
  'gpt-image-2.5-flare', 'gpt-image-2.5-flare-2026-09-08',
  'gpt-image-2', 'gpt-image-2-2026-04-21',
]);

export class LoungeError extends Error {
  constructor(code, message, status = 400, uncertain = false) {
    super(message);
    this.name = 'LoungeError';
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
  }
}

export function configuration(read) {
  const requested = read('LOUNGE_IMAGE_MODEL') || 'gpt-image-2.5-sunburst';
  const quality = read('LOUNGE_IMAGE_QUALITY') || 'medium';
  return {
    // New admission is three-image window quota only. Legacy n=1/five-image
    // receipts remain readable; clients cannot select a legacy paid route.
    batchMode: true,
    enabled: read('LOUNGE_GENERATION_ENABLED') === 'true',
    providerKey: read('OPENAI_API_KEY') || '',
    model: MODELS.includes(requested) ? requested : null,
    quality: ['low', 'medium', 'high'].includes(quality) ? quality : null,
    mode: ['sync', 'queue'].includes(read('LOUNGE_GENERATION_MODE') || 'sync') ? read('LOUNGE_GENERATION_MODE') || 'sync' : null,
    workerEnabled: read('LOUNGE_WORKER_ENABLED') === 'true',
    workerSecret: read('LOUNGE_WORKER_SECRET') || '',
  };
}

export function decodeBase64(value, maxBytes) {
  if (typeof value !== 'string' || !value.length || value.length % 4 !== 0) {
    throw new LoungeError('INVALID_IMAGE', 'The image encoding is invalid.');
  }
  if (value.length > Math.ceil(maxBytes / 3) * 4) {
    throw new LoungeError('IMAGE_TOO_LARGE', 'The image exceeds the allowed size.', 413);
  }
  // A repeated-group regex over multi-megabyte base64 can exhaust the V8 stack.
  // Scan once, allow padding only at the end, and require canonical zero pad bits.
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const end = value.length - padding;
  let last = 0;
  for (let i = 0; i < end; i++) {
    const code = value.charCodeAt(i);
    const sextet = code >= 65 && code <= 90 ? code - 65
      : code >= 97 && code <= 122 ? code - 71
        : code >= 48 && code <= 57 ? code + 4 : code === 43 ? 62 : code === 47 ? 63 : -1;
    if (sextet < 0) throw new LoungeError('INVALID_IMAGE', 'The image encoding is invalid.');
    last = sextet;
  }
  if ((padding === 2 && (last & 15) !== 0) || (padding === 1 && (last & 3) !== 0)) {
    throw new LoungeError('INVALID_IMAGE', 'The image encoding is invalid.');
  }
  const decodedLength = value.length / 4 * 3 - padding;
  if (decodedLength > maxBytes) throw new LoungeError('IMAGE_TOO_LARGE', 'The image exceeds the allowed size.', 413);
  let binary;
  try { binary = atob(value); } catch { throw new LoungeError('INVALID_IMAGE', 'The image encoding is invalid.'); }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function ascii(bytes, start, count) {
  return String.fromCharCode(...bytes.slice(start, start + count));
}

/** Inspect actual file bytes, not a supplied filename/type or claimed dimensions. */
export function imageDimensions(bytes) {
  const b = bytes;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length >= 45 && b.slice(0, 8).every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i]) &&
      view.getUint32(8) === 13 && ascii(b, 12, 4) === 'IHDR' && ascii(b, b.length - 8, 4) === 'IEND') {
    return { mime_type: 'image/png', width: view.getUint32(16), height: view.getUint32(20), extension: 'png' };
  }
  if (b.length >= 12 && b[0] === 255 && b[1] === 216 && b[b.length - 2] === 255 && b[b.length - 1] === 217) {
    let pos = 2;
    while (pos + 4 <= b.length) {
      if (b[pos++] !== 255) break;
      while (b[pos] === 255) pos++;
      const marker = b[pos++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (pos + 2 > b.length) break;
      const length = view.getUint16(pos);
      if (length < 2 || pos + length > b.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        return { mime_type: 'image/jpeg', height: view.getUint16(pos + 3), width: view.getUint16(pos + 5), extension: 'jpg' };
      }
      pos += length;
    }
  }
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP' && view.getUint32(4, true) + 8 === b.length) {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8X' && view.getUint32(16, true) >= 10) {
      return { mime_type: 'image/webp', width: 1 + b[24] + (b[25] << 8) + (b[26] << 16), height: 1 + b[27] + (b[28] << 8) + (b[29] << 16), extension: 'webp' };
    }
    if (chunk === 'VP8L' && b[20] === 47) {
      const bits = view.getUint32(21, true);
      return { mime_type: 'image/webp', width: 1 + (bits & 16383), height: 1 + ((bits >>> 14) & 16383), extension: 'webp' };
    }
    if (chunk === 'VP8 ' && b[23] === 157 && b[24] === 1 && b[25] === 42) {
      return { mime_type: 'image/webp', width: view.getUint16(26, true) & 16383, height: view.getUint16(28, true) & 16383, extension: 'webp' };
    }
  }
  throw new LoungeError('INVALID_IMAGE', 'Upload a valid PNG, JPEG or WebP reference.');
}

export function parseInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new LoungeError('INVALID_REQUEST', 'Provide an image brief and request ID.');
  const allowed = new Set(['request_id', 'prompt', 'kind', 'size', 'background', 'references']);
  if (Object.keys(raw).some(k => !allowed.has(k))) throw new LoungeError('INVALID_REQUEST', 'The request contains unsupported fields.');
  if (typeof raw.request_id !== 'string' || !UUID.test(raw.request_id)) throw new LoungeError('INVALID_REQUEST_ID', 'The request ID must be a UUID.');
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  if (!prompt || prompt.length > LIMITS.max_prompt_chars || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(prompt)) {
    throw new LoungeError('INVALID_PROMPT', 'Describe the artwork in 1–4,000 characters.');
  }
  const kind = raw.kind ?? 'custom';
  const size = raw.size ?? '1024x1024';
  const background = raw.background ?? 'opaque';
  if (!KINDS.includes(kind) || !SIZES.includes(size) || !['transparent', 'opaque'].includes(background)) {
    throw new LoungeError('INVALID_OPTIONS', 'Choose a supported artwork type, size and background.');
  }
  const list = raw.references ?? [];
  if (!Array.isArray(list) || list.length > LIMITS.max_references) throw new LoungeError('INVALID_REFERENCES', 'Use up to three image references.');
  const references = list.map((r, index) => {
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(k => !['name', 'mime_type', 'base64'].includes(k)) ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(r.mime_type)) {
      throw new LoungeError('INVALID_REFERENCES', 'References must contain PNG, JPEG or WebP image bytes, not URLs.');
    }
    const bytes = decodeBase64(r.base64, LIMITS.max_reference_bytes);
    const info = imageDimensions(bytes);
    if (info.mime_type !== r.mime_type) throw new LoungeError('IMAGE_TYPE_MISMATCH', 'A reference does not match its declared image format.');
    if (!info.width || !info.height || Math.max(info.width, info.height) > LIMITS.max_reference_edge || info.width * info.height > LIMITS.max_reference_pixels) {
      throw new LoungeError('IMAGE_DIMENSIONS', 'References must be at most 4,096 pixels per edge and 16 megapixels.');
    }
    const name = typeof r.name === 'string' ? r.name.replace(/[\x00-\x1f/\\]/g, '').slice(0, 120) : `Reference ${index + 1}`;
    return { ...info, name, bytes, base64: r.base64 };
  });
  return { request_id: raw.request_id.toLowerCase(), prompt, kind, size, background, references };
}

export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(v => v.toString(16).padStart(2, '0')).join('');
}

export async function fingerprint(input, config) {
  const references = await Promise.all(input.references.map(async r => ({
    mime_type: r.mime_type, width: r.width, height: r.height, hash: await sha256(r.bytes),
  })));
  const description = { prompt: input.prompt, kind: input.kind, size: input.size, background: input.background, model: config.model, quality: config.quality, references };
  return { hash: await sha256(JSON.stringify(description)), description };
}

export async function readJson(req, maxBodyBytes = LIMITS.max_body_bytes, requireJsonType = true) {
  if (requireJsonType && !(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    throw new LoungeError('INVALID_CONTENT_TYPE', 'Send the artwork brief as JSON.', 415);
  }
  const reader = req.body?.getReader();
  if (!reader) throw new LoungeError('INVALID_REQUEST', 'The artwork brief is missing.');
  const chunks = [];
  let count = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > maxBodyBytes) {
        await reader.cancel();
        throw new LoungeError('REQUEST_TOO_LARGE', 'The uploaded references are too large.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new LoungeError('INVALID_JSON', 'The artwork brief is not valid JSON.'); }
}

export function allocationView(row) {
  if (!row || !Number.isInteger(row.remaining)) return null;
  return { remaining: row.remaining, reserved: row.reserved, source: row.source, expires_at: row.expires_at,
    attempt_limit: row.attempt_limit, attempts_used: row.attempts_used,
    attempts_remaining: validAttemptBudget(row) ? Math.max(0, row.attempt_limit - row.attempts_used) : 0 };
}

function validAttemptBudget(row) {
  return Number.isInteger(row?.attempt_limit) && row.attempt_limit >= 1 &&
    Number.isInteger(row?.attempts_used) && row.attempts_used >= 0;
}

export function capability(config, user, allocation, connected = true, queueBudget = null) {
  let reason = null;
  if (!user) reason = 'SIGN_IN_REQUIRED';
  else if (!config.enabled) reason = 'GENERATION_DISABLED';
  else if ((config.mode ?? 'sync') === 'sync' && !config.providerKey) reason = 'PROVIDER_NOT_CONFIGURED';
  else if (!config.model || !config.quality) reason = 'PROVIDER_CONFIGURATION';
  else if (config.mode === null) reason = 'PROVIDER_CONFIGURATION';
  else if (config.mode === 'queue' && (!config.workerEnabled || config.workerSecret.length < 32)) reason = 'WORKER_NOT_CONFIGURED';
  else if (!connected || (allocation && !validAttemptBudget(allocation))) reason = 'STUDIO_NOT_CONNECTED';
  else if (config.mode === 'queue' && (!queueBudget?.enabled || !Number.isInteger(queueBudget.attempt_limit) || !Number.isInteger(queueBudget.attempts_used) ||
    queueBudget.attempt_limit<0 || queueBudget.attempts_used<0 || !Number.isFinite(new Date(queueBudget.expires_at).getTime()) || new Date(queueBudget.expires_at).getTime() <= Date.now())) reason = 'WORKER_BUDGET_REQUIRED';
  else if (config.mode === 'queue' && queueBudget.attempts_used >= queueBudget.attempt_limit) reason = 'WORKER_BUDGET_EXHAUSTED';
  else if (!allocation || !allocation.enabled || new Date(allocation.expires_at).getTime() <= Date.now()) reason = 'ALLOCATION_REQUIRED';
  else if (allocation.reserved >= 1) reason = 'GENERATION_IN_FLIGHT';
  else if (allocation.attempts_used >= allocation.attempt_limit) reason = 'ATTEMPT_LIMIT_REACHED';
  else if (allocation.remaining < 1) reason = 'ALLOCATION_EXHAUSTED';
  return { enabled: config.enabled, available: !reason, reason, allocation: allocationView(allocation), limits: LIMITS, sizes: SIZES, kinds: KINDS, model: config.model, quality: config.quality, generation_mode: config.mode ?? 'sync', billing_connected: false };
}

export const MESSAGES = Object.freeze({
  SIGN_IN_REQUIRED: 'Sign in with Twitch to generate artwork.',
  GENERATION_DISABLED: 'Image generation has not been enabled for this studio yet. Uploads and local editing still work.',
  PROVIDER_NOT_CONFIGURED: 'The studio image provider needs to be connected before generation can start.',
  PROVIDER_CONFIGURATION: 'The studio image model needs a valid server configuration.',
  STUDIO_NOT_CONNECTED: 'The studio storage and allocation service needs to be deployed.',
  ALLOCATION_REQUIRED: 'An owner-test or creator generation allocation is needed. Creator billing is not connected yet.',
  ALLOCATION_EXHAUSTED: 'Your generation allocation is used or reserved by an existing request.',
  ATTEMPT_LIMIT_REACHED: 'Your creation attempt allowance is used. Failed requests also count toward this safety limit. Contact the CUHZ team before starting more.',
  IDEMPOTENCY_CONFLICT: 'This request ID belongs to a different artwork brief. Submit a new request ID for a new brief.',
  GENERATION_IN_FLIGHT: 'An artwork request is already running or waiting for review. Check its status before starting another.',
  WORKER_NOT_CONFIGURED: 'The separate creator worker has not been connected or enabled yet.',
  WORKER_BUDGET_REQUIRED: 'A separate approved worker generation budget is required before queued creation can start.',
  WORKER_BUDGET_EXHAUSTED: 'The approved worker request budget is used. No additional provider requests will start.',
});
