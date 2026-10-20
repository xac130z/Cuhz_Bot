import { boundedTwitchJson } from '../lounge-membership/twitch-subscription.mjs';
/** Supabase's existing confidential Twitch provider handles Twitch OAuth. Only
 * this server adapter calls GoTrue token endpoints; browser code never does. */
export function createSupabaseAuthPort({ url, publishableKey, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
  const origin = new URL(url);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password
    || typeof publishableKey !== 'string' || !publishableKey) throw Error('AUTH_UPSTREAM_CONFIG');
  async function call(path, { method = 'GET', token, body } = {}) {
    const controller = new AbortController(); let timer;
    try {
      const response = await Promise.race([fetchImpl(`${origin.origin}/auth/v1/${path}`, { method, redirect: 'error',
        headers: { apikey: publishableKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal }),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('AUTH_UPSTREAM_UNAVAILABLE')); }, timeoutMs); })]);
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw Error('AUTH_UPSTREAM_UNAVAILABLE'); }
      if (response.status === 204) return null;
      return await Promise.race([boundedTwitchJson(response), new Promise((_, reject) => {
        // The same controller owns response consumption too; the outer timeout
        // remains active until finally.
        controller.signal.addEventListener('abort', () => reject(Error('AUTH_UPSTREAM_UNAVAILABLE')), { once: true });
      })]);
    } finally { clearTimeout(timer); controller.abort(); }
  }
  return {
    authorize({ redirectTo, codeChallenge }) {
      const target = new URL('/auth/v1/authorize', origin);
      target.search = new URLSearchParams({ provider: 'twitch', redirect_to: redirectTo,
        scopes: 'user:read:email', code_challenge: codeChallenge, code_challenge_method: 's256' }).toString();
      return target.href;
    },
    exchange: ({ code, verifier }) => call('token?grant_type=pkce', { method: 'POST', body: { auth_code: code, code_verifier: verifier } }),
    refresh: refreshToken => call('token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } }),
    user: accessToken => call('user', { token: accessToken }),
    logout: accessToken => call('logout?scope=local', { method: 'POST', token: accessToken }),
  };
}
