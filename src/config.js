const dotenv = require('dotenv');

// Load env vars
dotenv.config();

const requiredConfig = [
    'TWITCH_OAUTH_TOKEN',
    'TWITCH_CLIENT_ID',
    'TWITCH_BOT_USERNAME',
    'TWITCH_CHANNEL_NAME'
];

for (const config of requiredConfig) {
    if (!process.env[config]) {
        console.error(`Missing required environment variable: ${config}`);
        process.exit(1);
    }
}

module.exports = {
    oauthToken: process.env.TWITCH_OAUTH_TOKEN,
    clientId: process.env.TWITCH_CLIENT_ID,
    username: process.env.TWITCH_BOT_USERNAME,
    channels: [process.env.TWITCH_CHANNEL_NAME]
};
