'use strict';

// CUHZ Bot's public boundary. Keep this file deterministic: model output is
// untrusted until it passes validateOutbound().
const APPROVED_LINKS = Object.freeze({
    website: 'https://planetcuhz.com',
    privacy: 'https://planetcuhz.com/privacy',
    whitepaper: 'https://planetcuhz.com/whitepaper',
    discord: 'https://discord.com/invite/wt6Zc7Sgjx',
    voiceDiscord: 'https://discord.gg/eNxDKkxQdN',
    linktree: 'https://linktr.ee/PlanetCUHZ',
    dashboard: 'https://cuhz-bot-dashboard-846.created.app',
    chainGenerator: 'https://cuhz-bot-dashboard-846.created.app/chain-generator'
});

const APPROVED_HOSTS = new Set([
    'planetcuhz.com',
    'www.planetcuhz.com',
    'discord.com',
    'discord.gg',
    'linktr.ee',
    'cuhz-bot-dashboard-846.created.app',
    'twitch.tv',
    'www.twitch.tv'
]);

const PUBLIC_FACTS = Object.freeze([
    'CUHZ Bot is the official Twitch bot for the Planet CUHZ creator community.',
    'Planet CUHZ helps creators learn, build, and level up together.',
    'CUHZ Bot can share approved links and answer short stream-related questions.',
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
