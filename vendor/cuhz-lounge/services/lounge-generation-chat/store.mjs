/** Server-only DB port. No tokens or arbitrary actor IDs cross the browser API. */
export function createGenerationChatStore({ query } = {}) {
  if (typeof query !== 'function') throw Error('CHAT_GENERATION_CONFIG_INVALID');
  const one = async (sql, args) => (await query(sql, args)).rows?.[0] ?? null;
  return Object.freeze({
    // query must autocommit these independent bounded calls; do not wrap a
    // cleanup cycle in one transaction or retain locks across kinds.
    cleanup: async ({ isActive = () => true } = {}) => {
      const counts = {};
      for (const kind of ['receipts', 'briefs', 'preparations']) {
        if (!isActive()) break;
        counts[kind] = (await one('select public.lounge_generation_chat_cleanup($1,100) result', [kind]))?.result?.removed;
      }
      return counts;
    },
    prior: (userId, requestId) => one('select project_id,project_revision from public.lounge_generation_chat_preparations where user_id=$1 and id=$2', [userId, requestId]),
    project: (userId, projectId) => one(`select p.id,p.revision,p.archived_at,v.state from public.lounge_projects p
      join public.lounge_project_versions v on v.id=p.latest_version_id and v.user_id=p.user_id
      where p.user_id=$1 and p.id=$2`, [userId, projectId]),
    prepare: async ({ context, requestId, projectId, revision, inputText, fingerprint }) => (await one(
      'select public.lounge_generation_chat_prepare($1,$2,$3,$4,$5,$6,$7) result',
      [context.sessionId, context.sessionRevision, requestId, projectId, revision, inputText, fingerprint]))?.result,
    admit: async event => (await one('select public.lounge_generation_chat_execute($1,$2) result', [event.twitchId, event.operationKey]))?.result,
  });
}
