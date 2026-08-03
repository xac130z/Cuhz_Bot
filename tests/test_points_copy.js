/**
 * test_points_copy.js — guards the honesty of every string that talks about
 * CUHZ Points. Real viewers are earning these points in 8 live channels, so a
 * false claim in chat is a broken promise, not a typo.
 *
 * What must stay true:
 *  1. !rewards never points at planetcuhz.com — the site has no /rewards page,
 *     so the pointer is a dead end. (Restore it only when that page ships.)
 *  2. !rewards still renders inside REWARDS_LINE_MAX, and the drop-whole-tiers
 *     truncation still works if POINT_REWARDS ever grows.
 *  3. Both timer pools advertise the earn loop (the timers are the bot's only
 *     proactive surface — without this the economy is invisible).
 *  4. No timer still runs the retired "pull up to @four_a_reason's stream"
 *     onboarding; !bot is the single source of truth (PR #4).
 *  5. !pointsinfo does not promise points for silent lurking. The passive
 *     paycheck is MESSAGE-triggered (PRESENCE_GAP_MS 15 min / PAYCHECK_INTERVAL_MS
 *     10 min, both evaluated inside the chat-message handler), so a viewer who
 *     never types earns zero. The earn copy must be qualified with chat.
 *  6. Everything fits Twitch's 500-char message cap.
 */

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../src/bot.js'), 'utf8');

const TWITCH_MAX = 500;

let failures = 0;
const check = (name, cond) => {
    if (cond) console.log(`  ✅ ${name}`);
    else { console.error(`  ❌ ${name}`); failures++; }
};

console.log('test_points_copy:');

// --- helpers -------------------------------------------------------------

// Pull an array literal's body, minus // comment lines (comments quote the old
// copy on purpose and must not be mistaken for shipped strings).
function arrayLines(name) {
    const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`));
    if (!m) return null;
    const body = m[1].split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const lits = body.match(/(['"])(?:\\.|(?!\1)[^\\])*\1/g) || [];
    return lits.map(unquote);
}

function unquote(lit) {
    return lit.slice(1, -1).replace(/\\(['"\\])/g, '$1');
}

// --- !rewards ------------------------------------------------------------

// Evaluate the real buildRewardsLine() so we measure what chat actually sees.
const rewardsData = src.match(/const POINT_REWARDS = \[[\s\S]*?\n\];/);
const maxSrc = src.match(/const REWARDS_LINE_MAX = (\d+);/);
const fnSrc = src.match(/function buildRewardsLine\(\) \{[\s\S]*?\n\}/);
check('POINT_REWARDS / REWARDS_LINE_MAX / buildRewardsLine all found',
    !!rewardsData && !!maxSrc && !!fnSrc);

const REWARDS_LINE_MAX = maxSrc ? Number(maxSrc[1]) : 450;
check(`REWARDS_LINE_MAX budget intact (${REWARDS_LINE_MAX} <= ${TWITCH_MAX})`,
    REWARDS_LINE_MAX > 0 && REWARDS_LINE_MAX <= TWITCH_MAX);

// eslint-disable-next-line no-new-func
const buildWith = new Function('POINT_REWARDS',
    `${maxSrc[0]}\n${fnSrc[0]}\nreturn buildRewardsLine();`);
// eslint-disable-next-line no-new-func
const shippedRewards = new Function(
    `${rewardsData[0]}\n${maxSrc[0]}\n${fnSrc[0]}\nreturn buildRewardsLine();`)();

console.log(`     !rewards (${shippedRewards.length} chars): ${shippedRewards}`);

check('!rewards contains NO planetcuhz.com dead link',
    !/planetcuhz\.com/i.test(shippedRewards));
check(`!rewards within REWARDS_LINE_MAX (${shippedRewards.length} <= ${REWARDS_LINE_MAX})`,
    shippedRewards.length <= REWARDS_LINE_MAX);
check('!rewards still tells viewers how to actually redeem (ask a mod)',
    /ask a mod/i.test(shippedRewards));

// Truncation must still drop WHOLE tiers rather than blow the cap.
const fatLadder = Array.from({ length: 40 }, (_, i) => ({
    cost: (i + 1) * 500, name: `Placeholder reward number ${i + 1}`
}));
const truncated = buildWith(fatLadder);
check(`truncation still enforces the cap with an oversized ladder (${truncated.length} <= ${REWARDS_LINE_MAX})`,
    truncated.length <= REWARDS_LINE_MAX);
check('truncation marks the dropped tiers with an ellipsis', /…/.test(truncated));

// --- timer pools ---------------------------------------------------------

const proTimers = arrayLines('TIMER_MESSAGES');
const basicTimers = arrayLines('BASIC_TIMER_MESSAGES');
check('TIMER_MESSAGES parsed', Array.isArray(proTimers) && proTimers.length > 0);
check('BASIC_TIMER_MESSAGES parsed', Array.isArray(basicTimers) && basicTimers.length > 0);

const pointsLine = l => /!points\b/.test(l) && /CUHZ Points/i.test(l);
check('TIMER_MESSAGES advertises the points loop (mentions !points)',
    (proTimers || []).some(pointsLine));
check('BASIC_TIMER_MESSAGES advertises the points loop (mentions !points)',
    (basicTimers || []).some(pointsLine));

// Retired onboarding: !bot replaced the hardcoded stream pointer.
const allTimers = [...(proTimers || []), ...(basicTimers || [])];
check('no timer still routes onboarding to @four_a_reason\'s stream',
    !allTimers.some(l => /four_a_reason/i.test(l)));
check('Basic onboarding timer routes to !bot instead',
    (basicTimers || []).some(l => /!bot\b/.test(l)));

// --- !pointsinfo ---------------------------------------------------------

const infoMatch = src.match(/'!pointsinfo':\s*'((?:\\.|[^'\\])*)'/);
check('!pointsinfo string found', !!infoMatch);
const pointsInfo = infoMatch ? unquote(`'${infoMatch[1]}'`) : '';
console.log(`     !pointsinfo (${pointsInfo.length} chars): ${pointsInfo}`);

// The +10 paycheck only fires from inside the chat-message handler, so passive
// lurking pays nothing — the copy must say "in chat".
check('!pointsinfo does NOT promise points for passive lurking',
    !/hanging out (?!in chat)/i.test(pointsInfo));
check('!pointsinfo qualifies the +10 earn with chat',
    /hanging out in chat/i.test(pointsInfo));

// And the mechanic it describes must still be the one in the code.
check('paycheck is still message-triggered (presence + interval gate in handler)',
    /sinceSeen <= PRESENCE_GAP_MS && sincePay >= PAYCHECK_INTERVAL_MS/.test(src));

// --- char caps -----------------------------------------------------------

[...allTimers, shippedRewards, pointsInfo].forEach(text => {
    check(`under Twitch's ${TWITCH_MAX}-char cap (${text.length}): "${text.slice(0, 48)}…"`,
        text.length <= TWITCH_MAX);
});

if (failures) { console.error(`\n❌ test_points_copy: ${failures} check(s) failed`); process.exit(1); }
console.log('✅ test_points_copy: all checks passed');
