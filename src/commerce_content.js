'use strict';

// ============================================================================
//  CUHZ Bot — Stream commerce registry (code-owned, deterministic)
//
//  Sibling and stylistic twin of stream_content.js. Every price here mirrors the
//  live public catalog at https://planetcuhz.com/pricing. Prices live ONLY in
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

// Public product names describe channel-scoped bot plans, not viewer tiers.
// Legacy command names remain aliases for compatibility, but their replies use
// only the current public catalog names.
const COMMERCE_COMMANDS = Object.freeze({
    '!plans': '💎 Live plans: Membership — Free $0, Pro $9.99/mo, Team $24.99/mo. CUHZ Bot (one plan per Twitch channel) — Community free, Silver $4.99/mo, Gold $14.99/mo (includes site Pro), Partner $49.99/mo, Architect Custom Build (quote). One-time — Founders $99, Coaching Sprint $25/session. Details and purchase guidance → https://planetcuhz.com/pricing',
    '!community': '🤖 Community — free CUHZ Bot plan for one Twitch channel. Compare plans → https://planetcuhz.com/pricing · Start free bot onboarding → https://planetcuhz.com/bot',
    '!silver': '🥈 Silver — $4.99/mo for one CUHZ Bot plan on one Twitch channel. Compare plans and purchase → https://planetcuhz.com/pricing',
    '!gold': '💎 Gold — $14.99/mo for one CUHZ Bot plan on one Twitch channel; includes site Pro membership. Compare plans and purchase → https://planetcuhz.com/pricing',
    '!partner': '🛰️ Partner — $49.99/mo for one CUHZ Bot plan on one Twitch channel. Compare plans and purchase → https://planetcuhz.com/pricing',
    // Architect is QUOTE-ONLY by design — never emit a number here.
    '!architect': '🛠️ Architect Custom Build — quote only. Compare the live catalog → https://planetcuhz.com/pricing · Request an Architect quote → https://planetcuhz.com/solutions#start',
    '!site': '🌌 Planet CUHZ HQ → https://planetcuhz.com · Plans !plans · Store !store · Chain Studio (10 finishes, free, no login) → https://planetcuhz.com/chain',
    // Voice-only Discord — the same invite the site footer links (SOCIAL_LINKS).
    // A community invite, not a sale: no price, no urgency. Aliases: !voice, !family.
    '!discord': '🎙️ Pull up to the CUHZ voice fam — our voice-only Discord is where the cuhzins actually link up, cousin to cuhz → https://discord.gg/eNxDKkxQdN',
    // Planet CUHZ Podcast — a content plug, not a sale: no price, no urgency.
    // Aliases: !podcast, !pcp. Points at the real planetcuhz.com/podcast surface.
    '!pod': '🎙️ PCP — the Planet CUHZ Podcast (not that PCP, cuhz). Episode 001 is live → https://planetcuhz.com/podcast',
    '!pro': '🚀 Planet CUHZ membership: Free $0 · Pro $9.99/mo · Team $24.99/mo. Compare and purchase → https://planetcuhz.com/pricing',
    '!membership': '🚀 Planet CUHZ membership: Free $0 · Pro $9.99/mo · Team $24.99/mo. Compare and purchase → https://planetcuhz.com/pricing',
    '!store': '🛒 One-time offers: Founders $99 · Coaching Sprint $25/session. Details and purchase guidance → https://planetcuhz.com/pricing'
});

// --- !mytier dynamic lines (exact copy from plan §B) ------------------------
const MYTIER_LINES = Object.freeze({
    architect: '🛠️ @{user} this channel runs an Architect CUHZ Bot custom build. Plan details: !plans',
    partner: '🛰️ @{user} this channel runs the Partner CUHZ Bot plan. Plan details: !plans',
    gold: '💎 @{user} this channel runs the Gold CUHZ Bot plan. Plan details: !plans',
    silver: '🥈 @{user} this channel runs the Silver CUHZ Bot plan. Plan details: !plans',
    community: '🌌 @{user} this channel runs the free Community CUHZ Bot plan. Plan details: !plans'
});

