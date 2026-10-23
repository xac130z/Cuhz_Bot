import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');
export const challenge = value => createHash('sha256').update(value).digest('base64url');
export const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createVault(key) {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) throw Error('AUTH_KEY_REQUIRED');
  const secret = Buffer.from(key);
  return {
    csrf: token => createHmac('sha256', secret).update(`csrf:${token}`).digest('base64url'),
    rateKey: address => createHmac('sha256', secret).update(`rate:${address}`).digest('hex'),
    seal(value, purpose) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv);
      cipher.setAAD(Buffer.from(purpose));
      const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), bytes.toString('base64url')].join('.');
    },
    open(value, purpose) {
      const [version, iv, tag, body, extra] = String(value).split('.');
      if (version !== 'v1' || extra || !body) throw Error('AUTH_CIPHERTEXT_INVALID');
      const decipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(purpose)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8'));
    },
  };
}
