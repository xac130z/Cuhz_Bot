'use strict';

// ============================================================================
//  CUHZ Bot — Stream commerce registry (code-owned, deterministic)
//
//  Sibling and stylistic twin of stream_content.js. Every price here is SOURCED
//  (PRICING_PAGE.md ↔ Pricing.tsx ↔ README-BILLING.md — all three agree) and
//  every link is already in safety_policy APPROVED_HOSTS. Prices live ONLY in
//  this file — the model never quotes a price (the source:'ai' `$` regex keeps
//  it price-mute; that regex is untouched).
//
//  STANDING RULES (enforced where noted; see plan §C.3):
//    1. One commerce promo line per rotation cycle per channel — structural
//       (the rotation interval is the rate limit; no second scheduler).
//    2. No commerce messages while offline (timer + purchase watcher both
//       already live-gated in bot.js / tier_service.js).
//    3. Prices appear only in these deterministic replies, never in AI output.
//    4. No fake urgency / scarcity / discount words anywhere in these registries;
//       thank-yous fire only from verified entitlement rows; unknown = say nothing.
//    5. Every line is sent via sendMessage() so the allowlist + queue + dedupe
//       all apply. Every line stays under Twitch's 500-char limit.
// ============================================================================

// --- Static command replies (exact copy from plan §B) -----------------------
const COMMERCE_COMMANDS = Object.freeze({
    '!plans': '💎 CUHZ Bot tiers: Community FREE · Silver Supporter $4.99/mo · Gold Executive $14.99/mo · Affiliate Pack (bot in YOUR channel) $49.99/mo · Architect custom build (quote only). Full breakdown + checkout → https://planetcuhz.com/pricing#bot',
    '!silver': '🥈 Silver Supporter — $4.99/mo: unlimited base !ask (no point cost), 80% off the Claude brain, Verified Cuhz badge, +1,000 bonus points monthly. Go Silver → https://planetcuhz.com/pricing#bot',
    '!gold': '💎 Gold Executive — $14.99/mo: ZERO point cost on ALL brains (!ask, !ask -brain, !code), priority AI in busy chat, custom arrival greeting, +5,000 bonus points monthly. Go Gold → https://planetcuhz.com/pricing#bot',
    '!affiliate': '🛰️ Affiliate Pack — $49.99/mo: full CUHZ Bot in your channel running YOUR links + socials, mod intel (!chatreport / !mood), automated marketing rotation. Run the pack → https://planetcuhz.com/pricing#bot',
    // Architect is QUOTE-ONLY by design — never emit a number here.
    '!architect': '🛠️ Architect Custom Build — your own bot: your name, avatar, lore, private AI, dedicated instance. You own it. Quote only — start the convo → https://planetcuhz.com/solutions#start',
    '!site': '🌌 Planet CUHZ HQ → https://planetcuhz.com · Plans !plans · Store !store · Chain Studio (10 finishes, free, no login) → https://planetcuhz.com/chain',
    // Voice-only Discord — the same invite the site footer links (SOCIAL_LINKS).
    // A community invite, not a sale: no price, no urgency. Aliases: !voice, !family.
    '!discord': '🎙️ Pull up to the CUHZ voice fam — our voice-only Discord is where the cuhzins actually link up, cousin to cuhz → https://discord.gg/eNxDKkxQdN',
    '!pro': '🚀 Planet CUHZ site membership (separate from CUHZ Bot tiers): Free · Pro $9.99/mo · Team $24.99/mo — 2K tools, squad features, coaching perks → https://planetcuhz.com/pricing',
    '!membership': '🚀 Planet CUHZ site membership (separate from CUHZ Bot tiers): Free · Pro $9.99/mo · Team $24.99/mo — 2K tools, squad features, coaching perks → https://planetcuhz.com/pricing',
    '!store': '🛒 CUHZ digital store: CUHZ Chain Full Pack $9 · Emote Pack $7 · Overlay Kit $15 → https://planetcuhz.com/store'
});

// --- !mytier dynamic lines (exact copy from plan §B) ------------------------
const MYTIER_LINES = Object.freeze({
    gold: '💎 @{user} you\'re Gold Executive — all brains free, priority AI, stipend live. Real one.',
    silver: '🥈 @{user} you\'re Silver Supporter — base AI unlimited, brain 80% off. Appreciate you cuhz.',
    community: '🌌 @{user} you\'re Community tier — everything core is free. Curious what Silver/Gold adds? !plans'
});

// --- Periodic promo pool (exact copy from plan §C.1) ------------------------
// Honest, zero urgency, zero countdown language. One is injected per rotation.
const PROMO_LINES = Object.freeze([
    '💎 CUHZ Bot runs on tiers now: Silver $4.99/mo, Gold $14.99/mo — unlimited AI brains, stipends, priority. No pressure, it\'s all there → type !plans',
    '🤖 Streamers: Affiliate Pack $49.99/mo puts CUHZ Bot in YOUR chat with your links. Curious? !affiliate',
    '🛒 Emotes, overlays, the Chain Full Pack — real prices, no games → !store',
    // Community lines — no price, no urgency. Still one-per-cycle (same pool, one pick).
    '🎙️ The CUHZ voice fam runs off-stream too — hop in the voice-only Discord and link with the cuhzins → type !discord',
    '💬 Real convos, cousin to cuhz — the CUHZ family lives in the voice Discord. Pull up, it\'s free → https://discord.gg/eNxDKkxQdN',
    '👥 Building together is the whole point. Join the CUHZ voice fam → !voice'
]);

