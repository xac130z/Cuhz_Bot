import { isTrustedAuthContext } from '../lounge-auth/runtime.mjs';

/** Same database and broker as the Lounge. Actor IDs never come from JSON.
 * Prepared calls recheck current session, immutable identity and owner role.
 * Constructing the port opens no connection and changes no feature flags. */
export function createChainStore({ query, ownerTwitchId, rulesVersion } = {}) {
  if (typeof query !== 'function' || typeof rulesVersion !== 'string' || !rulesVersion || rulesVersion.length > 100
    || !(ownerTwitchId === null || /^[1-9][0-9]{0,19}$/.test(ownerTwitchId || ''))) throw Error('CHAIN_STORE_CONFIG_INVALID');
  const actor = context => {
    if (!isTrustedAuthContext(context) || !Number.isFinite(context.verifiedAt)) throw Error('CHAIN_CONTEXT_UNTRUSTED');
    return [context.sessionId, context.sessionRevision, new Date(context.verifiedAt).toISOString()];
  };
  return Object.freeze({
    async command(context, input) {
      const result = await query('select public.lounge_chain_command($1,$2,$3,$4,$5,$6::jsonb) result',
        [...actor(context), ownerTwitchId, rulesVersion, JSON.stringify(input)]);
      return result.rows?.[0]?.result;
    },
    async putAsset(context, metadata, bytes) {
      const result = await query('select public.lounge_chain_asset_put($1,$2,$3,$4,$5,$6::jsonb,$7) result',
        [...actor(context), ownerTwitchId, rulesVersion, JSON.stringify(metadata), bytes]);
      return result.rows?.[0]?.result;
    },
    async readAsset(context, hash) {
      return (await query('select result,content from public.lounge_chain_asset_read($1,$2,$3,$4)', [...actor(context), hash])).rows?.[0];
    },
  });
}
