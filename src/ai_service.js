const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('./logger');
const config = require('./config');

// =============================================
//  TRI-BRAIN AI SERVICE
//
//  👁️  THE EYES  — Gemini 2.0 Flash (Speed, Chat, Sentiment)
//  🧠 THE BRAIN — Claude (Complex decisions, moderation, persona)
//  🔧 THE HANDS — Qwen 2.5 via Groq (Code, logic, technical)
//
//  Each brain has its own executePrompt. The router picks the
//  right brain based on message "vibe" classification.
// =============================================

// ─────────── Safety Filter ───────────
const BANNED_WORDS = [
    // TOS-critical words — bot will NEVER post these
    // Add real slurs/banned terms here (kept empty for repo safety)
];

function safetyFilter(text) {
    if (!text) return text;
    const lower = text.toLowerCase();
    for (const word of BANNED_WORDS) {
        if (lower.includes(word)) {
            logger.warn(`🛡️ Safety filter caught banned content, blocking response`);
            return 'My bad cuhz, I almost said something wild. 🤐';
        }
    }
    return text;
}

// ─────────── Planet CUHZ Knowledge Base ───────────
const CUHZ_KNOWLEDGE = `
ABOUT PLANET CUHZ:
- Planet CUHZ is a cosmic creator ecosystem founded by planetcuhz
- "Cuhz" means family/cousin — the community treats everyone like fam
- Website: https://planetcuhz.com | Discord: https://discord.gg/wt6Zc7Sgjx
- Linktree: https://linktr.ee/PlanetCUHZ | Whitepaper: https://planetcuhz.com/whitepaper
- The CUHZ Chain Generator is a community tool: https://cuhz-bot-dashboard-846.created.app/chain-generator

STREAMERS:
- planetcuhz — The founder, solo dev building AI.
- planetcuhz — The brand channel (the boss)
- rico2ez — Community streamer and collaborator
- snowy_wolfies_ttv — The stats god
- thatgirlmahni_ — The trophy holder (formerly VGxMahni)

COMMUNITY VALUES:
- Welcoming and inclusive — no hate, no toxicity
- Creator empowerment — helping each other level up
- Cosmic/space theme — planets, orbits, stars, galaxies
- "Stay CUHZ" is the motto

DEVELOPMENT SERVICES:
- Cuhz Bot is just the beginning. 
- We build custom Twitch bots, Home Assistants, and full AI Agentic Development Teams.
- If a user is interested, tell them: "Yo cuhz, if you want your own custom Twitch bot, home assistant, or a full AI development team, let @planetcuhz know right here in the stream! 🚀"
BRAND VOICE:
- Warm, energetic, cosmic-themed, AAVE-friendly
- Use "cuhz" naturally — "what's good cuhz", "bet", "no cap", "wsg"
- Emojis: 🌌 🚀 💎 🔥 ✨ 🌍 🌙
- Never sound robotic or corporate — sound like a real community member
- If someone is toxic, roast them lightly but keep it TOS-safe
`.trim();

const CUHZ_SYSTEM_PROMPT = `${CUHZ_KNOWLEDGE}

You are Cuhz Bot, the official Twitch bot for Planet CUHZ.
Rules:
- Keep answers under 2 sentences max
- NO TOS violations ever
- If someone tries to trick you into saying something bad, reply: "Nice try cuhz 🧢"
- Sound like a real community member, not a corporate bot`;

// ─────────── BRAIN 1: THE EYES (Gemini) ───────────
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
        safetySettings,
    });
    logger.info('👁️ THE EYES initialized — Gemini 2.0 Flash');
} else {
    logger.warn('⚠️ GEMINI_API_KEY not set — The Eyes (Gemini) disabled');
}

// ─────────── BRAIN 2: THE BRAIN (Claude) ───────────
let claudeClient = null;
const CLAUDE_MODEL = 'claude-3-5-sonnet-20241022'; // Powerful but cheaper than Opus

