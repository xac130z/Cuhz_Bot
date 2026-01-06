const tmi = require('tmi.js');
const express = require('express');
const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

const startTime = new Date();

// --- Twitch Setup ---
let client;
let connectedChannels = new Set();

// State
let timerIndices = new Map(); // channel -> index
let streamStates = new Map(); // channel -> { isLive: boolean, startedAt: Date, title: string }
let twitchClientId = null; // Fetched dynamically

// --- Content Data (Non-Crypto) ---
const PUBLIC_COMMANDS = {
    '!cuhz': '🚀 https://planetcuhz.com',
    '!links': '🔗 https://linktr.ee/PlanetCUHZ',
    '!discord': '💬 https://discord.gg/5rFRaeBuHn',
    '!whatiscuhz': '🌌 Planet CUHZ is the creator ecosystem. Start here → https://planetcuhz.com',
    '!faq': '🌌 Planet CUHZ is the creator ecosystem. Start here → https://planetcuhz.com',
    '!whitepaper': '📄 https://planetcuhz.com/whitepaper',
    '!roadmap': '🧭 https://planetcuhz.com/whitepaper#roadmap',
    '!rules': '📌 Be respectful. No hate. No spam. Stay CUHZ. Full rules → https://planetcuhz.com/rules',
    '!privacy': '🔒 Privacy & security → https://planetcuhz.com/privacy',
    '!cuhzchain': '🔗 CUHZ Chain Generator → https://cuhz-bot-dashboard-846.created.app/chain-generator',
    '!chain': '🔗 CUHZ Chain Generator → https://cuhz-bot-dashboard-846.created.app/chain-generator',
    '!store': '🛒 Official CUHZ drops → https://planetcuhz.com/store',
    '!merch': '🛒 Official CUHZ drops → https://planetcuhz.com/store',
    '!gm': 'Good morning CUHZ ☀️',
    '!gn': 'Good night CUHZ 🌙',
    '!giveaway': '🎁 Giveaway status: Check Discord for active giveaways!',
    '!enter': 'Use the link in !giveaway or Discord to enter active giveaways.',
    '!help': '🌌 Planet CUHZ Commands: !cuhz !links !discord !whatiscuhz !whitepaper !roadmap !rules !privacy !cuhzchain !store !schedule !giveaway !gm !gn !hype !uptime | Mods: !announce !so !raid'
};

const HYPE_MESSAGES = [
    "Let's go CUHZ! 🚀",
    "Planet CUHZ in the building! 🌌",
    "Hype! Hype! Hype! 🔥",
    "Level up your content game! 💎",
    "Welcome to the Planet! 🌍"
];

const TIMER_MESSAGES = [
    "🌌 Planet CUHZ → https://planetcuhz.com",
    "🔗 All links → https://linktr.ee/PlanetCUHZ",
    "💬 Join the Discord → https://discord.gg/5rFRaeBuHn",
    "📄 Whitepaper → https://planetcuhz.com/whitepaper",
    "🔗 CUHZ Chain Generator → https://cuhz-bot-dashboard-846.created.app/chain-generator"
];

// --- Twitch API Helpers ---

async function fetchClientId() {
    if (twitchClientId) return twitchClientId;

    try {
        logger.info('Fetching Client ID validation...');
        const authBase = config.twitchAuthBase || 'https://id.twitch.tv/oauth2';
        // Pass token without 'oauth:' prefix if present
        const token = config.oauthToken.replace('oauth:', '');

        const response = await axios.get(`${authBase}/validate`, {
            headers: {
                'Authorization': `OAuth ${token}`
            }
        });

        if (response.data && response.data.client_id) {
            twitchClientId = response.data.client_id;
            logger.info(`Client ID fetched successfully: ${twitchClientId}`);
            return twitchClientId;
        }
    } catch (error) {
        logger.error('Error fetching Client ID from token validation:', error.message);
        return null;
    }
}

async function checkStreamStatus(channelName) {
    if (!twitchClientId) await fetchClientId();
    if (!twitchClientId) return null;

    try {
        const apiBase = config.twitchApiBase || 'https://api.twitch.tv/helix';
        const cleanName = channelName.replace('#', '');
        const token = config.oauthToken.replace('oauth:', '');

        const response = await axios.get(`${apiBase}/streams?user_login=${cleanName}`, {
            headers: {
                'Client-ID': twitchClientId,
                'Authorization': `Bearer ${token}`
            }
        });

        const data = response.data.data;
        if (data && data.length > 0) {
            // Stream is live
            const stream = data[0];
            return {
                isLive: true,
                startedAt: new Date(stream.started_at),
                title: stream.title,
                game: stream.game_name
            };
        } else {
            return { isLive: false };
        }
    } catch (error) {
        logger.error(`Error checking stream status for ${channelName}:`, error.message);
        return null; // Keep previous state on error
    }
}

