import { isTrustedAuthContext } from '../lounge-auth/runtime.mjs';

export const ELIGIBILITY_FRESH_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TWITCH = /^[1-9][0-9]{0,19}$/;
const REASON = /^[A-Z][A-Z_]{0,63}$/;
const noAuthority = { authorizesPaidGeneration: false, authorizesStageControl: false };
const resolutions = new WeakSet();
const stamp = value => value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
const validTime = value => Number.isSafeInteger(value) && value > 0;
function finish(eligibility) {
  const result = Object.freeze({ ...eligibility, ...noAuthority });
  resolutions.add(result);
  return result;
}
const deny = code => finish({ allowed: false, path: null, code });
function validContext(context, now) {
  return isTrustedAuthContext(context) && UUID.test(context.sessionId) && UUID.test(context.userId)
    && TWITCH.test(context.twitchId) && Number.isSafeInteger(context.sessionRevision) && context.sessionRevision > 0
    && validTime(context.verifiedAt) && context.verifiedAt <= now && now - context.verifiedAt < ELIGIBILITY_FRESH_MS;
}
const safeCodes = new Set(['SIGN_IN_REQUIRED', 'SESSION_RECHECK_REQUIRED', 'LOUNGE_PASS_REQUIRED', 'MEMBER_DISCONNECTED',
  'CONNECTION_CHANGED', 'TERMS_REQUIRED', 'ELIGIBILITY_REQUIRED', 'OWNER_ROLE_REQUIRED', 'INVALID_REQUEST',
  'IDEMPOTENCY_CONFLICT', 'INVALID_FIRST_ATTENDED_TIME', 'PILOT_ALREADY_STARTED', 'INVALID_GRANT',
  'PILOT_WINDOW_CLOSED', 'INVALID_GRANT_EXPIRY', 'PILOT_GRANT_EXISTS', 'PILOT_CAPACITY_REACHED',
  'PILOT_IDENTITY_CHANGED', 'INVALID_REVOCATION', 'GRANT_NOT_FOUND', 'GRANT_REVISION_CONFLICT',
  'GRANT_REVOKED', 'PILOT_IDENTITY_OR_GRANT_CONFLICT']);

/** Eligibility is separate from subscription membership. The unchanged P1
 * verifier remains the only writer of Helix subscription evidence. This service
 * consumes its fresh durable evidence OR an explicit pilot grant; neither is a
 * booking, a stage lease, a funded reservation or permission to call a provider.
 * Runtime AND durable path flags are required, both default off. */
