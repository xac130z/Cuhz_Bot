'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createSharedChatGuard } = require('../src/shared_chat_guard');

const original = { username: 'viewer', 'user-id': '8', 'room-id': '1', 'source-room-id': '1', id: 'original', 'source-id': 'original' };
const mirror = { ...original, 'room-id': '2', id: 'mirror' };
let cases = 0;
function check(name, fn) { fn(); cases++; console.log(`PASS ${name}`); }
check('original then multiple mirrors', () => {
    const guard = createSharedChatGuard();
    assert.equal(guard.accept(original), true);
    assert.equal(guard.accept(mirror), false);
    assert.equal(guard.accept({ ...mirror, id: 'third', 'room-id': '3' }), false);
    assert.equal(guard.accept(original), false);
});
check('mirror first does not consume original', () => {
    const guard = createSharedChatGuard();
    assert.equal(guard.accept(mirror), false);
    assert.equal(guard.accept(original), true);
});
check('self echoes blocked by local flag, configured username, or immutable ID', () => {
    const guard = createSharedChatGuard();
    assert.equal(guard.accept({}, true), false);
    assert.equal(guard.accept({ username: 'CUHZ_BOT' }, false, 'cuhz_bot'), false);
    assert.equal(guard.accept({ username: 'renamed', 'user-id': '42' }, false, 'cuhz_bot', '42'), false);
    assert.equal(guard.accept({ username: 'cuhz_bot_fan' }, false, 'cuhz_bot', '42'), true);
});
check('ordinary IDs and shared source IDs canonicalize identically', () => {
    const guard = createSharedChatGuard();
    assert.equal(guard.accept({ id: 'original' }), true);
    assert.equal(guard.accept(original), false);
});
check('distinct genuine messages not suppressed; untagged ordinary chat works', () => {
    const guard = createSharedChatGuard();
    assert.equal(guard.accept({ id: 'a' }), true);
    assert.equal(guard.accept({ id: 'b' }), true);
    assert.equal(guard.accept({}), true);
    assert.equal(guard.accept({}), true);
});
check('incomplete source-room routing fails closed', () => {
    assert.equal(createSharedChatGuard().accept({ 'source-room-id': '1' }), false);
});
check('bounded IDs expire', () => {
    let time = 0;
    const guard = createSharedChatGuard({ now: () => time, ttlMs: 100, maxEntries: 2 });
    guard.accept({ id: 'a' }); guard.accept({ id: 'b' }); guard.accept({ id: 'c' });
    assert.equal(guard.stats().trackedIds, 2);
    assert.equal(guard.accept({ id: 'c' }), false);
    time = 101;
    assert.equal(guard.accept({ id: 'c' }), true);
    assert.equal(guard.stats().trackedIds, 1);
});

// Execute the actual production message handler, with I/O replaced by spies.
// Unlike a boot smoke test, failures are never classified as benign.
const source = fs.readFileSync(require.resolve('../src/bot'), 'utf8');
const body = source.slice(source.indexOf('async function handleMessage('), source.indexOf('// --- Express Setup ---'));
async function integration() {
    let effects = { points: 0, memory: 0, ai: 0, sends: [] };
    const sandbox = {
        sharedChatGuard: createSharedChatGuard(),
        config: { username: 'cuhz_bot', enableContextAware: true }, botUserId: '42',
        logger: { info() {}, error(message) { throw Error(message); } },
        userMemory: { recordMessage() { effects.memory++; }, async getProfile() { return {}; } },
        contextHandler: { addToContext() {}, isQuestionOrRequest: m => m.includes('@cuhz_bot'),
            async handleContextAwareResponse() { effects.ai++; return '@viewer Hello!'; } },
        moodTracker: { getCurrentPersonality() { return 'normal'; }, getPersonalityConfig() { return {}; } },
        KNOWN_BOTS: new Set(['cuhz_bot']),
        db: { prepare() { return { async get() { return null; }, async run() { return {}; } }; } },
        pointsService: { async addPoints() { effects.points++; } },
        loyaltySystem: { async checkAchievements() { return []; } },
        getChannelConfig() { return { commands: {}, settings: { auto_welcome: true } }; },
        CHANNEL_TIERS: { planetcuhz: 'premium', cuhz_bot: 'premium' },
        TIERS: { BASIC: 'basic', PRO: 'pro', PREMIUM: 'premium' },
        _channelWelcomes: new Map(), streamStates: new Map(), streamKey: c => c.replace('#', ''),
        buildAiCommandList: x => x,
        handleAutoShoutout() { throw Error('direct request must not also shout out'); },
        sendMessage: (channel, message) => effects.sends.push({ channel, message }),
        client: { say: (channel, message) => effects.sends.push({ channel, message }) }
    };
    vm.createContext(sandbox);
    vm.runInContext(body, sandbox);
    await Promise.all([
        sandbox.handleMessage('#cuhz_bot', mirror, '@cuhz_bot hello there', false),
        sandbox.handleMessage('#planetcuhz', original, '@cuhz_bot hello there', false),
        sandbox.handleMessage('#planetcuhz', original, '@cuhz_bot hello there', false),
        sandbox.handleMessage('#cuhz_bot', { ...original, username: 'cuhz_bot', id: 'echo', 'source-id': 'echo' }, '@viewer @cuhz_bot hey!', false)
    ]);
    assert.equal(effects.points, 1);
    assert.equal(effects.memory, 1);
    assert.equal(effects.ai, 1);
    assert.deepEqual(effects.sends, [{ channel: '#planetcuhz', message: '@viewer Hello!' }]);
    console.log('PASS real handler: mirrored + concurrent replay + self echo yield one reply/tag/award, no extra welcome');
    cases++;
    effects = { points: 0, memory: 0, ai: 0, sends: [] };
    const command = { ...original, id: 'cmd', 'source-id': 'cmd' };
    await sandbox.handleMessage('#cuhz_bot', { ...command, 'room-id': '2' }, '!ping', false);
    await sandbox.handleMessage('#planetcuhz', command, '!ping', false);
    assert.equal(effects.sends.length, 1);
    assert.equal(effects.sends[0].channel, '#planetcuhz');
    assert.equal(effects.points, 1);
    console.log('PASS real handler: mirrored command executes only in originating room');
    cases++;
    console.log(`${cases} shared-chat regression groups passed`);
}
integration().catch(err => { console.error(err); process.exitCode = 1; });
