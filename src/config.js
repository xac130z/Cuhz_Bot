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

    // Testing / Mocking
    useMockApi: process.env.USE_MOCK_API === 'true',
    twitchApiBase: process.env.USE_MOCK_API === 'true' ? 'http://localhost:3001/helix' : 'https://api.twitch.tv/helix',
    twitchAuthBase: process.env.USE_MOCK_API === 'true' ? 'http://localhost:3001/auth' : 'https://id.twitch.tv/oauth2',

    // AI Settings
    geminiApiKey: process.env.GEMINI_API_KEY,
    enableMoodDetection: process.env.ENABLE_MOOD_DETECTION !== 'false',
    enableContextAware: process.env.ENABLE_CONTEXT_AWARE !== 'false',
    moodAnalysisInterval: parseInt(process.env.MOOD_ANALYSIS_INTERVAL) || 120, // seconds
    aiResponseTimeout: parseInt(process.env.AI_RESPONSE_TIMEOUT) || 3000, // ms
    contextBufferSize: parseInt(process.env.CONTEXT_BUFFER_SIZE) || 20, // messages

    // Server config
    port: process.env.PORT || 3000
};
