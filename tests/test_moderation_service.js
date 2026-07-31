/**
 * test_moderation_service.js — offline unit tests for the Helix moderation
 * service. No network: axios is replaced with a recording mock. Style matches
 * the repo's plain-node test scripts (throw on failure, exit 0 on pass).
 */

const assert = require('assert');

// Mock config before the service loads it.
process.env.USE_MOCK_API = 'false';
const config = require('../src/config');
config.oauthToken = 'oauth:testtoken';

const moderation = require('../src/moderation_service');

// ---- mocks ----
const calls = [];
const auditRows = [];

const mockHttp = {
    async post(url, body, opts) { calls.push({ method: 'post', url, body, opts }); return { data: {} }; },
    async patch(url, body, opts) { calls.push({ method: 'patch', url, body, opts }); return { data: {} }; },
    async delete(url, opts) { calls.push({ method: 'delete', url, opts }); return { data: {} }; }
};

const failingHttp = (status) => ({
    async post() { const e = new Error('nope'); e.response = { status, data: { message: 'denied' } }; throw e; },
    async patch() { const e = new Error('nope'); e.response = { status, data: { message: 'denied' } }; throw e; },
    async delete() { const e = new Error('nope'); e.response = { status, data: { message: 'denied' } }; throw e; }
});

const mockDb = {
    prepare(sql) {
        return { async run(...args) { auditRows.push({ sql: sql.trim().split('\n')[0], args }); } };
    }
};

const users = {
    four_a_reason: { id: '111', login: 'four_a_reason' },
    troll_guy: { id: '222', login: 'troll_guy' }
};

function initWith(http) {
    calls.length = 0;
    moderation.init({
        http,
        db: mockDb,
        getTwitchUser: async (login) => users[login.toLowerCase()] || null,
        getIds: async () => ({ clientId: 'cid123', botUserId: '999' })
    });
}

(async () => {
    // 1. timeout → POST /moderation/bans with duration, correct ids, confirmation msg
    initWith(mockHttp);
    let res = await moderation.banOrTimeout('#four_a_reason', 'modguy', 'troll_guy', 600, 'spam');
    assert.strictEqual(res.ok, true);
    assert.ok(res.message.includes('600'), 'timeout confirmation mentions duration');
    let c = calls[0];
    assert.strictEqual(c.method, 'post');
    assert.ok(c.url.endsWith('/moderation/bans'));
    assert.strictEqual(c.body.data.user_id, '222');
    assert.strictEqual(c.body.data.duration, 600);
    assert.strictEqual(c.body.data.reason, 'spam');
    assert.strictEqual(c.opts.params.broadcaster_id, '111');
    assert.strictEqual(c.opts.params.moderator_id, '999');
    assert.strictEqual(c.opts.headers['Client-ID'], 'cid123');

    // 2. ban (no duration) → no duration field
    initWith(mockHttp);
    res = await moderation.banOrTimeout('#four_a_reason', 'modguy', '@troll_guy', null);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(calls[0].body.data.duration, undefined);
    assert.ok(res.message.includes('banned'));

    // 3. unban → DELETE /moderation/bans with user_id param
    initWith(mockHttp);
    res = await moderation.unban('#four_a_reason', 'modguy', 'troll_guy');
    assert.strictEqual(res.ok, true);
    c = calls[0];
    assert.strictEqual(c.method, 'delete');
    assert.ok(c.url.endsWith('/moderation/bans'));
    assert.strictEqual(c.opts.params.user_id, '222');

    // 4. clear → DELETE /chat/messages without message_id
    initWith(mockHttp);
    res = await moderation.clearChat('#four_a_reason', 'modguy');
    assert.strictEqual(res.ok, true);
    assert.ok(calls[0].url.endsWith('/chat/messages'));
    assert.strictEqual(calls[0].opts.params.message_id, undefined);

    // 5. slow on/off → PATCH /chat/settings with the right body
    initWith(mockHttp);
    res = await moderation.setSlowMode('#four_a_reason', 'modguy', 30);
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(calls[0].body, { slow_mode: true, slow_mode_wait_time: 30 });
    res = await moderation.setSlowMode('#four_a_reason', 'modguy', 0);
    assert.deepStrictEqual(calls[1].body, { slow_mode: false });

    // 6. announce → POST /chat/announcements, truncated to 500
    initWith(mockHttp);
    res = await moderation.announce('#four_a_reason', 'modguy', 'x'.repeat(600));
    assert.strictEqual(res.ok, true);
    assert.strictEqual(calls[0].body.message.length, 500);

    // 7. raid → never calls Helix, honest broadcaster prompt
    initWith(mockHttp);
    res = await moderation.raid('#four_a_reason', 'modguy', 'rico2ez');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(calls.length, 0, 'raid must not call Helix with the bot token');
    assert.ok(res.message.includes('/raid rico2ez'));

    // 8. 403 → honest scope message naming the exact missing scope
    initWith(failingHttp(403));
    res = await moderation.banOrTimeout('#four_a_reason', 'modguy', 'troll_guy', 60);
    assert.strictEqual(res.ok, false);
    assert.ok(res.message.includes('moderator:manage:banned_users'), 'names the missing scope');

    // 9. unknown target → clean error, no crash
    initWith(mockHttp);
    res = await moderation.banOrTimeout('#four_a_reason', 'modguy', 'ghost_user', 60);
    assert.strictEqual(res.ok, false);
    assert.ok(res.message.includes('not found'));

    // 10. audit rows were written for every attempt above
    assert.ok(auditRows.length >= 9, `audit rows written (got ${auditRows.length})`);
    assert.ok(auditRows.every(r => r.sql.includes('INSERT INTO mod_actions')));

    // 11. capabilityReport maps scopes correctly
    const cap = moderation.capabilityReport(['moderator:manage:banned_users', 'moderator:manage:chat_settings']);
    assert.deepStrictEqual(cap, { ban: true, clear: false, slow: true, announce: false });

    console.log('✅ test_moderation_service: all 11 checks passed');
})().catch((err) => {
    console.error('❌ test_moderation_service FAILED:', err.message);
    process.exit(1);
});
