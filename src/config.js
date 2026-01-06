require('dotenv').config();

// Map Railway environment variables to bot config
module.exports = {
    // Twitch credentials
    oauthToken: process.env.BOT_OAUTH_TOKEN,
    username: process.env.BOT_USERNAME,
    channels: process.env.TWITCH_CHANNEL_NAME
        ? process.env.TWITCH_CHANNEL_NAME.split(',').map(ch => ch.trim()).filter(ch => ch.length > 0)
        : [],

    // Dashboard integration
    dashboardUrl: process.env.DASHBOARD_URL,
    apiBase: process.env.USE_MOCK_API === 'true'
        ? 'http://localhost:3001'
        : process.env.API_BASE,
    botApiSecret: process.env.BOT_API_SECRET,
    webhookToken: process.env.WEBHOOK_TOKEN,
    webhookUrl: process.env.WEBHOOK_URL,

    // Server config
    port: process.env.PORT || 3000
};
