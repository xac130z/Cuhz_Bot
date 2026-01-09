const logger = require('./logger');
const db = require('./database');

// Mood tracking state per channel
const channelMoodState = new Map();

// Mood thresholds for personality changes
const MOOD_THRESHOLDS = {
    HYPE: { energy: 70, minPositive: 40 },
    CHILL: { energy: 30, minPositive: 50 },
    SUPPORTIVE: { toxicity: 15, maxEnergy: 60 },
    TOXIC: { toxicity: 50 },
    NEUTRAL: {} // Default
};

// Personality modes
const PERSONALITIES = {
    hype: {
        tone: 'excited',
        useEmojis: true,
        useCaps: true,
        enthusiasmLevel: 'high',
        examples: ['LET\'S GO CUHZ! 🚀🔥', 'HYPE TRAIN INCOMING! 🌌', 'TO THE MOON! 💎']
    },
    chill: {
        tone: 'relaxed',
        useEmojis: false,
        useCaps: false,
        enthusiasmLevel: 'low',
        examples: ['vibing with the cuhz fam ✨', 'just here for the good times', 'chillin on planet cuhz 🌙']
    },
    supportive: {
        tone: 'encouraging',
        useEmojis: true,
        useCaps: false,
        enthusiasmLevel: 'medium',
        examples: ['We got this, cuhz! 💪', 'Keep your head up! 🌟', 'The cuhz fam is here for you ❤️']
    },
    moderated: {
        tone: 'serious',
        useEmojis: false,
        useCaps: false,
        enthusiasmLevel: 'low',
        examples: ['Let\'s keep chat positive, cuhz', 'Remember the community guidelines', 'Keep it respectful']
    },
    neutral: {
        tone: 'friendly',
        useEmojis: true,
        useCaps: false,
        enthusiasmLevel: 'medium',
        examples: ['Welcome to Planet CUHZ! 🌌', 'Good to see you, cuhz!', 'Thanks for hanging out! ✨']
    }
};

/**
 * Initialize mood tracking for a channel
 * @param {string} channel
 */
function initChannel(channel) {
    if (!channelMoodState.has(channel)) {
        channelMoodState.set(channel, {
            currentMood: 'neutral',
            currentPersonality: 'neutral',
            energy: 50,
            toxicity: 0,
            messageBuffer: [], // Rolling window of recent messages
            lastAnalysis: Date.now(),
            moodHistory: []
        });
        logger.info(`📊 Mood tracker initialized for ${channel}`);
    }
}

/**
 * Add message to channel buffer for analysis
 * @param {string} channel
 * @param {string} username
 * @param {string} message
 */
function addMessage(channel, username, message) {
    initChannel(channel);

    const state = channelMoodState.get(channel);
    state.messageBuffer.push({ username, message, timestamp: Date.now() });

    // Keep only last 20 messages in buffer
    if (state.messageBuffer.length > 20) {
        state.messageBuffer.shift();
    }
}

/**
 * Update mood based on AI sentiment analysis
 * @param {string} channel
 * @param {Object} sentimentData - {mood, energy, toxicity, summary}
 */
function updateMood(channel, sentimentData) {
    initChannel(channel);

    const state = channelMoodState.get(channel);
    state.currentMood = sentimentData.mood;
    state.energy = sentimentData.energy;
    state.toxicity = sentimentData.toxicity;
    state.lastAnalysis = Date.now();

    // Determine personality based on mood metrics
    const newPersonality = determinePersonality(sentimentData);

    if (newPersonality !== state.currentPersonality) {
        logger.info(`🎭 ${channel} personality changed: ${state.currentPersonality} → ${newPersonality}`);
        state.currentPersonality = newPersonality;
    }

    // Store in mood history
    state.moodHistory.push({
        mood: sentimentData.mood,
        energy: sentimentData.energy,
        toxicity: sentimentData.toxicity,
        timestamp: Date.now()
    });

    // Keep only last 50 mood snapshots
    if (state.moodHistory.length > 50) {
        state.moodHistory.shift();
    }

    // Save to database
    saveMoodToDatabase(channel, sentimentData);

    return newPersonality;
}

/**
 * Determine personality mode based on sentiment metrics
 * @param {Object} sentiment - {mood, energy, toxicity}
 * @returns {string} personality mode
 */
function determinePersonality(sentiment) {
    // Toxic takes highest priority
    if (sentiment.toxicity >= MOOD_THRESHOLDS.TOXIC.toxicity) {
        return 'moderated';
    }

    // Hype mode for high energy + positive mood
    if (sentiment.energy >= MOOD_THRESHOLDS.HYPE.energy &&
        (sentiment.mood === 'hype' || sentiment.mood === 'positive')) {
        return 'hype';
    }

    // Supportive for negative moods
    if (sentiment.mood === 'negative' && sentiment.toxicity < MOOD_THRESHOLDS.SUPPORTIVE.toxicity) {
        return 'supportive';
    }

    // Chill for low energy but positive
    if (sentiment.energy <= MOOD_THRESHOLDS.CHILL.energy &&
        sentiment.mood === 'positive') {
        return 'chill';
    }

    return 'neutral';
}

