const fail = () => { throw Error('LOUNGE_HOST_CONFIG_INVALID'); };
const flag = (env, name) => {
  if (env[name] !== undefined && !['true', 'false', ''].includes(env[name])) fail();
  return env[name] === 'true';
};
const required = (env, name) => typeof env[name] === 'string' && env[name].trim() ? env[name] : fail();
const origin = value => {
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.origin !== value) fail(); return value; }
  catch { fail(); }
};
/** Values stay server-side. Parsing never opens a connection or changes flags. */
export function hostConfig(env = {}) {
  if (!flag(env, 'LOUNGE_V2_ENABLED')) return Object.freeze({ enabled: false });
  const sealingKey = required(env, 'LOUNGE_AUTH_SEALING_KEY');
  if (!/^[A-Za-z0-9_-]{43}$/.test(sealingKey)) fail();
  const authKey = Buffer.from(sealingKey, 'base64url');
  if (authKey.length !== 32 || authKey.toString('base64url') !== sealingKey) fail();
  const eventSubSecret = required(env, 'LOUNGE_EVENTSUB_SECRET');
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(eventSubSecret)) fail();
  const subscriptionId = env.LOUNGE_EVENTSUB_SUBSCRIPTION_ID || null;
  if (subscriptionId !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(subscriptionId)) fail();
  const rulesVersion = required(env, 'LOUNGE_RULES_VERSION');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(rulesVersion)) fail();
  // Admission of paid work needs the still-pending funded dollar policy. A
  // deployment of chat/stage wiring must not implicitly activate a provider.
  if (flag(env, 'LOUNGE_GENERATION_CHAT_ENABLED')) throw Error('LOUNGE_FUNDED_ADMISSION_REQUIRED');
  // Existing P1 membership verification must be mounted explicitly, rather
  // than accepting a badge or stale membership row as an online check.
  if (flag(env, 'LOUNGE_SUBSCRIPTION_ENABLED')) throw Error('LOUNGE_SUBSCRIPTION_MONITOR_REQUIRED');
  const stageBridge = flag(env, 'LOUNGE_STAGE_BRIDGE_ENABLED');
  const bucket = env.LOUNGE_STORAGE_BUCKET || null;
  const storageKey = env.LOUNGE_STORAGE_SERVICE_KEY || null;
  if ((bucket !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(bucket)) || (stageBridge && (!bucket || !storageKey))) fail();
  return Object.freeze({ enabled: true, origin: origin(required(env, 'LOUNGE_PUBLIC_ORIGIN')),
    supabaseUrl: origin(required(env, 'LOUNGE_SUPABASE_URL')),
    publishableKey: required(env, 'LOUNGE_SUPABASE_PUBLISHABLE_KEY'),
    databaseUrl: env.LOUNGE_DATABASE_URL || null, authKey, eventSubSecret, subscriptionId, rulesVersion,
    bucket, storageKey, flags: Object.freeze({ auth: true, eligibility: true,
      pilot: flag(env, 'LOUNGE_PILOT_ENABLED'), subscription: false,
      pilotManagement: flag(env, 'LOUNGE_PILOT_MANAGEMENT_ENABLED'),
      stage: flag(env, 'LOUNGE_STAGE_ENABLED'), stageBridge, generationChat: false }) });
}

export function databaseOptions(value) {
  let url; try { url = new URL(value); } catch { throw Error('LOUNGE_DATABASE_CONFIG_REQUIRED'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2
    || [...url.searchParams].some(([key, mode]) => key !== 'sslmode' || !['require', 'verify-ca', 'verify-full'].includes(mode))
    || url.searchParams.getAll('sslmode').length > 1) throw Error('LOUNGE_DATABASE_CONFIG_REQUIRED');
  // pg parses TLS URL options after its explicit ssl object. Remove the sole
  // accepted hint so it cannot override certificate + hostname verification.
  url.search = '';
  return { connectionString: url.href, ssl: { rejectUnauthorized: true } };
}