// --- Bot Logic ---

async function initializeTwitchClient() {
    // 1. Fetch Client ID early for API calls
    await fetchClientId();

    // 2. Poll the dashboard for channels to join
    let channelsToJoin = [];

    if (config.apiBase && config.botApiSecret) {
        try {
            logger.info(`Attempting to connect to dashboard at: ${config.apiBase}`);
            const response = await axios.get(`${config.apiBase}/api/bot/channels`, {
                headers: { 'Authorization': `Bearer ${config.botApiSecret}` }
            });

            if (response.data && response.data.channels && response.data.channels.length > 0) {
                channelsToJoin = response.data.channels.map(ch => ch.name);
                logger.info(`Found ${channelsToJoin.length} channels to join from dashboard:`, channelsToJoin);
            } else {
                logger.info('No channels returned from dashboard, checking config.');
            }
        } catch (error) {
            logger.error('Error fetching channels from dashboard:', error.message);
        }
    }

    // Fallback to config if no dashboard channels
    if (channelsToJoin.length === 0 && config.channels && config.channels.length > 0) {
        channelsToJoin = config.channels;
        logger.info(`Using channels from config:`, channelsToJoin);
    }

    if (channelsToJoin.length === 0) {
        logger.warn('No channels configured to join!');
    }

    // 3. Create Client
    client = new tmi.Client({
        options: { debug: true },
        identity: {
            username: config.username,
            password: config.oauthToken
        },
        channels: channelsToJoin
    });

    client.connect().catch(err => logger.error('Twitch connection error:', err));
    setupEventHandlers();
}

function setupEventHandlers() {
    client.on('connected', (addr, port) => {
        logger.info(`Connected to Twitch at ${addr}:${port}`);
    });

    client.on('join', async (channel, username, self) => {
        if (self && !connectedChannels.has(channel)) {
            connectedChannels.add(channel);
            logger.info(`Joined channel: ${channel}`);

            // Start Timers & Status Checks
            startRotationalTimer(channel);
            startStreamPoller(channel);

            verifyJoin(channel);
        }
    });

    client.on('message', handleMessage);
}

async function verifyJoin(channel) {
    if (config.apiBase && config.botApiSecret) {
        try {
            await axios.post(`${config.apiBase}/api/bot/verify`, {
                channel: channel.replace('#', ''),
                status: 'active'
            }, {
                headers: { 'Authorization': `Bearer ${config.botApiSecret}` }
            });
        } catch (error) {
            logger.error('Error verifying channel join:', error.message);
        }
    }
}

function startStreamPoller(channel) {
    // Check immediately
    updateStreamState(channel);

    // Poll every 60 seconds
    setInterval(() => {
        updateStreamState(channel);
    }, 60000);
}

async function updateStreamState(channel) {
    const status = await checkStreamStatus(channel);
    if (status) {
        streamStates.set(channel, status);
        // Optional: log state change
        // logger.debug(`Stream state for ${channel}: ${status.isLive ? 'LIVE' : 'OFFLINE'}`);
    }
}

function startRotationalTimer(channel) {
    timerIndices.set(channel, 0);

    // 12-minute interval
    setInterval(() => {
        if (client && client.readyState() === 'OPEN') {
            // Smart Check: Only send if stream is LIVE
            const state = streamStates.get(channel);
            const isLive = state ? state.isLive : false; // Default to false if unknown to avoid spam

            // Allow sending if Mock API is enabled (for testing) OR actually live
            const shouldSend = config.useMockApi || isLive;

            if (shouldSend) {
                const index = timerIndices.get(channel) || 0;
                const message = TIMER_MESSAGES[index];

                client.say(channel, message).catch(err => logger.error('Error sending timer msg:', err));

                // Rotate
                const nextIndex = (index + 1) % TIMER_MESSAGES.length;
                timerIndices.set(channel, nextIndex);
            } else {
                // logger.debug(`Skipping timer for ${channel} (Stream Offline)`);
            }
        }
    }, 12 * 60 * 1000);

    logger.info(`Rotational timer initialized for ${channel} (Smart Mode: Live Only)`);
}