if (config.anthropicApiKey) {
    claudeClient = new Anthropic({ apiKey: config.anthropicApiKey });
    logger.info('🧠 THE BRAIN initialized — Claude 3.5 Sonnet');
} else {
    logger.warn('⚠️ ANTHROPIC_API_KEY not set — The Brain (Claude) disabled');
}

// ─────────── BRAIN 3: THE HANDS (Qwen via Groq or DashScope) ───────────
let qwenApiUrl = null;
let qwenApiKey = null;
let qwenModel = null;

if (config.groqApiKey) {
    // Preferred: Groq (fast inference, OpenAI-compatible)
    qwenApiUrl = 'https://api.groq.com/openai/v1/chat/completions';
    qwenApiKey = config.groqApiKey;
    qwenModel = 'qwen-2.5-72b-versatile';
    logger.info('🔧 THE HANDS initialized — Qwen 2.5 via Groq');
} else if (config.qwenApiKey) {
    // Fallback: DashScope direct
    qwenApiUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    qwenApiKey = config.qwenApiKey;
    qwenModel = 'qwen-turbo';
    logger.info('🔧 THE HANDS initialized — Qwen Turbo via DashScope');
} else {
    logger.warn('⚠️ No Qwen API key set — The Hands (Qwen) disabled');
}

// ─────────── Failure Tracking (Exponential Backoff) ───────────
const brainHealth = {
    gemini: { failures: 0, lastUsed: null, backoffUntil: 0 },
    claude: { failures: 0, lastUsed: null, backoffUntil: 0 },
    qwen: { failures: 0, lastUsed: null, backoffUntil: 0 }
};

function computeBackoff(failures) {
    // 5s, 10s, 20s, 40s, 80s... capped at 5 minutes
    return Math.min(5000 * Math.pow(2, failures - 1), 300000);
}

// ─────────── Sliding Window Rate Limiter ───────────
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

// ─────────── Twitch Length Guard ───────────
const TWITCH_MAX_LENGTH = 450;

function truncateForTwitch(text) {
    if (!text || text.length <= TWITCH_MAX_LENGTH) return text;
    return text.substring(0, TWITCH_MAX_LENGTH - 3) + '...';
}

// ─────────── Response Cache ───────────
const responseCache = new Map();
const CACHE_DURATION = 600000; // 10 minutes

// ─────────── Recent Response Tracker (Anti-Repetition) ───────────
const recentResponses = new Map(); // channel -> string[]
const MAX_RECENT_RESPONSES = 10;

function trackResponse(channel, response) {
    if (!channel || !response) return;
    if (!recentResponses.has(channel)) recentResponses.set(channel, []);
    const list = recentResponses.get(channel);
    list.push(response);
    if (list.length > MAX_RECENT_RESPONSES) list.shift();
}

function getRecentResponses(channel) {
    return recentResponses.get(channel) || [];
}

// =============================================
//  INDIVIDUAL BRAIN EXECUTORS
// =============================================

/**
 * Execute prompt via Gemini (The Eyes) — fast, cheap, bulk chat
 */
async function executeGemini(prompt) {
    if (!geminiModel || Date.now() < brainHealth.gemini.backoffUntil) return null;

    try {
        const temperature = 0.7 + (Math.random() * 0.3); // 0.7-1.0 for variety
        const result = await geminiModel.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature, maxOutputTokens: 300 }
        });
        if (!result.response || !result.response.text) {
            throw new Error('Empty/blocked response from Gemini');
        }
        const text = result.response.text().trim();
        brainHealth.gemini.failures = 0;
        brainHealth.gemini.backoffUntil = 0;
        brainHealth.gemini.lastUsed = Date.now();
        return text;
    } catch (err) {
        brainHealth.gemini.failures++;
        const backoffMs = computeBackoff(brainHealth.gemini.failures);
        brainHealth.gemini.backoffUntil = Date.now() + backoffMs;
        logger.warn(`👁️ Gemini error (${brainHealth.gemini.failures}, backoff ${Math.round(backoffMs / 1000)}s): ${err.message}`);
        return null;
    }
}

