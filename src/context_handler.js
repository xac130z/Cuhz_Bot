const logger = require('./logger');
const aiService = require('./ai_service');
const db = require('./database');

// Context buffer: stores recent messages per channel for conversation understanding
const contextBuffers = new Map();
const CONTEXT_BUFFER_SIZE = 20;

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
 * Check if message is a question or request
 * @param {string} message
 * @returns {boolean}
 */
function isQuestionOrRequest(message) {
    const lowerMsg = message.toLowerCase();

    // Question words
    const questionWords = ['how', 'what', 'when', 'where', 'why', 'who', 'which', 'can', 'could', 'would', 'should', 'is', 'are', 'do', 'does'];
    const hasQuestionWord = questionWords.some(word => lowerMsg.startsWith(word) || lowerMsg.includes(` ${word} `));

    // Question mark
    const hasQuestionMark = message.includes('?');

    // Request patterns
    const requestPatterns = [
        'tell me',
        'show me',
        'i want',
        'i need',
        'help with',
        'link to',
        'where can',
        'how do i'
    ];
    const hasRequestPattern = requestPatterns.some(pattern => lowerMsg.includes(pattern));

    return hasQuestionWord || hasQuestionMark || hasRequestPattern;
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
 * @returns {Promise<string|null>}
 */
async function handleContextAwareResponse(channel, username, message, currentMood, availableCommands, personalityConfig = null) {
    // First check if it's even a question/request
    if (!isQuestionOrRequest(message)) {
        return null;
    }

    // Try to match with existing commands first (faster, no API call)
    const commandMatch = matchExistingCommand(message, availableCommands);
    if (commandMatch) {
        return `@${username} ${commandMatch}`;
    }

    // Check cache for similar queries
    const cachedResponse = await getCachedResponse(message);
    if (cachedResponse) {
        logger.info('💾 Using cached context response');
        return `@${username} ${cachedResponse}`;
    }

    // Use AI for complex context understanding
    initChannel(channel);
    const context = contextBuffers.get(channel) || [];

    try {
        const aiResponse = await aiService.generateContextAwareResponse(
            message,
            context,
            currentMood,
            availableCommands,
            personalityConfig
        );

        if (aiResponse) {
            // Save to cache
            await cacheResponse(message, aiResponse);
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
async function getCachedResponse(query) {
    try {
        const normalizedQuery = query.toLowerCase().trim();

        const result = db.prepare(`
            SELECT response 
            FROM context_cache 
            WHERE LOWER(query) = ? 
            AND (expires_at IS NULL OR expires_at > datetime('now'))
            LIMIT 1
        `).get(normalizedQuery);

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
async function cacheResponse(query, response, ttlHours = 24) {
    try {
        const normalizedQuery = query.toLowerCase().trim();
        const expiresAt = new Date(Date.now() + ttlHours * 3600000).toISOString();

        db.prepare(`
            INSERT OR REPLACE INTO context_cache (channel, query, response, expires_at)
            VALUES ('*', ?, ?, ?)
        `).run(normalizedQuery, response, expiresAt);

        logger.info(`💾 Cached context response for: "${query}"`);
    } catch (error) {
        logger.error(`❌ Failed to cache response: ${error.message}`);
    }
}

/**
 * Clear expired cache entries
 */
function cleanExpiredCache() {
    try {
        const result = db.prepare(`
            DELETE FROM context_cache 
            WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
        `).run();

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
 * @returns {Object}
 */
function getCacheStats() {
    try {
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total_entries,
                COUNT(CASE WHEN expires_at > datetime('now') THEN 1 END) as active_entries,
                COUNT(CASE WHEN expires_at <= datetime('now') THEN 1 END) as expired_entries
            FROM context_cache
        `).get();

        return stats;
    } catch (error) {
        logger.error(`❌ Failed to get cache stats: ${error.message}`);
        return { total_entries: 0, active_entries: 0, expired_entries: 0 };
    }
}

// Clean expired cache every hour
setInterval(cleanExpiredCache, 3600000);

module.exports = {
    initChannel,
    addToContext,
    handleContextAwareResponse,
    isQuestionOrRequest,
    matchExistingCommand,
    getContext,
    clearContext,
    getCacheStats,
    cleanExpiredCache
};