export function createLoungeEligibilityService({ store, requiredRulesVersion, pilotEnabled = false,
  subscriptionEnabled = false, managementEnabled = false, now = Date.now, timeoutMs = 5_000 } = {}) {
  if (!store || ['connection', 'check', 'write'].some(name => typeof store[name] !== 'function')
    || typeof requiredRulesVersion !== 'string' || !requiredRulesVersion.trim() || requiredRulesVersion.length > 100
    || typeof now !== 'function' || [pilotEnabled, subscriptionEnabled, managementEnabled].some(value => typeof value !== 'boolean')
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw Error('ELIGIBILITY_CONFIG_INVALID');
  async function call(method, input) {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(() => store[method](input)), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('deadline')), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function resolve(context) {
    if (!pilotEnabled && !subscriptionEnabled) return deny('ELIGIBILITY_DISABLED');
    const at = now();
    if (!validTime(at) || !validContext(context, at)) return deny('SESSION_RECHECK_REQUIRED');
    try {
      const connection = await call('connection', context.userId);
      if (!connection) return deny('LOUNGE_PASS_REQUIRED');
      if (connection.disconnected_at != null) return deny('MEMBER_DISCONNECTED');
      if (connection.user_id !== context.userId || connection.twitch_user_id !== context.twitchId
        || !Number.isSafeInteger(connection.connection_revision) || connection.connection_revision < 1) return deny('CONNECTION_CHANGED');
      if (connection.rules_accepted_version !== requiredRulesVersion || !validTime(stamp(connection.rules_accepted_at))
        || stamp(connection.rules_accepted_at) > now()) return deny('TERMS_REQUIRED');
      if (!validContext(context, now())) return deny('SESSION_RECHECK_REQUIRED');
      const result = await call('check', { context, connectionRevision: connection.connection_revision,
        rulesVersion: requiredRulesVersion, subscriptionEnabled, pilotEnabled });
      const current = now();
      if (!validContext(context, current)) return deny('SESSION_RECHECK_REQUIRED');
      if (result?.ok !== true || result.eligible !== true) return deny(safeCodes.has(result?.code) ? result.code : 'ELIGIBILITY_UNAVAILABLE');
      if ((result.path !== 'pilot' || !pilotEnabled) && (result.path !== 'subscription' || !subscriptionEnabled)) return deny('ELIGIBILITY_DISABLED');
      if (result.user_id !== context.userId || result.twitch_user_id !== context.twitchId
        || result.connection_revision !== connection.connection_revision) return deny('CONNECTION_CHANGED');
      const checkedAt = stamp(result.checked_at), storedUntil = stamp(result.valid_until);
      const validUntil = Math.min(storedUntil, context.verifiedAt + ELIGIBILITY_FRESH_MS);
      if (!validTime(checkedAt) || checkedAt > current || current - checkedAt >= ELIGIBILITY_FRESH_MS
        || !validTime(validUntil) || validUntil <= current || storedUntil > checkedAt + ELIGIBILITY_FRESH_MS) return deny('ELIGIBILITY_RECHECK_REQUIRED');
      return finish({ allowed: true, path: result.path, code: result.path === 'pilot' ? 'PILOT_ELIGIBLE' : 'SUBSCRIPTION_ELIGIBLE',
        checkedAt, validUntil });
    } catch { return deny('ELIGIBILITY_UNAVAILABLE'); }
  }
  async function write(context, action, input) {
    if (!managementEnabled) return Object.freeze({ ok: false, code: 'PILOT_MANAGEMENT_DISABLED', ...noAuthority });
    if (!validContext(context, now())) return Object.freeze({ ok: false, code: 'SESSION_RECHECK_REQUIRED', ...noAuthority });
    const keys = action === 'start' ? ['requestId', 'firstAttendedAt'] : action === 'issue'
      ? ['requestId', 'userId', 'twitchId', 'connectionRevision', 'expiresAt', 'reason']
      : ['requestId', 'grantId', 'grantRevision', 'reason'];
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))
      || !UUID.test(input.requestId || '')
      || (action === 'start' && !validTime(stamp(input.firstAttendedAt)))
      || (action === 'issue' && (!UUID.test(input.userId || '') || !TWITCH.test(input.twitchId || '')
        || !Number.isSafeInteger(input.connectionRevision) || input.connectionRevision < 1 || !validTime(stamp(input.expiresAt)) || !REASON.test(input.reason || '')))
      || (action === 'revoke' && (!UUID.test(input.grantId || '') || !Number.isSafeInteger(input.grantRevision)
        || input.grantRevision < 1 || !REASON.test(input.reason || '')))) return Object.freeze({ ok: false, code: 'INVALID_REQUEST', ...noAuthority });
    try {
      const result = await call('write', { context, action, requestId: input.requestId, rulesVersion: requiredRulesVersion,
        userId: input.userId, twitchId: input.twitchId, connectionRevision: input.connectionRevision,
        timestamp: action === 'start' ? input.firstAttendedAt : input.expiresAt,
        grantId: input.grantId, grantRevision: input.grantRevision, reason: input.reason });
      if (!validContext(context, now())) throw Error('uncertain');
      if (result?.ok !== true) return Object.freeze({ ok: false, code: safeCodes.has(result?.code) ? result.code : 'ELIGIBILITY_UNAVAILABLE', ...noAuthority });
      const expectedOperation = action === 'start' ? 'started' : action === 'issue' ? 'issued' : 'revoked';
      if (result.operation !== expectedOperation || (action !== 'start' && (!UUID.test(result.grant_id || '')
        || result.grant_revision !== (action === 'issue' ? 1 : 2)))
        || (action === 'start' && (!validTime(stamp(result.starts_at)) || !validTime(stamp(result.ends_at))))
        || (action === 'issue' && !validTime(stamp(result.expires_at)))
        || (action === 'revoke' && !validTime(stamp(result.revoked_at)))) throw Error('invalid-receipt');
      // Administrative receipts report the original operation only. They are
      // never accepted as current eligibility and never restore a revoked grant.
      return Object.freeze({ ok: true, requestId: input.requestId, replayed: result.replayed === true,
        operation: result.operation, ...(result.grant_id ? { grantId: result.grant_id, grantRevision: result.grant_revision } : {}),
        ...(result.expires_at ? { expiresAt: result.expires_at } : {}),
        ...(result.starts_at ? { startsAt: result.starts_at, endsAt: result.ends_at } : {}),
        ...(result.revoked_at ? { revokedAt: result.revoked_at } : {}), ...noAuthority });
    } catch {
      return Object.freeze({ ok: false, code: 'PILOT_OUTCOME_UNKNOWN', requestId: input.requestId, ...noAuthority });
    }
  }
  return Object.freeze({ resolve, startPilot: (context, input) => write(context, 'start', input),
    issueGrant: (context, input) => write(context, 'issue', input), revokeGrant: (context, input) => write(context, 'revoke', input) });
}

/** Only a result issued by this module can reach its public projection. This
 * remains a status snapshot: downstream mutations MUST recheck in SQL. */
export function publicEligibilityStatus(resolution, now = Date.now()) {
  if (!resolutions.has(resolution)) return { eligible: false, code: 'ELIGIBILITY_UNAVAILABLE', ...noAuthority };
  if (resolution.allowed && (!validTime(now) || now < resolution.checkedAt || now >= resolution.validUntil)) {
    return { eligible: false, code: 'ELIGIBILITY_RECHECK_REQUIRED', ...noAuthority };
  }
  return { eligible: resolution.allowed, code: resolution.code, path: resolution.path,
    ...(resolution.allowed ? { validUntil: resolution.validUntil } : {}), ...noAuthority };
}
