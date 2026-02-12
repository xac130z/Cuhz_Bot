const tmi = require('tmi.js');
const express = require('express');
const axios = require('axios');
const config = require('./config');
const logger = require('./logger');
const db = require('./database');
const aiService = require('./ai_service');
const moodTracker = require('./mood_tracker');
const contextHandler = require('./context_handler');
const userMemory = require('./user_memory');
const pointsService = require('./points_service');
const loyaltySystem = require('./loyalty');
const modIntel = require('./mod_intel');
const fs = require('fs');
const path = require('path');

// --- Global Error Handlers (Prevention) ---
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception thrown:', err.stack || err);
});

const startTime = new Date();

// --- Twitch Setup ---
let client;
let connectedChannels = new Set();

// State
let timerIndices = new Map(); // channel -> index
let streamStates = new Map(); // channel -> { isLive: boolean, startedAt: Date, title: string }
let channelConfigs = new Map(); // channel -> { timers: [], commands: {}, hype: [] }
let twitchClientId = null; // Fetched dynamically
let botUserId = null; // Captured during validation

// --- Content Data (Non-Crypto) ---
const PUBLIC_COMMANDS = {
    '!cuhz': '🚀 https://planetcuhz.com',
    '!links': '🔗 https://linktr.ee/PlanetCUHZ',
    '!discord': '💬 https://discord.gg/5rFRaeBuHn',
    '!whatiscuhz': '🌌 Planet CUHZ is the creator ecosystem. Start here → https://planetcuhz.com',
    '!faq': '🌌 Planet CUHZ is the creator ecosystem. Start here → https://planetcuhz.com',
    '!whitepaper': '📄 https://planetcuhz.com/whitepaper',
    '!roadmap': '🧭 https://planetcuhz.com/whitepaper#roadmap',
    '!rules': '📌 Be respectful. No hate. No spam. Stay CUHZ.',
    '!privacy': '🔒 Privacy & security → https://planetcuhz.com/privacy',
    '!cuhzchain': '🔗 CUHZ Chain Generator → https://cuhz-bot-dashboard-846.created.app/chain-generator',
    '!chain': '🔗 CUHZ Chain Generator → https://cuhz-bot-dashboard-846.created.app/chain-generator',
    '!gm': 'Good morning CUHZ ☀️',
    '!gn': 'Good night CUHZ 🌙',
    '!giveaway': '🎁 Giveaway status: Check Discord for active giveaways!',
    '!enter': 'Use the link in !giveaway or Discord to enter active giveaways.',
    '!dashboard': '🎛️ Add CUHZ Bot to your channel → https://cuhz-bot-dashboard-846.created.app',
    '!pointsinfo': '💎 Earn Cuhz Points by chatting! Use them for AI commands: !ask (10-20), !code (25), or !ask -brain (50). Use !points to check balance and !top for the leaderboard!',
    '!help': '🌌 Commands: !cuhz !shoutouts !quote !4 !pointsinfo !points !top !claim !gamble !uptime !followage !links !discord | AI: !ask !code | Mods: !chatreport !mood !personality !so !raid | Ask a question naturally for AI help!'
};

const USER_COMMANDS = {
    '!ac': 'cuhz welcome back!',
    '!snow': 'can’t ban the snow man ☃️',
    '!mahni': '🏆',
    '!pnx': '☮️',
    '!rico': 'The heavy hitter is in the building! 💸',
    '!ec': 'Edward in the chat! Let’s get it. ⚡',
    '!rell': 'Rell is here, the vibes are up! 🔥',
    '!shock': 'Warning: High Voltage in the chat! ⚡',
    '!kay': 'Big Mula in the building! 💰',
    '!thorn': 'Watch out for the thorns! 🌹',
    '!limit': 'Taking it to the limit! 🚀',
    '!reacts': 'Reactions are LIVE! 👀',
    '!rock': 'Solid as a rock. 🪨',
    '!four': 'The Captain is here. 🫡',
    '!yoo': 'Yoo! Welcome to the stream. 👋',
    '!balen': 'Style has entered the chat. 💎',
    '!bot': 'Just a bot doing bot things. 🤖 Want to change a command message? Email SUPPORT@PLANETCUHZ.COM',
    '!shoutouts': 'Available Commands: !AC, !snow, !Mahni, !PNX, !Rico, !EC, !Rell, !Shock, !Kay, !Thorn, !Limit, !Reacts, !Rock, !Four, !Yoo, !Balen, !Bot. Want to change your message? Email SUPPORT@PLANETCUHZ.COM'
};

const HYPE_MESSAGES = [
    "Let's go CUHZ! 🚀",
    "Planet CUHZ in the building! 🌌",
    "Hype! Hype! Hype! 🔥",
    "Level up your content game! 💎",
    "Welcome to the Planet! 🌍"
];

const MOTIVATIONAL_QUOTES = [
    "Everything negative - pressure, challenges - is all an opportunity for me to rise. — Kobe Bryant 🐍",
    "Dedication sees dreams come true. — Kobe Bryant 🐍",
    "The most important thing is to try and inspire people so that they can be great in whatever they want to do. — Kobe Bryant 🐍",
    "I create my own path. It was straight and narrow. I looked at it this way: you were either in my way, or out of it. — Kobe Bryant 🐍",
    "If you do not believe in yourself, no one will do it for you. — Kobe Bryant 🐍",
    "A grateful heart is a magnet for miracles. ✨",
    "Happiness is not by chance, but by choice. ☀️",
    "The expert in anything was once a beginner. 🌱",
    "Your vibe attracts your tribe. 🫂",
    "Consistency is key. Keep showing up. 🔑",
    "Dream big. Work hard. Stay humble. 💪",
    "Focus on the step in front of you, not the whole staircase. 🪜",
    "Success is the sum of small efforts repeated day in and day out. 📈",
    "Believe you can and you're halfway there. 🚀",
    "Don't watch the clock; do what it does. Keep going. ⏰",
    "Your only limit is your mind. 🧠",
    "Great things never came from comfort zones. 🌊",
    "Discipline is doing what needs to be done, even if you don't want to do it. ⚔️",
    "Gratitude changes everything. 🙏",
    "Start where you are. Use what you have. Do what you can. 🛠️",
    "Every day is a second chance. 🌅",
    "Positive mind. Positive vibes. Positive life. ☮️",
    "Fall down seven times, stand up eight. 🥊",
    "Make today so awesome yesterday gets jealous. 😎"
];

