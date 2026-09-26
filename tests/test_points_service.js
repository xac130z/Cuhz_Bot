// Tests for the CUHZ points service (Wave 6 points fix).
// Runs against the local sqlite adapter with throwaway usernames that are
// cleaned up at the end (plus any leftovers from earlier aborted runs).
const assert = require('assert');
const db = require('../src/database');
const pointsService = require('../src/points_service');
const safetyPolicy = require('../src/safety_policy');

const PREFIX = 'pttest_';
const uid = (name) => `${PREFIX}${name}_${Date.now()}`;

async function cleanup() {
    await db.prepare(`DELETE FROM points_ledger WHERE username LIKE '${PREFIX}%'`).run();
    await db.prepare(`DELETE FROM users WHERE username LIKE '${PREFIX}%'`).run();
}

async function run() {
    if (db.type !== 'sqlite') {
        console.log('SKIP: points service tests require the sqlite adapter (unset DATABASE_URL)');
        return;
    }
    await cleanup();

    const { EARN, COSTS } = pointsService;

    // --- Constants are the published rates and are frozen ---
    assert.strictEqual(EARN.CHAT_MESSAGE, 1);
    assert.strictEqual(EARN.ACTIVITY_BONUS, 10);
    assert.strictEqual(EARN.ACTIVITY_BONUS_MINUTES, 10);
    assert.strictEqual(EARN.FOLLOW_BONUS, 300);
    assert.strictEqual(COSTS.ASK_EYES, 10);
    assert.strictEqual(COSTS.ASK_BRAIN, 50);
    assert.strictEqual(COSTS.ASK_BRAIN_SILVER, 10); // published: 80% off 50
    assert.strictEqual(COSTS.CODE_HANDS, 25);
    assert.ok(Object.isFrozen(EARN) && Object.isFrozen(COSTS));

    // --- addPoints / getBalance roundtrip (balance persists in the DB) ---
    const alice = uid('alice');
    assert.strictEqual(await pointsService.getBalance(alice), 0, 'unknown user starts at 0');
    assert.strictEqual(await pointsService.addPoints(alice, 100, 'test_grant'), true);
    assert.strictEqual(await pointsService.getBalance(alice), 100);

    // Invalid amounts are rejected, never partially applied
    assert.strictEqual(await pointsService.addPoints(alice, 0, 'test_zero'), false);
    assert.strictEqual(await pointsService.addPoints(alice, -5, 'test_negative'), false);
    assert.strictEqual(await pointsService.addPoints(alice, NaN, 'test_nan'), false);
    assert.strictEqual(await pointsService.getBalance(alice), 100);

    // --- deductPoints is atomic and can never overdraw ---
    assert.strictEqual(await pointsService.deductPoints(alice, 40, 'test_spend'), true);
    assert.strictEqual(await pointsService.getBalance(alice), 60);
    assert.strictEqual(await pointsService.deductPoints(alice, 61, 'test_overdraw'), false, 'insufficient must refuse');
    assert.strictEqual(await pointsService.getBalance(alice), 60, 'refused spend must not move the balance');
    assert.strictEqual(await pointsService.deductPoints(alice, 60, 'test_exact'), true, 'exact balance spend is allowed');
    assert.strictEqual(await pointsService.getBalance(alice), 0);
    assert.strictEqual(await pointsService.deductPoints(uid('ghost'), 5, 'test_ghost'), false, 'unknown user cannot spend');
    assert.strictEqual(await pointsService.deductPoints(alice, 0, 'test_free'), true, 'zero cost (Gold perk) always passes');

    // --- claimBonus is idempotent per (user, reason) ---
    const bob = uid('bob');
    assert.strictEqual(await pointsService.claimBonus(bob, 'follower_bonus', EARN.FOLLOW_BONUS), true);
    assert.strictEqual(await pointsService.claimBonus(bob, 'follower_bonus', EARN.FOLLOW_BONUS), false, 'second claim must refuse');
    assert.strictEqual(await pointsService.getBalance(bob), EARN.FOLLOW_BONUS);

    // Monthly stipend reasons (tier_service style) stay idempotent the same way
    assert.strictEqual(await pointsService.claimBonus(bob, 'tier_bonus_2026_07_gold', 5000), true);
    assert.strictEqual(await pointsService.claimBonus(bob, 'tier_bonus_2026_07_gold', 5000), false);
    assert.strictEqual(await pointsService.getBalance(bob), EARN.FOLLOW_BONUS + 5000);

    // --- recordChatActivity: +1 per message, +10 at most once per 10 min ---
    const cara = uid('cara');
    let r = await pointsService.recordChatActivity(cara, '#testchan');
    assert.deepStrictEqual(r, { earned: 1, activityBonus: 0 }, 'first message after boot starts the clock, no bonus');
    r = await pointsService.recordChatActivity(cara, '#testchan');
    assert.deepStrictEqual(r, { earned: 1, activityBonus: 0 }, 'no bonus inside the interval');

    // Simulate the activity clock passing the 10-minute mark
    pointsService._internal.activityMarks.set(cara, Date.now() - (EARN.ACTIVITY_BONUS_MINUTES + 1) * 60 * 1000);
    r = await pointsService.recordChatActivity(cara, '#testchan');
    assert.deepStrictEqual(r, { earned: 1 + EARN.ACTIVITY_BONUS, activityBonus: EARN.ACTIVITY_BONUS });
    r = await pointsService.recordChatActivity(cara, '#testchan');
    assert.deepStrictEqual(r, { earned: 1, activityBonus: 0 }, 'bonus clock resets after paying');

    assert.strictEqual(await pointsService.getBalance(cara), 4 * EARN.CHAT_MESSAGE + EARN.ACTIVITY_BONUS);
    const caraRow = await db.prepare('SELECT messages_sent FROM users WHERE username = ?').get(cara);
    assert.strictEqual(caraRow.messages_sent, 4, 'message count moves with the same upsert');

    // Ledger rows carry the channel (bare login form) for auditability
    const bonusRow = await db.prepare(
        "SELECT channel FROM points_ledger WHERE username = ? AND reason = 'activity_bonus'"
    ).get(cara);
    assert.strictEqual(bonusRow.channel, 'testchan');

    // --- getWeeklyTop: dialect-safe UTC cutoff, NET earnings, works on sqlite ---
    assert.match(pointsService._internal.utcCutoffDaysAgo(7), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const weekly = await pointsService.getWeeklyTop(50);
    const caraWeekly = weekly.find(u => u.username === cara);
    assert.ok(caraWeekly, 'this week\'s earner appears on the weekly board');
    assert.strictEqual(caraWeekly.points, 4 * EARN.CHAT_MESSAGE + EARN.ACTIVITY_BONUS);
    const aliceWeekly = weekly.find(u => u.username === alice);
    assert.ok(!aliceWeekly, 'net-zero week (earned 100, spent 100) stays off the board');

    // --- Display copy: cuhz voice, validateOutbound-safe, REAL rates only ---
    const pointsLine = pointsService.buildPointsLine('SomeCuhz', 1250);
    const infoLine = pointsService.buildPointsInfoLine();
    for (const line of [pointsLine, infoLine]) {
        const checked = safetyPolicy.validateOutbound(line, { source: 'bot' });
        assert.strictEqual(checked.allowed, true, `outbound must pass safety: ${line}`);
        assert.strictEqual(checked.text, line, 'line must survive cleaning untruncated');
        assert.ok(!/crypto|token|coin|\$/i.test(line), 'loyalty points, never currency language');
    }
    assert.ok(pointsLine.includes('1,250'), 'balance is shown formatted');
    assert.ok(pointsLine.includes(`+${EARN.CHAT_MESSAGE} per message`));
    assert.ok(pointsLine.includes(`+${EARN.ACTIVITY_BONUS} every ${EARN.ACTIVITY_BONUS_MINUTES} min`));
    assert.ok(infoLine.includes('never expire'), 'matches the published FAQ promise');
    assert.ok(infoLine.includes(`!ask ${COSTS.ASK_EYES}`));
    assert.ok(infoLine.includes(`!ask -brain ${COSTS.ASK_BRAIN}`));
    assert.ok(infoLine.includes(`!code ${COSTS.CODE_HANDS}`));

    await cleanup();
    console.log('✅ test_points_service: all assertions passed');
}

run().then(() => process.exit(0)).catch(err => {
    console.error('❌ test_points_service failed:', err);
    cleanup().finally(() => process.exit(1));
});
