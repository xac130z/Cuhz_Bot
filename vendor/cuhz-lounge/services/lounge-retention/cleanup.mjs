import { randomUUID } from 'node:crypto';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CODES = new Set(['CLEANUP_DISABLED', 'INVALID_REQUEST', 'ISOLATION_UNSUPPORTED',
  'CLEANUP_CLAIM_REQUIRED', 'CLEANUP_ORIGIN_INVALID', 'CLEANUP_CAPACITY_REVIEW_REQUIRED']);
const keys = (value, expected) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && UUID.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 64;
const denial = value => keys(value, ['ok', 'code']) && value.ok === false && CODES.has(value.code);
const refused = code => ({ ok: false, code });

/** Canonical booking-identity cleanup only. Reuses the host minute timer.
 * Each query must autocommit; never retain SQL locks between claim and step.
 * Transport timeout does not cancel a query or prove rollback. Keep its flight
 * and claim ID until observed, with no later step issued by an expired run. */
export function createTwitchCleanup({ query, enabled = false, timeoutMs = 6000,
  randomId = randomUUID, now = Date.now } = {}) {
  if (typeof query !== 'function' || typeof randomId !== 'function' || typeof now !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw Error('TWITCH_CLEANUP_CONFIG_INVALID');
  let active = false, epoch = 0, flight = null, pending = null, last = null, lastCode = 'CLEANUP_DISABLED';
  const status = () => ({ enabled: active, running: flight !== null, pending: pending !== null,
    code: lastCode, lastCompletedAt: last?.at ?? null,
    bookingsRedacted: last?.bookingsRedacted ?? null, receiptsRedacted: last?.receiptsRedacted ?? null });
  async function run() {
    if (!active) return refused('CLEANUP_DISABLED');
    if (flight) return refused('CLEANUP_BUSY');
    if (!pending) {
      let claimId;
      try { claimId = randomId(); } catch { /* Never issue a query without a valid claim ID. */ }
      if (!uuid(claimId)) { lastCode = 'CLEANUP_UNAVAILABLE'; return refused(lastCode); }
      pending = { claimId, jobId: null };
    }
    const claim = pending, turn = epoch;
    let timer, timedOut = false;
    const current = () => active && turn === epoch && !timedOut;
    const operation = Promise.resolve().then(async () => {
      if (!current()) return refused('CLEANUP_STOPPED');
      let jobId = claim.jobId;
      if (!jobId) {
        const result = (await query('select public.lounge_twitch_cleanup_claim($1) result', [claim.claimId]))?.rows?.[0]?.result;
        if (!current()) return refused('CLEANUP_STOPPED');
        if (denial(result)) return refused(result.code);
        if (!keys(result, ['ok', 'job']) || result.ok !== true) throw Error('invalid');
        if (result.job === null) return { ok: true, empty: true };
        const job = result.job;
        if (!keys(job, ['id', 'claimId', 'expiresAt']) || !uuid(job.id) || job.claimId !== claim.claimId
          || typeof job.expiresAt !== 'string' || !Number.isFinite(Date.parse(job.expiresAt))) throw Error('invalid');
        // Only an observed claim can start a step. SQL, not the host clock,
        // decides whether the claim is still valid after its business waits.
        jobId = job.id;
        claim.jobId = jobId;
      }
      if (!current()) return refused('CLEANUP_STOPPED');
      const result = (await query('select public.lounge_twitch_cleanup_step($1,$2,$3) result', [jobId, claim.claimId, 64]))?.rows?.[0]?.result;
      if (!current()) return refused('CLEANUP_STOPPED');
      if (denial(result)) return refused(result.code);
      if (!keys(result, ['ok', 'jobId', 'state', 'bookingsRedacted', 'receiptsRedacted', 'remaining'])
        || result.ok !== true || result.jobId !== jobId || !['running', 'done'].includes(result.state)
        || !count(result.bookingsRedacted) || !count(result.receiptsRedacted)
        || result.bookingsRedacted + result.receiptsRedacted > 64 || typeof result.remaining !== 'boolean'
        || (result.state === 'done') !== !result.remaining) throw Error('invalid');
      return { ok: true, jobId, state: result.state, bookingsRedacted: result.bookingsRedacted,
        receiptsRedacted: result.receiptsRedacted, remaining: result.remaining };
    });
    flight = operation;
    const release = () => { if (flight === operation) flight = null; };
    void operation.then(release, release);
    try {
      const result = await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => { timedOut = true; reject(Error('timeout')); }, timeoutMs);
      })]);
      if (!active || turn !== epoch) return refused('CLEANUP_STOPPED');
      if (!result.ok) {
        lastCode = result.code;
        // SQL expired/unknown claims have no remaining authority. A new
        // claim can recover the same unfinished canonical task next minute.
        if (result.code === 'CLEANUP_CLAIM_REQUIRED') pending = null;
        return result;
      }
      if (result.empty === true) { pending = null; lastCode = 'CLEANUP_IDLE'; return result; }
      if (result.state === 'done') pending = null;
      last = { at: new Date(now()).toISOString(), bookingsRedacted: result.bookingsRedacted,
        receiptsRedacted: result.receiptsRedacted };
      lastCode = result.state === 'done' ? 'CLEANUP_SCOPED_DONE' : 'CLEANUP_MORE';
      return result;
    } catch {
      if (!active || turn !== epoch) return refused('CLEANUP_STOPPED');
      lastCode = 'CLEANUP_OUTCOME_UNKNOWN';
      return refused(lastCode);
    } finally { clearTimeout(timer); }
  }
  return Object.freeze({ run, status,
    start(ready) { if (enabled === true && ready === true && !active) { active = true; epoch++; lastCode = 'CLEANUP_IDLE'; } },
    stop() { active = false; epoch++; lastCode = 'CLEANUP_DISABLED'; } });
}
