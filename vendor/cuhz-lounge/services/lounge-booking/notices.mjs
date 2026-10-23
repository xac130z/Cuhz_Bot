import { randomUUID } from 'node:crypto';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const exact = (v, keys) => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const count = v => Number.isSafeInteger(v) && v >= 0 && v <= 64;

/** No email/network or independent timer. The existing host minute timer owns
 * this single-flight dispatcher. Unknown results recover the same durable run. */
export function createBookingNotices({ query, enabled = false, timeoutMs = 6000, randomId = randomUUID } = {}) {
  if (typeof query !== 'function' || typeof randomId !== 'function' || typeof enabled !== 'boolean'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw Error('BOOKING_NOTICES_CONFIG_INVALID');
  let active = false, epoch = 0, flight = null, pending = null;
  async function run() {
    if (!active) return { ok: false, code: 'BOOKING_NOTICES_DISABLED' };
    if (flight) return { ok: false, code: 'BOOKING_NOTICES_BUSY' };
    if (!pending) {
      let id; try { id = randomId(); } catch { /* A malformed ID never reaches SQL. */ }
      if (!UUID.test(id || '')) return { ok: false, code: 'BOOKING_NOTICES_UNAVAILABLE' };
      pending = id;
    }
    const id = pending, turn = epoch;
    let timer, settled = false, finished = false;
    const operation = Promise.resolve().then(() => {
      if (!active || turn !== epoch) throw Error('stopped');
      return query('select public.lounge_booking_notices_dispatch($1,$2) result', [id, 64]);
    });
    flight = operation;
    const release = () => { settled = true; if (finished && flight === operation) flight = null; };
    void operation.then(release, release);
    try {
      const row = await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('timeout')), timeoutMs);
      })]);
      if (!active || turn !== epoch) return { ok: false, code: 'BOOKING_NOTICES_STOPPED' };
      const result = row?.rows?.[0]?.result, r = result?.response;
      if (!exact(result, ['ok', 'replayed', 'response']) || result.ok !== true || typeof result.replayed !== 'boolean'
        || !exact(r, ['requestId', 'observedAt', 'processed', 'delivered', 'suppressed', 'expired', 'removed', 'hasMore'])
        || r.requestId !== id || typeof r.observedAt !== 'string' || !Number.isFinite(Date.parse(r.observedAt))
        || !['processed', 'delivered', 'suppressed', 'expired', 'removed'].every(k => count(r[k]))
        || r.processed !== r.delivered + r.suppressed + r.expired || typeof r.hasMore !== 'boolean') throw Error('invalid response');
      pending = null;
      return result;
    } catch { return { ok: false, code: 'BOOKING_NOTICES_OUTCOME_UNKNOWN' }; }
    finally { clearTimeout(timer); finished = true; if (settled && flight === operation) flight = null; }
  }
  return Object.freeze({ run,
    start() { if (enabled && !active) { active = true; epoch++; } },
    stop() { active = false; epoch++; },
  });
}
