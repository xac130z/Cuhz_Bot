/** Pure identity shape validation shared by the callback and trusted servers.
 * Callers still have to authenticate online; this does not verify a token. */
const numericId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Supabase's identity row `id` can be a UUID. Prefer the immutable provider_id
 * and require agreement with the provider subject. Numeric legacy `id` is
 * supported only if provider_id is absent. Editable user_metadata is ignored. */
export function verifiedTwitchIdentity(user) {
  if (!uuid(user?.id) || !Array.isArray(user?.identities)) return null;
  const identities = user.identities.filter(row => row?.provider === 'twitch');
  if (identities.length !== 1) return null;
  const identity = identities[0];
  const subject = identity.identity_data?.sub;
  const providerId = identity.provider_id == null ? identity.id : identity.provider_id;
  if (!numericId(subject) || !numericId(providerId) || subject !== providerId) return null;
  if (identity.user_id != null && identity.user_id !== user.id) return null;
  return Object.freeze({ userId: user.id, twitchId: subject });
}
