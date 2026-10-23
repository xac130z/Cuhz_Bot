import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const grants = new WeakSet();
const hour = 60 * 60 * 1000;
const fail = () => Object.assign(Error('STAGE_OBS_DENIED'), { code: 'STAGE_OBS_DENIED' });
const canonicalOrigin = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && value.length <= 200; }
  catch { return false; }
};
const decode = value => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw fail();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw fail();
  return bytes;
};

/** Server-only capability for reserved transport capacity. It grants no role,
 * stage control, private data or paid work. No token is minted on import/start.
 * The deployment coordinator holds mint(); no HTTP mint route is exposed. */
export function createObsStreamAccess({ key, origin, now = Date.now } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !canonicalOrigin(origin) || typeof now !== 'function') {
    throw Error('STAGE_OBS_CONFIG_INVALID');
  }
  const signingKey = Buffer.from(key);
  const signature = payload => createHmac('sha256', signingKey).update(`v1.${payload}`).digest();
  function mint({ validityMs = 14 * hour } = {}) {
    const issuedAt = now();
    if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || !Number.isSafeInteger(validityMs)
      || validityMs < 1000 || validityMs > 16 * hour) throw Error('STAGE_OBS_VALIDITY_INVALID');
    const expiresAt = issuedAt + validityMs;
    const payload = Buffer.from(JSON.stringify({ v: 1, purpose: 'obs-stream', aud: origin,
      iat: issuedAt, exp: expiresAt, jti: randomBytes(16).toString('base64url') })).toString('base64url');
    return Object.freeze({ token: `v1.${payload}.${signature(payload).toString('base64url')}`,
      expiresAt: new Date(expiresAt).toISOString() });
  }
  function verify(token) {
    if (typeof token !== 'string' || token.length > 768) throw fail();
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') throw fail();
    const supplied = decode(parts[2]);
    if (supplied.length !== 32 || !timingSafeEqual(supplied, signature(parts[1]))) throw fail();
    let claims;
    try { claims = JSON.parse(decode(parts[1]).toString('utf8')); } catch { throw fail(); }
    const stamp = now();
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)
      || Object.keys(claims).sort().join(',') !== 'aud,exp,iat,jti,purpose,v'
      || claims.v !== 1 || claims.purpose !== 'obs-stream' || claims.aud !== origin
      || !Number.isSafeInteger(stamp) || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
      || claims.iat < 0 || claims.iat > stamp || claims.exp <= stamp || claims.exp - claims.iat < 1000
      || claims.exp - claims.iat > 16 * hour || typeof claims.jti !== 'string'
      || !/^[A-Za-z0-9_-]{22}$/.test(claims.jti) || decode(claims.jti).length !== 16) throw fail();
    const grant = Object.freeze({ id: claims.jti, issuedAt: claims.iat, expiresAt: claims.exp });
    grants.add(grant);
    return grant;
  }
  return Object.freeze({ mint, verify });
}

/** Browser JSON and copied grants cannot select the protected lane. */
export function trustedObsStreamGrant(value) {
  return value && grants.has(value) ? value : null;
}