const LUCKY_4_QUOTES = [
    "Luck is what happens when preparation meets opportunity. 🍀",
    "The harder you work, the luckier you get. 💪",
    "4 a reason, 4 a season, 4 a lifetime. You're here for it all. 💎",
    "Positive mind = Positive life. Keep glowing. ✨",
    "Your breakthrough is just around the corner. Keep pushing. 🚀",
    "Believe in the magic of new beginnings. 🌅",
    "Good things take time. Great things take patience. ⏳",
    "Manifesting abundance for you today. 💰",
    "You are exactly where you need to be. Trust the process. 🗺️",
    "Every setback is a setup for a comeback. 🏹",
    "Radiate positivity and the world will reflect it back. ☀️",
    "Luck follows the brave. Be fearless. 🦁",
    "Small steps every day add up to big results. 👣",
    "Your energy introduces you before you even speak. Make it good. ⚡",
    "Focus on the solution, not the problem. 🧩",
    "Today is a great day to have a great day. 🌈",
    "Success is not final, failure is not fatal: it is the courage to continue that counts. 🛡️",
    "You are capable of amazing things. 🌟",
    "Don't stop until you're proud. 🏆",
    "Work hard in silence, let your success be your noise. 📢",
    "The best way to predict the future is to create it. 🔮",
    "Your potential is endless. Go do what you were created to do. 🎨",
    "Stay patient and trust your journey. 🛤️",
    "Good energy is contagious. Pass it on. 🔄",
    "Limitations live only in our minds. 🧠",
    "Push yourself, because no one else is going to do it for you. 🫵",
    "Great things never come from comfort zones. 🌊",
    "Dream it. Wish it. Do it. ✅",
    "Success doesn’t come to you, you go to it. 🏃‍♂️",
    "Work hard, be kind, and amazing things will happen. 💖",
    "The only bad workout is the one that didn't happen. 🏋️‍♂️",
    "Your life is as good as your mindset. 💭",
    "Do something today that your future self will thank you for. 📅",
    "It always seems impossible until it's done. 🏁",
    "Don't wait for opportunity. Create it. 🔨",
    "Every day brings new choices. Choose wisely. 🤔",
    "Be the energy you want to attract. 🧲",
    "Keep going. Everything you need will come to you at the perfect time. ⏱️",
    "You are stronger than you think. 💪",
    "4 the culture. 4 the community. 4 the win. 🌐"
];

const TIMER_MESSAGES = [
    "🌌 Planet CUHZ → https://planetcuhz.com",
    "🔗 All links → https://linktr.ee/PlanetCUHZ",
    "💬 Join the Discord → https://discord.gg/5rFRaeBuHn",
    "🔗 CUHZ Chain Generator → https://cuhz-bot-dashboard-846.created.app/chain-generator"
];

// AI Warriors removed per user request

// --- Channel Personas ---
const DEFAULT_CONFIG = {
    timers: TIMER_MESSAGES,
    commands: PUBLIC_COMMANDS,
    hype: HYPE_MESSAGES
};

async function fetchChannelPersona(channel) {
    const cleanChannel = channel.toLowerCase().replace('#', '');
    if (!config.apiBase || !config.botApiSecret) {
        logger.info(`No API config, using defaults for ${channel}`);
        const persona = { ...DEFAULT_CONFIG, timers: [...TIMER_MESSAGES] };
        if (cleanChannel === 'fourareason4') {
            persona.timers.push("📱 Follow Four A Reason on YouTube and TikTok! 🚀");
        }
        channelConfigs.set(channel.toLowerCase(), persona);
        return;
    }

    try {
        logger.info(`Fetching configuration for ${channel}...`);
        const [cmdRes, timerRes, setRes] = await Promise.all([
            axios.get(`${config.apiBase}/api/bot/commands/${cleanChannel}`, {
                headers: { 'Authorization': `Bearer ${config.botApiSecret}` },
                timeout: 5000
            }),
            axios.get(`${config.apiBase}/api/bot/timers/${cleanChannel}`, {
                headers: { 'Authorization': `Bearer ${config.botApiSecret}` },
                timeout: 5000
            }),
            axios.get(`${config.apiBase}/api/bot/settings/${cleanChannel}`, {
                headers: { 'Authorization': `Bearer ${config.botApiSecret}` },
                timeout: 5000
            })
        ]);

        const persona = {
            commands: { ...PUBLIC_COMMANDS, ...cmdRes.data.commands },
            timers: timerRes.data.timers && timerRes.data.timers.length > 0 ? [...timerRes.data.timers] : [...TIMER_MESSAGES],
            interval: timerRes.data.interval || 60,
            settings: setRes.data || { auto_welcome: 1, auto_marketing: 1 },
            hype: HYPE_MESSAGES
        };

        // Add fourareason4 specific timer
        if (cleanChannel === 'fourareason4') {
            const promoMsg = "📱 Follow Four A Reason on YouTube and TikTok! 🚀";
            if (!persona.timers.includes(promoMsg)) {
                persona.timers.push(promoMsg);
            }
        }

        channelConfigs.set(channel.toLowerCase(), persona);
        logger.info(`Loaded ${Object.keys(persona.commands).length} commands, ${persona.timers.length} timers at ${persona.interval}min intervals for ${channel}`);
    } catch (error) {
        logger.error(`Error fetching persona for ${channel}:`, error.message);

        const fallbackPersona = { ...DEFAULT_CONFIG, timers: [...TIMER_MESSAGES] };
        if (cleanChannel === 'fourareason4') {
            fallbackPersona.timers.push("📱 Follow Four A Reason on YouTube and TikTok! 🚀");
        }
        channelConfigs.set(channel.toLowerCase(), fallbackPersona);
    }
}

function getChannelConfig(channel) {
    const cleanChannel = channel.toLowerCase();
    return channelConfigs.get(cleanChannel) || DEFAULT_CONFIG;
}

// --- Twitch API Helpers ---

function sanitizeChannel(name) {
    if (!name) return null;
    const clean = name.trim().toLowerCase();
    return clean.startsWith('#') ? clean : `#${clean}`;
}