// --- Periodic promo pool (exact copy from plan §C.1) ------------------------
// Honest, zero urgency, zero countdown language. One is injected per rotation.
const PROMO_LINES = Object.freeze([
    '💎 One CUHZ Bot plan per Twitch channel: Community free, Silver $4.99/mo, Gold $14.99/mo, Partner $49.99/mo, or Architect Custom Build. Details → https://planetcuhz.com/pricing',
    '🤖 Streamers: the Partner CUHZ Bot plan is $49.99/mo for one Twitch channel. Compare plans → https://planetcuhz.com/pricing',
    '🛒 Founders is $99 one-time and Coaching Sprint is $25/session. Details → https://planetcuhz.com/pricing',
    // Community lines — no price, no urgency. Still one-per-cycle (same pool, one pick).
    '🎙️ The CUHZ voice fam runs off-stream too — hop in the voice-only Discord and link with the cuhzins → type !discord',
    '💬 Real convos, cousin to cuhz — the CUHZ family lives in the voice Discord. Pull up, it\'s free → https://discord.gg/eNxDKkxQdN',
    '👥 Building together is the whole point. Join the CUHZ voice fam → !voice',
    // Content plug — no price, no urgency, no invented stats. One pick per cycle.
    '🎙️ The Planet CUHZ Podcast is up — PCP, and nah not that one cuhz. Tune in → type !pod'
]);

// --- Gold custom arrival pool (plan §A.3) -----------------------------------
// In-voice, honest, price-free. bot.js appends "@{user} 💎".
const GOLD_ARRIVAL = Object.freeze([
    '💎 Gold-plan channel cuhz in the building — clear the runway',
    '💎 Upper-orbit cuhz just landed — welcome in',
    '💎 Cuhz in the chat. The vibes are up'
]);

// --- Purchase thank-you / upgrade pools (exact copy from plan §C.2) ----------
// Generic-first (no name) is the safe default; named only when the buyer is
// present + public (they've chatted this session). Never an amount, order id,
// email, or "payment confirmed" phrasing — verified entitlement state only.
const GENERIC_THANKS = Object.freeze({
    silver: '🎉 This channel just moved to the Silver CUHZ Bot plan — CUHZ fam growing 💜',
    gold: '🎉 This channel just moved to the Gold CUHZ Bot plan — CUHZ fam growing 💜'
});
const NAMED_THANKS = Object.freeze({
    silver: '🎉 @{user} this channel just moved to the Silver CUHZ Bot plan 🥈 Plan details: !plans',
    gold: '🎉 @{user} this channel just moved to the Gold CUHZ Bot plan 💎 Plan details: !plans'
});
const UPGRADE_LINE = '🚀 @{user} this channel upgraded from Silver to Gold CUHZ Bot 💎 Plan details: !plans';

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
    if (key === '!affiliate') return COMMERCE_COMMANDS['!partner'];
    if (key === '!voice' || key === '!family') return COMMERCE_COMMANDS['!discord'];
    if (key === '!podcast' || key === '!pcp') return COMMERCE_COMMANDS['!pod'];
    return COMMERCE_COMMANDS[key] || null;
}

function isCommerceCommand(command) {
    const key = String(command || '').trim().toLowerCase().split(/\s+/)[0];
    return key === '!shop' || key === '!affiliate' || key === '!mytier' || key === '!voice' || key === '!family'
        || key === '!podcast' || key === '!pcp'
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

// Canonical commerce command registry. bot.js consumes this directly for the
// Basic-channel denylist so aliases and new commands cannot drift apart.
const COMMERCE_COMMAND_NAMES = Object.freeze([
    '!plans', '!community', '!silver', '!gold', '!partner', '!affiliate', '!architect',
    '!mytier', '!site', '!pro', '!membership', '!store', '!shop',
    // Voice-fam Discord (community invite) + its aliases.
    '!discord', '!voice', '!family',
    // Planet CUHZ Podcast (content plug) + its aliases.
    '!pod', '!podcast', '!pcp'
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
