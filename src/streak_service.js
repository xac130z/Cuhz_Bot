const WATCH_STREAK_MSG_ID = 'viewermilestone';
const WATCH_STREAK_CATEGORY = 'watch-streak';
const SEEN_EVENT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SEEN_EVENTS = 500;
const LATEST_STREAK_TTL_MS = 12 * 60 * 60 * 1000;
const AUTO_ANNOUNCE_COOLDOWN_MS = 30 * 1000;

function cleanLogin(value) {
    const login = String(value || '').trim().replace(/^@/, '');
    return /^[A-Za-z0-9_]{1,25}$/.test(login) ? login : null;
}

/**
 * Parse Twitch's verified IRC Watch Streak USERNOTICE.
 *
 * Twitch currently sends:
 *   msg-id=viewermilestone
 *   msg-param-category=watch-streak
 *   msg-param-value=<consecutive broadcasts watched>
 *
 * Ordinary chat messages are deliberately ignored so CUHZ Bot never presents
 * a viewer's typed claim as a Twitch-verified streak.
 */
function parseWatchStreakNotice(msgId, tags = {}) {
    if (String(msgId || '').toLowerCase() !== WATCH_STREAK_MSG_ID) return null;
    if (String(tags['msg-param-category'] || '').toLowerCase() !== WATCH_STREAK_CATEGORY) return null;

    const rawCount = String(tags['msg-param-value'] || '');
    if (!/^[1-9]\d*$/.test(rawCount)) return null;
    const streakCount = Number(rawCount);
    if (!Number.isSafeInteger(streakCount) || streakCount < 1) return null;

    const username = cleanLogin(tags.login || tags.username || tags['display-name']);
    if (!username) return null;

    const eventId = String(tags['msg-param-id'] || tags.id || '').trim();
    return {
        eventId: eventId || `${username.toLowerCase()}:${streakCount}`,
        username,
        streakCount
    };
}

function buildCelebration({ username, streakCount }) {
    if (streakCount >= 25) {
        return `🌌 LEGENDARY WATCH STREAK! @${username} has watched ${streakCount} consecutive streams — that's CUHZ history. Show love, family! 🔥`;
    }
    if (streakCount >= 10) {
        return `🚀 DOUBLE-DIGIT WATCH STREAK! @${username} just shared ${streakCount} consecutive streams. Certified CUHZ orbit — show love! 💎`;
    }
    if (streakCount >= 5) {
        return `🔥 @${username} is on a ${streakCount}-stream Watch Streak! That's a serious CUHZ run — family, show love! 🌌`;
    }
    return `🔥 Watch Streak spotted! @${username} has watched ${streakCount} consecutive streams. CUHZ fam, show love! 🌌`;
}

function buildLatestReply(latest) {
    if (!latest) {
        return `🔥 No recent Twitch Watch Streak is available. Share yours in Twitch chat and !streak will spotlight it.`;
    }
    return `🔥 Latest verified Watch Streak: @${latest.username} — ${latest.streakCount} consecutive streams. CUHZ fam, keep that run going! 🌌`;
}

function createTracker({ now = () => Date.now() } = {}) {
    const latestByChannel = new Map();
    const seenEvents = new Map();
    const lastAnnouncementByChannel = new Map();

    function pruneSeen(timestamp) {
        const cutoff = timestamp - SEEN_EVENT_TTL_MS;
        for (const [eventId, seenAt] of seenEvents) {
            if (seenAt < cutoff) seenEvents.delete(eventId);
        }
    }

    function record(channel, notice) {
        if (!notice) return { accepted: false, reason: 'invalid' };
        const channelKey = String(channel || '').toLowerCase();
        if (!channelKey) return { accepted: false, reason: 'invalid_channel' };

        const recordedAt = now();
        pruneSeen(recordedAt);
        const eventKey = `${channelKey}:${notice.eventId}`;
        if (seenEvents.has(eventKey)) return { accepted: false, reason: 'duplicate' };

        const recorded = { ...notice, channel: channelKey, seenAt: recordedAt };
        seenEvents.set(eventKey, recorded.seenAt);
        while (seenEvents.size > MAX_SEEN_EVENTS) {
            seenEvents.delete(seenEvents.keys().next().value);
        }
        latestByChannel.set(channelKey, recorded);

        // A raid can cause many viewers to share distinct streaks together.
        // Record every verified event, but send at most one automatic line per
        // channel every 30 seconds so community celebration cannot clog chat.
        const lastAnnouncement = lastAnnouncementByChannel.get(channelKey) || -Infinity;
        const shouldAnnounce = recordedAt - lastAnnouncement >= AUTO_ANNOUNCE_COOLDOWN_MS;
        if (shouldAnnounce) lastAnnouncementByChannel.set(channelKey, recordedAt);
        return {
            accepted: true,
            announced: shouldAnnounce,
            notice: recorded,
            reply: shouldAnnounce ? buildCelebration(recorded) : null
        };
    }

    function getLatest(channel) {
        const channelKey = String(channel || '').toLowerCase();
        const latest = latestByChannel.get(channelKey) || null;
        if (latest && now() - latest.seenAt > LATEST_STREAK_TTL_MS) {
            latestByChannel.delete(channelKey);
            return null;
        }
        return latest;
    }

    function commandReply(channel) {
        return buildLatestReply(getLatest(channel));
    }

    return { record, getLatest, commandReply };
}

/** Build the production USERNOTICE callback with dependencies injected so the
 * complete parse → dedupe/cooldown → send path is directly testable. */
function createNoticeHandler({ tracker, send, info = () => {}, error = () => {} }) {
    if (!tracker || typeof tracker.record !== 'function') throw new TypeError('tracker is required');
    if (typeof send !== 'function') throw new TypeError('send is required');

    return function handleWatchStreakNotice(msgId, channel, tags) {
        try {
            const notice = parseWatchStreakNotice(msgId, tags);
            const result = tracker.record(channel, notice);
            if (!result.accepted || !result.announced) return result;
            send(channel, result.reply, { source: 'watch_streak' });
            info(`🔥 Watch Streak in ${channel}: ${result.notice.username} (${result.notice.streakCount} streams)`);
            return result;
        } catch (err) {
            error('Watch Streak event handler error:', err);
            return { accepted: false, reason: 'handler_error' };
        }
    };
}

module.exports = {
    WATCH_STREAK_MSG_ID,
    WATCH_STREAK_CATEGORY,
    SEEN_EVENT_TTL_MS,
    MAX_SEEN_EVENTS,
    LATEST_STREAK_TTL_MS,
    AUTO_ANNOUNCE_COOLDOWN_MS,
    parseWatchStreakNotice,
    buildCelebration,
    buildLatestReply,
    createTracker,
    createNoticeHandler
};
