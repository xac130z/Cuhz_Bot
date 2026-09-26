'use strict';

// ============================================================================
//  CUHZ Bot — Keyword-intent listener (code-owned, deterministic, default-OFF)
//
//  Sibling and stylistic twin of commerce_content.js / stream_content.js. When
//  ENABLE_KEYWORD_REPLIES is on, this fires AT MOST ONE short, cuhz-voice reply
//  on a NON-command message whose text matches a small, word-boundary-anchored
//  intent set. Every reply is a fixed registry line — never AI output — and
//  carries NO price (prices live only in commerce_content.js). Lines only point
//  people at !plans / !mytier / !help and planetcuhz.com, all of which are on
//  safety_policy's approved allowlist, so every line passes validateOutbound.
//
//  HARD SAFETY RAILS (enforced in createListener().evaluate):
//    - global cooldown ≥45s PER intent
//    - per-user cooldown ≥5min
//    - ≤1 keyword reply per 60s OVERALL
//    - never reply to other bots or self (KNOWN_BOTS + the bot's own names)
//    - never fire when a !command was used (guarded here AND at the bot.js hook)
//    - live-status respect matching the marketing-rotation pattern (live-only,
//      unless USE_MOCK_API is on for local testing)
//    - the caller still routes replies through sendMessage(), so validateOutbound
//      + the per-channel send queue + dedupe window all apply on top of this.
//
//  Cooldowns consume ONLY on an actual reply — a blocked attempt never burns a
//  timer. "Never seen" defaults to -Infinity so the gates behave identically no
//  matter the clock origin (real Date.now() or an injected test clock).
// ============================================================================

const INTENTS = Object.freeze(['price', 'help', 'what_question', 'bot_mention']);

// --- Detection patterns (word-boundary anchored; see negative cases in tests) ---
// Price is checked first (most actionable), then help, then the two question
// intents. First match wins so a message resolves to exactly one intent.
const PRICE_PATTERNS = Object.freeze([
    /\bprice\b/i,
    /\bcost\b/i,
    /\bhow much\b/i,
    /\bsubscribe\b/i,
    /\bsub tier\b/i
]);
const HELP_PATTERNS = Object.freeze([
    /\bhelp\b/i,
    /\bhow do i\b/i,
    /\bhow does\b/i
]);
// what-question: the message must START with "what" (as a whole word) AND either
// contain a "?" or mention the bot.
const WHAT_START_PATTERN = /^\s*what\b/i;

// Third-party chat bots we never talk back to. The bot's own login + customer
// names are added per-instance via createListener({ botNames }).
const KNOWN_BOTS = Object.freeze(new Set([
    'nightbot', 'streamelements', 'streamlabs', 'moobot', 'wizebot',
    'fossabot', 'sery_bot', 'pretzelrocks', 'soundalerts', 'commanderroot',
    'streamlabs', 'own3d', 'kofistreambot', 'botisimo'
]));

// Hard rail minimums (ms). Defaults meet-or-exceed the spec floors.
const DEFAULTS = Object.freeze({
    perIntentCooldownMs: 45 * 1000,      // ≥45s per intent, global
    perUserCooldownMs: 5 * 60 * 1000,    // ≥5min per user
    overallCooldownMs: 60 * 1000         // ≤1 keyword reply per 60s overall
});

// --- Code-owned reply registry ---------------------------------------------
// Short, honest, cuhz-voice. NO prices, NO crypto, NO urgency/scarcity. Every
// line points only at real surfaces (!plans / !mytier / !help / planetcuhz.com)
// and passes validateOutbound({ source:'bot' }). Two per intent for variety.
const REPLIES = Object.freeze({
    price: Object.freeze([
        '💎 Curious about the tiers, cuhz? Full CUHZ Bot ladder + checkout → https://planetcuhz.com/pricing · quick peek with !plans, and !mytier shows what you\'re on.',
        '🛰️ Wanna see what CUHZ Bot runs? Type !plans for the tier breakdown — real numbers, no games. Yours is !mytier.'
    ]),
    help: Object.freeze([
        '🛰️ Need a hand, cuhz? !help lists every command, !plans shows the CUHZ Bot tiers, !mytier shows yours. HQ → https://planetcuhz.com',
        '🌌 I got you cuhz — !help for the full command list, !plans for the tiers. Planet CUHZ HQ → https://planetcuhz.com'
    ]),
    what_question: Object.freeze([
        '🌌 Good question cuhz — !plans breaks down the CUHZ Bot tiers and !help lists what I can do. More → https://planetcuhz.com',
        '🤖 That\'s a !help kinda question cuhz — full command list there, tiers in !plans. HQ → https://planetcuhz.com'
    ]),
    bot_mention: Object.freeze([
        '🤖 You rang, cuhz? !help shows what I do, !plans shows the tiers, !mytier shows yours. HQ → https://planetcuhz.com',
        '🛰️ Right here cuhz — !help for commands, !plans for the CUHZ Bot tiers. Planet CUHZ → https://planetcuhz.com'
    ])
});

