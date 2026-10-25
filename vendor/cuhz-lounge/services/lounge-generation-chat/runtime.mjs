import { isTrustedAuthContext } from '../lounge-auth/runtime.mjs';
import { isTrustedChatEvent } from '../lounge-stage/chat.mjs';
import { UUID, parseInput, fingerprint } from '../../supabase/functions/lounge-generate/core.mjs';
const fail = code => Object.assign(Error(code), { code });
const codes = new Set(['CHAT_GENERATION_DISABLED','CHAT_EVENT_RETIRED','CHAT_REPLAY_CAPACITY_REVIEW_REQUIRED','CHAT_PROTOCOL_RETIRED','INVALID_REQUEST','IDEMPOTENCY_CONFLICT','PROJECT_REVISION_REQUIRED',
  'REFERENCES_REQUIRE_WEBSITE','INVALID_BRIEF','ELIGIBILITY_REQUIRED','WEBSITE_SESSION_REQUIRED','PREPARED_BRIEF_REQUIRED',
  'PREPARED_BRIEF_CHANGED','WEBSITE_REQUEST_PENDING','IMAGE_POLICY_REQUIRED','IMAGE_ALLOWANCE_REQUIRED','IMAGE_LIMIT_REACHED',
  'GENERATION_IN_FLIGHT','WORKER_BUDGET_REQUIRED','WORKER_BATCH_BUDGET_EXHAUSTED','TWITCH_IDENTITY_REQUIRED']);
const requestShape = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => ['requestId','projectId','revision','confirm'].includes(key))
  && UUID.test(value.requestId || '') && UUID.test(value.projectId || '')
  && Number.isInteger(value.revision) && value.revision >= 1 && value.revision <= 90 && value.confirm === true;
/** No timers/listeners on import and no provider imports. Explicit start and both process/SQL
 * flags are required. A chat command never grants publishing or stage control. */
