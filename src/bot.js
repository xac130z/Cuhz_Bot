const tmi = require('tmi.js');
const express = require('express');
const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

const startTime = new Date();

// --- Twitch Setup ---
let client;
let connectedChannels = new Set();
// Rotational Timers State
let timerIndices = new Map(); // channel -> index

// --- Content Data ---
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

async function initializeTwitchClient() {
    // Poll the dashboard for channels to join
    if (config.apiBase && config.botApiSecret) {
        try {
            logger.info(`Attempting to connect to dashboard at: ${config.apiBase}`);
            const response = await axios.get(`${config.apiBase}/api/bot/channels`, {
                headers: { 'Authorization': `Bearer ${config.botApiSecret}` }
            });

            if (response.data && response.data.channels && response.data.channels.length > 0) {
                const channelNames = response.data.channels.map(ch => ch.name);
                logger.info(`Found ${channelNames.length} channels to join from dashboard:`, channelNames);
                client = createClient(channelNames);
            } else {
                logger.info('No channels returned from dashboard, falling back to config.');
            }
        } catch (error) {
            logger.error('Error fetching channels from dashboard:', error.message);
        }
    }

    // Fallback
    if (!client) {
        logger.info(`Connecting to Twitch with Username: ${config.username}`);
        client = createClient(config.channels);
    }

    client.connect().catch(err => logger.error('Twitch connection error:', err));
    setupEventHandlers();
}

function createClient(channels) {
    return new tmi.Client({
        options: { debug: true },
        identity: {
            username: config.username,
            password: config.oauthToken
        },
        channels: channels
    });
}

function setupEventHandlers() {
    client.on('connected', (addr, port) => {
        logger.info(`Connected to Twitch at ${addr}:${port}`);
    });

    client.on('join', async (channel, username, self) => {
        if (self && !connectedChannels.has(channel)) {
            connectedChannels.add(channel);
            logger.info(`Joined channel: ${channel}`);
            startRotationalTimer(channel);
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

function startRotationalTimer(channel) {
    // Initialize index for this channel
    timerIndices.set(channel, 0);

    // 12-minute interval (12 * 60 * 1000)
    setInterval(() => {
        if (client && client.readyState() === 'OPEN') {
            const index = timerIndices.get(channel) || 0;
            const message = TIMER_MESSAGES[index];

            logger.info(`Sending timer msg to ${channel}: ${message}`);
            client.say(channel, message).catch(err => logger.error('Error sending timer msg:', err));

            // Rotate index
            const nextIndex = (index + 1) % TIMER_MESSAGES.length;
            timerIndices.set(channel, nextIndex);
        }
    }, 12 * 60 * 1000);

    logger.info(`Rotational timer initialized for ${channel} (12m interval)`);
}

async function handleMessage(channel, tags, message, self) {
    if (self) return;
    const msg = message.toLowerCase(); // keep original `message` for case-sensitive args

    // 1. Exact Match Public Commands
    if (PUBLIC_COMMANDS[msg]) {
        client.say(channel, PUBLIC_COMMANDS[msg]);
        return;
    }

    // 2. Dynamic / Special Public Commands
    if (msg === '!schedule' || msg === '!stream') {
        client.say(channel, `@${tags.username} 🗓 Check the schedule tab & turn on notifications for updates!`);
        return;
    }

    if (msg === '!hype') {
        const randomHype = HYPE_MESSAGES[Math.floor(Math.random() * HYPE_MESSAGES.length)];
        client.say(channel, randomHype);
        return;
    }

    if (msg === '!uptime') {
        const up = new Date() - startTime;
        const minutes = Math.floor((up / 1000) / 60);
        client.say(channel, `Stream uptime: Bot running for ${minutes} minutes. (Streamer uptime requires API)`);
        return;
    }

    // 3. Mod / Owner Commands
    const isMod = tags.mod || (tags.badges && tags.badges.broadcaster);

    if (msg.startsWith('!announce ') && isMod) {
        const announcement = message.substring(10); // keep original case
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
        client.say(channel, `✅ Bot Online. Uptime: ${Math.floor((new Date() - startTime) / 60000)}m. Ver: Non-Crypto v1.0`);
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
        channels: Array.from(connectedChannels)
    });
});

app.listen(config.port, () => {
    logger.info(`Bot API listening on port ${config.port}`);
    initializeTwitchClient();
});
