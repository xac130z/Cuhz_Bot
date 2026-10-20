import { verifiedTwitchIdentity } from '../lounge-membership/identity.mjs';
const credentialClaim = value => value && typeof value === 'object' && Object.entries(value).some(([key,item]) => ['provider_token','provider_access_token','provider_refresh_token','refresh_token'].includes(key) || credentialClaim(item));
const text = value => typeof value === 'string' ? value.slice(0, 128) : '';
/** No spreading upstream user/session objects. Provider credentials and arbitrary
 * identity/user metadata cannot survive this server response projection. */
export function projectUser(user) {
  const identity = verifiedTwitchIdentity(user);
  if (!identity) throw Error('AUTH_IDENTITY_REQUIRED');
  const row = user.identities.find(value => value.provider === 'twitch');
  const data = row.identity_data || {};
  const login = [data.preferred_username, data.nickname, data.slug, data.user_name]
    .find(value => typeof value === 'string' && /^[a-zA-Z0-9_]{2,25}$/.test(value));
  if (!login) throw Error('AUTH_IDENTITY_REQUIRED');
  return { id: identity.userId, aud: 'authenticated', role: 'authenticated', created_at: text(user.created_at),
    app_metadata: { provider: 'twitch', providers: ['twitch'] }, user_metadata: {},
    identities: [{ id: text(row.id), user_id: identity.userId, provider_id: identity.twitchId, provider: 'twitch',
      identity_data: { sub: identity.twitchId, preferred_username: login.toLowerCase(), name: text(data.name) || login } }] };
}
export function projectSession(tokens, user, now = Date.now()) {
  if (typeof tokens.access_token !== 'string' || tokens.access_token.length < 16 || tokens.access_token.length > 16384
    || !Number.isSafeInteger(tokens.expires_at) || tokens.expires_at * 1000 <= now) throw Error('AUTH_SESSION_INVALID');
  return { access_token: tokens.access_token, token_type: 'bearer', expires_at: tokens.expires_at,
    expires_in: Math.max(0, Math.floor(tokens.expires_at - now / 1000)), refresh_token: '', user: projectUser(user) };
}
export function privateTokens(raw, now = Date.now()) {
  if (typeof raw?.access_token !== 'string' || raw.access_token.length < 16 || raw.access_token.length > 16384
    || typeof raw.refresh_token !== 'string' || raw.refresh_token.length < 16 || raw.refresh_token.length > 16384
    || !Number.isSafeInteger(raw.expires_in) || raw.expires_in < 1 || raw.expires_in > 900) throw Error('AUTH_SESSION_INVALID');
  // Online getUser validates the signature/identity after this structural check.
  // Never advertise a shorter lifetime than the signed token actually grants.
  let claims;
  try { const parts=raw.access_token.split('.'); if(parts.length!==3)throw Error();
    claims=JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/'))); } catch { throw Error('AUTH_SESSION_INVALID'); }
  const seconds=Math.floor(now/1000);
  if(credentialClaim(claims)||claims.aud!=='authenticated'||typeof claims.sub!=='string'||!Number.isSafeInteger(claims.exp)
    ||claims.exp<=seconds||claims.exp>seconds+900||Math.abs(claims.exp-(seconds+raw.expires_in))>5
    ||(raw.expires_at!==undefined&&raw.expires_at!==claims.exp))throw Error('AUTH_SESSION_INVALID');
  return { access_token: raw.access_token, refresh_token: raw.refresh_token,
    expires_at: claims.exp, user_id: claims.sub };
}
