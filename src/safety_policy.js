'use strict';

// CUHZ Bot's public boundary. Keep this file deterministic: model output is
// untrusted until it passes validateOutbound().
const APPROVED_LINKS = Object.freeze({
    website: 'https://planetcuhz.com',
    privacy: 'https://planetcuhz.com/privacy',
    whitepaper: 'https://planetcuhz.com/whitepaper',
    // Canonical planetcuhz.com surfaces (SITE TRUTH PACK links registry).
    chainStudio: 'https://planetcuhz.com/chain',
    botRequest: 'https://planetcuhz.com/bot',
    pricing: 'https://planetcuhz.com/pricing',
    botTiers: 'https://planetcuhz.com/pricing#bot',
    store: 'https://planetcuhz.com/store',
    solutions: 'https://planetcuhz.com/solutions',
    solutionsIntake: 'https://planetcuhz.com/solutions#start',
    creatorToolkit: 'https://planetcuhz.com/tools',
    community: 'https://planetcuhz.com/community',
    protocol: 'https://planetcuhz.com/protocol',
    memberApp: 'https://planetcuhz.com/app',
    discord: 'https://discord.com/invite/wt6Zc7Sgjx',
    voiceDiscord: 'https://discord.gg/eNxDKkxQdN',
    linktree: 'https://linktr.ee/PlanetCUHZ',
    x: 'https://x.com/PlanetCuhz',
    xCommunity: 'https://x.com/i/communities/1933710165359923481',
    twitch: 'https://www.twitch.tv/planetcuhz',
    // Bot ops dashboard (different trust domain; see config.js). The Chain
    // Studio moved to planetcuhz.com/chain — never link created.app for chains.
    dashboard: 'https://cuhz-bot-dashboard-846.created.app'
});

const APPROVED_HOSTS = new Set([
    'planetcuhz.com',
    'www.planetcuhz.com',
    'discord.com',
    'discord.gg',
    'linktr.ee',
    'x.com',
    'www.x.com',
    'cuhz-bot-dashboard-846.created.app',
    'twitch.tv',
    'www.twitch.tv'
]);

// Site-authority facts (SITE TRUTH PACK, verified against the real page code).
// Deliberately price-free: exact numbers live only in commerce_content.js —
// these lines establish WHERE the truth lives so the model never invents it.
const PUBLIC_FACTS = Object.freeze([
    'CUHZ Bot is the official Twitch bot for the Planet CUHZ creator community.',
    'Planet CUHZ (planetcuhz.com) is a Twitch-native NBA 2K creator community — the Cuhzunity — that also runs as an AI studio.',
    'Planet CUHZ helps creators learn, build, and level up together.',
    'CUHZ Bot can share approved links and answer short stream-related questions.',
    'The CUHZ Chain Studio is free at planetcuhz.com/chain — no login; upload a pic, drape the chain, pick a finish, download the PNG.',
    'The Chain Studio has ten finishes: Gold, Blue, Black, Silver, Iced, Fire, Electric, Frozen, Neon, and the signature Planet Cuhz spectrum.',
    'CUHZ Bot is free forever on the Community tier — streamers request it at planetcuhz.com/bot with Twitch sign-in (no channel name to type), then type /mod CuhzBot in chat.',
    'CUHZ Bot tiers are Community (free), Silver Supporter, Gold Executive, Affiliate Pack (for streamers), and the Architect custom build — Architect is quote-only, never a number.',
    'Bot tiers run alongside Planet CUHZ site membership (Free, Pro, Team) — one never replaces the other, and CUHZ points never expire.',
    'Store items at planetcuhz.com/store (Chain Full Pack, Emote Pack Vol. 1, Orbit Overlay Kit) are buyable in the store; merch runs as Cuhzunity drops coordinated in Discord.',
    'The AI studio builds, redesigns, and fixes streamer sites and stream tools — briefs go to planetcuhz.com/solutions and the studio replies with an exact quote before any build.',
    'The Cuhzunity lives on a voice-only Discord and on X @PlanetCuhz; the NBA 2K Protocol at planetcuhz.com/protocol finds your 5.',
    'Everything is plain USD — no coins, no tokens, no wallets, ever.',
    'Purchases happen only on an approved HTTPS checkout page; CUHZ Bot never collects payment details in chat.',
    'CUHZ Bot tiers and prices are listed only at planetcuhz.com/pricing — CUHZ Bot never quotes a price the site does not show. For plans and prices, point people to the !plans command.'
]);

