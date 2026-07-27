const logger = require('./logger');
const aiService = require('./ai_service');
const db = require('./database');

// Context buffer: stores recent messages per channel for conversation understanding
const contextBuffers = new Map();
const CONTEXT_BUFFER_SIZE = 20;

// Response cooldown: prevents bot from spamming same user
const userResponseCooldowns = new Map(); // username -> last response timestamp
const RESPONSE_COOLDOWN_MS = 45000; // 45 seconds between responses to same user

// Bot identity for mention detection
const BOT_USERNAME = (process.env.BOT_USERNAME || 'cuhz_bot').toLowerCase();

/**
 * Initialize context tracking for a channel
 * @param {string} channel
 */
function initChannel(channel) {
    if (!contextBuffers.has(channel)) {
        contextBuffers.set(channel, []);
        logger.info(`💬 Context handler initialized for ${channel}`);
    }
}

/**
 * Add message to context buffer
 * @param {string} channel
 * @param {string} username
 * @param {string} message
 */
function addToContext(channel, username, message) {
    initChannel(channel);

    const buffer = contextBuffers.get(channel);
    buffer.push(`${username}: ${message}`);

    // Keep only recent messages
    if (buffer.length > CONTEXT_BUFFER_SIZE) {
        buffer.shift();
    }
}

/**
 * Check if bot can respond to a user (cooldown check)
 * @param {string} username
 * @returns {boolean}
 */
function canRespondToUser(username) {
    const lastResponse = userResponseCooldowns.get(username.toLowerCase());
    if (!lastResponse) return true;
    return (Date.now() - lastResponse) > RESPONSE_COOLDOWN_MS;
}

/**
 * Record that bot responded to user (for cooldown)
 * @param {string} username
 */
function recordResponse(username) {
    userResponseCooldowns.set(username.toLowerCase(), Date.now());
}

/**
 * Check if message contains CUHZ-related keywords
 * @param {string} message
 * @returns {boolean}
 */
function isCuhzRelated(message) {
    const lowerMsg = message.toLowerCase();
    return lowerMsg.includes('cuhz') ||
        lowerMsg.includes('planet') ||
        lowerMsg.includes('chain');
}

/**
 * Check if message is a question or request worth responding to
 * Improved to reduce false positives from casual chat
 * @param {string} message
 * @returns {boolean}
 */
function isQuestionOrRequest(message) {
    const lowerMsg = message.toLowerCase().trim();

    // Never treat links/promos as questions — URL query strings contain '?'
    // and previously tripped the question detector (bot scolded the streamer
    // for posting his own YouTube link). Links are never the bot's business.
    if (/(https?:\/\/|www\.|\.com\/|\.gg\/|youtu\.be)/i.test(lowerMsg)) {
        return false;
    }

    // CUHZ keyword boost — lower threshold for CUHZ-related messages
    const hasCuhzKeyword = isCuhzRelated(message);
    const minLength = hasCuhzKeyword ? 8 : 15; // More lenient for CUHZ mentions

    // Skip very short messages — too ambiguous to determine intent
    if (lowerMsg.length < minLength) {
        return false;
    }

    // Skip if it looks like an emote or reaction (all caps, single words, emote-like patterns)
    if (/^[A-Z!?]+$/.test(message.trim()) || message.trim().split(' ').length <= 2) {
        // Allow if it ends with ? even if short, OR if CUHZ-related
        if (!message.includes('?') && !hasCuhzKeyword) return false;
    }

    // Direct question mark is a strong signal
    const hasQuestionMark = message.includes('?');

    // Question words — only count if they START the sentence
    const questionStarters = ['how ', 'what ', 'when ', 'where ', 'why ', 'who ', 'which ', 'can i ', 'can you ', 'could you ', 'would you ', 'should i ', 'does anyone ', 'do you ', 'is there '];
    const startsWithQuestion = questionStarters.some(word => lowerMsg.startsWith(word));

    // Request patterns — strong intent signals
    const requestPatterns = [
        'tell me', 'show me', 'i want to know', 'i need help',
        'help with', 'link to', 'where can i', 'how do i',
        'what is', 'explain', 'looking for'
    ];
    const hasRequestPattern = requestPatterns.some(pattern => lowerMsg.includes(pattern));

    // Direct bot mention is always worth responding to
    const mentionsBot = lowerMsg.includes(`@${BOT_USERNAME}`) || lowerMsg.includes('cuhz bot') || lowerMsg.includes('cuhzbot');

    // Must have at least one strong signal
    return mentionsBot || hasRequestPattern || (startsWithQuestion && hasQuestionMark) || (hasQuestionMark && lowerMsg.length > 20);
}

/**
 * Check if message can be answered with existing commands
 * @param {string} message
 * @param {Object} availableCommands
 * @returns {string|null} - Command response or null
 */
function matchExistingCommand(message, availableCommands) {
    const lowerMsg = message.toLowerCase();

    // Direct command keyword matching
    const commandKeywords = {
        'discord': ['discord', 'server', 'community'],
        'links': ['links', 'linktree', 'socials', 'social media'],
        'cuhz': ['planet cuhz', 'what is cuhz', 'planetcuhz', 'website'],
        'uptime': ['uptime', 'how long', 'stream start', 'when did stream'],
        'hype': ['hype', 'lets go', 'pump up'],
        'help': ['help', 'commands', 'what can you do'],
        'points': ['points', 'my points', 'how many points']
    };

    for (const [commandName, keywords] of Object.entries(commandKeywords)) {
        const matchingKeyword = keywords.some(kw => lowerMsg.includes(kw));
        if (matchingKeyword) {
            const cmdKey = `!${commandName}`;
            if (availableCommands[cmdKey]) {
                logger.info(`🎯 Matched question to existing command: ${cmdKey}`);
                return availableCommands[cmdKey];
            }
        }
    }

    return null;
}