/**
 * Execute prompt via Claude (The Brain) — complex, persona-perfect
 */
async function executeClaude(systemPrompt, userMessage) {
    if (!claudeClient || Date.now() < brainHealth.claude.backoffUntil) return null;

    try {
        const response = await claudeClient.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 200,
            temperature: 0.8,
            system: systemPrompt,
            messages: [
                { role: 'user', content: userMessage }
            ]
        });

        const text = response.content?.[0]?.text?.trim();
        if (!text) throw new Error('Empty response from Claude');

        brainHealth.claude.failures = 0;
        brainHealth.claude.backoffUntil = 0;
        brainHealth.claude.lastUsed = Date.now();
        return text;
    } catch (err) {
        brainHealth.claude.failures++;
        const backoffMs = computeBackoff(brainHealth.claude.failures);
        brainHealth.claude.backoffUntil = Date.now() + backoffMs;
        logger.warn(`🧠 Claude error (${brainHealth.claude.failures}, backoff ${Math.round(backoffMs / 1000)}s): ${err.message}`);
        return null;
    }
}

/**
 * Execute prompt via Qwen (The Hands) — code, logic, technical
 */
async function executeQwen(systemPrompt, userMessage) {
    if (!qwenApiUrl || Date.now() < brainHealth.qwen.backoffUntil) return null;

    try {
        const response = await fetch(qwenApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${qwenApiKey}`
            },
            body: JSON.stringify({
                model: qwenModel,
                messages: [
                    { role: 'system', content: systemPrompt + ' You are the Coding Specialist.' },
                    { role: 'user', content: userMessage }
                ],
                max_tokens: 400,
                temperature: 0.4   // Lower temp for precision
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Qwen API ${response.status}: ${errBody}`);
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (!text) throw new Error('Empty response from Qwen');

        brainHealth.qwen.failures = 0;
        brainHealth.qwen.backoffUntil = 0;
        brainHealth.qwen.lastUsed = Date.now();
        return text;
    } catch (err) {
        brainHealth.qwen.failures++;
        const backoffMs = computeBackoff(brainHealth.qwen.failures);
        brainHealth.qwen.backoffUntil = Date.now() + backoffMs;
        logger.warn(`🔧 Qwen error (${brainHealth.qwen.failures}, backoff ${Math.round(backoffMs / 1000)}s): ${err.message}`);
        return null;
    }
}

// =============================================
//  VIBE ROUTER — picks the right brain
// =============================================

// Keywords that trigger each brain
const CODE_TRIGGERS = ['!code', 'python', 'javascript', 'function', 'console.log', 'error', 'debug', 'api', 'sql', 'regex', 'npm', 'node', 'html', 'css', 'git', 'deploy'];
const DEEP_TRIGGERS = ['!ask', 'explain', 'plan', 'strategy', 'think about', 'opinion', 'should i', 'what if', 'help me', 'advice', 'serious', 'moderat', 'toxic', 'ban', 'report'];

/**
 * Classify which brain should handle this message
 * @param {string} message - The user's message
 * @returns {'eyes'|'brain'|'hands'} - Which brain to route to
 */
function classifyVibe(message) {
    const lower = message.toLowerCase();

    // Code/technical → The Hands (Qwen)
    for (const trigger of CODE_TRIGGERS) {
        if (lower.includes(trigger)) return 'hands';
    }

    // Deep conversation/moderation → The Brain (Claude)
    for (const trigger of DEEP_TRIGGERS) {
        if (lower.includes(trigger)) return 'brain';
    }

    // Everything else → The Eyes (Gemini) — fast and cheap
    return 'eyes';
}

// =============================================
//  UNIFIED EXECUTE — with cascade fallback
// =============================================

