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

    // Planet Cuhz site integration (stream commerce / tier sync — Wave 6).
    // DELIBERATELY separate from BOT_API_SECRET/API_BASE above: those point at the
    // created.app dashboard, a different trust domain. SITE_API_* target the Supabase
    // `bot-worker-sync` edge function (functions base URL + that function's own
    // BOT_API_SECRET). Never reuse or confuse the two.
    siteApiUrl: process.env.SITE_API_URL,        // e.g. https://<ref>.functions.supabase.co
    siteApiSecret: process.env.SITE_API_SECRET,  // = the site's BOT_API_SECRET value
    // Three independent honest-state switches — secure-off by default like every
    // other flag here. Nothing here changes chat behavior until the owner flips them.
    enableTierSync: process.env.ENABLE_TIER_SYNC === 'true',
    enableCommerceCommands: process.env.ENABLE_COMMERCE_COMMANDS === 'true',
    enablePurchaseShoutouts: process.env.ENABLE_PURCHASE_SHOUTOUTS === 'true',
    // Unpublished perk — the ladder promises stipends, not multipliers. Stays OFF
    // until the owner publishes it; never advertise an unpublished perk.
    enableGoldPoints2x: process.env.ENABLE_GOLD_POINTS_2X === 'true',

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
    enableProactiveAi: process.env.ENABLE_PROACTIVE_AI === 'true',
    enableVoice: process.env.ENABLE_CUHZ_VOICE === 'true',
    enableChatPayments: process.env.ENABLE_CHAT_PAYMENTS === 'true',
    enableGambling: process.env.ENABLE_GAMBLING === 'true',
    moodAnalysisInterval: parseInt(process.env.MOOD_ANALYSIS_INTERVAL) || 120, // seconds
    aiResponseTimeout: parseInt(process.env.AI_RESPONSE_TIMEOUT) || 3000, // ms
    contextBufferSize: parseInt(process.env.CONTEXT_BUFFER_SIZE) || 20, // messages
    storeChatContent: process.env.STORE_CHAT_CONTENT === 'true',
    chatRetentionDays: Math.max(1, Math.min(30, parseInt(process.env.CHAT_RETENTION_DAYS, 10) || 7)),

    // Server config
    port: process.env.PORT || 3000
};
