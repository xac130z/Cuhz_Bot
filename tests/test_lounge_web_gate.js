'use strict';
// The web gate turns a planetcuhz.com Supabase session into a verified Twitch
// id, or nothing. Identity law under test: ONLY identities[] from the online
// /auth/v1/user call counts; user-writable fields never do; the controller
// set is hardcoded and ignores env; every failure fails CLOSED.
const assert = require('node:assert/strict');
const { createWebGate, WEB_CONTROLLER_IDS } = require('../src/lounge_web_gate');

let passed = 0;
const check = async (n, f) => { await f(); passed++; console.log(`PASS ${n}`); };

const PHX = '823707557';
const OWNER = '1293717308';

function identityUser(id, login, extra = {}) {
    return {
        status: 200,
        data: {
            id: 'uuid-x',
            user_metadata: { provider_id: 'SPOOFED-' + id },   // must be ignored
            identities: [
                { provider: 'email', id: 'e1', identity_data: {} },
                { provider: 'twitch', id, identity_data: { sub: id, preferred_username: login } },
            ],
            ...extra,
        },
    };
}

(async () => {
    let calls = 0;
    const responses = [];
    const gate = () => createWebGate({
        anonKey: 'anon-key-public',
        httpGet: async () => { calls++; return responses.shift(); },
        now: () => clockMs,
    });
    let clockMs = 1_000_000;

    await check('the controller set is exactly the two shared controllers', () => {
        assert.deepEqual([...WEB_CONTROLLER_IDS].sort(), [OWNER, PHX].sort());
    });

    await check('a valid Phoenix session verifies, by identities[], never metadata', async () => {
        const g = gate();
        responses.push(identityUser(PHX, 'PhoenixPNYC'));
        const r = await g.verify('Bearer tok.a.a');
        assert.equal(r.ok, true);
        assert.equal(r.twitchId, PHX);
        assert.equal(r.login, 'phoenixpnyc');
    });

    await check('a signed-in NON-controller is refused: not_a_controller', async () => {
        const g = gate();
        responses.push(identityUser('999999', 'randomviewer'));
        const r = await g.verify('Bearer tok.b.b');
        assert.deepEqual(r, { ok: false, reason: 'not_a_controller' });
    });

    await check('mismatched identity fields fail closed (identity_data.sub must equal identity id)', async () => {
        const g = gate();
        const res = identityUser(PHX, 'phoenixpnyc');
        res.data.identities[1].id = '999999';          // disagreement = reject
        responses.push(res);
        const r = await g.verify('Bearer tok.c.c');
        assert.deepEqual(r, { ok: false, reason: 'no_twitch_identity' });
    });

    await check('no twitch identity at all is refused even for a valid session', async () => {
        const g = gate();
        responses.push({ status: 200, data: { identities: [{ provider: 'email', id: 'e', identity_data: {} }] } });
        const r = await g.verify('Bearer tok.d.d');
        assert.deepEqual(r, { ok: false, reason: 'no_twitch_identity' });
    });

    await check('a dead/revoked session (non-200) is not_signed_in — sign-out is caught online', async () => {
        const g = gate();
        responses.push({ status: 403, data: { error_code: 'session_not_found' } });
        const r = await g.verify('Bearer tok.e.e');
        assert.deepEqual(r, { ok: false, reason: 'not_signed_in' });
    });

    await check('missing/garbage Authorization header never reaches the network', async () => {
        const g = gate();
        const before = calls;
        for (const h of [undefined, '', 'Bearer', 'Basic abc', 'Bearer two tokens', 'Bearer $(bad)']) {
            const r = await g.verify(h);
            assert.deepEqual(r, { ok: false, reason: 'no_token' }, String(h));
        }
        assert.equal(calls, before, 'no HTTP call for malformed headers');
    });

    await check('network failure fails closed as auth_unreachable and is NOT cached', async () => {
        const g = createWebGate({
            anonKey: 'k',
            httpGet: async () => { calls++; throw new Error('ECONNRESET'); },
            now: () => clockMs,
        });
        const before = calls;
        assert.deepEqual(await g.verify('Bearer tok.f.f'), { ok: false, reason: 'auth_unreachable' });
        assert.deepEqual(await g.verify('Bearer tok.f.f'), { ok: false, reason: 'auth_unreachable' });
        assert.equal(calls, before + 2, 'an outage must never stick in the cache');
    });

    await check('verdicts cache for 45s per token, then re-verify', async () => {
        const g = gate();
        responses.push(identityUser(OWNER, 'planetcuhz'));
        const before = calls;
        assert.equal((await g.verify('Bearer tok.g.g')).ok, true);
        assert.equal((await g.verify('Bearer tok.g.g')).ok, true);   // cache hit
        assert.equal(calls, before + 1);
        clockMs += 46_000;
        responses.push({ status: 401, data: {} });                   // revoked meanwhile
        assert.equal((await g.verify('Bearer tok.g.g')).ok, false);  // re-checked
        assert.equal(calls, before + 2);
    });

    console.log(`\n${passed} web-gate checks passed.`);
})().catch((err) => { console.error(err); process.exit(1); });
