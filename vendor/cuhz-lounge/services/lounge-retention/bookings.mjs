import { randomUUID } from 'node:crypto';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CODES = new Set(['CLEANUP_DISABLED', 'INVALID_REQUEST', 'ISOLATION_UNSUPPORTED',
  'IDEMPOTENCY_CONFLICT', 'CLEANUP_CAPACITY_REVIEW_REQUIRED']);
const keys = (value, expected) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 64;
const refused = code => ({ ok: false, code });

/** One separately autocommitted deadline sweep per existing host minute tick.
 * A timeout cannot prove rollback: retain the physical flight and original
 * request ID. Only SQL's database clock decides whether a booking is due. */
export function createRetiredBookingLifecycle({ query, enabled = false, timeoutMs = 6000,
  randomId = randomUUID, now = Date.now } = {}) {
  if (typeof query !== 'function' || typeof randomId !== 'function' || typeof now !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw Error('RETIRED_BOOKING_CONFIG_INVALID');
  let active = false, epoch = 0, flight = null, pending = null, last = null, lastCode = 'CLEANUP_DISABLED';
  const status = () => ({ enabled: active, running: flight !== null, pending: pending !== null,
    code: lastCode, lastCompletedAt: last?.at ?? null, processed: last?.processed ?? null });
  async function run() {
    if (!active) return refused('CLEANUP_DISABLED');
    if (flight) return refused('RETIRED_BOOKING_BUSY');
    if (!pending) {
      let id;
      try { id = randomId(); } catch { /* No SQL without a valid stable request ID. */ }
      if (typeof id !== 'string' || !UUID.test(id)) {
        lastCode = 'RETIRED_BOOKING_UNAVAILABLE'; return refused(lastCode);
      }
      pending = id;
    }
    const requestId = pending, turn = epoch;
    let timer;
    const operation = Promise.resolve().then(() => {
      if (!active || turn !== epoch) throw Error('stopped');
      return query('select public.lounge_twitch_cleanup_expire($1,$2) result', [requestId, 64]);
    });
    flight = operation;
    const release = () => { if (flight === operation) flight = null; };
    void operation.then(release, release);
    try {
      const row = await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('timeout')), timeoutMs);
      })]);
      if (!active || turn !== epoch) return refused('RETIRED_BOOKING_STOPPED');
      const result = row?.rows?.[0]?.result;
      if (keys(result, ['ok', 'code']) && result.ok === false && CODES.has(result.code)) {
        lastCode = result.code; return refused(result.code);
      }
      const r = result?.response;
      if (!keys(result, ['ok', 'replayed', 'response']) || result.ok !== true || typeof result.replayed !== 'boolean'
        || !keys(r, ['requestId', 'observedAt', 'processed', 'expired', 'noShows', 'completed', 'leasesRevoked', 'leasesRedacted', 'hasMore'])
        || r.requestId !== requestId || typeof r.observedAt !== 'string' || !Number.isFinite(Date.parse(r.observedAt))
        || !['processed', 'expired', 'noShows', 'completed', 'leasesRevoked', 'leasesRedacted'].every(key => count(r[key]))
        || r.processed !== r.expired + r.noShows + r.completed
        || typeof r.hasMore !== 'boolean') throw Error('invalid');
      const at = new Date(now()).toISOString();
      pending = null; last = { at, processed: r.processed };
      lastCode = r.hasMore ? 'RETIRED_BOOKING_MORE' : 'RETIRED_BOOKING_RECEIPTED';
      return { ok: true, replayed: result.replayed, response: { requestId, observedAt: r.observedAt,
        processed: r.processed, expired: r.expired, noShows: r.noShows, completed: r.completed,
        leasesRevoked: r.leasesRevoked, leasesRedacted: r.leasesRedacted, hasMore: r.hasMore } };
    } catch {
      if (!active || turn !== epoch) return refused('RETIRED_BOOKING_STOPPED');
      lastCode = 'RETIRED_BOOKING_OUTCOME_UNKNOWN'; return refused(lastCode);
    } finally { clearTimeout(timer); }
  }
  return Object.freeze({ run, status,
    start(ready) { if (enabled === true && ready === true && !active) { active = true; epoch++; lastCode = 'RETIRED_BOOKING_IDLE'; } },
    stop() { active = false; epoch++; lastCode = 'CLEANUP_DISABLED'; } });
}
