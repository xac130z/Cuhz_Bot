import { isTrustedAuthContext } from '../lounge-auth/runtime.mjs';

/** Prepared-query port for the existing database. Only live broker contexts can
 * enter this adapter; SQL rechecks the session and derives the actor itself. */
export function createBookingTransportStore({ query, requiredRulesVersion, allowSubscription = false, allowPilot = false } = {}) {
  if (typeof query !== 'function' || typeof requiredRulesVersion !== 'string'
    || !requiredRulesVersion.trim() || requiredRulesVersion.length > 100) throw Error('BOOKING_STORE_CONFIG_INVALID');
  async function execute(context, command) {
    if (!isTrustedAuthContext(context) || !Number.isFinite(context.verifiedAt)) throw Error('BOOKING_CONTEXT_UNTRUSTED');
    return (await query('select public.lounge_booking_transport($1,$2,$3,$4,$5::jsonb,$6,$7) result',
      [context.sessionId, context.sessionRevision, new Date(context.verifiedAt).toISOString(), requiredRulesVersion,
        JSON.stringify(command), allowSubscription === true, allowPilot === true])).rows?.[0]?.result;
  }
  return Object.freeze({ read: context => execute(context, { action: 'list' }), write: execute });
}