async function handleMessage(channel, tags, message, self) {
    if (self) return;
    const msg = message.toLowerCase();

    // 1. Exact Match Public Commands
    if (PUBLIC_COMMANDS[msg]) {
        client.say(channel, PUBLIC_COMMANDS[msg]);
        return;
    }

    // 2. Dynamic Commands
    if (msg === '!uptime') {
        const state = streamStates.get(channel);

        if (state && state.isLive && state.startedAt) {
            const diff = Date.now() - state.startedAt.getTime();
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff / (1000 * 60)) % 60);
            client.say(channel, `Stream has been live for ${hours}h ${minutes}m! 🔴`);
        } else {
            // Fallback to bot uptime if stream is offline (or unknown)
            const up = new Date() - startTime;
            const minutes = Math.floor((up / 1000) / 60);
            client.say(channel, `Stream is currently offline. Bot has been running for ${minutes} minutes.`);
        }
        return;
    }

    if (msg === '!schedule' || msg === '!stream') {
        client.say(channel, `@${tags.username} 🗓 Check the schedule tab & turn on notifications for updates!`);
        return;
    }

    if (msg === '!hype') {
        const randomHype = HYPE_MESSAGES[Math.floor(Math.random() * HYPE_MESSAGES.length)];
        client.say(channel, randomHype);
        return;
    }

    // 3. Mod / Owner Commands
    const isMod = tags.mod || (tags.badges && tags.badges.broadcaster);

    if (msg.startsWith('!announce ') && isMod) {
        const announcement = message.substring(10);
        client.say(channel, `/announce ${announcement}`);
        return;
    }

    if (msg.startsWith('!raid ') && isMod) {
        const target = message.split(' ')[1];
        if (target) client.say(channel, `/raid ${target}`);
        return;
    }

    if (msg.startsWith('!so ') && isMod) {
        const target = message.split(' ')[1];
        if (target) {
            const cleanTarget = target.replace('@', '');
            client.say(channel, `Big shoutout to @${cleanTarget}! Everyone check them out here: https://twitch.tv/${cleanTarget} 🚀`);
        }
        return;
    }

    if (msg === '!status' && tags.username === 'fourareason4') {
        const state = streamStates.get(channel);
        const liveStatus = state ? (state.isLive ? 'LIVE 🔴' : 'OFFLINE ⚫') : 'UNKNOWN ⚪';
        client.say(channel, `✅ Bot Online. Stream: ${liveStatus}. Ver: Non-Crypto v1.2 (Smart Mode)`);
        return;
    }

    // 4. Webhook Forwarding
    if (config.webhookUrl) {
        try {
            await axios.post(config.webhookUrl, {
                platform: 'twitch',
                channel: channel.replace('#', ''),
                user: tags.username,
                message: message,
                timestamp: new Date().toISOString()
            }, { headers: { 'Authorization': `Bearer ${config.webhookToken}` } });
        } catch (error) {
            logger.error('Webhook error:', error.message);
        }
    }
}

// --- Express Setup ---
const app = express();
app.use(express.json());

function verifyDashboardRequest(req, res, next) {
    // Simple verification - enhance as needed
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${config.botApiSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

app.post('/send-message', verifyDashboardRequest, (req, res) => {
    const { channel, message } = req.body;
    if (!client) return res.status(503).json({ error: 'Bot not connected' });

    const target = channel.startsWith('#') ? channel : `#${channel}`;
    client.say(target, message)
        .then(() => res.json({ status: 'success' }))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.post('/join-channel', verifyDashboardRequest, async (req, res) => {
    const { channel } = req.body;
    if (!client) return res.status(503).json({ error: 'Bot not connected' });

    try {
        await client.join(channel.startsWith('#') ? channel : `#${channel}`);
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/leave-channel', verifyDashboardRequest, async (req, res) => {
    const { channel } = req.body;
    if (!client) return res.status(503).json({ error: 'Bot not connected' });

    try {
        const target = channel.startsWith('#') ? channel : `#${channel}`;
        await client.part(target);
        connectedChannels.delete(target);
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        connected: client ? client.readyState() === 'OPEN' : false,
        channels: Array.from(connectedChannels),
        streamStates: Object.fromEntries(streamStates)
    });
});

app.listen(config.port, () => {
    logger.info(`Bot API listening on port ${config.port}`);
    initializeTwitchClient();
});