/**
 * Get current mood state for a channel
 * @param {string} channel
 * @returns {Object}
 */
function getMoodState(channel) {
    initChannel(channel);
    return channelMoodState.get(channel);
}

/**
 * Get current personality for a channel
 * @param {string} channel
 * @returns {string}
 */
function getCurrentPersonality(channel) {
    const state = getMoodState(channel);
    return state.currentPersonality;
}

/**
 * Get personality configuration
 * @param {string} personalityMode
 * @returns {Object}
 */
function getPersonalityConfig(personalityMode) {
    return PERSONALITIES[personalityMode] || PERSONALITIES.neutral;
}

/**
 * Manually override personality (for mods)
 * @param {string} channel
 * @param {string} personalityMode
 * @returns {boolean}
 */
function setPersonality(channel, personalityMode) {
    if (!PERSONALITIES[personalityMode]) {
        return false;
    }

    initChannel(channel);
    const state = channelMoodState.get(channel);
    state.currentPersonality = personalityMode;
    logger.info(`🎭 ${channel} personality manually set to: ${personalityMode}`);
    return true;
}

/**
 * Get message buffer for AI analysis
 * @param {string} channel
 * @returns {Array}
 */
function getMessageBuffer(channel) {
    const state = getMoodState(channel);
    return state.messageBuffer || [];
}

/**
 * Check if mood analysis is needed (time-based + message threshold)
 * @param {string} channel
 * @returns {boolean}
 */
function shouldAnalyzeMood(channel) {
    const state = getMoodState(channel);
    const timeSinceLastAnalysis = Date.now() - state.lastAnalysis;
    const messageCount = state.messageBuffer.length;

    // Analyze every 2 minutes OR when buffer reaches 15 messages
    return timeSinceLastAnalysis > 120000 || messageCount >= 15;
}

/**
 * Clear message buffer (after analysis)
 * @param {string} channel
 */
function clearMessageBuffer(channel) {
    const state = getMoodState(channel);
    if (state) {
        state.messageBuffer = [];
    }
}

/**
 * Save mood data to database
 * @param {string} channel
 * @param {Object} sentiment
 */
function saveMoodToDatabase(channel, sentiment) {
    try {
        const messageSample = channelMoodState.get(channel)?.messageBuffer
            .slice(-5)
            .map(m => `${m.username}: ${m.message}`)
            .join(' | ') || '';

        db.prepare(`
            INSERT INTO mood_history (channel, mood, energy, toxicity, message_sample)
            VALUES (?, ?, ?, ?, ?)
        `).run(channel, sentiment.mood, sentiment.energy, sentiment.toxicity, messageSample);

    } catch (error) {
        logger.error(`❌ Failed to save mood to database: ${error.message}`);
    }
}

/**
 * Get mood statistics for a channel
 * @param {string} channel
 * @param {number} hours - Hours to look back
 * @returns {Object}
 */
function getMoodStats(channel, hours = 24) {
    try {
        const since = new Date(Date.now() - hours * 3600000).toISOString();

        const stats = db.prepare(`
            SELECT 
                mood,
                AVG(energy) as avg_energy,
                AVG(toxicity) as avg_toxicity,
                COUNT(*) as count
            FROM mood_history
            WHERE channel = ? AND created_at >= ?
            GROUP BY mood
        `).all(channel, since);

        return stats;
    } catch (error) {
        logger.error(`❌ Failed to get mood stats: ${error.message}`);
        return [];
    }
}

/**
 * Check if hype injection is needed (low energy for extended period)
 * @param {string} channel
 * @returns {boolean}
 */
function needsHypeInjection(channel) {
    const state = getMoodState(channel);

    // Check recent mood history
    const recentMoods = state.moodHistory.slice(-5);
    if (recentMoods.length < 3) return false;

    const avgEnergy = recentMoods.reduce((sum, m) => sum + m.energy, 0) / recentMoods.length;

    // If energy has been below 40 for last few analyses, inject hype
    return avgEnergy < 40 && state.currentMood !== 'toxic';
}

module.exports = {
    initChannel,
    addMessage,
    updateMood,
    getMoodState,
    getCurrentPersonality,
    getPersonalityConfig,
    setPersonality,
    getMessageBuffer,
    shouldAnalyzeMood,
    clearMessageBuffer,
    getMoodStats,
    needsHypeInjection,
    PERSONALITIES
};