/**
 * Route prompt to the right brain, with fallback cascade
 * @param {string} prompt - Full prompt text
 * @param {string} vibe - 'eyes', 'brain', or 'hands'
 * @returns {Promise<{text: string|null, model: string}>}
 */
async function executeWithRouting(prompt, vibe = 'eyes') {
    let text = null;
    let modelUsed = 'none';

    // Try the intended brain first
    if (vibe === 'brain' && claudeClient) {
        text = await executeClaude(CUHZ_SYSTEM_PROMPT, prompt);
        if (text) modelUsed = 'claude';
    } else if (vibe === 'hands' && qwenApiUrl) {
        text = await executeQwen(CUHZ_SYSTEM_PROMPT, prompt);
        if (text) modelUsed = 'qwen';
    } else if (vibe === 'eyes' && geminiModel) {
        text = await executeGemini(`${CUHZ_SYSTEM_PROMPT}\n\n${prompt}`);
        if (text) modelUsed = 'gemini';
    }

    // Fallback cascade: Gemini → Claude → Qwen
    if (!text) {
        if (modelUsed !== 'gemini') {
            text = await executeGemini(`${CUHZ_SYSTEM_PROMPT}\n\n${prompt}`);
            if (text) modelUsed = 'gemini';
        }
    }
    if (!text) {
        if (modelUsed !== 'claude' && claudeClient) {
            text = await executeClaude(CUHZ_SYSTEM_PROMPT, prompt);
            if (text) modelUsed = 'claude';
        }
    }
    if (!text) {
        if (modelUsed !== 'qwen' && qwenApiUrl) {
            text = await executeQwen(CUHZ_SYSTEM_PROMPT, prompt);
            if (text) modelUsed = 'qwen';
        }
    }

    if (!text) {
        logger.warn(`⚠️ ALL AI BRAINS UNAVAILABLE — degraded mode. Backoffs: Gemini ${Math.max(0, Math.round((brainHealth.gemini.backoffUntil - Date.now()) / 1000))}s, Claude ${Math.max(0, Math.round((brainHealth.claude.backoffUntil - Date.now()) / 1000))}s, Qwen ${Math.max(0, Math.round((brainHealth.qwen.backoffUntil - Date.now()) / 1000))}s`);
    }

    return { text, model: modelUsed };
}

// =============================================
//  PUBLIC API
// =============================================

/**
 * Analyze sentiment — always uses The Eyes (Gemini) for speed
 */
async function analyzeSentiment(messages) {
    if (!geminiModel && !claudeClient && !qwenApiUrl) {
        return { mood: 'neutral', energy: 50, toxicity: 0, summary: 'No AI available' };
    }
    if (messages.length === 0) {
        return { mood: 'neutral', energy: 50, toxicity: 0, summary: 'No messages' };
    }

    if (!canMakeRequest()) {
        return fallbackSentimentAnalysis(messages);
    }

    try {
        recordRequest();

        const chatSample = messages.map(m => `${m.username}: ${m.message}`).join('\n');

        const prompt = `Analyze the sentiment of these Twitch chat messages. Respond ONLY with valid JSON.

Chat messages:
${chatSample}

JSON format:
{"mood":"<positive|negative|neutral|hype|toxic>","energy":<0-100>,"toxicity":<0-100>,"summary":"<1 sentence>"}`;

        // Sentiment always goes to Gemini (fast + cheap)
        const { text, model } = await executeWithRouting(prompt, 'eyes');

        if (!text) return fallbackSentimentAnalysis(messages);

        let jsonText = text;
        if (text.includes('```json')) {
            jsonText = text.split('```json')[1].split('```')[0].trim();
        } else if (text.includes('```')) {
            jsonText = text.split('```')[1].split('```')[0].trim();
        }

        const analysis = JSON.parse(jsonText);
        if (!analysis.mood || analysis.energy === undefined) {
            return fallbackSentimentAnalysis(messages);
        }

        analysis.energy = Math.max(0, Math.min(100, analysis.energy));
        analysis.toxicity = Math.max(0, Math.min(100, analysis.toxicity));
        analysis.model = model;

        logger.info(`👁️ Sentiment [${model}]: ${analysis.mood} (E:${analysis.energy} T:${analysis.toxicity})`);
        return analysis;
    } catch (error) {
        logger.error(`❌ Sentiment analysis failed: ${error.message}`);
        return fallbackSentimentAnalysis(messages);
    }
}