function _cleanLogin(user) {
    return String(user || '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

function _normalizeNames(names) {
    return (names || []).map(n => String(n || '').toLowerCase().trim()).filter(Boolean);
}

/**
 * Pure intent detector. Returns one of INTENTS or null. Never throws.
 * Commands (leading "!") always return null — keyword replies never fire on a
 * command, guarded here AND at the bot.js call site.
 * @param {string} message raw viewer message
 * @param {{ botNames?: string[] }} [opts]
 */
function detectIntent(message, opts = {}) {
    const text = String(message || '').trim();
    if (!text || text.startsWith('!')) return null;

    const lower = text.toLowerCase();
    const botNames = _normalizeNames(opts.botNames);
    const mentionsBot = botNames.some(n => lower.includes(n));

    if (PRICE_PATTERNS.some(re => re.test(text))) return 'price';
    if (HELP_PATTERNS.some(re => re.test(text))) return 'help';
    if (WHAT_START_PATTERN.test(text) && (text.includes('?') || mentionsBot)) return 'what_question';
    if (mentionsBot && text.includes('?')) return 'bot_mention';
    return null;
}

/**
 * True when a username is a known chat bot, one of the bot's own names, or empty
 * (no name → treat as non-human; never reply).
 */
function isBotUser(username, botNames = []) {
    const u = _cleanLogin(username);
    if (!u) return true;
    if (KNOWN_BOTS.has(u)) return true;
    return _normalizeNames(botNames).map(n => _cleanLogin(n)).some(n => n && n === u);
}

// No-repeat picker (mirrors commerce_content._pickNoRepeat), per listener instance.
function _makePicker() {
    const recent = new Map(); // key -> string[]
    return function pick(key, arr, avoidLast = 1) {
        if (!arr || arr.length === 0) return null;
        const seen = recent.get(key) || [];
        const pool = arr.filter(x => !seen.includes(x));
        const source = pool.length ? pool : arr;
        const choice = source[Math.floor(Math.random() * source.length)];
        recent.set(key, [...seen, choice].slice(-avoidLast));
        return choice;
    };
}

/**
 * Build a stateful listener. State (cooldown maps) lives in this closure, so each
 * instance is isolated — great for tests and safe as a bot.js singleton.
 * @param {{ botNames?: string[], now?: () => number, cooldowns?: object }} [options]
 */
function createListener(options = {}) {
    const cfg = Object.assign({}, DEFAULTS, options.cooldowns || {});
    const botNames = _normalizeNames(options.botNames);
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const pick = _makePicker();

    let lastOverallAt = -Infinity;
    const lastIntentAt = new Map(); // intent -> ts
    const lastUserAt = new Map();   // login -> ts

    /**
     * Decide whether to reply to one message. Returns
     * { reply: string|null, intent: string|null, reason: string|null }.
     * `reply` is non-null only when every gate passes; the caller then routes it
     * through sendMessage(). Cooldowns are consumed only on a real reply.
     * @param {{ username: string, message: string, isLive?: boolean, useMockApi?: boolean }} ctx
     */
    function evaluate(ctx = {}) {
        const t = now();

        // Never reply to bots / self.
        if (isBotUser(ctx.username, botNames)) return { reply: null, intent: null, reason: 'bot' };

        const intent = detectIntent(ctx.message, { botNames });
        if (!intent) return { reply: null, intent: null, reason: 'no_intent' };

        // Live-status respect (marketing-rotation pattern): live-only, unless the
        // local mock API is on for testing.
        const isLive = ctx.useMockApi ? true : !!ctx.isLive;
        if (!isLive) return { reply: null, intent, reason: 'offline' };

        // Overall throttle: ≤1 keyword reply per 60s across all intents/users.
        if (t - lastOverallAt < cfg.overallCooldownMs) return { reply: null, intent, reason: 'overall_cooldown' };

        // Per-user cooldown ≥5min.
        const login = _cleanLogin(ctx.username);
        const userLast = lastUserAt.has(login) ? lastUserAt.get(login) : -Infinity;
        if (t - userLast < cfg.perUserCooldownMs) return { reply: null, intent, reason: 'user_cooldown' };

        // Per-intent global cooldown ≥45s.
        const intentLast = lastIntentAt.has(intent) ? lastIntentAt.get(intent) : -Infinity;
        if (t - intentLast < cfg.perIntentCooldownMs) return { reply: null, intent, reason: 'intent_cooldown' };

        const line = pick(intent, REPLIES[intent], 1);
        if (!line) return { reply: null, intent, reason: 'no_reply' };

        // Consume cooldowns ONLY now, on an actual reply.
        lastOverallAt = t;
        lastUserAt.set(login, t);
        lastIntentAt.set(intent, t);
        return { reply: line, intent, reason: null };
    }

    return { evaluate };
}

module.exports = {
    INTENTS,
    KNOWN_BOTS,
    DEFAULTS,
    REPLIES,
    detectIntent,
    isBotUser,
    createListener
};
