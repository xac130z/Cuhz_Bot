'use strict';

// ============================================================================
//  Unit tests for Twitch Edge Service (!topclip, !vod, !age, !followers, etc.)
// ============================================================================

const assert = require('assert');
const edge = require('../src/twitch_edge_service');

async function runTests() {
    console.log('🧪 Testing Twitch Edge Service Intelligence Suite');

    // Test 1: Channel normalization
    assert.strictEqual(edge.normalizeLogin('#Four_A_Reason'), 'four_a_reason');
    assert.strictEqual(edge.normalizeLogin('@PlanetCuhz'), 'planetcuhz');
    assert.strictEqual(edge.normalizeLogin('rico2ez'), 'rico2ez');
    console.log('✅ Test 1: Channel normalization passed');

    // Test 2: Uptime formatter
    const now = Date.now();
    const tenMinsAgo = new Date(now - 10 * 60 * 1000);
    const twoHoursAgo = new Date(now - 135 * 60 * 1000);
    assert.strictEqual(edge.formatUptimeDuration(tenMinsAgo), '10 minutes');
    assert.strictEqual(edge.formatUptimeDuration(twoHoursAgo), '2h 15m');
    console.log('✅ Test 2: Uptime duration formatter passed');

    // Test 3: Top Clip mock response
    edge.clearCache();
    edge.setMockFetcher(async (op, vars) => {
        if (op === 'TopClip') {
            return {
                user: {
                    clips: {
                        edges: [{
                            node: {
                                title: 'Insane 360 Dunks',
                                viewCount: 420,
                                slug: 'CrispyDunkSlug',
                                durationSeconds: 22,
                                curator: { displayName: 'Tay' }
                            }
                        }]
                    }
                }
            };
        }
        return null;
    });

    const clip = await edge.getTopClip('four_a_reason');
    assert.ok(clip, 'Should return top clip');
    assert.strictEqual(clip.title, 'Insane 360 Dunks');
    assert.strictEqual(clip.viewCount, 420);
    assert.strictEqual(clip.url, 'https://clips.twitch.tv/CrispyDunkSlug');
    assert.strictEqual(clip.curator, 'Tay');
    console.log('✅ Test 3: Top clip parsing passed');

    // Test 4: Account age mock calculation
    edge.clearCache();
    edge.setMockFetcher(async (op, vars) => {
        if (op === 'AccountAge') {
            // Set 400 days ago
            const d = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
            return { user: { displayName: 'CuhzFan', createdAt: d.toISOString() } };
        }
        return null;
    });

    const age = await edge.getAccountAge('cuhzfan');
    assert.ok(age, 'Should return account age');
    assert.strictEqual(age.yearsOld, 1);
    assert.strictEqual(age.daysOld, 400);
    console.log('✅ Test 4: Account age math & tenure passed');

    // Test 5: Followers count mock
    edge.clearCache();
    edge.setMockFetcher(async (op, vars) => {
        if (op === 'FollowerCount') {
            return { user: { displayName: 'Reason', followers: { totalCount: 676 } } };
        }
        return null;
    });

    const followers = await edge.getFollowerCount('four_a_reason');
    assert.ok(followers);
    assert.strictEqual(followers.totalCount, 676);
    console.log('✅ Test 5: Followers count passed');

    // Test 6: Live network integration check against real Twitch GQL
    edge.clearCache();
    edge.setMockFetcher(null); // Real network
    const liveCuhzBot = await edge.getLiveStream('cuhz_bot');
    assert.ok(liveCuhzBot, 'Should retrieve real cuhz_bot stream metadata');
    assert.strictEqual(typeof liveCuhzBot.isLive, 'boolean');
    console.log(`✅ Test 6: Live Twitch Edge network probe verified (cuhz_bot live=${liveCuhzBot.isLive})`);

    console.log('🎉 All Twitch Edge Service unit & integration tests passed cleanly!');
}

runTests().catch(err => {
    console.error('❌ Twitch edge test failed:', err);
    process.exit(1);
});
