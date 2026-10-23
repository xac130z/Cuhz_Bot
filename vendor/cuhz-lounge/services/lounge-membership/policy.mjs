/** Server-only policy. Evidence MUST come from online auth, the private Twitch
 * verifier and owner-scoped database reads, never from a browser/IRC payload.
 * This pure evaluator does not itself verify tokens or commit a reservation. */
import { verifiedTwitchIdentity } from './identity.mjs';
export { verifiedTwitchIdentity } from './identity.mjs';

export const CUHZ_BOT_CHANNEL_ID = '175727753';
export const MEMBERSHIP_FRESH_MS = 60_000;
export const BOOKING_FRESH_MS = 15_000;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fresh = (at, now, ttl) => Number.isSafeInteger(at) && at <= now && now - at < ttl;
const deny = reason => Object.freeze({ allowed: false, reason, authorizesPaidGeneration: false });


function verifiedPrincipal(auth, now) {
  if (!Number.isSafeInteger(now) || now < 1) return deny('CLOCK_INVALID');
  if (auth?.source !== 'supabase-online' || auth.status !== 'verified') return deny('SIGN_IN_REQUIRED');
  if (!fresh(auth.checkedAt, now, MEMBERSHIP_FRESH_MS)) return deny('IDENTITY_RECHECK_REQUIRED');
  const principal = verifiedTwitchIdentity(auth.user);
  return principal ? { allowed: true, principal } : deny('TWITCH_IDENTITY_REQUIRED');
}

/** An active paid/gifted/Prime subscription counts alike when Twitch confirms
 * it. A Twitch identity, founder/mod badge, Stripe plan, points balance, pilot
 * grant or nickname alone never establishes this membership. */
export function evaluateLoungeMembership({ auth, subscription, terms } = {}, {
  now = Date.now(), broadcasterId = CUHZ_BOT_CHANNEL_ID, requiredTermsVersion,
} = {}) {
  if (broadcasterId !== CUHZ_BOT_CHANNEL_ID) return deny('MEMBERSHIP_CONFIG_INVALID');
  const verified = verifiedPrincipal(auth, now);
  if (!verified.allowed) return verified;
  const { principal } = verified;
  if (subscription?.source !== 'helix-broadcaster-subscriptions'
    || subscription.broadcasterId !== broadcasterId || subscription.userId !== principal.twitchId) {
    return deny('SUBSCRIPTION_RECHECK_REQUIRED');
  }
  if (!fresh(subscription.checkedAt, now, MEMBERSHIP_FRESH_MS)
    || !['active', 'inactive'].includes(subscription.status)) return deny('SUBSCRIPTION_RECHECK_REQUIRED');
  if (subscription.status !== 'active') return deny('SUBSCRIPTION_REQUIRED');
  // Terms acceptance is a record of the user's consent, not subscription proof.
  if (requiredTermsVersion != null && (!requiredTermsVersion || terms?.userId !== principal.userId
    || terms.version !== requiredTermsVersion || !Number.isSafeInteger(terms.acceptedAt)
    || terms.acceptedAt < 1 || terms.acceptedAt > now)) return deny('TERMS_REQUIRED');
  return Object.freeze({ allowed: true, reason: 'MEMBER', principal,
    validUntil: Math.min(auth.checkedAt, subscription.checkedAt) + MEMBERSHIP_FRESH_MS,
    authorizesPaidGeneration: false });
}

/** Track A deliberately requires no stage booking. This is eligibility only;
 * the existing queue must atomically reserve funded compute and allowance. */
export function evaluateLoungeGenerationEligibility(evidence = {}, options = {}) {
  return evaluateLoungeMembership(evidence, options);
}

/** Track B booked control is common to web and chat. There is deliberately no admin,
 * broadcaster or moderator bypass in the member policy. Safety/emergency
 * operator actions belong to a separate audited permission path. */
export function evaluateBookedLoungeControl(evidence = {}, options = {}) {
  const now = options.now ?? Date.now();
  const membership = evaluateLoungeMembership(evidence, { ...options, now });
  if (!membership.allowed) return membership;
  const snapshot = evidence.booking;
  if (snapshot?.source !== 'lounge-booking-store' || !fresh(snapshot.checkedAt, now, BOOKING_FRESH_MS)) {
    return deny('BOOKING_RECHECK_REQUIRED');
  }
  const booking = snapshot.booking;
  if (!booking) return deny('BOOKING_REQUIRED');
  if (typeof options.resourceId !== 'string' || !options.resourceId.trim()) return deny('BOOKING_CONFIG_INVALID');
  if (!uuid(booking.id) || booking.userId !== membership.principal.userId
    || booking.twitchUserId !== membership.principal.twitchId
    || booking.resourceId !== options.resourceId) return deny('BOOKING_OWNER_MISMATCH');
  if (booking.state !== 'active') return deny('BOOKING_NOT_ACTIVE');
  if (!Number.isSafeInteger(booking.revision) || booking.revision < 1) return deny('BOOKING_INVALID');
  if (!Number.isSafeInteger(booking.startsAt) || !Number.isSafeInteger(booking.endsAt)
    || booking.startsAt < 1 || booking.endsAt <= booking.startsAt) return deny('BOOKING_INVALID');
  if (now < booking.startsAt) return deny('BOOKING_NOT_STARTED');
  if (now >= booking.endsAt) return deny('BOOKING_ENDED');
  return Object.freeze({ allowed: true, reason: 'BOOKED_MEMBER', principal: membership.principal,
    bookingId: booking.id,
    bookingRevision: booking.revision,
    resourceId: booking.resourceId,
    validUntil: Math.min(membership.validUntil, snapshot.checkedAt + BOOKING_FRESH_MS, booking.endsAt),
    // API/points budgets are an additional atomic reservation, NOT implied by
    // paying Twitch or booking a time. A true allowed decision isn't a debit.
    authorizesPaidGeneration: false });
}

/** Existing creations remain recoverable by their owner after membership or a
 * booking ends. This does not grant edits, new generation or public sharing. */
export function evaluateOwnedLoungeAssetRead({ auth, assetOwnerUserId } = {}, { now = Date.now() } = {}) {
  const verified = verifiedPrincipal(auth, now);
  if (!verified.allowed) return verified;
  if (assetOwnerUserId !== verified.principal.userId) return deny('ASSET_NOT_FOUND');
  return Object.freeze({ allowed: true, reason: 'OWNED_ASSET', principal: verified.principal,
    authorizesPaidGeneration: false });
}
