const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('./logger');
const config = require('./config');

// Initialize Gemini AI
let genAI = null;
let model = null;

if (config.geminiApiKey) {
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
    model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); // Fast, free tier
    logger.info('✅ Gemini AI initialized');
} else {
    logger.warn('⚠️ GEMINI_API_KEY not set - AI features disabled');
}

// Rate limiting for free tier (15 requests/min)
const requestQueue = [];
const MAX_REQUESTS_PER_MINUTE = 15;
let requestCount = 0;

setInterval(() => {
    requestCount = 0;
}, 60000);

// Response cache to reduce API calls
const responseCache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

/**
 * Analyze sentiment of recent chat messages
 * @param {Array<{username: string, message: string}>} messages - Recent chat messages
 * @returns {Promise<{mood: string, energy: number, toxicity: number, summary: string}>}
 */
async function analyzeSentiment(messages) {
    if (!model || messages.length === 0) {
        return { mood: 'neutral', energy: 50, toxicity: 0, summary: 'No AI available' };
    }

    // Rate limiting check
    if (requestCount >= MAX_REQUESTS_PER_MINUTE) {
        logger.warn('⚠️ AI rate limit reached, using fallback sentiment');
        return fallbackSentimentAnalysis(messages);
    }

    try {
        requestCount++;

        const chatSample = messages.map(m => `${m.username}: ${m.message}`).join('\n');

        const prompt = `Analyze the sentiment and energy of these Twitch chat messages. Respond ONLY with valid JSON, no other text.

Chat messages:
${chatSample}

Respond with this exact JSON structure:
{
  "mood": "<positive|negative|neutral|hype|toxic>",
  "energy": <0-100>,
  "toxicity": <0-100>,
  "summary": "<brief 1-sentence description>"
}

Guidelines:
- mood: "hype" for excited/caps-heavy chats, "toxic" for hostile/offensive, "positive" for friendly, "negative" for sad/complaining, "neutral" otherwise
- energy: 0=dead chat, 50=normal, 100=extremely active/excited
- toxicity: 0=clean, 50=some edgy jokes, 100=very offensive/hostile
- summary: One sentence describing the vibe`;

        const result = await model.generateContent(prompt);
        const response = result.response.text().trim();

        // Extract JSON from response (sometimes wrapped in markdown)
        let jsonText = response;
        if (response.includes('```json')) {
            jsonText = response.split('```json')[1].split('```')[0].trim();
        } else if (response.includes('```')) {
            jsonText = response.split('```')[1].split('```')[0].trim();
        }

        const analysis = JSON.parse(jsonText);

        logger.info(`🤖 AI Sentiment: ${analysis.mood} (energy: ${analysis.energy}, toxicity: ${analysis.toxicity})`);

        return analysis;
    } catch (error) {
        logger.error(`❌ AI sentiment analysis failed: ${error.message}`);
        return fallbackSentimentAnalysis(messages);
    }
}

/**
 * Generate context-aware response to natural language queries
 * @param {string} userMessage - The user's message
 * @param {Array<string>} recentMessages - Recent chat context
 * @param {string} currentMood - Current chat mood
 * @param {Object} availableCommands - Bot commands that can be suggested
 * @returns {Promise<string|null>} - Response or null if not a query
 */