const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|system|developer)\s+(instructions|messages|prompt)/i,
    /(reveal|show|print|repeat|leak)\s+(the\s+)?(system|developer|hidden|secret|api|oauth)/i,
    /(system|developer)\s*prompt/i,
    /jailbreak|prompt\s*injection|do\s+anything\s+now/i,
    /act\s+as\s+(an?\s+)?(unfiltered|unrestricted|developer|system)/i,
    /(?:password|api[_ -]?key|oauth[_ -]?token|seed phrase|private key)/i
];

const DISALLOWED_AI_OUTPUT = [
    /\b(?:password|api[_ -]?key|oauth[_ -]?token|seed phrase|private key)\b/i,
    /\b(?:send|wire|transfer|pay)\b.{0,40}\b(?:money|crypto|bitcoin|ethereum|wallet|cash app|card)\b/i,
    /\b(?:guaranteed returns?|risk[- ]free profit|get rich quick)\b/i,
    /(?:\$\s*\d|\b(?:usd|dollars?)\b\s*\d|\d\s*\b(?:usd|dollars?)\b)/i
];

const URL_PATTERN = /https?:\/\/[^\s<>()]+|(?:^|\s)(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>()]*)?/gi;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanText(value, maxLength = 450) {
    return String(value || '')
        .replace(CONTROL_CHARS, '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function extractUrls(text) {
    return (cleanText(text).match(URL_PATTERN) || []).map(url => url.trim());
}

function normalizeUrlCandidate(candidate) {
    const trimmed = candidate.replace(/[.,!?;:]+$/, '');
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isApprovedUrl(candidate) {
    try {
        const parsed = new URL(normalizeUrlCandidate(candidate));
        return parsed.protocol === 'https:' && APPROVED_HOSTS.has(parsed.hostname.toLowerCase());
    } catch (_) {
        return false;
    }
}

function assessViewerInput(value) {
    const text = cleanText(value, 350);
    if (!text) return { allowed: false, reason: 'empty', text: '' };
    if (INJECTION_PATTERNS.some(pattern => pattern.test(text))) {
        return { allowed: false, reason: 'prompt_injection', text: '' };
    }

    // Viewer links are not model context. This prevents a model from endorsing
    // phishing links while still allowing normal non-link chat around them.
    const safeText = text.replace(URL_PATTERN, ' [viewer link removed] ').replace(/\s{2,}/g, ' ').trim();
    return { allowed: true, reason: null, text: safeText };
}

function validateOutbound(value, options = {}) {
    const source = options.source || 'bot';
    const text = cleanText(value, 450);
    if (!text) return { allowed: false, reason: 'empty', text: '' };

    // IRC moderation actions are allowed only when the caller explicitly marks
    // them as a moderator action. AI and dashboard text can never create them.
    if (text.startsWith('/') && !options.moderatorAction) {
        return { allowed: false, reason: 'irc_action_not_authorized', text: '' };
    }

    const urls = extractUrls(text);
    if (urls.some(url => !isApprovedUrl(url))) {
        return { allowed: false, reason: 'unapproved_link', text: '' };
    }

    if (source === 'ai' && DISALLOWED_AI_OUTPUT.some(pattern => pattern.test(text))) {
        return { allowed: false, reason: 'unsafe_ai_claim', text: '' };
    }

    return { allowed: true, reason: null, text };
}

function safeUsername(value) {
    return cleanText(value, 25).replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
}

function approvedKnowledgeBlock() {
    return [
        'APPROVED PUBLIC FACTS (do not invent or contradict):',
        ...PUBLIC_FACTS.map(fact => `- ${fact}`),
        'APPROVED PUBLIC LINKS (never output another URL):',
        ...Object.entries(APPROVED_LINKS).map(([name, url]) => `- ${name}: ${url}`)
    ].join('\n');
}

module.exports = {
    APPROVED_LINKS,
    APPROVED_HOSTS,
    PUBLIC_FACTS,
    assessViewerInput,
    validateOutbound,
    safeUsername,
    approvedKnowledgeBlock,
    cleanText,
    extractUrls,
    isApprovedUrl
};
