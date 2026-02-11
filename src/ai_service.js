const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require('@google/generative-ai');
const logger = require('./logger');
const config = require('./config');

// =============================================
//  MULTI-MODEL AI SERVICE
//  Primary: Google Gemini 2.0 Flash
//  Backup:  Alibaba Qwen (OpenAI-compatible API)
// =============================================

// --- Gemini Setup ---
let genAI = null;
let geminiModel = null;

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

if (config.geminiApiKey) {
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
    geminiModel = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        safetySettings
    });
    logger.info('✅ Gemini AI initialized (gemini-2.0-flash)');
} else {
    logger.warn('⚠️ GEMINI_API_KEY not set - Gemini disabled');
}

// --- Qwen Setup ---
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const QWEN_MODEL = 'qwen-turbo'; // Fast, free-tier model
let qwenEnabled = false;

if (config.qwenApiKey) {
    qwenEnabled = true;
    logger.info('✅ Qwen AI initialized (qwen-turbo) — backup model ready');
} else {
    logger.warn('⚠️ QWEN_API_KEY not set - Qwen backup disabled');
}

// Track which model is active and failures
let geminiConsecutiveFailures = 0;
const GEMINI_FAILURE_THRESHOLD = 3; // After 3 failures, switch to Qwen
let activeModel = geminiModel ? 'gemini' : (qwenEnabled ? 'qwen' : 'none');

// --- Sliding Window Rate Limiter ---
const requestTimestamps = [];
const MAX_REQUESTS_PER_MINUTE = 15;
const RATE_WINDOW_MS = 60000;

function canMakeRequest() {
    const now = Date.now();
    while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_WINDOW_MS) {
        requestTimestamps.shift();
    }
    return requestTimestamps.length < MAX_REQUESTS_PER_MINUTE;
}

function recordRequest() {
    requestTimestamps.push(Date.now());
}

// --- TWITCH MESSAGE LENGTH GUARD ---
const TWITCH_MAX_LENGTH = 450;

function truncateForTwitch(text) {
    if (!text || text.length <= TWITCH_MAX_LENGTH) return text;
    return text.substring(0, TWITCH_MAX_LENGTH - 3) + '...';
}

// Response cache
const responseCache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

// --- Planet CUHZ Knowledge Base ---
const CUHZ_KNOWLEDGE = `
ABOUT PLANET CUHZ:
- Planet CUHZ is a cosmic creator ecosystem founded by FourAReason4
- "Cuhz" means family/cousin — the community treats everyone like fam
- Website: https://planetcuhz.com | Discord: https://discord.gg/5rFRaeBuHn
- Linktree: https://linktr.ee/PlanetCUHZ | Whitepaper: https://planetcuhz.com/whitepaper
- The CUHZ Chain Generator is a community tool: https://cuhz-bot-dashboard-846.created.app/chain-generator

STREAMERS:
- fourareason4 — The founder. Streams gaming, creative, and community content
- planetcuhz — The brand channel
- rico_santanax — Community streamer and collaborator

COMMUNITY VALUES:
- Welcoming and inclusive — no hate, no toxicity
- Creator empowerment — helping each other level up
- Cosmic/space theme — use references to planets, orbits, stars, galaxies
- "Stay CUHZ" is the motto

BRAND VOICE:
- Warm, energetic, cosmic-themed
- Use "cuhz" naturally (not forced) — like "what's good cuhz"
- Emojis: 🌌 🚀 💎 🔥 ✨ 🌍 🌙
- Never sound robotic or corporate — sound like a real community member
`.trim();

// =============================================
//  CORE: Multi-Model Prompt Execution
// =============================================

/**
 * Send a prompt to the active AI model. Falls back to Qwen if Gemini fails.
 * @param {string} prompt - The full prompt to send
 * @param {boolean} isJSON - Whether to expect JSON response
 * @returns {Promise<string|null>} - The AI response text
 */