export function createGenerationChatRuntime({ store, getConfig, sendPrivateReply, enabled = false,
  now = Date.now, timeoutMs = 5000, cleanupIntervalMs = 60_000 } = {}) {
  if (!store?.prior || !store?.project || !store?.prepare || !store?.admit || !store?.cleanup || typeof getConfig !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000
    || !Number.isInteger(cleanupIntervalMs) || cleanupIntervalMs < 10 || cleanupIntervalMs > 60_000) throw fail('CHAT_GENERATION_CONFIG_INVALID');
  let active = false, epoch = 0, cleanupTimer = null, cleaning = false; const limits = new Map();
  const bounded = async (work, code = 'CHAT_GENERATION_UNAVAILABLE') => {
    let timer; try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(fail(code)), timeoutMs);
    })]); } finally { clearTimeout(timer); }
  };
  const current = run => { if (!enabled || !active || run !== epoch) throw fail('CHAT_GENERATION_DISABLED'); };
  const config = () => { const value = getConfig();
    if (!value?.enabled || value.mode !== 'queue' || value.workerEnabled !== true || value.model !== 'gpt-image-2.5-sunburst'
      || value.quality !== 'medium') throw fail('CHAT_GENERATION_DISABLED'); return value; };
  const trusted = context => isTrustedAuthContext(context) && context.verifiedAt <= now() && now() - context.verifiedAt < 60_000;
  const status = value => codes.has(value) ? value : 'CHAT_GENERATION_UNAVAILABLE';
  async function prepare(context, input) {
    const run = epoch; current(run); const policy = config();
    if (!trusted(context)) throw fail('WEBSITE_SESSION_REQUIRED');
    if (!requestShape(input)) throw fail('INVALID_REQUEST');
    const requestId = input.requestId.toLowerCase(), projectId = input.projectId.toLowerCase();
    const prior = await bounded(() => store.prior(context.userId, requestId)); current(run);
    let identity = { hash: '', description: {} };
    if (!prior) {
      const project = await bounded(() => store.project(context.userId, projectId)); current(run);
      if (!project || project.id !== projectId || project.archived_at != null || project.revision !== input.revision) throw fail('PROJECT_REVISION_REQUIRED');
      if (!Array.isArray(project.state?.references) || project.state.references.length) throw fail('REFERENCES_REQUIRE_WEBSITE');
      let parsed; try { parsed = parseInput({ request_id: requestId, prompt: project.state.prompt, kind: project.state.kind,
        size: project.state.size, background: project.state.background, references: [] }); } catch { throw fail('INVALID_BRIEF'); }
      identity = await fingerprint(parsed, policy); current(run);
    }
    if (!trusted(context)) throw fail('WEBSITE_SESSION_REQUIRED'); config();
    const result = await bounded(() => store.prepare({ context, requestId, projectId, revision: input.revision,
      inputText: JSON.stringify(identity.description), fingerprint: identity.hash }), 'CHAT_PREPARATION_UNKNOWN');
    if (run !== epoch || !active) throw fail('CHAT_PREPARATION_UNKNOWN');
    if (result?.ok !== true) return { ok: false, code: status(result?.code) };
    if (result.request_id !== requestId || typeof result.prepared !== 'boolean' || !Number.isFinite(Date.parse(result.expires_at))) throw fail('CHAT_PREPARATION_UNKNOWN');
    return { ok: true, requestId, prepared: result.prepared, expiresAt: result.expires_at, replayed: result.replayed === true,
      command: '!lounge create', batchSize: 3, publishesAutomatically: false };
  }
  async function handleChat(event) {
    const run = epoch;
    try {
      current(run);
      if (!isTrustedChatEvent(event) || event.verifiedAt > now() || now() - event.verifiedAt >= 60_000
        || !/^!lounge\s+create$/i.test(event.text.trim())) return { ok: false, code: 'UNTRUSTED_CHAT' };
      // Need a private status channel BEFORE admission. Public chat never gets
      // prompts, project IDs, account IDs, signed URLs or private receipt data.
      if (typeof sendPrivateReply !== 'function') return { ok: false, code: 'PRIVATE_REPLY_UNAVAILABLE' };
      const stamp = now(); for (const [key, times] of limits) if (stamp - times.at(-1) >= 10_000) limits.delete(key);
      const recent = (limits.get(event.twitchId) || []).filter(time => stamp - time < 10_000);
      if (recent.length >= 4 || (limits.size >= 1000 && !limits.has(event.twitchId))) return { ok: false, code: 'RATE_LIMITED' };
      limits.set(event.twitchId, [...recent, stamp]);
      config();
      const raw = await bounded(() => store.admit(event), 'CHAT_GENERATION_UNKNOWN');
      if (run !== epoch || !active) throw fail('CHAT_GENERATION_UNKNOWN');
      const accepted = raw?.ok === true && raw.code === 'QUEUED' && raw.batch_size === 3 && UUID.test(raw.request_id || '');
      if (raw?.ok === true && !accepted) throw fail('CHAT_GENERATION_UNKNOWN');
      const code = accepted ? 'QUEUED' : status(raw?.code);
      const text = accepted ? 'Your prepared three-image request is queued. Check the private Lounge library for its receipt. Publishing is separate.'
        : 'Creation was not accepted. Open the Lounge to check your saved brief, session and allowance before trying again.';
      // Failed reply delivery never reverses or retries a committed admission.
      try { await bounded(() => sendPrivateReply({ twitchId: event.twitchId, operationKey: event.operationKey, text })); }
      catch { return { ok: accepted, code, privateReplyDelivered: false }; }
      return { ok: accepted, code, privateReplyDelivered: true };
    } catch (error) { return { ok: false, code: ['CHAT_GENERATION_UNKNOWN','CHAT_GENERATION_DISABLED'].includes(error?.code) ? error.code : 'CHAT_GENERATION_UNAVAILABLE' }; }
  }
  async function cleanup() {
    if (!active || cleaning) return; cleaning = true; const run = epoch;
    try { await bounded(() => store.cleanup({ isActive: () => active && epoch === run })); } catch { /* No paid work is retried; next bounded retention tick may retry. */ }
    finally { cleaning = false; }
  }
  return Object.freeze({ prepare, handleChat, cleanup, start() {
    if (!enabled) return { started: false }; if (active) return { started: true }; active = true; epoch++;
    cleanupTimer = setInterval(() => { void cleanup(); }, cleanupIntervalMs); cleanupTimer.unref?.(); void cleanup();
    return { started: true };
  }, stop() { active = false; epoch++; if (cleanupTimer) clearInterval(cleanupTimer); cleanupTimer = null; limits.clear(); } });
}
