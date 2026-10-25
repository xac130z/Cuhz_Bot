const keys = (value, expected) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 64;
const codes = new Set(['COMMAND_RETENTION_DISABLED', 'INVALID_REQUEST', 'ISOLATION_UNSUPPORTED']);
const refused = code => ({ ok: false, code });
const WINDOW_MS = 720 * 60 * 60 * 1000;

/** Bounded log erasure, not a business command or a maintenance-command journal.
 * Queries autocommit. A lost response means unknown counts; a later sweep may
 * safely continue, but cannot overlap an outstanding physical SQL call. */
export function createCommandRetention({ query, enabled = false, timeoutMs = 6000 } = {}) {
  if (typeof query !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw Error('COMMAND_RETENTION_CONFIG_INVALID');
  }
  let active = false, epoch = 0, flight = null, last = null, code = 'COMMAND_RETENTION_DISABLED';
  const status = () => ({ enabled: active, running: flight !== null, code,
    observedAt: last?.observedAt ?? null, cutoff: last?.cutoff ?? null,
    removedAudit: last?.removedAudit ?? null, removedStage: last?.removedStage ?? null,
    removedBridge: last?.removedBridge ?? null, hasMore: last?.hasMore ?? null });
  async function run() {
    if (!active) return refused('COMMAND_RETENTION_DISABLED');
    if (flight) return refused('COMMAND_RETENTION_BUSY');
    const turn = epoch;
    let timer;
    const operation = Promise.resolve().then(() => {
      if (!active || turn !== epoch) throw Error('stopped');
      return query('select public.lounge_command_retention_sweep($1) result', [64]);
    });
    flight = operation;
    const release = () => { if (flight === operation) flight = null; };
    void operation.then(release, release);
    try {
      const row = await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('timeout')), timeoutMs);
      })]);
      if (!active || turn !== epoch) return refused('COMMAND_RETENTION_STOPPED');
      const value = row?.rows?.[0]?.result;
      if (keys(value, ['ok', 'code']) && value.ok === false && codes.has(value.code)) {
        code = value.code; return refused(code);
      }
      if (!keys(value, ['ok', 'observedAt', 'cutoff', 'removedAudit', 'removedStage', 'removedBridge', 'hasMore'])
        || value.ok !== true || typeof value.observedAt !== 'string' || typeof value.cutoff !== 'string'
        || !Number.isFinite(Date.parse(value.observedAt)) || !Number.isFinite(Date.parse(value.cutoff))
        || Date.parse(value.observedAt) - Date.parse(value.cutoff) !== WINDOW_MS
        || !['removedAudit', 'removedStage', 'removedBridge'].every(key => count(value[key]))
        || value.removedAudit + value.removedStage + value.removedBridge > 64 || typeof value.hasMore !== 'boolean') throw Error('invalid');
      last = { observedAt: value.observedAt, cutoff: value.cutoff, removedAudit: value.removedAudit,
        removedStage: value.removedStage, removedBridge: value.removedBridge, hasMore: value.hasMore };
      code = value.hasMore ? 'COMMAND_RETENTION_MORE' : 'COMMAND_RETENTION_OBSERVED';
      return { ok: true, ...last };
    } catch {
      if (!active || turn !== epoch) return refused('COMMAND_RETENTION_STOPPED');
      code = 'COMMAND_RETENTION_OUTCOME_UNKNOWN'; return refused(code);
    } finally { clearTimeout(timer); }
  }
  return Object.freeze({ run, status,
    start(ready) { if (enabled === true && ready === true && !active) { active = true; epoch++; code = 'COMMAND_RETENTION_IDLE'; } },
    stop() { active = false; epoch++; code = 'COMMAND_RETENTION_DISABLED'; } });
}
