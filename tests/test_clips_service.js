'use strict';
// Actual service with inert ports: no real database/config/axios/Points import.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validateOutbound } = require('../src/safety_policy');
const source = fs.readFileSync(path.join(__dirname, '../src/clips_service.js'), 'utf8');
function fixture(options = {}) {
    const records = [], awards = [], requests = [], reads = [], queries = [];
    let now = 20000;
    class Clock extends Date { static now() { return now; } }
    const db = { prepare(sql) {
        queries.push(sql.trim());
        return {
            async run(...args) {
                if (options.saveThrows) throw new Error('synthetic unknown record');
                if (sql.includes('INSERT INTO community_clips')) {
                    const result = Object.hasOwn(options, 'saveResult') ? options.saveResult : { changes: 1 };
                    if (result?.changes === 1) records.push(args);
                    return result;
                }
                if (options.compileThrows) throw new Error('synthetic compile update');
                return { changes: args.length };
            },
            async all(limit) {
                if (options.readThrows) throw new Error('synthetic read');
                return records.slice(0, limit).map((r, i) => ({ id: i + 1, clipped_by: r[1], title: r[2] }));
            },
        };
    } };
    const ports = {
        axios: {
            async post(...args) { requests.push(args); if (options.apiThrows) throw new Error('synthetic unknown capture'); return options.response; },
            async get(...args) { reads.push(args); if (options.getThrows) throw new Error('synthetic unknown verification'); return options.getResponse; },
        },
        './database': db,
        './config': { oauthToken: options.native ? 'oauth:synthetic-fixture-only' : '', useMockApi: !options.native, twitchApiBase: 'https://fixture.invalid/helix' },
        './logger': { info() {}, warn() {}, error() {} },
        './points_service': { async addPoints(...args) {
            awards.push(args); if (options.pointsThrow) throw new Error('synthetic unknown award');
            return Object.hasOwn(options, 'pointsResult') ? options.pointsResult : true;
        } },
    };
    const context = { module: { exports: {} }, Date: Clock, process: { env: Object.freeze({ TWITCH_CLIENT_ID: Object.hasOwn(options, 'clientId') ? options.clientId : 'synthetic-client' }) }, require(name) {
        assert.ok(Object.hasOwn(ports, name), `Unexpected dependency ${name}`); return ports[name];
    } };
    vm.runInNewContext(source, context, { filename: 'clips_service.js', timeout: 1000 });
    return { service: context.module.exports, records, awards, requests, reads, queries, advance() { now += 15001; } };
}
let passed = 0;
async function test(name, body) { await body(); passed++; console.log(`PASS ${name}`); }
function sent(result) {
    const checked = validateOutbound(result.announcement, { source: 'bot' });
    assert.equal(checked.allowed, true); assert.ok(checked.text.length <= 450);
    assert.doesNotMatch(checked.text, /queued.*Discord|Points awarded|clipped that moment/i);
    return checked.text;
}
(async () => {
    await test('manual tool, confirmed record and award are independent', async () => {
        const f = fixture(); const r = await f.service.handleClipCommand('#planetcuhz', 'Alice', 'Insane No Scope 360');
        assert.equal(r.success, true); assert.equal(r.capture, 'unconfirmed');
        assert.equal(r.record, 'confirmed'); assert.equal(r.points, 'confirmed');
        assert.equal(r.title, 'Insane No Scope 360'); assert.equal(r.clipUrl, 'https://www.twitch.tv/planetcuhz/clip');
        assert.match(sent(r), /creation is unconfirmed.*manual clip tool/);
        assert.match(sent(r), /Request saved for community review/); assert.match(sent(r), /\+10 CUHZ Points confirmed/);
        assert.equal(f.requests.length, 0); assert.deepEqual(f.awards[0], ['alice', 10, 'community_clip', '#planetcuhz']);
    });
    await test('native202 confirms acceptance, never completed asynchronous creation', async () => {
        const f = fixture({ native: true, response: { status: 202, data: { data: [{ id: 'Valid_Slug-123' }] } } });
        const r = await f.service.handleClipCommand('#planetcuhz', 'Alice', '', '123456');
        assert.equal(r.capture, 'accepted'); assert.equal(r.clipUrl, 'https://clips.twitch.tv/Valid_Slug-123');
        assert.match(sent(r), /Twitch accepted.*creation is not verified/);
        assert.match(sent(r), /https:\/\/www.twitch.tv\/planetcuhz\/clip\/Valid_Slug-123/);
        assert.equal(f.requests.length, 1); assert.equal(f.awards.length, 1);
    });
    const receipt = { status: 202, data: { data: [{ id: 'Valid_Slug-123' }] } };
    await test('native request uses private numeric room and configured client; exact GET verifies capture', async () => {
        const f = fixture({ native: true, response: receipt, getResponse: { status: 200, data: { data: [{ id: 'Valid_Slug-123', broadcaster_id: '123456' }] } } });
        const r = await f.service.handleClipCommand('#planetcuhz', 'Alice', 'broadcaster_id=999999', '123456');
        assert.equal(r.capture, 'verified'); assert.match(sent(r), /Twitch clip verified/);
        assert.equal(f.requests[0][0], 'https://fixture.invalid/helix/clips');
        const post = f.requests[0][2], get = f.reads[0][1];
        assert.equal(post.params.broadcaster_id, '123456'); assert.equal(get.params.id, 'Valid_Slug-123');
        for (const request of [post, get]) {
            assert.equal(request.headers['Client-ID'], 'synthetic-client');
            assert.equal(request.headers.Authorization, 'Bearer synthetic-fixture-only');
            assert.equal(request.timeout, 3000); assert.equal(request.maxContentLength, 65536); assert.equal(request.maxRedirects, 0);
        }
        assert.equal(f.reads[0][0], f.requests[0][0]);
        assert.equal(f.requests.length, 1); assert.equal(f.reads.length, 1); assert.equal(f.awards.length, 1);
        assert.doesNotMatch(JSON.stringify(f.records), /123456/);
    });
    for (const room of [undefined, null, '', 'planetcuhz', '0', '01', '-1', '12.3', ' 123', '123\n', '1'.repeat(129), 123456, {}]) {
        await test('invalid or missing private room never calls native API', async () => {
            const f = fixture({ native: true, response: receipt });
            const r = await f.service.handleClipCommand('#planetcuhz', 'Alice', '123456', room);
            assert.equal(r.capture, 'unconfirmed'); assert.equal(f.requests.length, 0); assert.equal(f.reads.length, 0);
            assert.equal(f.awards.length, 1); sent(r);
        });
    }
    for (const clientId of [undefined, null, '', '   ', 123, 'bad id', 'bad\nid', 'a'.repeat(129)]) await test('missing configured Client-ID has no hardcoded native fallback', async () => {
        const f = fixture({ native: true, clientId, response: receipt });
        const r = await f.service.handleClipCommand('#planetcuhz', 'Alice', '', '123456');
        assert.equal(r.capture, 'unconfirmed'); assert.equal(f.requests.length, 0); assert.equal(f.reads.length, 0);
    });
    for (const outcome of [
        { getThrows: true }, {}, { getResponse: { status: 200, data: { data: [] } } },
        { getResponse: { status: 202, data: { data: [{ id: 'Valid_Slug-123', broadcaster_id: '123456' }] } } },
        ...[{ id: 'Other', broadcaster_id: '123456' }, { id: 'Valid_Slug-123', broadcaster_id: '999999' },
            { id: 'Valid_Slug-123', broadcaster_id: 123456 }, null].map(clip => ({ getResponse: { status: 200, data: { data: [clip] } } })),
    ]) await test('unconfirmed verification leaves accepted creation intact without retries or duplicate award', async () => {
        const f = fixture({ native: true, response: receipt, ...outcome });
        const r = await f.service.handleClipCommand('#planetcuhz', 'Alice', '', '123456');
        assert.equal(r.capture, 'accepted'); assert.match(sent(r), /creation is not verified/);
        assert.equal(f.requests.length, 1); assert.equal(f.reads.length, 1); assert.equal(f.awards.length, 1);
    });
    const invalidReceipts = [
        { apiThrows: true }, { response: { status: 202, data: { data: [] } } },
        { response: { status: 202, data: { data: { 0: { id: 'Valid' } } } } },
        { response: { status: 200, data: { data: [{ id: 'Valid' }] } } },
        ...[{}, ' ', '../bad', 'bad\nslug', 'https://bad.invalid', 'a'.repeat(129)].map(id => ({ response: { status: 202, data: { data: [{ id }] } } })),
    ];
    for (const options of invalidReceipts) await test('unknown/malformed native receipt uses manual tool without retry', async () => {
        const f = fixture({ native: true, ...options }); const r = await f.service.handleClipCommand('#planetcuhz', 'Alice', '', '123456');
        assert.equal(r.capture, 'unconfirmed'); assert.match(sent(r), /creation is unconfirmed/); assert.equal(f.reads.length, 0);
        assert.equal(f.requests.length, 1); assert.equal(f.awards.length, 1);
    });
    for (const options of [{ saveResult: { changes: 0 } }, { saveResult: { changes: '1' } }, { saveResult: undefined }, { saveThrows: true }]) await test('only exact one-row acknowledgement confirms a record', async () => {
        const f = fixture(options); const r = await f.service.handleClipCommand('#planetcuhz', 'Alice', '', '123456');
        assert.equal(r.success, false); assert.equal(r.record, 'unconfirmed'); assert.equal(r.points, 'confirmed');
        assert.match(sent(r), /Request save is unconfirmed/); assert.doesNotMatch(sent(r), /Request saved/); assert.equal(f.awards.length, 1);
    });
    for (const options of [{ pointsResult: false }, { pointsResult: undefined }, { pointsResult: { success: true } }, { pointsThrow: true }]) await test('unacknowledged award is unknown, not absent or retried', async () => {
        const f = fixture(options); const r = await f.service.handleClipCommand('#planetcuhz', 'Alice', '', '123456');
        assert.equal(r.success, true); assert.equal(r.record, 'confirmed'); assert.equal(r.points, 'unconfirmed');
        assert.match(sent(r), /Points status is unconfirmed; do not retry for points/);
        assert.doesNotMatch(sent(r), /\+10|no points|not awarded/i); assert.equal(f.awards.length, 1);
    });
    await test('cooldown prevents repeat effects; later requests retain existing policy', async () => {
        const f = fixture(); await f.service.handleClipCommand('#planetcuhz', 'Alice', '', '123456');
        const r = await f.service.handleClipCommand('#planetcuhz', 'ALICE');
        assert.equal(r.cooldown, true); assert.equal(f.awards.length, 1); assert.equal(f.records.length, 1);
        f.advance(); await f.service.handleClipCommand('#planetcuhz', 'Alice', '', '123456'); assert.equal(f.awards.length, 2);
    });
    await test('long title cannot hide outcomes or inject a blocked chat link', async () => {
        const title = '🎬'.repeat(500) + ' https://not-approved.invalid\nnext line';
        const f = fixture({ native: true, response: { status: 202, data: { data: [{ id: 'a'.repeat(128) }] } }, pointsResult: false, saveThrows: true });
        const r = await f.service.handleClipCommand('#' + 'c'.repeat(25), 'u'.repeat(25), title, '123456');
        assert.equal(r.title, title); assert.match(sent(r), /Request save is unconfirmed/);
        assert.match(sent(r), /Points status is unconfirmed/); assert.doesNotMatch(sent(r), /not-approved/);
    });
    await test('default/explicit metadata and review reader remain intact', async () => {
        const f = fixture(); const r = await f.service.handleClipCommand('#planetcuhz', 'Alice', '   ');
        assert.equal(r.title, 'Hype Moment by @planetcuhz');
        assert.equal((await f.service.getPendingClips(10))[0].title, r.title);
        await f.service.markClipsCompiled([1]); assert.match(f.queries.at(-1), /UPDATE community_clips/);
    });
    await test('reader/update errors stay bounded without follow-up effects', async () => {
        const f = fixture({ readThrows: true, compileThrows: true });
        assert.equal((await f.service.getPendingClips()).length, 0);
        await f.service.markClipsCompiled([1]); await f.service.markClipsCompiled([]);
        assert.equal(f.awards.length, 0); assert.equal(f.requests.length, 0);
    });
    console.log(`${passed} isolated clip checks passed; no real database, environment, API, wallet or Discord calls.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
