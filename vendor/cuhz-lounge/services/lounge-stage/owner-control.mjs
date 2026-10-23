const numericId = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);

/** First live rehearsal restriction. The binding is trusted server configuration
 * taken from an authenticated owner identity, never a login, badge or request.
 * This is an additional denial gate; it cannot grant a session, role or lease.
 * Copy the scalar values so caller mutation cannot widen a running instance. */
export function createOwnerControlGate(config) {
  const enabled = config?.enabled === true;
  const ownerId = config?.twitchId;
  return Object.freeze({
    check(twitchId) {
      if (!enabled) return 'STAGE_CONTROL_DISABLED';
      if (!numericId(ownerId)) return 'STAGE_OWNER_UNCONFIGURED';
      if (!numericId(twitchId) || twitchId !== ownerId) return 'STAGE_OWNER_REQUIRED';
      return null;
    },
  });
}