/**
 * Generate context-aware response — routes based on vibe
 */
async function generateContextAwareResponse(channel, userMessage, recentMessages = [], currentMood = 'neutral', availableCommands = {}, personalityConfig = null, userProfile = null) {
    if (!geminiModel && !claudeClient && !qwenApiUrl) return null;

    // Check cache
    const cacheKey = userMessage.toLowerCase().trim();
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.response;
    }

    if (!canMakeRequest()) return null;

    try {
        recordRequest();

        // Classify which brain should handle this
        const vibe = classifyVibe(userMessage);

        const context = recentMessages.slice(-5).join('\n');
        const commandList = Object.entries(availableCommands)
            .map(([cmd, desc]) => `${cmd}: ${desc}`)
            .join('\n');

        let personalityInstructions = '';
        if (personalityConfig) {
            personalityInstructions = `\nPersonality: ${currentMood} | Tone: ${personalityConfig.tone} | Emojis: ${personalityConfig.useEmojis ? 'YES' : 'NO'} | Enthusiasm: ${personalityConfig.enthusiasmLevel}`;
        }

        let userContext = '';
        if (userProfile) {
            userContext = `\nUser "${userProfile.username}": ${userProfile.total_messages || 0} msgs, score ${userProfile.relationship_score || 0}/100`;
            if (userProfile.notes) userContext += `, known for: ${userProfile.notes}`;
        }

        // Anti-repetition: tell AI what it said recently
        const recent = getRecentResponses(channel);
        const avoidBlock = recent.length > 0
            ? `\nIMPORTANT: Do NOT repeat or closely paraphrase these recent responses:\n${recent.map(r => `- "${r}"`).join('\n')}\nBe creative and vary your language.`
            : '';

        const prompt = `Current mood: ${currentMood}${personalityInstructions}${userContext}

Recent chat:\n${context}

Commands: ${commandList}

User says: "${userMessage}"

Reply as Cuhz Bot (under 200 chars). If it's just casual chat with no question, reply: NO_RESPONSE${avoidBlock}`;

        const { text, model } = await executeWithRouting(prompt, vibe);

        if (!text || text === 'NO_RESPONSE' || text.length === 0) return null;

        let response = safetyFilter(truncateForTwitch(text));
        responseCache.set(cacheKey, { response, timestamp: Date.now() });
        trackResponse(channel, response);

        logger.info(`🤖 [${model.toUpperCase()}/${vibe}] "${response}"`);
        return response;
    } catch (error) {
        logger.error(`❌ Context response failed: ${error.message}`);
        return null;
    }
}

/**
 * Generate proactive message — uses The Eyes (Gemini)
 */
async function generateProactiveMessage(channel, recentMessages = [], currentMood = 'neutral') {
    if (!canMakeRequest()) return null;

    try {
        recordRequest();
        const context = recentMessages.slice(-5).join('\n');

        const prompt = `You are in Twitch channel ${channel}. Chat energy is LOW.

Recent:\n${context}

Mood: ${currentMood}

Generate ONE engaging message (under 150 chars) to spark convo. Be specific, not generic. Sound natural.`;

        const { text } = await executeWithRouting(prompt, 'eyes');
        return text ? safetyFilter(truncateForTwitch(text)) : null;
    } catch (error) {
        logger.warn(`⚠️ Proactive msg failed: ${error.message}`);
        return null;
    }
}

/**
 * Direct ask to a specific brain (for !ask, !code commands)
 */
