'use strict';

// ============================================================================
//  Followage service tests — duration formatting, honest reply mapping
//  (following / not-following / no-permission / unknown user / API failure),
//  caching, tags-user-id fast path, and the 3s deadline. Hermetic: the Helix
//  network seam is stubbed via _internal.setNet so nothing hits the wire.
// ============================================================================

const assert = require('assert');
const followage = require('../src/followage_service');

const I = followage._internal;
const AUTH = { clientId: 'test-client-id', token: 'test-token' };

// Fake Helix: records calls, answers /users and /channels/followers.
function makeNet(handlers) {
    const calls = [];
    const net = async (url, options) => {
        calls.push({ url, params: (options && options.params) || {} });
        if (url.includes('/channels/followers')) return handlers.followers(options);
        if (url.includes('/users')) return handlers.users(options);
        throw new Error(`Unexpected URL in test: ${url}`);
    };
    net.calls = calls;
    return net;
}

function usersResponse(rows) {
    return { data: { data: rows } };
}

function httpError(status) {
    const err = new Error(`Request failed with status code ${status}`);
    err.response = { status, data: {} };
    return err;
}

async function run() {
    // ------------------------------------------------------------ formatDuration
    {
        assert.strictEqual(
            followage.formatDuration('2024-04-13T00:00:00Z', new Date('2026-07-25T12:00:00Z')),
            '2 years, 3 months, 12 days', 'calendar diff across years');
        assert.strictEqual(
            followage.formatDuration('2025-06-24T00:00:00Z', new Date('2026-07-25T12:00:00Z')),
            '1 year, 1 month, 1 day', 'singular unit forms');
        assert.strictEqual(
            followage.formatDuration('2026-06-30T00:00:00Z', new Date('2026-07-25T00:00:00Z')),
            '25 days', 'day borrow across a month boundary');
        assert.strictEqual(
            followage.formatDuration('2026-05-25T00:00:00Z', new Date('2026-07-25T00:00:00Z')),
            '2 months', 'zero-day months omit the days part');
        assert.strictEqual(
            followage.formatDuration('2026-07-25T07:00:00Z', new Date('2026-07-25T12:00:00Z')),
            '5 hours', 'sub-day follows report hours');
        assert.strictEqual(
            followage.formatDuration('2026-07-25T10:30:00Z', new Date('2026-07-25T12:00:00Z')),
            '1 hour', 'singular hour');
        assert.strictEqual(
            followage.formatDuration('2026-07-25T11:50:00Z', new Date('2026-07-25T12:00:00Z')),
            'less than an hour', 'brand-new follow');
        assert.strictEqual(
            followage.formatDuration('2099-01-01T00:00:00Z', new Date('2026-07-25T12:00:00Z')),
            'less than an hour', 'future/clock-skew timestamp never goes negative');
        assert.strictEqual(
            followage.formatDuration('not-a-date'),
            'less than an hour', 'garbage timestamp never crashes');
    }

    // ------------------------------------- following: tags fast path + caching
    {
        I.reset();
        const net = makeNet({
            users: () => usersResponse([{ id: 'b-1', login: 'four_a_reason', display_name: 'four_A_reason' }]),
            followers: () => ({ data: { data: [{ user_id: 'u-9', followed_at: '2024-04-13T00:00:00Z' }], total: 42 } })
        });
        I.setNet(net);

        const result = await followage.getFollowage({
            channelLogin: '#four_a_reason',
            targetLogin: 'wilmer',
            targetUserId: 'u-9',          // tmi tags fast path
            targetDisplay: 'Wilmer',
            auth: AUTH
        });
        assert.strictEqual(result.status, 'following');
        assert.strictEqual(result.followedAt, '2024-04-13T00:00:00Z');
        // tags carried the user id -> exactly one /users call (broadcaster only).
        assert.strictEqual(net.calls.filter(c => c.url.includes('/users')).length, 1,
            'sender lookup must reuse the tags user-id, not /users');
        const followersCall = net.calls.find(c => c.url.includes('/channels/followers'));
        assert.strictEqual(followersCall.params.broadcaster_id, 'b-1');
        assert.strictEqual(followersCall.params.user_id, 'u-9');

        const reply = followage.buildReply(result, new Date('2026-07-25T12:00:00Z'));
        assert.ok(reply.includes('@Wilmer'), 'reply addresses the target');
        assert.ok(reply.includes('2 years, 3 months, 12 days'), 'reply carries the human duration');
        assert.ok(reply.includes('four_a_reason'), 'reply names the channel');
        assert.ok(reply.toLowerCase().includes('cuhz'), 'reply speaks cuhz');
        assert.ok(!reply.startsWith('/'), 'reply is validateOutbound-safe (no IRC action)');
        assert.ok(reply.length <= 450, 'reply fits the outbound length cap');

        // Second ask inside the TTL: served entirely from cache, zero new calls.
        const before = net.calls.length;
        const again = await followage.getFollowage({
            channelLogin: 'four_a_reason', targetLogin: 'wilmer',
            targetUserId: 'u-9', targetDisplay: 'Wilmer', auth: AUTH
        });
        assert.strictEqual(again.status, 'following');
        assert.strictEqual(net.calls.length, before, 'follow answers are cached ~10 min');
    }

    // --------------------------------------- not following: honest + inviting
    {
        I.reset();
        const net = makeNet({
            users: (options) => {
                const login = options.params.login;
                if (login === 'four_a_reason') return usersResponse([{ id: 'b-1', display_name: 'four_A_reason' }]);
                return usersResponse([{ id: 'u-77', display_name: 'NewCuhz' }]);
            },
            followers: () => ({ data: { data: [], total: 42 } })
        });
        I.setNet(net);

        // "!followage @newcuhz" — no tags id, so the target IS resolved via /users.
        const result = await followage.getFollowage({
            channelLogin: 'four_a_reason', targetLogin: 'newcuhz',
            targetUserId: null, targetDisplay: 'newcuhz', auth: AUTH
        });
        assert.strictEqual(result.status, 'not_following');
        const reply = followage.buildReply(result);
        assert.ok(reply.includes('not following'), 'honest not-following');
        assert.ok(reply.includes('smash that follow'), 'invites the follow');
        assert.ok(reply.toLowerCase().includes('cuhz'));
    }

    // ------------------- 401/403: honest "need mod" — NEVER fake not-following
    {
        I.reset();
        const net = makeNet({
            users: () => usersResponse([{ id: 'b-1', display_name: 'four_A_reason' }]),
            followers: () => { throw httpError(401); }
        });
        I.setNet(net);

        const result = await followage.getFollowage({
            channelLogin: 'four_a_reason', targetLogin: 'wilmer',
            targetUserId: 'u-9', targetDisplay: 'Wilmer', auth: AUTH
        });
        assert.strictEqual(result.status, 'no_permission');
        const reply = followage.buildReply(result);
        assert.ok(reply.includes('mod status'), 'asks for mod status honestly');
        assert.ok(!reply.includes('not following'), 'a denied lookup never claims not-following');
        assert.ok(!reply.startsWith('/'), 'mentions /mod mid-sentence only — passes validateOutbound');

        // 403 (bot not a mod) maps the same way.
        I.reset();
        const net403 = makeNet({
            users: () => usersResponse([{ id: 'b-1', display_name: 'four_A_reason' }]),
            followers: () => { throw httpError(403); }
        });
        I.setNet(net403);
        const result403 = await followage.getFollowage({
            channelLogin: 'four_a_reason', targetLogin: 'wilmer',
            targetUserId: 'u-9', targetDisplay: 'Wilmer', auth: AUTH
        });
        assert.strictEqual(result403.status, 'no_permission');
    }

    // ---------------------------------------------------- unknown target user
    {
        I.reset();
        const net = makeNet({
            users: (options) => options.params.login === 'four_a_reason'
                ? usersResponse([{ id: 'b-1', display_name: 'four_A_reason' }])
                : usersResponse([]),
            followers: () => { throw new Error('followers must not be called for unknown users'); }
        });
        I.setNet(net);
        const result = await followage.getFollowage({
            channelLogin: 'four_a_reason', targetLogin: 'ghost_user_xyz',
            targetUserId: null, targetDisplay: 'ghost_user_xyz', auth: AUTH
        });
        assert.strictEqual(result.status, 'unknown_user');
        assert.ok(followage.buildReply(result).includes('ghost_user_xyz'));
    }

    // --------------------- network failure: graceful error, never cached, no throw
    {
        I.reset();
        const net = makeNet({
            users: () => usersResponse([{ id: 'b-1', display_name: 'four_A_reason' }]),
            followers: () => { throw new Error('ETIMEDOUT'); }
        });
        I.setNet(net);

        const result = await followage.getFollowage({
            channelLogin: 'four_a_reason', targetLogin: 'wilmer',
            targetUserId: 'u-9', targetDisplay: 'Wilmer', auth: AUTH
        });
        assert.strictEqual(result.status, 'error');
        const reply = followage.buildReply(result);
        assert.ok(reply.includes('run it back'), 'graceful failure reply');
        assert.ok(!reply.includes('not following'), 'a failed lookup never claims not-following');

        // Errors are NOT cached: the next ask must hit the API again.
        const followersCalls = () => net.calls.filter(c => c.url.includes('/channels/followers')).length;
        const before = followersCalls();
        await followage.getFollowage({
            channelLogin: 'four_a_reason', targetLogin: 'wilmer',
            targetUserId: 'u-9', targetDisplay: 'Wilmer', auth: AUTH
        });
        assert.strictEqual(followersCalls(), before + 1, 'transient errors are retried, not cached');
    }

    // --------------------------- missing/failed auth resolves to honest error
    {
        I.reset();
        I.setNet(makeNet({
            users: () => { throw new Error('must not be called without auth'); },
            followers: () => { throw new Error('must not be called without auth'); }
        }));
        const result = await followage.getFollowage({
            channelLogin: 'four_a_reason', targetLogin: 'wilmer',
            targetUserId: 'u-9', targetDisplay: 'Wilmer',
            auth: async () => null   // token validation failed upstream
        });
        assert.strictEqual(result.status, 'error');
    }

    // ------------------------------- deadline: a hung API can't stall the chat
    {
        I.reset();
        I.setNet(() => new Promise(() => {})); // Helix never answers
        const started = Date.now();
        const result = await followage.getFollowage({
            channelLogin: 'four_a_reason', targetLogin: 'wilmer',
            targetUserId: 'u-9', targetDisplay: 'Wilmer', auth: AUTH,
            deadlineMs: 100
        });
        assert.strictEqual(result.status, 'error', 'hung lookup resolves as error');
        assert.ok(Date.now() - started < 1000, 'resolves at the deadline, not the request timeout');
    }

    I.reset();
    console.log('✅ followage service tests passed');
}

run().catch((err) => {
    console.error('❌ followage service test failed:', err && err.stack ? err.stack : err);
    process.exit(1);
});
