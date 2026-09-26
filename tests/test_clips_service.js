'use strict';

const assert = require('assert');
const clipsService = require('../src/clips_service');
const pointsService = require('../src/points_service');
const db = require('../src/database');

async function runTests() {
    console.log('🧪 Testing Clips Service & Community Promo Pipeline');

    const testUser = `cliptest_${Date.now()}`;
    const channel = '#planetcuhz';

    // Test 1: First clip creates successfully
    const res1 = await clipsService.handleClipCommand(channel, testUser, 'Insane No Scope 360');
    assert.strictEqual(res1.success, true, 'First clip should succeed');
    assert.strictEqual(res1.title, 'Insane No Scope 360', 'Title should be preserved');
    assert.ok(res1.announcement.includes(testUser), 'Announcement should mention user');
    assert.ok(res1.announcement.includes('+10 CUHZ Points'), 'Announcement should mention +10 points');
    console.log('✅ Test 1: Clip creation & announcement passed');

    // Test 2: User is on cooldown immediately after
    const resCooldown = await clipsService.handleClipCommand(channel, testUser, 'Spam clip');
    assert.strictEqual(resCooldown.success, false, 'Second immediate clip should be blocked by cooldown');
    assert.strictEqual(resCooldown.cooldown, true, 'Cooldown flag should be true');
    console.log('✅ Test 2: User cooldown prevention passed');

    // Test 3: Verify points were credited to user
    const balance = await pointsService.getBalance(testUser);
    assert.strictEqual(balance, 10, 'User should have received 10 points for clipping');
    console.log('✅ Test 3: Loyalty points crediting verified');

    // Test 4: Verify clip saved in database
    const pending = await clipsService.getPendingClips(10);
    const saved = pending.find(c => c.clipped_by === testUser);
    assert.ok(saved, 'Clip should be present in pending queue');
    assert.strictEqual(saved.title, 'Insane No Scope 360');
    console.log('✅ Test 4: Database persistence verified');

    // Test 5: Mark clip compiled
    await clipsService.markClipsCompiled([saved.id]);
    const after = await clipsService.getPendingClips(10);
    const stillPending = after.find(c => c.id === saved.id);
    assert.strictEqual(stillPending, undefined, 'Clip should no longer be pending after markClipsCompiled');
    console.log('✅ Test 5: Lifecycle status updates verified');

    console.log('🎉 All Clips Service tests passed cleanly!');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
