const PREFLIGHT = 'public.lounge_command_preflight(uuid,integer,integer,text,text,uuid,text)';
const FRONTIER = 'public.lounge_command_frontier_open()';
const SWEEP = 'public.lounge_command_retention_sweep(integer)';
const CAPABILITIES = `select to_regclass('public.lounge_command_retention_state') is not null as installed,
  to_regprocedure('${PREFLIGHT}') is not null as preflight,
  to_regprocedure('${FRONTIER}') is not null as frontier,
  to_regprocedure('${SWEEP}') is not null as sweep`;
const PORTS = new Set(['bridge.import', 'bridge.review', 'bridge.decide', 'bridge.revoke', 'curated.import', 'curated.review']);
const REFUSALS = new Set(['COMMAND_RETIRED', 'COMMAND_CAPACITY_REVIEW_REQUIRED', 'INVALID_REQUEST',
  'ISOLATION_UNSUPPORTED', 'SIGN_IN_REQUIRED', 'SESSION_RECHECK_REQUIRED', 'OPERATOR_REQUIRED',
  'OWNER_BINDING_REQUIRED', 'CURATED_DISABLED', 'OWNER_REQUIRED', 'CONNECTION_CHANGED', 'RULES_REQUIRED']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const keys = (value, expected) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));

/** Shape validation only; a preflight never replaces final SQL authorization. */
export function commandPreflightResult(value) {
  if (keys(value, ['ok', 'state']) && value.ok === true && ['fresh', 'replay'].includes(value.state)) return { ok: true, state: value.state };
  if (keys(value, ['ok', 'code']) && value.ok === false && REFUSALS.has(value.code)) return { ok: false, code: value.code };
  return undefined;
}

/** Private prepared-query port. An entirely absent protocol is an older
 * schema; a partial protocol, malformed result or SQL error fails closed.
 * Capability results are never cached across a migration or restore. */
export function createCommandRetentionPort({ query, unavailableCode = 'BRIDGE_UNAVAILABLE' } = {}) {
  if (typeof query !== 'function' || !['BRIDGE_UNAVAILABLE', 'ASSET_UNAVAILABLE'].includes(unavailableCode)) {
    throw Error('COMMAND_PORT_CONFIG_INVALID');
  }
  const unavailable = () => Object.assign(Error(unavailableCode), { code: unavailableCode });
  const one = async (sql, args = []) => (await query(sql, args))?.rows?.[0];
  async function supported() {
    const value = await one(CAPABILITIES);
    if (!keys(value, ['installed', 'preflight', 'frontier', 'sweep'])
      || !Object.values(value).every(item => typeof item === 'boolean')) throw unavailable();
    if (Object.values(value).every(item => item === false)) return false;
    if (!Object.values(value).every(item => item === true)) throw unavailable();
    return true;
  }
  async function preflight({ context, connectionRevision = null, ownerId = null, rulesVersion = null, requestId, port } = {}) {
    try {
      if (!PORTS.has(port) || typeof requestId !== 'string' || !UUID.test(requestId)
        || typeof context?.sessionId !== 'string' || !UUID.test(context.sessionId)
        || !Number.isInteger(context.sessionRevision) || context.sessionRevision < 1) throw unavailable();
      if (!await supported()) return null;
      const value = (await one('select public.lounge_command_preflight($1::uuid,$2::integer,$3::integer,$4::text,$5::text,$6::uuid,$7::text) result',
        [context.sessionId, context.sessionRevision, connectionRevision, ownerId, rulesVersion, requestId, port]))?.result;
      const parsed = commandPreflightResult(value);
      if (parsed) return parsed;
      throw unavailable();
    } catch { throw unavailable(); }
  }
  async function frontierOpen() {
    try {
      if (!await supported()) return true;
      const value = (await one('select public.lounge_command_frontier_open() as open'))?.open;
      if (typeof value !== 'boolean') throw unavailable();
      return value;
    } catch { throw unavailable(); }
  }
  return Object.freeze({ preflight, frontierOpen });
}