async function executePrompt(prompt, isJSON = false) {
    // Try Gemini first (if available and not failing too much)
    if (geminiModel && geminiConsecutiveFailures < GEMINI_FAILURE_THRESHOLD) {
        try {
            const result = await geminiModel.generateContent(prompt);

            if (!result.response || !result.response.text) {
                throw new Error('Empty/blocked response from Gemini');
            }

            const text = result.response.text().trim();
            geminiConsecutiveFailures = 0; // Reset on success
            activeModel = 'gemini';
            return text;
        } catch (err) {
            geminiConsecutiveFailures++;
            const isSafety = err.message && (err.message.includes('SAFETY') || err.message.includes('blocked'));

            if (geminiConsecutiveFailures >= GEMINI_FAILURE_THRESHOLD) {
                logger.warn(`⚠️ Gemini failed ${GEMINI_FAILURE_THRESHOLD}x in a row — switching to Qwen backup`);
            } else if (isSafety) {
                logger.warn(`⚠️ Gemini safety filter triggered, trying Qwen...`);
            } else {
                logger.warn(`⚠️ Gemini error (${geminiConsecutiveFailures}/${GEMINI_FAILURE_THRESHOLD}): ${err.message}`);
            }

            // Fall through to Qwen
        }
    }

    // Try Qwen as backup
    if (qwenEnabled) {
        try {
            const response = await fetch(QWEN_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.qwenApiKey}`
                },
                body: JSON.stringify({
                    model: QWEN_MODEL,
                    messages: [
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: 300,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const errBody = await response.text();
                throw new Error(`Qwen API ${response.status}: ${errBody}`);
            }

            const data = await response.json();
            const text = data.choices?.[0]?.message?.content?.trim();

            if (!text) {
                throw new Error('Empty response from Qwen');
            }

            activeModel = 'qwen';
            logger.info(`🤖 Response from Qwen backup model`);
            return text;
        } catch (err) {
            logger.error(`❌ Qwen backup also failed: ${err.message}`);
        }
    }

    // Both models failed
    return null;
}

// Periodically try to recover Gemini if it was disabled
setInterval(() => {
    if (geminiModel && geminiConsecutiveFailures >= GEMINI_FAILURE_THRESHOLD) {
        logger.info('🔄 Attempting to recover Gemini as primary model...');
        geminiConsecutiveFailures = 0; // Give it another chance
    }
}, 5 * 60 * 1000); // Every 5 minutes

// =============================================
//  PUBLIC API
// =============================================

/**
 * Analyze sentiment of recent chat messages
 */
async function analyzeSentiment(messages) {
    if (activeModel === 'none' || messages.length === 0) {
        return { mood: 'neutral', energy: 50, toxicity: 0, summary: 'No AI available' };
    }

    if (!canMakeRequest()) {
        logger.warn('⚠️ AI rate limit reached, using fallback sentiment');
        return fallbackSentimentAnalysis(messages);
    }

    try {
        recordRequest();

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

        const response = await executePrompt(prompt, true);

        if (!response) {
            return fallbackSentimentAnalysis(messages);
        }

        // Extract JSON
        let jsonText = response;
        if (response.includes('```json')) {
            jsonText = response.split('```json')[1].split('```')[0].trim();
        } else if (response.includes('```')) {
            jsonText = response.split('```')[1].split('```')[0].trim();
        }

        const analysis = JSON.parse(jsonText);

        if (!analysis.mood || analysis.energy === undefined || analysis.toxicity === undefined) {
            return fallbackSentimentAnalysis(messages);
        }

        analysis.energy = Math.max(0, Math.min(100, analysis.energy));
        analysis.toxicity = Math.max(0, Math.min(100, analysis.toxicity));

        logger.info(`🤖 AI Sentiment [${activeModel}]: ${analysis.mood} (energy: ${analysis.energy}, toxicity: ${analysis.toxicity})`);
        return analysis;
    } catch (error) {
        logger.error(`❌ AI sentiment analysis failed: ${error.message}`);
        return fallbackSentimentAnalysis(messages);
    }
}

/**
 * Generate context-aware response to natural language queries
 */
async function generateContextAwareResponse(userMessage, recentMessages = [], currentMood = 'neutral', availableCommands = {}, personalityConfig = null, userProfile = null) {
    if (activeModel === 'none') return null;

    // Check cache first
    const cacheKey = userMessage.toLowerCase().trim();
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        logger.info('💾 Using cached AI response');
        return cached.response;
    }

    if (!canMakeRequest()) {
        logger.warn('⚠️ AI rate limit reached, skipping context response');
        return null;
    }

    try {
        recordRequest();

        const context = recentMessages.slice(-5).join('\n');
        const commandList = Object.entries(availableCommands)
            .map(([cmd, desc]) => `${cmd}: ${desc}`)
            .join('\n');

        let personalityInstructions = '';
        if (personalityConfig) {
            personalityInstructions = `
Personality Mode: ${currentMood}
- Tone: ${personalityConfig.tone}
- Use Emojis: ${personalityConfig.useEmojis ? 'YES' : 'NO'}
- Use CAPS: ${personalityConfig.useCaps ? 'YES (for emphasis)' : 'NO'}
- Enthusiasm Level: ${personalityConfig.enthusiasmLevel}
- Examples of this personality: ${personalityConfig.examples.join(' | ')}`;
        }

        let userContext = '';
        if (userProfile) {
            userContext = `\nUser Profile for "${userProfile.username}":`;
            if (userProfile.total_messages) userContext += `\n- Messages sent: ${userProfile.total_messages}`;
            if (userProfile.relationship_score) userContext += `\n- Relationship score: ${userProfile.relationship_score}/100`;
            if (userProfile.notes) userContext += `\n- Known for: ${userProfile.notes}`;
            if (userProfile.first_seen) userContext += `\n- First seen: ${userProfile.first_seen}`;
        }

        const prompt = `${CUHZ_KNOWLEDGE}

You are the CUHZ Bot, the official Twitch bot for Planet CUHZ.

Current chat mood: ${currentMood}
${personalityInstructions}
${userContext}

Recent messages:
${context}

Available commands:
${commandList}

User says: "${userMessage}"

Instructions:
1. If this is a QUESTION or REQUEST for information, provide a helpful, friendly response
2. If it's just regular chat/reaction (hype, emotes, casual talk), respond with: NO_RESPONSE
3. Keep responses under 200 characters (HARD LIMIT)
4. IMPORTANT: Match the personality mode ${currentMood} exactly
5. Include relevant links/commands when appropriate
6. Sound like a real community member, not a corporate bot
7. If you know the user (from their profile above), personalize your response subtly

Respond with ONLY the message to send, or NO_RESPONSE if not needed.`;

        let response = await executePrompt(prompt);

        if (!response || response === 'NO_RESPONSE' || response.length === 0) {
            return null;
        }

        response = truncateForTwitch(response);

        responseCache.set(cacheKey, { response, timestamp: Date.now() });

        logger.info(`🤖 AI Context Response [${activeModel}]: "${response}"`);
        return response;

    } catch (error) {
        logger.error(`❌ AI context response failed: ${error.message}`);
        return null;
    }
}

