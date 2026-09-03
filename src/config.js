require('dotenv').config();

// Map Railway environment variables to bot config
module.exports = {
    // Twitch credentials
    oauthToken: process.env.BOT_OAUTH_TOKEN,
    username: process.env.BOT_USERNAME,
    channels: process.env.TWITCH_CHANNEL_NAME
        ? process.env.TWITCH_CHANNEL_NAME.split(',').map(ch => {
            const clean = ch.trim().toLowerCase();
            return clean.startsWith('#') ? clean : `#${clean}`;
        }).filter(ch => ch.length > 1)
        : [],

    // Dashboard integration
    dashboardUrl: process.env.DASHBOARD_URL,
    apiBase: process.env.USE_MOCK_API === 'true'
        ? 'http://localhost:3001'
        : process.env.API_BASE,
    botApiSecret: process.env.BOT_API_SECRET,
    webhookToken: process.env.WEBHOOK_TOKEN,
    webhookUrl: process.env.WEBHOOK_URL,

    // Planet Cuhz site integration (viewer tier entitlement sync — src/tier_service.js).
    // DELIBERATELY separate from BOT_API_SECRET/apiBase above: those point at the
    // created.app dashboard, a different trust domain. SITE_API_* target the Supabase
    // `bot-worker-sync` edge function (functions base URL + that function's own
    // BOT_API_SECRET). Never reuse or confuse the two.
    siteApiUrl: process.env.SITE_API_URL,        // e.g. https://<ref>.functions.supabase.co
    siteApiSecret: process.env.SITE_API_SECRET,  // = the site's BOT_API_SECRET value
    // Two independent honest-state switches — secure-off by default like every
    // other flag here. Unset (or any value other than the literal string 'true')
    // means OFF. Nothing in tier_service.js runs (no network call, no db write,
    // no chat line, no timer) until an owner sets these to 'true' in Railway.
    //   ENABLE_TIER_SYNC          — viewer tier lookup + monthly Silver/Gold stipends
    //   ENABLE_PURCHASE_SHOUTOUTS — live-gated purchase thank-you announcements
    // NOTE: ENABLE_COMMERCE_COMMANDS (the !plans/!silver/!gold command family) is
    // NOT wired here — that registry was not harvested this pass (stale pre-ladder-v2
    // copy in the source branch; see tier_service.js header). Left unimplemented on
    // purpose rather than shipped unsafe.
    enableTierSync: process.env.ENABLE_TIER_SYNC === 'true',
    enablePurchaseShoutouts: process.env.ENABLE_PURCHASE_SHOUTOUTS === 'true',

    // Testing / Mocking
    useMockApi: process.env.USE_MOCK_API === 'true',
    twitchApiBase: process.env.USE_MOCK_API === 'true' ? 'http://localhost:3001/helix' : 'https://api.twitch.tv/helix',
    twitchAuthBase: process.env.USE_MOCK_API === 'true' ? 'http://localhost:3001/auth' : 'https://id.twitch.tv/oauth2',

    // AI Settings — Tri-Brain Architecture
    geminiApiKey: process.env.GEMINI_API_KEY,        // The Eyes (speed, chat, sentiment)
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,  // The Brain (complex decisions, moderation)
    groqApiKey: process.env.GROQ_API_KEY,            // The Hands (Qwen via Groq — code, logic)
    qwenApiKey: process.env.QWEN_API_KEY,            // Legacy Qwen direct (DashScope fallback)
    enableMoodDetection: process.env.ENABLE_MOOD_DETECTION !== 'false',
    enableContextAware: process.env.ENABLE_CONTEXT_AWARE !== 'false',
    moodAnalysisInterval: parseInt(process.env.MOOD_ANALYSIS_INTERVAL) || 120, // seconds
    // 10000ms default: gemini-3.6-flash is a thinking model and regularly needs
    // >3s (3000ms caused a continuous timeout storm in production). NOTE: the
    // AI_RESPONSE_TIMEOUT env var still overrides this — Railway may have 3000
    // set; clear/raise it there or this default won't take effect.
    aiResponseTimeout: parseInt(process.env.AI_RESPONSE_TIMEOUT) || 10000, // ms
    contextBufferSize: parseInt(process.env.CONTEXT_BUFFER_SIZE) || 20, // messages

    // Server config
    port: process.env.PORT || 3000
};