/**
 * Handle context-aware response using AI
 * @param {string} channel
 * @param {string} username
 * @param {string} message
 * @param {string} currentMood
 * @param {Object} availableCommands
 * @param {Object} personalityConfig - Personality configuration (optional)
 * @param {Object} userProfile - User profile data for personalization (optional)
 * @returns {Promise<string|null>}
 */
async function handleContextAwareResponse(channel, username, message, currentMood, availableCommands, personalityConfig = null, userProfile = null, streamState = null) {
    // First check if it's even a question/request
    if (!isQuestionOrRequest(message)) {
        return null;
    }

    // Check cooldown to prevent spam
    if (!canRespondToUser(username)) {
        logger.debug(`⏱️ Cooldown active for ${username}, skipping response`);
        return null;
    }

    // Try to match with existing commands first (faster, no API call)
    const commandMatch = matchExistingCommand(message, availableCommands);
    if (commandMatch) {
        return `@${username} ${commandMatch}`;
    }

    // Check cache for similar queries (per channel — communities don't share replies)
    const cachedResponse = await getCachedResponse(channel, message);
    if (cachedResponse) {
        logger.info('💾 Using cached context response');
        return `@${username} ${cachedResponse}`;
    }

    // Use AI for complex context understanding
    initChannel(channel);
    const context = contextBuffers.get(channel) || [];

    try {
        const aiResponse = await aiService.generateContextAwareResponse(
            channel,
            message,
            context,
            currentMood,
            availableCommands,
            personalityConfig,
            userProfile,  // Pass user profile for personalization
            streamState   // Pass live stream info (game/title) for grounding
        );

        if (aiResponse) {
            // Save to cache
            await cacheResponse(channel, message, aiResponse);
            // Record response for cooldown tracking
            recordResponse(username);
            return `@${username} ${aiResponse}`;
        }

        return null;
    } catch (error) {
        logger.error(`❌ Context-aware response failed: ${error.message}`);
        return null;
    }
}

/**
 * Get response from database cache
 * @param {string} query
 * @returns {Promise<string|null>}
 */
async function getCachedResponse(channel, query) {
    try {
        const normalizedQuery = query.toLowerCase().trim();
        const now = new Date().toISOString();

        const result = await db.prepare(`
            SELECT response 
            FROM context_cache 
            WHERE channel = ? AND LOWER(query) = ? 
            AND (expires_at IS NULL OR expires_at > ?)
            LIMIT 1
        `).get(channel, normalizedQuery, now);

        return result ? result.response : null;
    } catch (error) {
        logger.error(`❌ Failed to get cached response: ${error.message}`);
        return null;
    }
}

/**
 * Cache AI response for future use
 * @param {string} query
 * @param {string} response
 * @param {number} ttlHours - Time to live in hours
 */
async function cacheResponse(channel, query, response, ttlHours = 1) {
    try {
        const normalizedQuery = query.toLowerCase().trim();
        const expiresAt = new Date(Date.now() + ttlHours * 3600000).toISOString();

        // Delete existing cache entry for this channel+query first to avoid duplicates
        await db.prepare(`
            DELETE FROM context_cache WHERE channel = ? AND LOWER(query) = ?
        `).run(channel, normalizedQuery);

        await db.prepare(`
            INSERT INTO context_cache (channel, query, response, expires_at)
            VALUES (?, ?, ?, ?)
        `).run(channel, normalizedQuery, response, expiresAt);

        logger.info(`💾 Cached context response for: "${query}"`);
    } catch (error) {
        logger.error(`❌ Failed to cache response: ${error.message}`);
    }
}

/**
 * Clear expired cache entries
 */
async function cleanExpiredCache() {
    try {
        const now = new Date().toISOString();
        const result = await db.prepare(`
            DELETE FROM context_cache 
            WHERE expires_at IS NOT NULL AND expires_at < ?
        `).run(now);

        if (result.changes > 0) {
            logger.info(`🧹 Cleaned ${result.changes} expired cache entries`);
        }
    } catch (error) {
        logger.error(`❌ Failed to clean cache: ${error.message}`);
    }
}

/**
 * Get context buffer for a channel
 * @param {string} channel
 * @returns {Array<string>}
 */
function getContext(channel) {
    initChannel(channel);
    return contextBuffers.get(channel) || [];
}

/**
 * Clear context buffer for a channel
 * @param {string} channel
 */
function clearContext(channel) {
    if (contextBuffers.has(channel)) {
        contextBuffers.set(channel, []);
        logger.info(`🧹 Cleared context for ${channel}`);
    }
}

/**
 * Get cache statistics
 * @returns {Promise<Object>}
 */
async function getCacheStats() {
    try {
        const now = new Date().toISOString();
        const stats = await db.prepare(`
            SELECT 
                COUNT(*) as total_entries,
                COUNT(CASE WHEN expires_at > ? THEN 1 END) as active_entries,
                COUNT(CASE WHEN expires_at <= ? THEN 1 END) as expired_entries
            FROM context_cache
        `).get(now, now);

        return stats;
    } catch (error) {
        logger.error(`❌ Failed to get cache stats: ${error.message}`);
        return { total_entries: 0, active_entries: 0, expired_entries: 0 };
    }
}

// Clean expired cache every hour
setInterval(cleanExpiredCache, 3600000).unref(); // unref: don't hold the event loop open (lets tests/shutdown exit)

module.exports = {
    initChannel,
    addToContext,
    handleContextAwareResponse,
    isQuestionOrRequest,
    matchExistingCommand,
    getContext,
    clearContext,
    getCacheStats,
    cleanExpiredCache,
    canRespondToUser,
    recordResponse,
    isCuhzRelated
};
