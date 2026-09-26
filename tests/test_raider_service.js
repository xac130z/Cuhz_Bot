'use strict';

// ============================================================================
//  Unit tests for Raider Service (!raider)
// ============================================================================

const assert = require('assert');
const raiderService = require('../src/raider_service');

async function runTests() {
    console.log('🧪 Testing Raider Service & Roster Live Scout Pipeline');

    // Test 1: Channel normalization
    assert.strictEqual(raiderService.normalizeChannel('#Four_A_Reason'), 'four_a_reason');
    assert.strictEqual(raiderService.normalizeChannel('@PlanetCuhz'), 'planetcuhz');
    assert.strictEqual(raiderService.normalizeChannel('rico2ez'), 'rico2ez');
    console.log('✅ Test 1: Channel normalization passed');

    // Test 2: Zero streamers live
    raiderService.clearCache();
    raiderService.setMockFetcher(async () => []);
    const msgEmpty = await raiderService.getRaiderRecommendation('four_a_reason');
    assert.ok(msgEmpty.includes('resting their frequencies'), 'Should report empty roster when nobody is live');
    assert.ok(msgEmpty.includes('planetcuhz.com/creators'), 'Should point to creators directory');
    console.log('✅ Test 2: Empty live roster response passed');

    // Test 3: Self-channel exclusion (only current channel is live)
    raiderService.clearCache();
    raiderService.setMockFetcher(async () => [
        { login: 'four_a_reason', displayName: 'Four_A_Reason', game: 'NBA 2K26', viewers: 42, title: 'Rec Grind' }
    ]);
    const msgSelf = await raiderService.getRaiderRecommendation('#four_a_reason');
    assert.ok(msgSelf.includes('resting their frequencies'), 'Current channel should be excluded so streamer does not raid self');
    console.log('✅ Test 3: Self-channel exclusion verified');

    // Test 4: Single live target recommendation
    raiderService.clearCache();
    raiderService.setMockFetcher(async () => [
        { login: 'four_a_reason', displayName: 'Four_A_Reason', game: 'NBA 2K26', viewers: 42, title: 'Rec Grind' },
        { login: 'rico2ez', displayName: 'Rico2EZ', game: 'Apex Legends', viewers: 18, title: 'Ranked Push' }
    ]);
    const msgSingle = await raiderService.getRaiderRecommendation('#four_a_reason');
    assert.ok(msgSingle.includes('@Rico2EZ'), 'Should recommend Rico2EZ');
    assert.ok(msgSingle.includes('Apex Legends'), 'Should display game name');
    assert.ok(msgSingle.includes('18 viewers'), 'Should display viewer count');
    assert.ok(msgSingle.includes('/raid rico2ez'), 'Should provide Twitch /raid command');
    console.log('✅ Test 4: Single target recommendation format passed');

    // Test 5: Multiple live targets (ranked sorting + runners-up)
    raiderService.clearCache();
    raiderService.setMockFetcher(async () => [
        { login: 'cuhz_bot', displayName: 'Cuhz_Bot', game: 'Software and Game Development', viewers: 5, title: 'Coding' },
        { login: 'stormygirlnz89', displayName: 'StormyGirlNZ89', game: 'Fortnite', viewers: 25, title: 'Late Night' },
        { login: 'thatgirlmahni_', displayName: 'ThatGirlMahni_', game: 'Just Chatting', viewers: 50, title: 'Community Talk' }
    ]);
    const msgMulti = await raiderService.getRaiderRecommendation('#cuhz_bot');
    assert.ok(msgMulti.includes('@ThatGirlMahni_'), 'Top viewer count should be primary recommendation');
    assert.ok(msgMulti.includes('@StormyGirlNZ89'), 'Runners-up should be included in list');
    assert.ok(msgMulti.includes('/raid thatgirlmahni_'), 'Should provide /raid command for top streamer');
    console.log('✅ Test 5: Multi-streamer ranked recommendation passed');

    // Test 6: Cache hit verification
    let fetchCalls = 0;
    raiderService.clearCache();
    raiderService.setMockFetcher(async () => {
        fetchCalls++;
        return [
            { login: 'rico2ez', displayName: 'Rico2EZ', game: 'Apex', viewers: 10, title: 'Live' }
        ];
    });
    await raiderService.getRaiderRecommendation('#planetcuhz');
    await raiderService.getRaiderRecommendation('#planetcuhz');
    assert.strictEqual(fetchCalls, 1, 'Subsequent call within TTL should hit cache, not invoke fetcher');
    console.log('✅ Test 6: In-memory caching layer verified');

    // Test 7: Live network test against Twitch GQL
    raiderService.clearCache();
    raiderService.setMockFetcher(null); // restore real network fetcher
    const liveStreams = await raiderService.fetchLiveStreams(['cuhz_bot']);
    assert.ok(Array.isArray(liveStreams), 'Should return an array from live Twitch GQL');
    console.log(`✅ Test 7: Live Twitch GQL network probe passed (found ${liveStreams.length} live from test set)`);

    console.log('🎉 All Raider Service unit & integration tests passed cleanly!');
}

runTests().catch(err => {
    console.error('❌ Raider service test failed:', err);
    process.exit(1);
});
