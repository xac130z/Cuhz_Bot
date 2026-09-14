'use strict';

// Twitch duplicates shared-chat PRIVMSGs with different `id` values, but
// preserves source-id and source-room-id. Process only the originating room:
// this also keeps commands, permissions, points and context in their own room.
// https://dev.twitch.tv/docs/chat/irc/#shared-chat
function createSharedChatGuard({ now = Date.now, ttlMs = 10 * 60 * 1000, maxEntries = 20000 } = {}) {
    const seen = new Map();
    const counters = { accepted: 0, self: 0, mirrored: 0, duplicate: 0, malformed: 0 };
    const clean = value => String(value || '').trim();
    const login = value => clean(value).replace(/^[@#]/, '').toLowerCase();

    function accept(tags = {}, self = false, botUsername = '', botUserId = '') {
        tags = tags || {};
        const sender = login(tags.username);
        if (self || (sender && sender === login(botUsername)) ||
            (clean(botUserId) && clean(tags['user-id']) === clean(botUserId))) {
            counters.self++;
            return false;
        }
        const sourceRoom = clean(tags['source-room-id']);
        const room = clean(tags['room-id']);
        if (sourceRoom && !room) {
            counters.malformed++;
            return false;
        }
        if (sourceRoom && sourceRoom !== room) {
            // Do not claim the ID: a mirrored copy can arrive BEFORE original.
            counters.mirrored++;
            return false;
        }
        const id = clean(tags['source-id']) || clean(tags.id);
        if (id) {
            const time = now();
            for (const [key, expires] of seen) {
                if (expires > time) break;
                seen.delete(key);
            }
            if (seen.has(id)) {
                counters.duplicate++;
                return false;
            }
            while (seen.size >= maxEntries) seen.delete(seen.keys().next().value);
            // Claim synchronously, before the message handler's first await.
            seen.set(id, time + ttlMs);
        }
        // Never dedupe by text: separate genuine messages may have identical text.
        counters.accepted++;
        return true;
    }

    return { accept, stats: () => ({ ...counters, trackedIds: seen.size }) };
}

module.exports = { createSharedChatGuard };
