const tmi = require('tmi.js');
const express = require('express');
const axios = require('axios');
const config = require('./config');

// --- Twitch Setup ---
const client = new tmi.Client({
    options: { debug: true },
    identity: {
        username: config.username,
        password: config.oauthToken
    },
    channels: config.channels
});

client.connect().catch(console.error);

client.on('connected', (addr, port) => {
    console.log(`* Connected to Twitch at ${addr}:${port}`);
});

// Send message to dashboard whenever a chat message is received
client.on('message', async (channel, tags, message, self) => {
    if (self) return;

    console.log(`[${channel}] ${tags.username}: ${message}`);

    // Command handling (Basic)
    if (message.toLowerCase() === '!ping') {
        client.say(channel, `@${tags.username}, Pong!`);
    }

    // Forward to Anything.com Dashboard if URL is provided
    if (config.anythingUrl) {
        try {
            await axios.post(config.anythingUrl, {
                platform: 'twitch',
                channel: channel,
                user: tags.username,
                message: message,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error sending to dashboard:', error.message);
        }
    }
});

// --- Express Setup (API for Dashboard) ---
const app = express();
app.use(express.json());

// Handle incoming messages from the dashboard to Twitch
app.post('/send-message', (req, res) => {
    const { channel, message } = req.body;

    if (!channel || !message) {
        return res.status(400).json({ error: 'Missing channel or message' });
    }

    const targetChannel = channel.startsWith('#') ? channel : `#${channel}`;

    client.say(targetChannel, message)
        .then(() => {
            res.json({ status: 'success', message: 'Sent to Twitch' });
        })
        .catch(err => {
            res.status(500).json({ error: err.message });
        });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', connected: client.readyState() === 'OPEN' });
});

app.listen(config.port, () => {
    console.log(`* Bot API listening on port ${config.port}`);
});
