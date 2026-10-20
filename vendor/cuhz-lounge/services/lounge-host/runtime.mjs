import { createLoungeApplication } from '../lounge-goal2/runtime.mjs';
import { createSupabaseAuthPort } from '../lounge-auth/supabase.mjs';
import { createPrivateChatInbox } from '../lounge-chat-inbox/runtime.mjs';
import { hostConfig, databaseOptions } from './config.mjs';
import { createStoragePort } from './storage.mjs';
import { createEventSubIngress } from './eventsub.mjs';
import { createObsStreamAccess } from '../lounge-stage/obs-access.mjs';

const unavailable = code => new Response(JSON.stringify({ error: code }), { status: 503,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
/** Existing bot host entry. Separate Supabase SQL connection is intentional:
 * never point the Lounge schema at the bot's existing Points database.
 * Import/factory construction never migrates, changes a flag, grants a role,
 * starts generation, registers EventSub, or speaks on stream. */
export async function createHostedLounge({ env = {}, db, sendPrivateReply, fetchImpl = globalThis.fetch,
  schedule = setInterval, cancel = clearInterval } = {}) {
  const config = hostConfig(env);
  if (!config.enabled) return Object.freeze({ start: async () => ({ started: false }), stop: async () => {},
    handle: async () => unavailable('LOUNGE_DISABLED') });
  let pool, stopped = false, running = false, epoch = 0, pending, timer;
  if (!db) {
    const connection = databaseOptions(config.databaseUrl);
    const { Pool } = await import('pg');
    pool = new Pool({ ...connection, max: 2, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000, statement_timeout: 5000, query_timeout: 6000,
      application_name: 'cuhz-lounge' });
    // No raw connection errors: messages can include connection credentials.
    pool.on('error', () => {});
    db = pool;
  }
  if (typeof db.query !== 'function') throw Error('LOUNGE_DATABASE_CONFIG_REQUIRED');
  const query = async (sql, args) => {
    if (stopped) throw Error('LOUNGE_UNAVAILABLE');
    const result = await db.query(sql, args);
    if (stopped) throw Error('LOUNGE_OUTCOME_UNKNOWN');
    return result;
  };
  const upstreams = new Set();
  const guardedFetch = async (url, options = {}) => {
    if (stopped || options.signal?.aborted) throw Error('LOUNGE_UNAVAILABLE');
    const controller = new AbortController(), abort = () => controller.abort();
    upstreams.add(controller); options.signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => { upstreams.delete(controller); options.signal?.removeEventListener('abort', abort); };
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      if (stopped || controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw Error('LOUNGE_UNAVAILABLE'); }
      if (!response.body) { cleanup(); return response; }
      const reader = response.body.getReader();
      const stream = new ReadableStream({
        async pull(output) {
          try {
            if (stopped || controller.signal.aborted) throw Error('LOUNGE_UNAVAILABLE');
            const part = await reader.read();
            if (stopped || controller.signal.aborted) throw Error('LOUNGE_UNAVAILABLE');
            if (part.done) { cleanup(); output.close(); } else output.enqueue(part.value);
          } catch { cleanup(); controller.abort(); void reader.cancel().catch(() => {}); output.error(Error('LOUNGE_UNAVAILABLE')); }
        },
        cancel() { cleanup(); controller.abort(); return reader.cancel(); },
      });
      return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch { cleanup(); controller.abort(); throw Error('LOUNGE_UNAVAILABLE'); }
  };
  let app;
  const inbox = createPrivateChatInbox({ query, origin: config.origin, enabled: true,
    authenticate: request => app.auth.authenticate(request) });
  const storage = config.bucket && config.storageKey
    ? createStoragePort({ url: config.supabaseUrl, bucket: config.bucket, serviceKey: config.storageKey, fetchImpl: guardedFetch }) : {};
  app = createLoungeApplication({ db: { query }, origin: config.origin, authKey: config.authKey,
    authUpstream: createSupabaseAuthPort({ url: config.supabaseUrl, publishableKey: config.publishableKey, fetchImpl: guardedFetch }),
    requiredRulesVersion: config.rulesVersion, flags: config.flags, ...storage,
    eventSubSecret: config.eventSubSecret, sendPrivateReply: sendPrivateReply ?? inbox.sendPrivateReply,
    obsAccess: config.obsKey ? createObsStreamAccess({ key: config.obsKey, origin: config.origin }) : null,
    getGenerationConfig: () => ({ enabled: false }) });
  const webhook = createEventSubIngress({ secret: config.eventSubSecret, subscriptionId: config.subscriptionId,
    store: {
      async revoked(id) {
        const value = (await query('select exists(select 1 from public.lounge_eventsub_revocations where subscription_id=$1) as revoked', [id])).rows?.[0]?.revoked;
        if (typeof value !== 'boolean') throw Error('CHAT_TRANSPORT_UNAVAILABLE');
        return value;
      },
      async revoke({ id, status, messageId, occurredAt }) {
        await query(`insert into public.lounge_eventsub_revocations(subscription_id,status,message_id,occurred_at)
          values($1,$2,$3,$4) on conflict(subscription_id) do nothing`, [id, status, messageId, occurredAt]);
      },
    },
    handleNotification: request => app.handle(request) });
  async function start() {
    if (stopped) return { started: false };
    if (running) return { started: true };
    if (pending) return pending;
    const turn = epoch;
    const task = (async () => {
      try {
        const result = await query(`select (r.rolsuper or r.rolbypassrls) as privileged,
          current_setting('transaction_isolation')='read committed' as isolation_ok,
          to_regclass('public.lounge_auth_sessions') is not null as auth_ready,
          to_regclass('public.lounge_stage_state') is not null as stage_ready,
          to_regclass('public.lounge_members') is not null as members_ready,
          to_regclass('public.lounge_chat_inbox') is not null as inbox_ready,
          to_regclass('public.lounge_eventsub_revocations') is not null as eventsub_ready,
          to_regprocedure('public.lounge_chat_inbox_send(text,text,text)') is not null
            and to_regprocedure('public.lounge_chat_inbox_read(uuid,integer,uuid,text)') is not null
            and to_regprocedure('public.lounge_chat_inbox_cleanup(integer)') is not null as inbox_rpc_ready,
          to_regprocedure('public.lounge_stage_apply(uuid,integer,integer,jsonb,boolean,boolean)') is not null
            and to_regprocedure('public.lounge_stage_chat_prepare(text,text,jsonb)') is not null
            and to_regprocedure('public.lounge_stage_public(boolean,boolean)') is not null as stage_rpc_ready
          from pg_roles r where r.rolname=current_user`);
        const row = result.rows?.[0];
        if (!row || !['privileged', 'isolation_ok', 'auth_ready', 'stage_ready', 'members_ready', 'inbox_ready', 'eventsub_ready', 'inbox_rpc_ready', 'stage_rpc_ready'].every(key => row[key] === true)) throw Error('LOUNGE_SCHEMA_REVIEW_REQUIRED');
        if (stopped || turn !== epoch) return { started: false };
        app.start(); running = true;
        timer = schedule(() => {
          if (!running || stopped || turn !== epoch) return;
          // Bounded SQL routines own cleanup; this never retries a paid job.
          void Promise.allSettled([app.auth.cleanup(), inbox.cleanup()]);
        }, 60000);
        timer?.unref?.();
        return { started: true, generationEnabled: false };
      } catch { if (stopped || turn !== epoch) return { started: false }; throw Error('LOUNGE_HOST_START_UNAVAILABLE'); }
    })();
    pending = task;
    try { return await task; } finally { if (pending === task) pending = null; }
  }
  async function stop() {
    if (stopped) return;
    stopped = true; running = false; epoch++;
    if (timer !== undefined) cancel(timer);
    for (const controller of upstreams) controller.abort();
    await app.stop();
    if (pool) await pool.end();
  }
  async function handle(request) {
    if (!running || stopped) return unavailable('LOUNGE_UNAVAILABLE');
    const turn = epoch;
    try {
      const url = new URL(request.url);
      if (url.origin !== config.origin) return new Response(null, { status: 403 });
      let response;
      if (url.pathname.startsWith('/api/lounge/v2/chat/')) response = await inbox.handle(request);
      else if (url.pathname === '/api/lounge/v2/stage/chat') {
        if (url.search) return new Response(null, { status: 404 });
        response = await webhook(request);
      }
      else response = await app.handle(request);
      if (stopped || turn !== epoch) { void response.body?.cancel().catch(() => {}); return unavailable('LOUNGE_OUTCOME_UNKNOWN'); }
      return response;
    } catch { return unavailable('LOUNGE_UNAVAILABLE'); }
  }
  return Object.freeze({ start, stop, handle });
}
