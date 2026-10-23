import { CUHZ_BOT_CHANNEL_ID } from './policy.mjs';

const ENDPOINT = 'https://api.twitch.tv/helix/subscriptions';
const MAX_BODY_BYTES = 32_768;
const numericId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);

export async function boundedTwitchJson(response) {
  const declared = response.headers?.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error('response_limit');
  }
  if (!response.body || typeof response.body.getReader !== 'function') throw new Error('response_invalid');
  const reader = response.body.getReader();
  let size = 0;
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error('response_limit');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Server-only, injected credentials; call with a broadcaster user access token
 * carrying channel:read:subscriptions for CUHZ Bot. Tokens are never returned,
 * logged or placed in a URL. This module does not acquire/refresh credentials. */
export function createTwitchSubscriptionVerifier({
  clientId, accessToken, broadcasterId = CUHZ_BOT_CHANNEL_ID,
  fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 5_000,
} = {}) {
  return async function verify(userId) {
    const result = (status, reason, extras = {}) => Object.freeze({
      source: 'helix-broadcaster-subscriptions', broadcasterId, userId,
      status, reason, checkedAt: now(), ...extras,
    });
    if (broadcasterId !== CUHZ_BOT_CHANNEL_ID || typeof clientId !== 'string' || !clientId.trim()
      || typeof accessToken !== 'string' || !accessToken.trim() || typeof fetchImpl !== 'function'
      || typeof now !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
      // Do not echo invalid secret/config values.
      return { source: 'helix-broadcaster-subscriptions', status: 'unknown', reason: 'SUBSCRIPTION_CONFIG_INVALID' };
    }
    if (!numericId(userId)) return { source: 'helix-broadcaster-subscriptions', status: 'unknown', reason: 'IDENTITY_INVALID' };
    const url = new URL(ENDPOINT);
    url.searchParams.set('broadcaster_id', broadcasterId);
    url.searchParams.set('user_id', userId);
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url.href, {
            method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
            headers: { 'Client-ID': clientId, Authorization: `Bearer ${accessToken}` },
          });
          if (response.status !== 200) {
            await response.body?.cancel?.().catch(() => {});
            return result('unknown', response.status === 401 || response.status === 403
              ? 'SUBSCRIPTION_CREDENTIALS_REQUIRED' : response.status === 429
                ? 'SUBSCRIPTION_RATE_LIMITED' : 'SUBSCRIPTION_UNAVAILABLE');
          }
          const body = await boundedTwitchJson(response);
          if (!body || !Array.isArray(body.data) || body.data.length > 1) return result('unknown', 'SUBSCRIPTION_RESPONSE_INVALID');
          if (body.data.length === 0) return result('inactive', 'NOT_SUBSCRIBED');
          const row = body.data[0];
          if (row?.broadcaster_id !== broadcasterId || row?.user_id !== userId
            || !['1000', '2000', '3000'].includes(row?.tier)) return result('unknown', 'SUBSCRIPTION_RESPONSE_INVALID');
          return result('active', 'SUBSCRIBED', { tier: row.tier });
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('deadline')); }, timeoutMs);
        }),
      ]);
    } catch {
      return result('unknown', controller.signal.aborted ? 'SUBSCRIPTION_TIMEOUT' : 'SUBSCRIPTION_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