// --- Gold custom arrival pool (plan §A.3) -----------------------------------
// In-voice, honest, price-free. bot.js appends "@{user} 💎".
const GOLD_ARRIVAL = Object.freeze([
    '💎 Gold Executive in the building — clear the runway',
    '💎 Upper-orbit cuhz just landed — Gold Executive on deck',
    '💎 Gold in the chat. The brains are free and the vibes are up'
]);

// --- Purchase thank-you / upgrade pools (exact copy from plan §C.2) ----------
// Generic-first (no name) is the safe default; named only when the buyer is
// present + public (they've chatted this session). Never an amount, order id,
// email, or "payment confirmed" phrasing — verified entitlement state only.
const GENERIC_THANKS = Object.freeze({
    silver: '🎉 Somebody just went Silver Supporter on the Planet — CUHZ fam growing 💜',
    gold: '🎉 Somebody just went Gold Executive on the Planet — CUHZ fam growing 💜'
});
const NAMED_THANKS = Object.freeze({
    silver: '🎉 @{user} just went Silver Supporter 🥈 Welcome to the fam cuhz — !mytier to flex it',
    gold: '🎉 @{user} just went Gold Executive 💎 Welcome to the upper orbit cuhz — !mytier to flex it'
});
const UPGRADE_LINE = '🚀 @{user} leveled UP — Silver → Gold. Zero-cost brains unlocked 💎';

// --- No-repeat picker (local; mirrors bot.js pickNoRepeat) ------------------
const _recent = new Map(); // key -> string[]
function _pickNoRepeat(key, arr, avoidLast = 2) {
    if (!arr || arr.length === 0) return null;
    const recent = _recent.get(key) || [];
    const pool = arr.filter(x => !recent.includes(x));
    const source = pool.length ? pool : arr;
    const pick = source[Math.floor(Math.random() * source.length)];
    _recent.set(key, [...recent, pick].slice(-avoidLast));
    return pick;
}

function _clean(user) {
    return String(user || '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
}

// --- Public API (mirrors stream_content.launchCommandResponse's shape) ------

/**
 * Deterministic reply for the !plans command family. Returns null when the
 * command isn't a commerce command (caller then falls through to the existing
 * honest stream_content.js responses). `!shop` is an alias of `!store`.
 * !mytier is intentionally NOT here — it is dynamic (needs the viewer's tier).
 */
function commerceCommandResponse(command) {
    const key = String(command || '').trim().toLowerCase().split(/\s+/)[0];
    if (key === '!shop') return COMMERCE_COMMANDS['!store'];
    if (key === '!voice' || key === '!family') return COMMERCE_COMMANDS['!discord'];
    return COMMERCE_COMMANDS[key] || null;
}

function isCommerceCommand(command) {
    const key = String(command || '').trim().toLowerCase().split(/\s+/)[0];
    return key === '!shop' || key === '!mytier' || key === '!voice' || key === '!family'
        || Object.prototype.hasOwnProperty.call(COMMERCE_COMMANDS, key);
}

function myTierLine(tier, user) {
    const line = MYTIER_LINES[tier] || MYTIER_LINES.community;
    return line.replace('{user}', _clean(user));
}

function pickPromoLine(key) {
    return _pickNoRepeat(`promo:${key}`, PROMO_LINES, 2);
}

function pickGoldArrival(key) {
    return _pickNoRepeat(`goldarrival:${key}`, GOLD_ARRIVAL, 2);
}

function genericThankYou(tier) {
    return GENERIC_THANKS[tier] || null;
}

function namedThankYou(user, tier) {
    const tpl = NAMED_THANKS[tier];
    return tpl ? tpl.replace('{user}', _clean(user)) : null;
}

function upgradeLine(user) {
    return UPGRADE_LINE.replace('{user}', _clean(user));
}

// The commerce command names that must be added to BASIC_BLOCKED_COMMANDS
// (Basic channels are other streamers' chats — we don't sell there).
const COMMERCE_COMMAND_NAMES = Object.freeze([
    '!plans', '!silver', '!gold', '!affiliate', '!architect',
    '!mytier', '!site', '!pro', '!membership', '!store', '!shop',
    // Voice-fam Discord (community invite) + its aliases.
    '!discord', '!voice', '!family'
]);

module.exports = {
    COMMERCE_COMMANDS,
    MYTIER_LINES,
    PROMO_LINES,
    GOLD_ARRIVAL,
    GENERIC_THANKS,
    NAMED_THANKS,
    UPGRADE_LINE,
    COMMERCE_COMMAND_NAMES,
    commerceCommandResponse,
    isCommerceCommand,
    myTierLine,
    pickPromoLine,
    pickGoldArrival,
    genericThankYou,
    namedThankYou,
    upgradeLine
};
