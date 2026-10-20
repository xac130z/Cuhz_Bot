/** Server-only prepared-query adapter. SQL derives the actor from the broker
 * session and checks current role/identity; callers cannot post an actor ID. */
export function createPostgresEligibilityStore({ query } = {}) {
  if (typeof query !== 'function') throw Error('ELIGIBILITY_STORE_CONFIG_INVALID');
  const first = async (sql, values) => (await query(sql, values)).rows?.[0] ?? null;
  const rpc = async (sql, values) => (await first(sql, values))?.result;
  return {
    connection: userId => first('select user_id,twitch_user_id,connection_revision,disconnected_at,rules_accepted_version,rules_accepted_at from public.lounge_members where user_id=$1', [userId]),
    accept: ({ context, rulesVersion, acceptedAt, requestId }) => rpc('select public.lounge_eligibility_accept($1,$2,$3,$4,$5) result',
      [context.sessionId, context.sessionRevision, rulesVersion, acceptedAt, requestId]),
    check: ({ context, connectionRevision, rulesVersion, subscriptionEnabled, pilotEnabled }) => rpc(
      'select public.lounge_eligibility_check($1,$2,$3,$4,$5,$6) result',
      [context.sessionId, context.sessionRevision, connectionRevision, rulesVersion, subscriptionEnabled, pilotEnabled]),
    write: ({ context, action, requestId, rulesVersion, userId = null, twitchId = null,
      connectionRevision = null, timestamp = null, grantId = null, grantRevision = null, reason = null }) => rpc(
      'select public.lounge_pilot_write($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) result',
      [context.sessionId, context.sessionRevision, action, requestId, rulesVersion, userId, twitchId,
        connectionRevision, timestamp, grantId, grantRevision, reason]),
  };
}
