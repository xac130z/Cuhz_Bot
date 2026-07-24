'use strict';

// ============================================================================
//  Roster-sync tests — delta computation, protected env channels, join pacing,
//  fail-open, and contract event shapes. Hermetic: the site network seam is
//  stubbed via _internal.setNet so nothing hits the wire.
// ============================================================================

const assert = require('assert');
const config = require('../src/config');
const roster = require('../src/roster_service');

const I = roster._internal;

// Minimal desired-state row matching the GET contract shape.
function row(login, status, extra) {
    return Object.assign({
        id: `id-${login}`,
        twitch_user_id: `tuid-${login}`,
        twitch_login: login,
        status: status || 'approved',
        is_mod: false,
        channel_bot_granted: false,
        can_send: false,
        blocked_reason: null,
        last_seen_at: null
    }, extra || {});
}

function hashChannels(logins) {
    return logins.map((l) => `#${l}`);
}

async function run() {
    // ---------------------------------------------------------------- delta: joins
    {
        I.reset();
        const desired = [row('newstreamer', 'approved'), row('alreadyhere', 'active')];
        const delta = roster.computeDelta({
            desired,
            joined: hashChannels(['alreadyhere']),   // already in this one
            protectedSet: new Set(),
            roster: new Map()
        });
        assert.deepStrictEqual(delta.toJoin.map((j) => j.login), ['newstreamer'],
            'a desired channel we are not in must be a join');
        assert.strictEqual(delta.toJoin[0].id, 'id-newstreamer', 'join carries the site request id');
        // alreadyhere is joined + active -> heartbeat target, no confirm needed.
        assert.deepStrictEqual(delta.heartbeatIds.sort(), ['id-alreadyhere'],
            'joined desired channels are heartbeat targets');
        assert.strictEqual(delta.toConfirm.length, 0, 'active joined channel needs no confirm');
        assert.strictEqual(delta.toPart.length, 0, 'nothing to part');
    }

    // ---------------------------------------------- delta: confirm already-joined approved
    {
        I.reset();
        // An env/pre-joined channel that was ALSO requested on the site and is still
        // 'approved' -> no IRC join, just a 'joined' confirmation to flip it active.
        const delta = roster.computeDelta({
            desired: [row('envchan', 'approved')],
            joined: hashChannels(['envchan']),
            protectedSet: new Set(['envchan']),
            roster: new Map()
        });
        assert.strictEqual(delta.toJoin.length, 0, 'already joined -> no IRC join');
        assert.deepStrictEqual(delta.toConfirm.map((c) => c.login), ['envchan'],
            'joined + approved -> confirm to the site');
        assert.deepStrictEqual(delta.heartbeatIds, ['id-envchan']);
    }

    // ---------------------------------------------------- delta: parts (revoked channel)
    {
        I.reset();
        // We previously joined 'gonestreamer' via roster; it is no longer desired.
        const rosterMap = new Map([['gonestreamer', { id: 'id-gonestreamer' }], ['stillwanted', { id: 'id-stillwanted' }]]);
        const delta = roster.computeDelta({
            desired: [row('stillwanted', 'active')],
            joined: hashChannels(['gonestreamer', 'stillwanted']),
            protectedSet: new Set(),
            roster: rosterMap
        });
        assert.deepStrictEqual(delta.toPart.map((p) => p.login), ['gonestreamer'],
            'a roster channel no longer desired must be parted');
        assert.strictEqual(delta.toPart[0].id, 'id-gonestreamer', 'part carries the stored request id');
    }

    // ------------------------------------------------ PROTECTED env channels never part
    {
        I.reset();
        // 'homebase' is in our roster AND not desired, but it is a protected env
        // channel -> it must NEVER be parted.
        const rosterMap = new Map([['homebase', { id: 'id-homebase' }]]);
        const delta = roster.computeDelta({
            desired: [],                              // site wants nothing
            joined: hashChannels(['homebase']),
            protectedSet: new Set(['homebase']),
            roster: rosterMap
        });
        assert.strictEqual(delta.toPart.length, 0, 'protected env channel must never be parted');
    }

    // --------------------------------------------------------- delta: invalid rows dropped
    {
        I.reset();
        const delta = roster.computeDelta({
            desired: [
                row('good', 'approved'),
                { id: 'no-login', twitch_login: 'BAD NAME!', status: 'approved' }, // invalid login
                { twitch_login: 'noid', status: 'approved' }                       // missing id
            ],
            joined: [],
            protectedSet: new Set(),
            roster: new Map()
        });
        assert.deepStrictEqual(delta.toJoin.map((j) => j.login), ['good'],
            'rows with an invalid login or missing id are ignored');
    }

    // ------------------------------------------------------------------- join pacing
    {
        I.reset();
        // Fresh window: allow up to MAX_JOINS_PER_WINDOW (15), then stop.
        for (let i = 0; i < 15; i++) {
            assert.strictEqual(I.canJoinNow(), true, `join ${i} should be allowed within window`);
            I.recordJoinAttempt();
        }
        assert.strictEqual(I.canJoinNow(), false, '16th JOIN in a 10s window must be blocked');

        // Age the recorded JOINs out of the 10s window -> allowed again.
        I.reset();
        for (let i = 0; i < 15; i++) I._joinTimestamps.push(Date.now() - 11000);
        assert.strictEqual(I.canJoinNow(), true, 'stale JOINs prune out of the window');
    }

    // ---------------------------------------------- join pacing: executeJoins caps/cycle
    {
        I.reset();
        I.TUNING.joinSpacingMs = 0;      // no real delay in test
        I.TUNING.maxJoinsPerCycle = 3;   // cap the cycle
        const joined = [];
        const posts = [];
        I.setDeps({ join: async (ch) => { joined.push(ch); }, part: async () => {}, getJoined: () => [] });
        I.setNet({ postEvent: async (b) => { posts.push(b); return { ok: true }; } });

        const toJoin = ['a', 'b', 'c', 'd', 'e'].map((l) => ({ id: `id-${l}`, login: l, status: 'approved' }));
        const count = await I.executeJoins(toJoin);
        assert.strictEqual(count, 3, 'executeJoins must stop at maxJoinsPerCycle');
        assert.strictEqual(joined.length, 3, 'exactly 3 IRC joins this cycle');
        assert.strictEqual(posts.length, 3, 'exactly 3 joined events reported');
    }

    // -------------------------------------------- event shapes: joined (contract fields)
    {
        I.reset();
        I.TUNING.joinSpacingMs = 0;
        const posts = [];
        I.setDeps({ join: async () => {}, part: async () => {}, getJoined: () => [] });
        I.setNet({ postEvent: async (b) => { posts.push(b); return { ok: true }; } });

        await I.executeJoins([{ id: 'id-x', login: 'streamerx', status: 'approved' }]);
        const joinedEvt = posts.find((p) => p.event === 'joined');
        assert.ok(joinedEvt, 'a joined event must be posted');
        assert.deepStrictEqual(Object.keys(joinedEvt).sort(), ['can_send', 'event', 'id', 'is_mod', 'twitch_login'].sort());
        assert.strictEqual(joinedEvt.id, 'id-x');
        assert.strictEqual(joinedEvt.event, 'joined');
        assert.strictEqual(joinedEvt.twitch_login, 'streamerx');
        assert.strictEqual(joinedEvt.is_mod, false, 'fresh join is honestly not a mod');
        assert.strictEqual(joinedEvt.can_send, true);
        // The channel is now tracked in our roster.
        assert.ok(I._roster.has('streamerx'), 'a successful join is tracked in the roster');
    }

    // ------------------------------------------- event shapes: error (failed join)
    {
        I.reset();
        I.TUNING.joinSpacingMs = 0;
        const posts = [];
        I.setDeps({ join: async () => { throw new Error('No response from Twitch.'); }, part: async () => {}, getJoined: () => [] });
        I.setNet({ postEvent: async (b) => { posts.push(b); return { ok: true }; } });

        const count = await I.executeJoins([{ id: 'id-f', login: 'failchan', status: 'approved' }]);
        assert.strictEqual(count, 0, 'a failed join is not counted');
        const errEvt = posts.find((p) => p.event === 'error');
        assert.ok(errEvt, 'a failed join reports an error event');
        assert.strictEqual(errEvt.id, 'id-f');
        assert.strictEqual(typeof errEvt.message, 'string');
        assert.ok(/join failed/.test(errEvt.message), 'error message is descriptive');
        assert.ok(!I._roster.has('failchan'), 'a failed join is NOT tracked in the roster');
        assert.ok(I.isCoolingDown('failchan'), 'a failed join sets a backoff cooldown');
    }

    // -------------------------------------------- event shapes: parted (contract fields)
    {
        I.reset();
        const posts = [];
        const parted = [];
        I.setDeps({ join: async () => {}, part: async (ch) => { parted.push(ch); }, getJoined: () => [] });
        I.setNet({ postEvent: async (b) => { posts.push(b); return { ok: true }; } });
        I._roster.set('goodbye', { id: 'id-bye' });

        await I.executeParts([{ id: 'id-bye', login: 'goodbye' }]);
        assert.deepStrictEqual(parted, ['#goodbye'], 'part calls client.part with the # channel');
        const partedEvt = posts.find((p) => p.event === 'parted');
        assert.ok(partedEvt, 'a parted event must be posted');
        assert.deepStrictEqual(Object.keys(partedEvt).sort(), ['event', 'id'].sort());
        assert.strictEqual(partedEvt.id, 'id-bye');
        assert.strictEqual(partedEvt.event, 'parted');
        assert.ok(!I._roster.has('goodbye'), 'a parted channel is removed from the roster');
    }

    // ------------------------------------------------- event shapes: heartbeat (batch)
    {
        I.reset();
        const posts = [];
        I.setNet({ postEvent: async (b) => { posts.push(b); return { ok: true, updated: (b.ids || []).length }; } });
        // Seed active ids as a reconcile would, then heartbeat.
        config.enableRosterSync = true;
        const savedUrl = config.siteApiUrl;
        const savedSecret = config.siteApiSecret;
        config.siteApiUrl = 'https://example.functions.supabase.co';
        config.siteApiSecret = 'test-secret';

        // Drive active ids through a reconcile with a stubbed desired-state.
        I.setDeps({ join: async () => {}, part: async () => {}, getJoined: () => hashChannels(['live1', 'live2']) });
        I.setNet({
            getDesired: async () => ({ channels: [row('live1', 'active'), row('live2', 'active')] }),
            postEvent: async (b) => { posts.push(b); return { ok: true }; }
        });
        I.TUNING.joinSpacingMs = 0;
        await roster.reconcile();
        assert.deepStrictEqual(I.getActiveIds().sort(), ['id-live1', 'id-live2'],
            'reconcile records joined desired ids as heartbeat targets');

        await I.runHeartbeat();
        const hb = posts.find((p) => p.event === 'heartbeat');
        assert.ok(hb, 'heartbeat event must be posted');
        assert.deepStrictEqual(Object.keys(hb).sort(), ['event', 'ids'].sort());
        assert.ok(Array.isArray(hb.ids), 'heartbeat carries an ids array');
        assert.deepStrictEqual(hb.ids.slice().sort(), ['id-live1', 'id-live2']);

        config.siteApiUrl = savedUrl;
        config.siteApiSecret = savedSecret;
        config.enableRosterSync = false;
    }

    // ------------------------------------------------------------------- fail-open
    {
        I.reset();
        config.enableRosterSync = true;
        const savedUrl = config.siteApiUrl;
        const savedSecret = config.siteApiSecret;
        config.siteApiUrl = 'https://example.functions.supabase.co';
        config.siteApiSecret = 'test-secret';

        // Pre-seed a roster; a site outage must leave it untouched and NOT throw.
        I._roster.set('keepme', { id: 'id-keep' });
        let parted = false;
        I.setDeps({ join: async () => {}, part: async () => { parted = true; }, getJoined: () => hashChannels(['keepme']) });
        I.setNet({ getDesired: async () => { throw new Error('network down'); }, postEvent: async () => ({ ok: true }) });

        await roster.reconcile(); // must resolve, not reject
        assert.ok(I._roster.has('keepme'), 'fail-open keeps the current roster on a site outage');
        assert.strictEqual(parted, false, 'fail-open never parts a channel on a site outage');

        config.siteApiUrl = savedUrl;
        config.siteApiSecret = savedSecret;
        config.enableRosterSync = false;
    }

    // -------------------------------------------- disabled flag is a hard no-op
    {
        I.reset();
        config.enableRosterSync = false;
        let touched = false;
        I.setNet({ getDesired: async () => { touched = true; return { channels: [] }; }, postEvent: async () => ({ ok: true }) });
        await roster.reconcile();
        assert.strictEqual(touched, false, 'reconcile does nothing while ENABLE_ROSTER_SYNC is off');
    }

    console.log('✅ Roster service tests passed');
    // The DB adapter (sqlite) holds no open interval we care about; exit clean.
    process.exit(0);
}

run().catch((err) => {
    console.error('❌ Roster service tests FAILED:', err && err.stack ? err.stack : err);
    process.exit(1);
});
