const tmi = require('tmi.js');
const express = require('express');
const axios = require('axios');
const config = require('./config');

// --- Twitch Setup ---
let client;
let connectedChannels = new Set();

async function initializeTwitchClient() {
    // Poll the dashboard for channels to join
    if (config.apiBase && config.botApiSecret) {
        try {
            const response = await axios.get(`${config.apiBase}/api/bot/channels`, {
                headers: {
                    'Authorization': `Bearer ${config.botApiSecret}`
                }
            });

            if (response.data && response.data.channels) {
                const channelNames = response.data.channels.map(ch => ch.name);
                console.log(`* Found ${channelNames.length} channels to join:`, channelNames);

                client = new tmi.Client({
                    options: { debug: true },
                    identity: {
                        username: config.username,
                        password: config.oauthToken
                    },
                    channels: channelNames
                });
            }
        } catch (error) {
            console.error('Error fetching channels from dashboard:', error.message);
        }
    }

    // Fallback to config channels if API call failed
    if (!client) {
        client = new tmi.Client({
            options: { debug: true },
            identity: {
                username: config.username,
                password: config.oauthToken
            },
            channels: config.channels
        });
    }

    client.connect().catch(console.error);

    client.on('connected', (addr, port) => {
        console.log(`* Connected to Twitch at ${addr}:${port}`);
    });

    // Verify channel join with dashboard
    client.on('join', async (channel, username, self) => {
        if (self && !connectedChannels.has(channel)) {
            connectedChannels.add(channel);
            console.log(`* Joined channel: ${channel}`);

            // Notify dashboard that we've joined
            if (config.apiBase && config.botApiSecret) {
                try {
                    await axios.post(`${config.apiBase}/api/bot/verify`, {
                        channel: channel.replace('#', ''),
                        status: 'active'
                    }, {
                        headers: {
                            'Authorization': `Bearer ${config.botApiSecret}`
                        }
                    });
                } catch (error) {
                    console.error('Error verifying channel join:', error.message);
                }
            }
        }
    });

    // Handle chat messages
    client.on('message', async (channel, tags, message, self) => {
        if (self) return;

        console.log(`[${channel}] ${tags.username}: ${message}`);

        // Basic ping command
        if (message.toLowerCase() === '!ping') {
            client.say(channel, `@${tags.username}, Pong!`);
        }

        // Forward to dashboard webhook if configured
        if (config.webhookUrl) {
            try {
                await axios.post(config.webhookUrl, {
                    platform: 'twitch',
                    channel: channel.replace('#', ''),
                    user: tags.username,
                    userId: tags['user-id'],
                    message: message,
                    timestamp: new Date().toISOString(),
                    tags: tags
                }, {
                    headers: {
                        'Authorization': `Bearer ${config.webhookToken}`
                    }
                });
            } catch (error) {
                console.error('Error sending to webhook:', error.message);
            }
        }

        // Process commands via dashboard API
        if (message.startsWith('!') && config.apiBase && config.botApiSecret) {
            try {
                const response = await axios.post(`${config.apiBase}/api/bot/command`, {
                    channel: channel.replace('#', ''),
                    user: tags.username,
                    command: message,
                    tags: tags
                }, {
                    headers: {
                        'Authorization': `Bearer ${config.botApiSecret}`
                    }
                });

                if (response.data && response.data.reply) {
                    client.say(channel, response.data.reply);
                }
            } catch (error) {
                // Silently fail for command processing - not all commands need dashboard
                console.log('Command not processed by dashboard:', message);
            }
        }
    });
}

// --- Express Setup (API for Dashboard) ---
const app = express();
app.use(express.json());

// Middleware to verify requests from dashboard
function verifyDashboardRequest(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${config.botApiSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// Handle incoming messages from the dashboard to Twitch
app.post('/send-message', verifyDashboardRequest, (req, res) => {
    const { channel, message } = req.body;

    if (!channel || !message) {
        return res.status(400).json({ error: 'Missing channel or message' });
    }

    const targetChannel = channel.startsWith('#') ? channel : `#${channel}`;

    if (!client) {
        return res.status(503).json({ error: 'Bot not connected to Twitch' });
    }

    client.say(targetChannel, message)
        .then(() => {
            res.json({ status: 'success', message: 'Sent to Twitch' });
        })
        .catch(err => {
            res.status(500).json({ error: err.message });
        });
});

// Join a new channel dynamically
app.post('/join-channel', verifyDashboardRequest, async (req, res) => {
    const { channel } = req.body;

    if (!channel) {
        return res.status(400).json({ error: 'Missing channel name' });
    }

    const targetChannel = channel.startsWith('#') ? channel : `#${channel}`;

    if (!client) {
        return res.status(503).json({ error: 'Bot not connected to Twitch' });
    }

    try {
        await client.join(targetChannel);
        res.json({ status: 'success', message: `Joined ${targetChannel}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Leave a channel
app.post('/leave-channel', verifyDashboardRequest, async (req, res) => {
    const { channel } = req.body;

    if (!channel) {
        return res.status(400).json({ error: 'Missing channel name' });
    }

    const targetChannel = channel.startsWith('#') ? channel : `#${channel}`;

    if (!client) {
        return res.status(503).json({ error: 'Bot not connected to Twitch' });
    }

    try {
        await client.part(targetChannel);
        connectedChannels.delete(targetChannel);
        res.json({ status: 'success', message: `Left ${targetChannel}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        connected: client ? client.readyState() === 'OPEN' : false,
        channels: Array.from(connectedChannels)
    });
});

// Start the server
app.listen(config.port, () => {
    console.log(`* Bot API listening on port ${config.port}`);
    console.log(`* Dashboard URL: ${config.dashboardUrl || 'Not configured'}`);
    console.log(`* API Base: ${config.apiBase || 'Not configured'}`);

    // Initialize Twitch client after server starts
    initializeTwitchClient();
});