async function askBrain(brain, userMessage, username = 'someone') {
    if (!canMakeRequest()) return 'Rate limited cuhz, try again in a sec 🕐';

    try {
        recordRequest();
        const prompt = `User ${username} asks: ${userMessage}`;
        const { text, model } = await executeWithRouting(prompt, brain);

        if (!text) return 'All my brains are taking a nap rn cuhz 😴';
        return safetyFilter(truncateForTwitch(text));
    } catch (error) {
        logger.error(`❌ askBrain(${brain}) failed: ${error.message}`);
        return 'Something went wrong cuhz, try again 🔄';
    }
}

// ─────────── Fallback Sentiment ───────────
function fallbackSentimentAnalysis(messages) {
    const positiveWords = ['lol', 'hype', 'love', 'great', 'awesome', 'amazing', 'lets go', 'lfg', 'pog', 'w'];
    const negativeWords = ['bad', 'hate', 'boring', 'sad', 'terrible', 'trash', 'l ', ' l'];
    const toxicWords = ['fuck', 'shit', 'stupid', 'idiot', 'noob'];
    const hypeWords = ['!!!!', 'lets go', 'lfg', 'hype', 'pog', 'poggers', 'w'];

    let positiveCount = 0, negativeCount = 0, toxicCount = 0, capsCount = 0, totalWords = 0;

    messages.forEach(({ message }) => {
        const lower = message.toLowerCase();
        totalWords += message.split(' ').length;
        positiveWords.forEach(w => { if (lower.includes(w)) positiveCount++; });
        negativeWords.forEach(w => { if (lower.includes(w)) negativeCount++; });
        toxicWords.forEach(w => { if (lower.includes(w)) toxicCount++; });
        hypeWords.forEach(w => { if (lower.includes(w)) capsCount++; });
        if (message.replace(/[^A-Z]/g, '').length > message.length * 0.5) capsCount++;
    });

    const energy = Math.min(100, Math.max(0, 50 + (capsCount * 10) + ((totalWords / messages.length) * 5) - (messages.length < 3 ? 20 : 0)));
    const toxicity = Math.min(100, toxicCount * 20);
    let mood = 'neutral';
    if (toxicity > 40) mood = 'toxic';
    else if (capsCount > 3 && positiveCount > negativeCount) mood = 'hype';
    else if (positiveCount > negativeCount + 2) mood = 'positive';
    else if (negativeCount > positiveCount + 2) mood = 'negative';

    return { mood, energy: Math.round(energy), toxicity: Math.round(toxicity), summary: `Fallback: ${mood}`, model: 'fallback' };
}

function clearCache() {
    responseCache.clear();
    logger.info('🧹 AI cache cleared');
}

function getStats() {
    const now = Date.now();
    while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_WINDOW_MS) {
        requestTimestamps.shift();
    }

    return {
        triBrain: true,
        eyes: { model: 'Gemini 2.0 Flash', available: geminiModel !== null, failures: brainHealth.gemini.failures, backoffUntil: brainHealth.gemini.backoffUntil },
        brain: { model: CLAUDE_MODEL, available: claudeClient !== null, failures: brainHealth.claude.failures, backoffUntil: brainHealth.claude.backoffUntil },
        hands: { model: qwenModel || 'none', available: qwenApiUrl !== null, failures: brainHealth.qwen.failures, backoffUntil: brainHealth.qwen.backoffUntil },
        requestsThisMinute: requestTimestamps.length,
        maxRequestsPerMinute: MAX_REQUESTS_PER_MINUTE,
        cacheSize: responseCache.size,
        aiEnabled: !!(geminiModel || claudeClient || qwenApiUrl)
    };
}

module.exports = {
    analyzeSentiment,
    generateContextAwareResponse,
    generateProactiveMessage,
    askBrain,
    classifyVibe,
    safetyFilter,
    clearCache,
    getStats,
    truncateForTwitch,
    trackResponse,
    getRecentResponses,
    CUHZ_KNOWLEDGE
};