async function fetchClientId() {
    if (twitchClientId && botUserId) return twitchClientId;

    try {
        logger.info('Fetching Client ID validation...');
        const authBase = config.twitchAuthBase || 'https://id.twitch.tv/oauth2';
        // Pass token without 'oauth:' prefix if present
        const token = config.oauthToken.replace('oauth:', '');

        const response = await axios.get(`${authBase}/validate`, {
            headers: {
                'Authorization': `OAuth ${token}`
            },
            timeout: 10000
        });

        if (response.data && response.data.client_id) {
            twitchClientId = response.data.client_id;
            botUserId = response.data.user_id;
            logger.info(`Identity Validated: Bot is logged in as '${response.data.login}' (ID: ${botUserId})`);
            logger.info(`Client ID: ${twitchClientId}`);
            return twitchClientId;
        }
    } catch (error) {
        logger.error('Error fetching Client ID from token validation. Check your BOT_OAUTH_TOKEN.');
        logger.error('Error details:', error.message);
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
            },
            timeout: 10000
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

// --- Twitch ID & Follow Helpers ---

async function getTwitchUser(username) {
    if (!twitchClientId) await fetchClientId();
    if (!twitchClientId) return null;

    try {
        const apiBase = config.twitchApiBase || 'https://api.twitch.tv/helix';
        const token = config.oauthToken.replace('oauth:', '');
        const cleanName = username.replace('#', '').replace('@', '');

        const response = await axios.get(`${apiBase}/users`, {
            params: { login: cleanName },
            headers: {
                'Client-ID': twitchClientId,
                'Authorization': `Bearer ${token}`
            },
            timeout: 5000
        });

        if (response.data && response.data.data.length > 0) {
            return response.data.data[0];
        }
        return null;
    } catch (error) {
        logger.error(`Error resolving user ${username}:`, error.message);
        return null;
    }
}

async function getFollowData(broadcasterId, userId) {
    if (!twitchClientId) await fetchClientId();
    if (!twitchClientId) return null;

    try {
        const apiBase = config.twitchApiBase || 'https://api.twitch.tv/helix';
        const token = config.oauthToken.replace('oauth:', '');

        logger.info(`🔍 Checking follow: broadcaster=${broadcasterId}, user=${userId}`);

        const response = await axios.get(`${apiBase}/channels/followers`, {
            params: {
                broadcaster_id: broadcasterId,
                user_id: userId,
                moderator_id: botUserId // Required for this endpoint
            },
            headers: {
                'Client-ID': twitchClientId,
                'Authorization': `Bearer ${token}`
            },
            timeout: 5000
        });

        logger.info(`📊 Follow API response: ${JSON.stringify(response.data)}`);

        if (response.data && response.data.data && response.data.data.length > 0) {
            return response.data.data[0]; // Returns { user_id, user_name, followed_at }
        }
        return null; // Not following
    } catch (error) {
        // Log the actual error for debugging
        if (error.response) {
            logger.error(`❌ Follow API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            if (error.response.status === 401) {
                logger.error('⚠️ OAuth token missing "moderator:read:followers" scope. Regenerate token with this scope.');
            }
        } else {
            logger.error(`❌ Follow API error: ${error.message}`);
        }
        return null;
    }
}

async function updateChannelInfo(broadcasterId, data) {
    if (!twitchClientId) await fetchClientId();
    if (!twitchClientId) return false;

    try {
        const apiBase = config.twitchApiBase || 'https://api.twitch.tv/helix';
        const token = config.oauthToken.replace('oauth:', '');

        await axios.patch(`${apiBase}/channels?broadcaster_id=${broadcasterId}`, data, {
            headers: {
                'Client-ID': twitchClientId,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
        return true;
    } catch (error) {
        logger.error(`Error updating channel info: ${error.message}`);
        if (error.response) {
            logger.error(`API Error: ${JSON.stringify(error.response.data)}`);
        }
        return false;
    }
}

async function getGameId(gameName) {
    if (!twitchClientId) await fetchClientId();
    if (!twitchClientId) return null;

    try {
        const apiBase = config.twitchApiBase || 'https://api.twitch.tv/helix';
        const token = config.oauthToken.replace('oauth:', '');
        const response = await axios.get(`${apiBase}/games?name=${encodeURIComponent(gameName)}`, {
            headers: {
                'Client-ID': twitchClientId,
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.data && response.data.data.length > 0) {
            return response.data.data[0].id;
        }
        return null;
    } catch (error) {
        return null;
    }
}

async function validateToken() {
    try {
        const authBase = config.twitchAuthBase || 'https://id.twitch.tv/oauth2';
        const token = config.oauthToken.replace('oauth:', '');
        const response = await axios.get(`${authBase}/validate`, {
            headers: { 'Authorization': `OAuth ${token}` }
        });
        return response.data;
    } catch (error) {
        return null;
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
                headers: { 'Authorization': `Bearer ${config.botApiSecret}` },
                timeout: 10000
            });

            if (response.data && response.data.channels && response.data.channels.length > 0) {
                channelsToJoin = response.data.channels.map(ch => sanitizeChannel(ch.name)).filter(n => !!n);
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
        channelsToJoin = config.channels.map(ch => sanitizeChannel(ch)).filter(n => !!n);
        logger.info(`Using channels from config:`, channelsToJoin);
    }

    if (channelsToJoin.length === 0) {
        logger.warn('No channels configured to join!');
    }

    // 3. Create Client
    const oauthToken = config.oauthToken.startsWith('oauth:') ? config.oauthToken : `oauth:${config.oauthToken}`;

    logger.info(`Initializing Twitch Client for user: ${config.username}`);
    logger.info(`Final Channel List: ${channelsToJoin.join(', ')}`);

    client = new tmi.Client({
        options: { debug: true, connectionTimeout: 10000 },
        connection: {
            reconnect: true,
            secure: true
        },
        identity: {
            username: config.username,
            password: oauthToken
        },
        channels: channelsToJoin
    });

    client.connect().then(() => {
        logger.info('Successfully initiated connection to Twitch IRC.');
    }).catch(err => {
        logger.error('Twitch connection FAILED:', err);
    });
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

            // Fetch persona from Dashboard
            await fetchChannelPersona(channel);

            // Initialize AI features
            if (config.enableMoodDetection) {
                moodTracker.initChannel(channel);
            }
            if (config.enableContextAware) {
                contextHandler.initChannel(channel);
            }

            // Start Timers & Status Checks
            startRotationalTimer(channel);
            startStreamPoller(channel);
            startMoodAnalyzer(channel);

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
                headers: { 'Authorization': `Bearer ${config.botApiSecret}` },
                timeout: 10000
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

// ... imports
const streamIntel = require('./stream_intel');

// ... existing code ...

// --- Persistence Helper ---
const STATE_FILE = path.join(__dirname, 'stream_states.json');

function loadStreamStates() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            const parsed = JSON.parse(data);
            // Convert strings back to dates/maps
            for (const [key, val] of Object.entries(parsed)) {
                if (val.startedAt) val.startedAt = new Date(val.startedAt);
                if (val.lastAnnounced) val.lastAnnounced = new Date(val.lastAnnounced);
                streamStates.set(key, val);
            }
            logger.info('Loaded stream states from disk.');
        }
    } catch (e) {
        logger.error('Failed to load stream states:', e.message);
    }
}

function saveStreamStates() {
    try {
        const obj = Object.fromEntries(streamStates);
        fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2));
    } catch (e) {
        logger.error('Failed to save stream states:', e.message);
    }
}

// Load on startup
loadStreamStates();

async function updateStreamState(channel) {
    const status = await checkStreamStatus(channel);
    const current = streamStates.get(channel);
    const wasLive = current && current.isLive;

    // Default game name if undefined
    const gameName = (status && status.game) ? status.game : 'something cool';

    // 1. Stream is LIVE
    if (status && status.isLive) {
        // Check if we should announce (Live now, wasn't live OR not announced recently)
        // We add a 'lastAnnounced' timestamp to prevent spam on restarts
        const now = Date.now();
        const lastAnnounced = current ? (current.lastAnnounced ? new Date(current.lastAnnounced).getTime() : 0) : 0;
        const cooldown = 60 * 60 * 1000; // 1 hour cooldown for "We are live" message

        const shouldAnnounce = !wasLive || (now - lastAnnounced > cooldown);

        // Update state
        const newState = {
            ...status,
            game: gameName,
            lastAnnounced: shouldAnnounce ? new Date() : (current ? current.lastAnnounced : null)
        };

        streamStates.set(channel, newState);
        saveStreamStates(); // Persist immediately

        await streamIntel.updateStreamStatus(channel, newState);

        if (shouldAnnounce) {
            logger.info(`🔴 STREAM LIVE: ${channel} playing ${gameName}`);
            client.say(channel, `🔴 WE ARE LIVE! playing ${gameName}! Get in here cuhz! 🚀`);
        } else {
            logger.info(`🔴 Stream live (already announced): ${channel}`);
        }
    }
    // 2. Stream went OFFLINE
    else if (wasLive) {
        streamStates.set(channel, { isLive: false, lastAnnounced: current.lastAnnounced });
        saveStreamStates();

        await streamIntel.updateStreamStatus(channel, { isLive: false });
        logger.info(`⚫ STREAM ENDED: ${channel}`);
    }
}




function startMoodAnalyzer(channel) {
    if (!config.enableMoodDetection) return;

    logger.info(`🤖 Mood analyzer initialized for ${channel}`);

    // Analyze mood every 2 minutes
    setInterval(async () => {
        if (moodTracker.shouldAnalyzeMood(channel)) {
            const messageBuffer = moodTracker.getMessageBuffer(channel);

            if (messageBuffer.length >= 5) {
                try {
                    const sentiment = await aiService.analyzeSentiment(messageBuffer);
                    const newPersonality = moodTracker.updateMood(channel, sentiment);

                    // Check if hype injection is needed (with cooldown)
                    if (moodTracker.needsHypeInjection(channel) && client && client.readyState() === 'OPEN') {
                        // Try AI-generated proactive message first, fall back to static hype
                        const recentContext = contextHandler.getContext(channel);
                        let hypeMsg = await aiService.generateProactiveMessage(channel, recentContext, sentiment.mood);

                        if (!hypeMsg) {
                            const persona = getChannelConfig(channel);
                            hypeMsg = persona.hype[Math.floor(Math.random() * persona.hype.length)];
                        }

                        client.say(channel, `💫 ${hypeMsg}`);
                        moodTracker.recordHypeInjection(channel);
                        logger.info(`💉 Injected hype into ${channel} (low energy detected)`);
                    }

                    // Alert mods if toxicity is high
                    if (sentiment.toxicity > 60 && client && client.readyState() === 'OPEN') {
                        logger.warn(`⚠️ High toxicity detected in ${channel}: ${sentiment.toxicity}`);
                        // Could send a private message to mods here
                    }

                } catch (error) {
                    logger.error(`Failed to analyze mood for ${channel}:`, error.message);
                }
            }
        }
    }, config.moodAnalysisInterval * 1000);
}

function startRotationalTimer(channel) {
    timerIndices.set(channel, 0);
    const persona = getChannelConfig(channel);
    const intervalMs = (persona.interval || 60) * 60 * 1000; // Default to 60 minutes if not specified

    logger.info(`Rotational timer initialized for ${channel} (Every ${persona.interval || 60}m, Smart Mode)`);

    setInterval(() => {
        if (client && client.readyState() === 'OPEN') {
            const persona = getChannelConfig(channel);
            // Check if Auto-Marketing is enabled
            if (persona.settings && !persona.settings.auto_marketing) {
                return;
            }

            // Smart Check: Only send if stream is LIVE
            const state = streamStates.get(channel);
            const isLive = state ? state.isLive : false; // Default to false if unknown to avoid spam

            // Allow sending if Mock API is enabled (for testing) OR actually live
            const shouldSend = config.useMockApi || isLive;

            if (shouldSend) {
                const index = timerIndices.get(channel) || 0;
                const message = persona.timers[index];

                if (message) {
                    client.say(channel, message).catch(err => logger.error('Error sending timer msg:', err));
                }

                // Rotate
                const nextIndex = (index + 1) % persona.timers.length;
                timerIndices.set(channel, nextIndex);
            } else {
                // logger.debug(`Skipping timer for ${channel} (Stream Offline)`);
            }
        }
    }, intervalMs); // FIXED: Now uses the calculated interval instead of hardcoded 12 minutes

    logger.info(`Rotational timer started for ${channel} at ${persona.interval || 60} minute intervals`);
}

/**
 * Handle automatic shoutouts for fellow streamers
 * @param {string} channel - Channel name
 * @param {string} usernameLower - Username in lowercase
 * @param {string} displayName - Display name for mention
 */
async function handleAutoShoutout(channel, usernameLower, displayName) {
    try {
        // Check if this user is in the auto-shoutout list
        const streamer = await db.prepare(`
            SELECT * FROM streamer_shoutouts 
            WHERE channel = ? AND streamer_username = ? AND is_active = 1
        `).get(channel, usernameLower);

        if (!streamer) {
            return; // Not in the list, skip
        }

        // Check cooldown (24 hours since last shoutout)
        if (streamer.last_shoutout) {
            const lastShoutout = new Date(streamer.last_shoutout);
            const hoursSinceLastShoutout = (Date.now() - lastShoutout.getTime()) / (1000 * 60 * 60);

            if (hoursSinceLastShoutout < 24) {
                return; // Too soon, skip
            }
        }

        // Give the shoutout!
        client.say(channel, `🎬 Big shoutout to fellow streamer @${displayName}! Check them out at https://twitch.tv/${usernameLower} 🚀`);

        // Update database
        await db.prepare(`
            UPDATE streamer_shoutouts 
            SET last_shoutout = CURRENT_TIMESTAMP, shoutout_count = shoutout_count + 1 
            WHERE channel = ? AND streamer_username = ?
        `).run(channel, usernameLower);

        logger.info(`🎬 Auto-shoutout sent for ${usernameLower} in ${channel}`);

    } catch (err) {
        logger.error('Error in handleAutoShoutout:', err.message);
    }
}

async function handleMessage(channel, tags, message, self) {
    if (self) return;

    // --- Add to AI Context & Mood Buffers ---
    const username = tags.username;
    if (config.enableMoodDetection) {
        moodTracker.addMessage(channel, username, message);
    }
    if (config.enableContextAware) {
        contextHandler.addToContext(channel, username, message);
    }

    // --- Record to Chat Memory ---
    const isCommand = message.startsWith('!');
    userMemory.recordMessage(channel, username, message, isCommand);

    // --- Track User Activity ---
    try {
        const usernameL = username.toLowerCase();
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();

        // 1. Check Passive Paycheck (Active for 10 mins -> +10 points)
        // We check last_seen before updating it to see how long since last active
        const user = await db.prepare('SELECT last_seen FROM users WHERE username = ?').get(usernameL);

        if (user) {
            const lastSeenTime = new Date(user.last_seen).getTime();
            const timeDiff = now.getTime() - lastSeenTime;

            // If they've been chatting actively (last msg was within 10-20 mins ago)
            // AND it's been at least 10 minutes since last activity logged
            if (timeDiff > 10 * 60 * 1000 && timeDiff < 30 * 60 * 1000) {
                await pointsService.addPoints(usernameL, 10, 'passive_paycheck');
            }
        }

        // 2. Earn Active Point (+1 per message)
        await pointsService.addPoints(usernameL, 1, 'chat_message');

        // 3. Update User Stats (Last Seen, Msg Count)
        const upsertUser = db.prepare(`
            INSERT INTO users (username, points, messages_sent, last_seen)
            VALUES (?, 1, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(username) DO UPDATE SET
                messages_sent = messages_sent + 1,
                last_seen = CURRENT_TIMESTAMP
        `);
        await upsertUser.run(usernameL);

        // 4. Check Achievements (Async)
        loyaltySystem.checkAchievements(usernameL).then(newAchievements => {
            if (newAchievements && newAchievements.length > 0) {
                newAchievements.forEach(ach => {
                    client.say(channel, `🏆 ACHIEVEMENT UNLOCKED: @${tags.username} earned '${ach}'!`);
                });
            }
        });

        // ... commands ...

        if (msg === '!achievements') {
            const achievements = await loyaltySystem.getAchievements(tags.username);
            if (achievements.length === 0) {
                client.say(channel, `📜 @${tags.username} has no achievements yet. Keep chatting!`);
            } else {
                const list = achievements.map(a => a.achievement_name).join(', ');
                client.say(channel, `🏆 @${tags.username}'s Achievements: ${list}`);
            }
            return;
        }


        const persona = getChannelConfig(channel);
        // Welcome back message (if last seen > 24h ago or new user AND settings allow it)
        const canWelcome = !persona.settings || persona.settings.auto_welcome;
        if (canWelcome && (!user || user.last_seen < oneDayAgo)) {
            client.say(channel, `Welcome to the Planet, @${tags.username}! 🌌`);
        }

        // Auto-shoutout for fellow streamers (if not shouted out recently)
        await handleAutoShoutout(channel, usernameL, tags.username);

    } catch (err) {
        logger.error('Error tracking user points/welcome:', err.message);
    }

    const msg = message.toLowerCase();
    const cleanChannel = channel.replace('#', '').toLowerCase();
    const isVerifiedStream = ['fourareason4', 'planetcuhz', 'rico_santanax'].includes(cleanChannel);

    const persona = getChannelConfig(channel);

    // 0. Global Connectivity Test
    if (msg === '!ping') {
        client.say(channel, `Pong! 🏓 The bot is active in ${channel}.`);
        return;
    }

    // 0.5. Context-Aware Response (AI)
    if (config.enableContextAware && !msg.startsWith('!')) {
        try {
            const currentPersonality = moodTracker.getCurrentPersonality(channel);
            const personalityConfig = moodTracker.getPersonalityConfig(currentPersonality);

            // Get user profile for personalization
            const userProfile = await userMemory.getProfile(tags.username);

            const aiResponse = await contextHandler.handleContextAwareResponse(
                channel,
                tags.username,
                message,
                currentPersonality,
                persona.commands,
                personalityConfig,
                userProfile   // Pass user profile for AI personalization
            );

            if (aiResponse) {
                client.say(channel, aiResponse);
                return;
            }
        } catch (error) {
            logger.error('Context-aware response error:', error.message);
        }
    }

    // 1. Exact Match Public Commands (Persona Specific)
    if (persona.commands[msg]) {
        client.say(channel, persona.commands[msg]);
        return;
    }

    // 1.5. Master User Commands
    if (USER_COMMANDS[msg]) {
        client.say(channel, USER_COMMANDS[msg]);
        return;
    }

    // 1.6. Support & Command Help
    if (msg.includes('how do i get a command') || msg.includes('how to get a custom command')) {
        client.say(channel, `Custom commands are for regulars! If you're on the list and want an update, email SUPPORT@PLANETCUHZ.COM`);
        return;
    }

    if (msg.includes('how to change my message') || msg.includes('how do i change my message') || msg.includes('change my command')) {
        client.say(channel, `If you want to change your custom command message, please email SUPPORT@PLANETCUHZ.COM`);
        return;
    }

    // 1.6. Directory Command
    if (msg === '!shoutouts') {
        client.say(channel, 'Available Commands: !AC, !snow, !Mahni, !PNX, !Rico, !EC, !Rell, !Shock, !Kay, !Thorn, !Limit, !Reacts, !Rock, !Four, !Yoo, !Balen, !Bot. Want to change your message? Email SUPPORT@PLANETCUHZ.COM');
        return;
    }

    // 1.7. Support Query Detection ("How do I get a command?")
    const helpPattern = /how (do|can) i (get|have|make) a (command|custom command)/i;
    if (helpPattern.test(message)) {
        client.say(channel, "Custom commands are for regulars! If you're on the list and want an update, email SUPPORT@PLANETCUHZ.COM");
        return;
    }

    // 2. Dynamic Commands
    if (msg.startsWith('!followage') || msg.startsWith('!following')) {
        try {
            // 1. Determine target user (sender or specified user)
            const args = message.split(' ');
            const targetUsername = args[1] ? args[1].replace('@', '') : tags.username;

            // 2. Get IDs for Channel and Target User
            const channelUser = await getTwitchUser(channel.replace('#', ''));
            const targetUser = await getTwitchUser(targetUsername);

            if (!channelUser || !targetUser) {
                logger.warn(`Could not resolve IDs for followage check: Ch=${channel} User=${targetUsername}`);
                // Only reply if it was a specific request that failed
                if (args[1]) client.say(channel, `Could not find user @${targetUsername}`);
                return;
            }

            // 3. Check follow status
            const followData = await getFollowData(channelUser.id, targetUser.id);

            if (followData) {
                const start = new Date(followData.followed_at);
                const now = new Date();
                const diffTime = Math.abs(now - start);

                const years = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 365));
                const months = Math.floor((diffTime % (1000 * 60 * 60 * 24 * 365)) / (1000 * 60 * 60 * 24 * 30));
                const days = Math.floor((diffTime % (1000 * 60 * 60 * 24 * 30)) / (1000 * 60 * 60 * 24));
                const hours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

                let timeStr = "";
                if (years > 0) timeStr += `${years}y `;
                if (months > 0) timeStr += `${months}m `;
                if (days > 0) timeStr += `${days}d `;
                if (timeStr === "") timeStr = `${hours}h`; // Fallback for very new follows

                client.say(channel, `@${targetUsername} has been following for ${timeStr.trim()}! 📅`);
            } else {
                client.say(channel, `@${targetUsername} is not following ${channel} (yet)!`);
            }
        } catch (err) {
            logger.error('Error in !followage:', err.message);
        }
        return;
    }

    if (msg === '!claim') {
        try {
            // 1. Get IDs
            const channelUser = await getTwitchUser(channel.replace('#', ''));
            const targetUser = await getTwitchUser(tags.username);

            if (!channelUser || !targetUser) {
                client.say(channel, `⚠️ API Error: Could not verify follower status. Try again later.`);
                return;
            }

            // 2. Verify Follow
            const followData = await getFollowData(channelUser.id, targetUser.id);
            if (!followData) {
                client.say(channel, `🚫 You must be following the channel to claim your 300 point bonus!`);
                return;
            }

            // 3. Attempt to Claim (Logic in pointsService handles "one time only" check)
            const success = await pointsService.claimBonus(tags.username, 'follower_bonus', 300);

            if (success) {
                const balance = await pointsService.getBalance(tags.username);
                client.say(channel, `🎉 FOLLOW BONUS CLAIMED! @${tags.username} received 300 points! Balance: ${balance} 💎`);
            } else {
                client.say(channel, `🚫 Nice try cuhz! You already claimed your follower bonus.`);
            }
        } catch (err) {
            logger.error('Error in !claim:', err.message);
        }
        return;
    }


    if (msg === '!streamstats') {
        const stats = await streamIntel.getStats(channel);
        if (!stats) {
            client.say(channel, "📊 No stream data available yet.");
        } else if (stats.isLive) {
            client.say(channel, `🔴 LIVE | Viewers: ${stats.viewers} (Peak: ${stats.peak_viewers || stats.viewers}) | Started: ${new Date(stats.started_at).toLocaleTimeString()}`);
        } else {
            client.say(channel, `⚫ OFFLINE | Last Stream: ${new Date(stats.started_at).toLocaleDateString()} | Duration: ${stats.ended_at ? Math.round((new Date(stats.ended_at) - new Date(stats.started_at)) / 60000) + 'm' : 'Unknown'}`);
        }
        return;
    }

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
        const messages = persona.hype || HYPE_MESSAGES;
        const randomHype = messages[Math.floor(Math.random() * messages.length)];
        client.say(channel, randomHype);
        return;
    }

    if (msg === '!quote' || msg === '!motivation') {
        const randomQuote = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
        client.say(channel, `🦁 ${randomQuote}`);
        return;
    }

    if (msg === '!4') {
        const randomLucky = LUCKY_4_QUOTES[Math.floor(Math.random() * LUCKY_4_QUOTES.length)];
        client.say(channel, `🍀 ${randomLucky}`);
        return;
    }

    // --- Phase 1: Chat Memory Commands (Restricted to Verified Streams) ---
    if (msg.startsWith('!whois ') && isVerifiedStream) {
        const target = message.split(' ')[1]?.replace('@', '');
        if (target) {
            try {
                const summary = await userMemory.generateUserSummary(target);
                client.say(channel, `📋 @${target}: ${summary}`);
            } catch (err) {
                logger.error('Error in !whois:', err.message);
            }
        }
        return;
    }

    if (msg === '!topchatters' && isVerifiedStream) {
        try {
            const top = await userMemory.getTopChatters(channel, 24, 5); // Keep original parameters for now, diff had (5)
            if (top.length === 0) {
                client.say(channel, `📊 No chat data yet for today!`);
            } else {
                const list = top.map((c, i) => `${i + 1}. @${c.username} (${c.msg_count})`).join(' | ');
                client.say(channel, `🏆 Top chatters today: ${list}`);
            }
        } catch (err) {
            logger.error('Error in !topchatters:', err.message);
        }
        return;
    }




    // 3. Mod / Owner Commands
    const isMod = tags.mod || (tags.badges && tags.badges.broadcaster);

    // --- Mod Intelligence Commands ---

    if (msg === '!chatreport' && isMod) {
        const health = await modIntel.getChatHealth(channel);
        if (health) {
            client.say(channel, `🛡️ Chat Report: Mood=${health.mood} (${health.energy}% Energy, ${health.toxicity}% Toxicity) | Activity=${health.messagesLastHour} msgs by ${health.activeChatters} users (Last Hour)`);
        } else {
            client.say(channel, `⚠️ Failed to generate report.`);
        }
        return;
    }

    if (msg.startsWith('!userreport ') && isMod) {
        const target = message.split(' ')[1]?.replace('@', '');
        if (target) {
            client.say(channel, `🔍 Analyzing ${target}... specific report generating... standby...`);
            const report = await modIntel.generateUserReport(target);
            // It might be long, so maybe split or categorize
            // For Twitch limit comfort, maybe keep it short in prompt or split here
            // But prompt asked for "brief", so likely okay.
            client.say(channel, `📋 Report on @${target}: ${report}`);
        }
        return;
    }


    // --- Dev Service Promotion Commands ---
    if (['!build', '!agents'].includes(msg)) {
        let promo = "Yo cuhz, if you want your own custom Twitch bot, home assistant, or a full AI development team, let @fourareason4 know right here in the stream! 🚀";

        if (cleanChannel === 'planetcuhz') promo = "Looking to level up your brand with a custom bot or AI team? Let @fourareason4 know he's in the chat! 🌌";
        if (cleanChannel === 'rico_santanax') promo = "Rico's bot is built by the fam! Want your own? Holla at @fourareason4 for custom bots and AI agents! 🔥";

        client.say(channel, promo);
        return;
    }

    // Mood Detection Commands
    if (msg === '!mood' && isMod && config.enableMoodDetection) {
        const moodState = moodTracker.getMoodState(channel);
        client.say(channel, `📊 Current mood: ${moodState.currentMood} | Energy: ${moodState.energy}/100 | Toxicity: ${moodState.toxicity}/100 | Personality: ${moodState.currentPersonality}`);
        return;
    }

    if (msg.startsWith('!personality ') && isMod && config.enableMoodDetection) {
        const mode = message.split(' ')[1]?.toLowerCase();
        if (moodTracker.setPersonality(channel, mode)) {
            client.say(channel, `🎭 Personality set to: ${mode}`);
        } else {
            client.say(channel, `❌ Invalid personality. Options: hype, chill, supportive, moderated, neutral`);
        }
        return;
    }

    if (msg === '!aistats' && tags.username === 'fourareason4' && isVerifiedStream) {
        const s = aiService.getStats();
        const cacheStats = await contextHandler.getCacheStats();
        const eyes = `👁️${s.eyes.available ? '✅' : '❌'}(${s.eyes.failures})`;
        const brain = `🧠${s.brain.available ? '✅' : '❌'}(${s.brain.failures})`;
        const hands = `🔧${s.hands.available ? '✅' : '❌'}(${s.hands.failures})`;
        client.say(channel, `🤖 Tri-Brain: ${eyes} ${brain} ${hands} | ${s.requestsThisMinute}/${s.maxRequestsPerMinute} req/min | Cache: ${cacheStats.active_entries}`);
        return;
    }

    // --- Points & Economy Commands ---
    if (msg === '!points' || msg === '!balance') {
        const balance = await pointsService.getBalance(tags.username);
        client.say(channel, `💎 @${tags.username}, you have ${balance} Cuhz Points!`);
        return;
    }

    if (msg === '!richlist' || msg === '!top') {
        const richList = await pointsService.getRichList(5);
        if (richList.length === 0) {
            client.say(channel, "📉 The economy is in shambles! (No data yet)");
        } else {
            const list = richList.map((u, i) => `${i + 1}. ${u.username} (${u.points})`).join(' | ');
            client.say(channel, `👑 Cuhz Rich List: ${list}`);
        }
        return;
    }

    if (msg.startsWith('!give ') && isMod) {
        const args = message.split(' ');
        const target = args[1]?.replace('@', '');
        const amount = parseInt(args[2]);

        if (target && !isNaN(amount)) {
            await pointsService.addPoints(target, amount, `admin_grant_by_${tags.username}`);
            client.say(channel, `💸 @${tags.username} gave ${amount} points to @${target}!`);
        }
        return;
    }

    if (msg.startsWith('!gamble ')) {
        const args = message.split(' ');
        const amount = parseInt(args[1]);

        if (isNaN(amount) || amount <= 0) {
            client.say(channel, `Usage: !gamble <amount>`);
            return;
        }

        const balance = await pointsService.getBalance(tags.username);
        if (balance < amount) {
            client.say(channel, `🚫 You're broke cuhz! You only have ${balance} points.`);
            return;
        }

        const win = Math.random() < 0.5;
        if (win) {
            await pointsService.addPoints(tags.username, amount, 'gamble_win');
            client.say(channel, `🎰 WINNER! @${tags.username} doubled up to ${balance + amount} points! 🟢`);
        } else {
            await pointsService.deductPoints(tags.username, amount, 'gamble_loss');
            client.say(channel, `🎰 RIP @${tags.username}... you lost ${amount} points. 🔴`);
        }
        return;
    }

    // --- Tri-Brain Direct Commands (Gated by Economy) ---
    // !ask generic -> Gemini (10 pts)
    // !ask -brain -> Claude (50 pts)
    if (msg.startsWith('!ask ') && isVerifiedStream) {
        let question = message.substring(5).trim();
        let cost = 10;
        let brain = 'eyes'; // Default Gemini
        let brainName = 'The Eyes (Gemini)';

        if (question.startsWith('-brain')) {
            brain = 'brain'; // Claude
            brainName = 'The Brain (Claude)';
            cost = 50;
            question = question.substring(6).trim();
        }

        if (question) {
            const success = await pointsService.deductPoints(tags.username, cost, `ask_${brain}`);
            if (!success) {
                const balance = await pointsService.getBalance(tags.username);
                client.say(channel, `🚫 Broke User Alert: You need ${cost} points for ${brainName} but only have ${balance}. Chat more to earn!`);
                return;
            }

            try {
                const reply = await aiService.askBrain(brain, question, tags.username);
                const prefix = brain === 'brain' ? '🧠' : '👁️';
                client.say(channel, `${prefix} ${reply}`);
            } catch (err) {
                logger.error('Error in !ask:', err.message);
                // Refund on error? Maybe later.
            }
        }
        return;
    }

    if (msg.startsWith('!code ') && isVerifiedStream) {
        const query = message.substring(6).trim();
        const cost = 25;

        if (query) {
            const success = await pointsService.deductPoints(tags.username, cost, 'ask_hands');
            if (!success) {
                const balance = await pointsService.getBalance(tags.username);
                client.say(channel, `🚫 You need ${cost} points for The Hands (Code) but only have ${balance}.`);
                return;
            }

            try {
                const reply = await aiService.askBrain('hands', query, tags.username);
                client.say(channel, `💻 ${reply}`);
            } catch (err) {
                logger.error('Error in !code:', err.message);
            }
        }
        return;
    }


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

    if (msg.startsWith('!title ') && isMod) {
        const newTitle = message.substring(7).trim();
        const user = await getTwitchUser(channel.replace('#', ''));
        if (user && newTitle) {
            const success = await updateChannelInfo(user.id, { title: newTitle });
            if (success) client.say(channel, `✅ Stream title updated to: ${newTitle}`);
            else client.say(channel, `❌ Failed to update title. Check bot perks.`);
        }
        return;
    }

    if (msg.startsWith('!game ') && isMod) {
        const gameName = message.substring(6).trim();
        const user = await getTwitchUser(channel.replace('#', ''));
        const gameId = await getGameId(gameName);
        if (user && gameId) {
            const success = await updateChannelInfo(user.id, { game_id: gameId });
            if (success) client.say(channel, `🎮 Category updated to: ${gameName}`);
            else client.say(channel, `❌ Failed to update category.`);
        } else if (gameName && !gameId) {
            client.say(channel, `❌ Could not find game: ${gameName}`);
        }
        return;
    }

    if (msg === '!botcheck' && isMod) {
        const validation = await validateToken();
        if (validation) {
            const hasFollowerScope = (validation.scopes || []).includes('moderator:read:followers');
            const hasBroadcastScope = (validation.scopes || []).includes('channel:manage:broadcast');
            client.say(channel, `🤖 Status: LIVE | Scopes: ${validation.scopes.length} | Followage Fix: ${hasFollowerScope ? '✅' : '❌'} | Title/Game: ${hasBroadcastScope ? '✅' : '❌'}`);
        } else {
            client.say(channel, `❌ Token invalid or expired.`);
        }
        return;
    }

    if (msg === '!refresh' && isMod) {
        client.say(channel, `🔄 Refreshing persona from dashboard...`);
        await fetchChannelPersona(channel);
        client.say(channel, `✅ Persona reloaded!`);
        return;
    }

    // Auto-shoutout management commands
    if (msg.startsWith('!addstreamer ') && isMod) {
        const streamerName = message.split(' ')[1]?.replace('@', '').toLowerCase();
        if (streamerName) {
            try {
                await db.prepare(`
                    INSERT INTO streamer_shoutouts (channel, streamer_username, is_active)
                    VALUES (?, ?, 1)
                    ON CONFLICT(channel, streamer_username) DO UPDATE SET is_active = 1
                `).run(channel, streamerName);
                client.say(channel, `✅ @${streamerName} added to auto-shoutout list!`);
                logger.info(`Added ${streamerName} to auto-shoutout list for ${channel}`);
            } catch (err) {
                logger.error('Error adding streamer:', err.message);
            }
        }
        return;
    }

    if (msg.startsWith('!removestreamer ') && isMod) {
        const streamerName = message.split(' ')[1]?.replace('@', '').toLowerCase();
        if (streamerName) {
            try {
                await db.prepare(`
                    UPDATE streamer_shoutouts 
                    SET is_active = 0 
                    WHERE channel = ? AND streamer_username = ?
                `).run(channel, streamerName);
                client.say(channel, `❌ @${streamerName} removed from auto-shoutout list.`);
                logger.info(`Removed ${streamerName} from auto-shoutout list for ${channel}`);
            } catch (err) {
                logger.error('Error removing streamer:', err.message);
            }
        }
        return;
    }

    if (msg === '!liststreamers' && isMod) {
        try {
            const streamers = await db.prepare(`
                SELECT streamer_username, shoutout_count 
                FROM streamer_shoutouts 
                WHERE channel = ? AND is_active = 1
                ORDER BY streamer_username
            `).all(channel);

            if (streamers.length === 0) {
                client.say(channel, '📊 No streamers in auto-shoutout list.');
            } else {
                const list = streamers.map(s => `@${s.streamer_username} (${s.shoutout_count})`).join(', ');
                client.say(channel, `🎬 Auto-shoutout list: ${list}`);
            }
        } catch (err) {
            logger.error('Error listing streamers:', err.message);
        }
        return;
    }

    if (msg.startsWith('!ban ') && isMod) {
        const target = message.split(' ')[1];
        if (target) client.say(channel, `/ban ${target}`);
        return;
    }

    if (msg.startsWith('!timeout ') && isMod) {
        const parts = message.split(' ');
        const target = parts[1];
        const duration = parts[2] || 600;
        if (target) client.say(channel, `/timeout ${target} ${duration}`);
        return;
    }

    if (msg === '!clear' && isMod) {
        client.say(channel, '/clear');
        return;
    }

    if (msg.startsWith('!slow ') && isMod) {
        const seconds = message.split(' ')[1] || 10;
        client.say(channel, `/slow ${seconds}`);
        return;
    }

    if (msg === '!slowoff' && isMod) {
        client.say(channel, '/slowoff');
        return;
    }

    if (msg.startsWith('!unban ') && isMod) {
        const target = message.split(' ')[1];
        if (target) client.say(channel, `/unban ${target}`);
        return;
    }

    if (msg.startsWith('!untimeout ') && isMod) {
        const target = message.split(' ')[1];
        if (target) client.say(channel, `/untimeout ${target}`);
        return;
    }

    // Warriors command removed per user request

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
            }, {
                headers: { 'Authorization': `Bearer ${config.webhookToken}` },
                timeout: 5000
            });
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
        streamStates: Object.fromEntries(streamStates),
        startTime: startTime.toISOString(),
        logs: logger.getLogs()
    });
});

app.get('/', (req, res) => {
    try {
        const templatePath = path.join(__dirname, 'dashboard.html');
        const html = fs.readFileSync(templatePath, 'utf8');
        res.send(html);
    } catch (err) {
        res.status(500).send('Dashboard template missing.');
    }
});

app.listen(config.port, () => {
    logger.info(`Bot API listening on port ${config.port}`);
    initializeTwitchClient();
});