async function generateContextAwareResponse(userMessage, recentMessages = [], currentMood = 'neutral', availableCommands = {}) {
    if (!model) {
        return null;
    }

    // Check cache first
    const cacheKey = userMessage.toLowerCase().trim();
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        logger.info('💾 Using cached AI response');
        return cached.response;
    }

    // Rate limiting check
    if (requestCount >= MAX_REQUESTS_PER_MINUTE) {
        logger.warn('⚠️ AI rate limit reached, skipping context response');
        return null;
    }

    try {
        requestCount++;

        const context = recentMessages.slice(-5).join('\n');
        const commandList = Object.entries(availableCommands)
            .map(([cmd, desc]) => `${cmd}: ${desc}`)
            .join('\n');

        const prompt = `You are the Antigravity Agent, a Twitch chat bot for Planet CUHZ - a cosmic creator community.

Current chat mood: ${currentMood}
Recent messages:
${context}

Available commands:
${commandList}

User says: "${userMessage}"

Instructions:
1. If this is a QUESTION or REQUEST for information (how to join, what is, when, where, etc.), provide a helpful, friendly response
2. If it's just regular chat/reaction (hype, emotes, casual talk), respond with: NO_RESPONSE
3. Keep responses under 200 characters
4. Match the current mood (${currentMood}): use emojis and energy if "hype", be supportive if negative, casual if neutral
5. Include relevant links/commands when appropriate
6. Use Planet CUHZ brand voice: welcoming, cosmic theme, "cuhz" instead of "cousin"

Respond with ONLY the message to send, or NO_RESPONSE if not needed.`;

        const result = await model.generateContent(prompt);
        const response = result.response.text().trim();

        if (response === 'NO_RESPONSE' || response.length === 0) {
            return null;
        }

        // Cache the response
        responseCache.set(cacheKey, {
            response,
            timestamp: Date.now()
        });

        logger.info(`🤖 AI Context Response: "${response}"`);
        return response;

    } catch (error) {
        logger.error(`❌ AI context response failed: ${error.message}`);
        return null;
    }
}

/**
 * Fallback sentiment analysis using keyword matching
 * @param {Array<{username: string, message: string}>} messages
 * @returns {Object}
 */
function fallbackSentimentAnalysis(messages) {
    const positiveWords = ['lol', 'hype', 'love', 'great', 'awesome', 'amazing', 'lets go', 'lfg', 'pog', 'w'];
    const negativeWords = ['bad', 'hate', 'boring', 'sad', 'terrible', 'trash', 'l ', ' l'];
    const toxicWords = ['fuck', 'shit', 'stupid', 'idiot', 'noob', 'trash talk'];
    const hypeWords = ['!!!!', 'lets go', 'lfg', 'hype', 'pog', 'poggers', 'w'];

    let positiveCount = 0;
    let negativeCount = 0;
    let toxicCount = 0;
    let capsCount = 0;
    let totalWords = 0;

    messages.forEach(({ message }) => {
        const lower = message.toLowerCase();
        totalWords += message.split(' ').length;

        positiveWords.forEach(word => {
            if (lower.includes(word)) positiveCount++;
        });
        negativeWords.forEach(word => {
            if (lower.includes(word)) negativeCount++;
        });
        toxicWords.forEach(word => {
            if (lower.includes(word)) toxicCount++;
        });
        hypeWords.forEach(word => {
            if (lower.includes(word)) capsCount++;
        });

        // Count caps letters
        const capsLetters = message.replace(/[^A-Z]/g, '').length;
        if (capsLetters > message.length * 0.5) capsCount++;
    });

    const avgWordsPerMessage = totalWords / messages.length;
    const energy = Math.min(100, Math.max(0,
        50 + (capsCount * 10) + (avgWordsPerMessage * 5) - (messages.length < 3 ? 20 : 0)
    ));

    const toxicity = Math.min(100, toxicCount * 20);

    let mood = 'neutral';
    if (toxicity > 40) {
        mood = 'toxic';
    } else if (capsCount > 3 && positiveCount > negativeCount) {
        mood = 'hype';
    } else if (positiveCount > negativeCount + 2) {
        mood = 'positive';
    } else if (negativeCount > positiveCount + 2) {
        mood = 'negative';
    }

    return {
        mood,
        energy: Math.round(energy),
        toxicity: Math.round(toxicity),
        summary: `Fallback analysis: ${mood} mood detected`
    };
}

/**
 * Clear response cache (useful for testing)
 */
function clearCache() {
    responseCache.clear();
    logger.info('🧹 AI response cache cleared');
}

/**
 * Get AI service statistics
 */
function getStats() {
    return {
        requestsThisMinute: requestCount,
        maxRequestsPerMinute: MAX_REQUESTS_PER_MINUTE,
        cacheSize: responseCache.size,
        aiEnabled: model !== null
    };
}

module.exports = {
    analyzeSentiment,
    generateContextAwareResponse,
    clearCache,
    getStats
};