/**
 * Generate a proactive message for lull periods
 */
async function generateProactiveMessage(channel, recentMessages = [], currentMood = 'neutral') {
    if (activeModel === 'none' || !canMakeRequest()) return null;

    try {
        recordRequest();

        const context = recentMessages.slice(-5).join('\n');

        const prompt = `${CUHZ_KNOWLEDGE}

You are the CUHZ Bot in Twitch channel ${channel}. Chat energy is LOW right now.

Recent messages:
${context}

Current mood: ${currentMood}

Generate ONE short, engaging message (under 150 chars) to spark conversation. Options:
- Ask an interesting question about gaming, music, or content creation
- Share a fun fact or cosmic trivia
- Hype up the stream or community
- Reference something from the recent chat to keep the convo going

Do NOT be generic. Be specific and interesting. Sound natural, not robotic.
Respond with ONLY the message, nothing else.`;

        let response = await executePrompt(prompt);
        return response ? truncateForTwitch(response) : null;
    } catch (error) {
        logger.warn(`⚠️ Proactive message generation failed: ${error.message}`);
        return null;
    }
}

/**
 * Fallback sentiment analysis using keyword matching
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

        positiveWords.forEach(word => { if (lower.includes(word)) positiveCount++; });
        negativeWords.forEach(word => { if (lower.includes(word)) negativeCount++; });
        toxicWords.forEach(word => { if (lower.includes(word)) toxicCount++; });
        hypeWords.forEach(word => { if (lower.includes(word)) capsCount++; });

        const capsLetters = message.replace(/[^A-Z]/g, '').length;
        if (capsLetters > message.length * 0.5) capsCount++;
    });

    const avgWordsPerMessage = totalWords / messages.length;
    const energy = Math.min(100, Math.max(0,
        50 + (capsCount * 10) + (avgWordsPerMessage * 5) - (messages.length < 3 ? 20 : 0)
    ));

    const toxicity = Math.min(100, toxicCount * 20);

    let mood = 'neutral';
    if (toxicity > 40) mood = 'toxic';
    else if (capsCount > 3 && positiveCount > negativeCount) mood = 'hype';
    else if (positiveCount > negativeCount + 2) mood = 'positive';
    else if (negativeCount > positiveCount + 2) mood = 'negative';

    return {
        mood,
        energy: Math.round(energy),
        toxicity: Math.round(toxicity),
        summary: `Fallback analysis: ${mood} mood detected`
    };
}

/**
 * Clear response cache
 */
function clearCache() {
    responseCache.clear();
    logger.info('🧹 AI response cache cleared');
}

/**
 * Get AI service statistics
 */
function getStats() {
    const now = Date.now();
    while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_WINDOW_MS) {
        requestTimestamps.shift();
    }

    return {
        activeModel,
        geminiAvailable: geminiModel !== null,
        qwenAvailable: qwenEnabled,
        geminiFailures: geminiConsecutiveFailures,
        requestsThisMinute: requestTimestamps.length,
        maxRequestsPerMinute: MAX_REQUESTS_PER_MINUTE,
        cacheSize: responseCache.size,
        aiEnabled: activeModel !== 'none'
    };
}

module.exports = {
    analyzeSentiment,
    generateContextAwareResponse,
    generateProactiveMessage,
    clearCache,
    getStats,
    truncateForTwitch,
    CUHZ_KNOWLEDGE
};
