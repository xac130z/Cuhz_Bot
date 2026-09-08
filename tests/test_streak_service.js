const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tmi = require('tmi.js');
const streakService = require('../src/streak_service');

function verifiedTags(overrides = {}) {
    return {
        login: 'orbitcuhz',
        'display-name': 'OrbitCuhz',
        id: 'chat-message-id',
        'msg-id': 'viewermilestone',
        'msg-param-id': 'watch-streak-event-id',
        'msg-param-category': 'watch-streak',
        'msg-param-value': '7',
        ...overrides
    };
}

const parsed = streakService.parseWatchStreakNotice('viewermilestone', verifiedTags());
assert.deepStrictEqual(parsed, {
    eventId: 'watch-streak-event-id',
    username: 'orbitcuhz',
    streakCount: 7
});

assert.strictEqual(
    streakService.parseWatchStreakNotice('resub', verifiedTags()),
    null,
    'subscription streaks are not Watch Streak events'
);
assert.strictEqual(
    streakService.parseWatchStreakNotice('viewermilestone', verifiedTags({ 'msg-param-category': 'other' })),
    null,
    'other viewer milestones are ignored'
);
assert.strictEqual(
    streakService.parseWatchStreakNotice('viewermilestone', verifiedTags({ 'msg-param-value': '0' })),
    null,
    'invalid streak counts are ignored'
);
assert.strictEqual(
    streakService.parseWatchStreakNotice('viewermilestone', verifiedTags({ 'msg-param-value': '7abc' })),
    null,
    'malformed counts fail closed'
);
assert.strictEqual(
    streakService.parseWatchStreakNotice('viewermilestone', verifiedTags({ login: 'not a login', 'display-name': '' })),
    null,
    'unsafe mentions are rejected'
);

// Exercise the installed tmi.js parser, not just our helper. Version 1.8.5
// forwards new/unknown USERNOTICE types using (msgId, channel, tags, message).
const tmiClient = new tmi.Client({ connection: { reconnect: false }, channels: [] });
let forwardedNotice = null;
tmiClient.on('usernotice', (msgId, channel, tags, message) => {
    forwardedNotice = { msgId, channel, tags, message };
});
tmiClient.handleMessage({
    prefix: 'tmi.twitch.tv',
    command: 'USERNOTICE',
    params: ['#planetcuhz', 'Shared from Twitch'],
    tags: verifiedTags()
});
assert.ok(forwardedNotice, 'installed tmi.js emits a generic usernotice event');
assert.strictEqual(forwardedNotice.msgId, 'viewermilestone');
assert.strictEqual(forwardedNotice.channel, '#planetcuhz');
assert.strictEqual(forwardedNotice.tags['msg-param-category'], 'watch-streak');

let clock = 1_000;
const tracker = streakService.createTracker({ now: () => clock });
const first = tracker.record('#planetcuhz', parsed);
assert.strictEqual(first.accepted, true);
assert.strictEqual(first.announced, true);
assert.match(first.reply, /@orbitcuhz/);
assert.match(first.reply, /7-stream Watch Streak/);
assert.ok(first.reply.length <= 500, 'automatic reply fits Twitch chat');

const duplicate = tracker.record('#planetcuhz', parsed);
assert.deepStrictEqual(duplicate, { accepted: false, reason: 'duplicate' });

const latest = tracker.commandReply('#PLANETCUHZ');
assert.match(latest, /Latest verified Watch Streak/);
assert.match(latest, /7 consecutive streams/);
assert.ok(latest.length <= 500, '!streak reply fits Twitch chat');

const empty = tracker.commandReply('#anotherchannel');
assert.match(empty, /No recent Twitch Watch Streak is available/);

const burstNotice = streakService.parseWatchStreakNotice(
    'viewermilestone',
    verifiedTags({ login: 'secondcuhz', 'msg-param-id': 'burst-id', 'msg-param-value': '9' })
);
const burst = tracker.record('#planetcuhz', burstNotice);
assert.strictEqual(burst.accepted, true, 'a distinct verified event is recorded');
assert.strictEqual(burst.announced, false, 'channel cooldown suppresses burst chat');
assert.strictEqual(burst.reply, null);
assert.match(tracker.commandReply('#planetcuhz'), /@secondcuhz/,
    'suppressed celebrations still become the latest verified streak');

clock += streakService.LATEST_STREAK_TTL_MS + 1;
assert.match(tracker.commandReply('#planetcuhz'), /No recent Twitch Watch Streak is available/,
    'old latest state expires instead of presenting a stale streak');

clock = 1_000 + streakService.SEEN_EVENT_TTL_MS + 1;
const replayAfterTtl = tracker.record('#planetcuhz', parsed);
assert.strictEqual(replayAfterTtl.accepted, true, 'old event IDs expire from duplicate memory');

for (const count of [1, 5, 10, 25]) {
    const reply = streakService.buildCelebration({ username: 'orbitcuhz', streakCount: count });
    assert.match(reply, new RegExp(String(count)));
    assert.ok(reply.length <= 500, `tier ${count} reply fits Twitch chat`);
}

const botSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'bot.js'), 'utf8');
assert.match(botSource, /require\('\.\/streak_service'\)/, 'bot imports streak service');
assert.match(botSource, /client\.on\('usernotice'/, 'bot listens for Twitch USERNOTICE events');
assert.match(botSource, /createNoticeHandler/, 'bot uses the tested USERNOTICE handler');
assert.match(botSource, /msg === '!streak'/, '!streak command is dispatched');
assert.match(botSource, /!streak/, '!streak appears in bot help');

const sent = [];
const handlerLogs = [];
clock = 5_000;
const handlerTracker = streakService.createTracker({ now: () => clock });
const handler = streakService.createNoticeHandler({
    tracker: handlerTracker,
    send: (channel, text, options) => sent.push({ channel, text, options }),
    info: (line) => handlerLogs.push(line)
});
handler('viewermilestone', '#planetcuhz', verifiedTags());
handler('viewermilestone', '#planetcuhz', verifiedTags());
assert.strictEqual(sent.length, 1, 'one verified event sends once; replay is deduplicated');
assert.strictEqual(sent[0].options.source, 'watch_streak');
assert.strictEqual(handlerLogs.length, 1);

handler('resub', '#planetcuhz', verifiedTags());
assert.strictEqual(sent.length, 1, 'unrelated USERNOTICE never sends');

clock += streakService.AUTO_ANNOUNCE_COOLDOWN_MS + 1;
handler('viewermilestone', '#planetcuhz', verifiedTags({
    login: 'thirdcuhz',
    'msg-param-id': 'third-event',
    'msg-param-value': '12'
}));
assert.strictEqual(sent.length, 2, 'a later verified event sends after cooldown');

console.log('✅ test_streak_service: verified parsing, dedupe, command state, copy, and bot wiring');
