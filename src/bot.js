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
    '!dashboard': '🎛️ Add CUHZ Bot to your channel → https://cuhz-bot-dashboard-846.created.app',
    '!help': '🌌 Commands: !cuhz !links !discord !dashboard !whatiscuhz !whitepaper !roadmap !rules !store !hype !uptime !points | Mods: !mood !personality !announce !so !raid | Type your question naturally for AI help!'
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
        channelConfigs.set(channel.toLowerCase(), DEFAULT_CONFIG);
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
            timers: timerRes.data.timers && timerRes.data.timers.length > 0 ? timerRes.data.timers : TIMER_MESSAGES,
            interval: timerRes.data.interval || 60,
            settings: setRes.data || { auto_welcome: 1, auto_marketing: 1 },
            hype: HYPE_MESSAGES
        };

        channelConfigs.set(channel.toLowerCase(), persona);
        logger.info(`Loaded ${Object.keys(persona.commands).length} commands, ${persona.timers.length} timers at ${persona.interval}min intervals for ${channel}`);
    } catch (error) {
        logger.error(`Error fetching persona for ${channel}:`, error.message);
        channelConfigs.set(channel.toLowerCase(), DEFAULT_CONFIG);
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
    if (twitchClientId) return twitchClientId;

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
            logger.info(`Identity Validated: Bot is logged in as '${response.data.login}'`);
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
                user_id: userId
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

async function updateStreamState(channel) {
    const status = await checkStreamStatus(channel);
    if (status) {
        streamStates.set(channel, status);
        // Optional: log state change
        // logger.debug(`Stream state for ${channel}: ${status.isLive ? 'LIVE' : 'OFFLINE'}`);
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

        const user = await db.prepare('SELECT last_seen FROM users WHERE username = ?').get(usernameL);

        const upsertUser = db.prepare(`
            INSERT INTO users (username, points, messages_sent, last_seen)
            VALUES (?, 1, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(username) DO UPDATE SET
                points = points + 1,
                messages_sent = messages_sent + 1,
                last_seen = CURRENT_TIMESTAMP
        `);
        await upsertUser.run(usernameL);

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

    // --- Phase 1: Chat Memory Commands ---
    if (msg.startsWith('!whois ')) {
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

    if (msg === '!topchatters') {
        try {
            const topChatters = await userMemory.getTopChatters(channel, 24, 5);
            if (topChatters.length === 0) {
                client.say(channel, `📊 No chat data yet for today!`);
            } else {
                const list = topChatters.map((c, i) => `${i + 1}. @${c.username} (${c.msg_count})`).join(' | ');
                client.say(channel, `🏆 Top chatters today: ${list}`);
            }
        } catch (err) {
            logger.error('Error in !topchatters:', err.message);
        }
        return;
    }


    if (msg === '!points') {
        try {
            const user = await db.prepare('SELECT points FROM users WHERE username = ?').get(tags.username.toLowerCase());
            const userPoints = user ? user.points : 0;
            client.say(channel, `@${tags.username}, you have ${userPoints} CUHZ points! 💎`);
        } catch (err) {
            logger.error('Error fetching points:', err.message);
        }
        return;
    }

    // 3. Mod / Owner Commands
    const isMod = tags.mod || (tags.badges && tags.badges.broadcaster);

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

    if (msg === '!aistats' && tags.username === 'fourareason4') {
        const aiStats = aiService.getStats();
        const cacheStats = await contextHandler.getCacheStats();
        const modelStatus = `Active: ${aiStats.activeModel.toUpperCase()} | Gemini: ${aiStats.geminiAvailable ? '✅' : '❌'} | Qwen: ${aiStats.qwenAvailable ? '✅' : '❌'}`;
        client.say(channel, `🤖 ${modelStatus} | ${aiStats.requestsThisMinute}/${aiStats.maxRequestsPerMinute} req/min | Cache: ${cacheStats.active_entries} | Fails: ${aiStats.geminiFailures}`);
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
