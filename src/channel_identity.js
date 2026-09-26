// Routing aliases only: never rewrite historical users, points, or ledger IDs.
const CHANNEL_ALIASES = Object.freeze({
    qweenstormygirlnz89: 'stormygirlnz89'
});

function sanitizeChannel(name) {
    if (typeof name !== 'string') return null;
    const login = name.trim().toLowerCase().replace(/^#/, '');
    if (!login) return null;
    return `#${CHANNEL_ALIASES[login] || login}`;
}

function normalizeChannels(names) {
    return [...new Set(names.map(sanitizeChannel).filter(Boolean))];
}

module.exports = { sanitizeChannel, normalizeChannels };
