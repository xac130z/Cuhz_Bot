/**
 * test_points_copy.js — guards the honesty of every string that talks about
 * CUHZ Points. Real viewers are earning these points in 8 live channels, so a
 * false claim in chat is a broken promise, not a typo.
 *
 * What must stay true:
 *  1. Neither !rewards nor !pointsinfo points at planetcuhz.com — the site has no
 *     /rewards, /leaderboard or /points page (all 404 live), so the pointer is a
 *     dead end. (Restore it only when planetcuhz.com/points ships.)
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
 *  7. FIRST-PARTY ONLY (CUHZ_POINTS_ECONOMY.md Rev 2). CUHZ Bot is a guest in 8
 *     channels it does not own, so no reward may promise a HOST STREAMER's labor
 *     or channel privileges. This file is the tripwire: the retired vocabulary
 *     (shoutout / VIP / pick next game / "your stream" / "your channel") is
 *     banned from reward text, and the bot-greeting tier must name the Planet
 *     Cuhz channel out loud so it can never read as a promise in a host's house.
 *  8. The four public costs stay exactly 500/1000/2500/5000. Viewers are banking
 *     against those numbers right now — they may be lowered, never raised, and a
 *     net-new tier (e.g. the 7500 grail) needs the owner, not an agent.
 *  9. The 25% discount tier never claims instant/automatic delivery — spec §4 E1
 *     (store platform single-use codes) is UNVERIFIED and the fallback is a
 *     manual refund, so the copy must stay "issued via Discord" by a human.
 * 10. NAMING LAW (ladder v2, owner-locked 2026-08-06). The internal tier keys
 *     (basic/pro/premium) are plumbing, not products: "Pro" collides with the
 *     planetcuhz.com site membership and "Premium" is a plan nobody can buy, so
 *     neither may leak into a chat string. "Affiliate Pack" is retired vocabulary
 *     — the $49.99 SKU is Partner, a managed own-branded deployment. Every
 *     !prices line must also fit the 500-char Twitch cap.
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
check('!rewards states the Rev 2 fulfilment promise (fam / Discord, no host needed)',
    /via Discord/i.test(shippedRewards) && /no host needed/i.test(shippedRewards));
check('!rewards no longer implies on-stream fulfilment ("usually same stream")',
    !/same stream/i.test(shippedRewards));

// --- the ladder itself: first-party only ---------------------------------

// eslint-disable-next-line no-new-func
const tiersData = new Function(`${rewardsData[0]}\nreturn POINT_REWARDS;`)();

// Never-raise rule (spec §2c): these four numbers are public and viewers are
// grinding toward them. They may be confirmed or LOWERED — never raised — and a
// net-new tier (the 7500 grail) is the owner's call, not an agent's.
check(`costs are exactly [500,1000,2500,5000] (${tiersData.map(t => t.cost).join(',')})`,
    JSON.stringify(tiersData.map(t => t.cost)) === JSON.stringify([500, 1000, 2500, 5000]));

// Rev 2 kill list. CUHZ Bot is a guest in 8 channels it does not own, so reward
// copy may never name a host streamer's labour, airtime, or channel privileges.
const HOST_DEPENDENT = [
    'shoutout',
    'VIP',
    'pick next game',
    'your stream',
    'your channel'
];
tiersData.forEach(t => {
    const text = `${t.name} ${t.note}`;
    const hit = HOST_DEPENDENT.filter(w => new RegExp(w.replace(/ /g, '\\s+'), 'i').test(text));
    check(`tier ${t.cost} promises nothing from a host streamer${hit.length ? ` (found: ${hit.join(', ')})` : ''}`,
        hit.length === 0);
    check(`tier ${t.cost} has a website-grade note`,
        typeof t.note === 'string' && t.note.length > 20);
});

// The bot's own speech is ours; a greeting in a HOST's chat is our promo in their
// house. The tier must say WHICH channel out loud, in the chat-visible name too —
// in a host's channel an unscoped "Custom bot greeting" reads as a promise there.
const greeting = tiersData.find(t => /greeting/i.test(t.name));
check('bot-greeting tier exists and is priced at 5000', !!greeting && greeting.cost === 5000);
check('bot-greeting tier scopes to Planet Cuhz in its note',
    !!greeting && /planet\s*cuhz/i.test(greeting.note));
check('bot-greeting tier scopes to Planet Cuhz in the chat-visible name',
    !!greeting && /planet\s*cuhz/i.test(greeting.name));
check('bot-greeting scope survives into the rendered !rewards line',
    /planet\s*cuhz/i.test(shippedRewards.replace(/CUHZ POINTS REWARDS/i, '')));

// Spec §4 E1 is UNVERIFIED (can the store issue single-use codes at all?), and the
// documented fallback is William refunding 25% by hand. So the discount tier must
// read as human-issued — never instant, never automatic.
const discount = tiersData.find(t => /%/.test(t.name));
check('discount tier exists at 1000', !!discount && discount.cost === 1000);
check('discount tier does NOT claim instant/automatic delivery (E1 unverified)',
    !!discount && !/instant|automatic|auto-appl|immediately/i.test(`${discount.name} ${discount.note}`));
check('discount tier says a human issues it via Discord',
    !!discount && /issued via Discord/i.test(discount.note));

// The 7500 grail is net-new value (a $15 SKU) — owner approval, not agent action.
check('no unapproved 7500 grail tier snuck in',
    !tiersData.some(t => t.cost === 7500));

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

// A points line must name the currency AND route somewhere the viewer can act.
const pointsLine = l => /CUHZ Points/i.test(l) && /!(points|rewards)\b/.test(l);
check('TIMER_MESSAGES advertises the points loop', (proTimers || []).some(pointsLine));
check('BASIC_TIMER_MESSAGES advertises the points loop', (basicTimers || []).some(pointsLine));

// The instant AI spends are Pro/Premium-gated. Showcasing them in the Pro pool is
// the point of the Rev 2 timer upgrade; advertising them to Basic channels would
// be selling a command those viewers cannot run.
check('Pro timer showcases the instant AI spends (!ask / !code)',
    (proTimers || []).some(l => /!ask\b/.test(l) && /!code\b/.test(l)));
check('Basic timer does NOT advertise the Pro/Premium-only AI spends',
    !(basicTimers || []).some(l => /!ask\b|!code\b|-brain/.test(l)));

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

// /leaderboard, /rewards and /points all 404 on the live site. Until the /points
// page ships (spec §6), no chat surface may send a viewer there for points.
check('!pointsinfo contains NO planetcuhz.com dead link',
    !/planetcuhz\.com/i.test(pointsInfo));
check('!pointsinfo still routes the leaderboard to !top',
    /!top\b/.test(pointsInfo));

// And the mechanic it describes must still be the one in the code.
check('paycheck is still message-triggered (presence + interval gate in handler)',
    /sinceSeen <= PRESENCE_GAP_MS && sincePay >= PAYCHECK_INTERVAL_MS/.test(src));

// --- naming law: no internal tier names, no retired vocabulary -----------

// Every literal the bot actually speaks: sendMessage(channel, …) and the raw
// client.say(channel, …) escapes. Comments are excluded by construction (a
// commented-out line never matches the call form), so the old vocabulary can
// still be quoted in a code comment for context without failing the build.
function spokenStrings() {
    const out = [];
    const re = /(?:sendMessage|client\.say)\(\s*channel\s*,\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
    let m;
    while ((m = re.exec(src)) !== null) out.push({ raw: m[2], quote: m[1] });
    return out;
}

const spoken = spokenStrings();
check(`spoken-string scanner found the chat surface (${spoken.length} literals)`,
    spoken.length > 20);

// "Pro"/"Premium" are CHANNEL_TIERS plumbing. A viewer never bought either word,
// and "Pro" is the name of a different product on the site.
const tierLeaks = spoken.filter(s => /Pro\s*\/\s*Premium|\bPremium\b/i.test(s.raw));
check(`no internal tier names leak into chat copy${tierLeaks.length ? ` (found: ${tierLeaks.map(s => s.raw.slice(0, 60)).join(' | ')})` : ''}`,
    tierLeaks.length === 0);

// Retired 2026-08-06: the $49.99 SKU is Partner (managed, own-branded), and no
// chat string may still sell it as an "Affiliate Pack".
const affiliateLeaks = spoken.filter(s => /affiliate/i.test(s.raw));
check(`no "Affiliate Pack" vocabulary left in chat copy${affiliateLeaks.length ? ` (found: ${affiliateLeaks.map(s => s.raw.slice(0, 60)).join(' | ')})` : ''}`,
    affiliateLeaks.length === 0);

// --- !prices ladder ------------------------------------------------------

const planBlock = src.match(/const PLAN_DETAILS = \{([\s\S]*?)\n\s*\};/);
check('PLAN_DETAILS block found', !!planBlock);

const planLines = {};
if (planBlock) {
    planBlock[1].split('\n')
        .filter(l => !l.trim().startsWith('//'))
        .forEach(l => {
            const m = l.match(/^\s*(\w+)\s*:\s*(['"])((?:\\.|(?!\2)[^\\])*)\2/);
            if (m) planLines[m[1]] = unquote(`${m[2]}${m[3]}${m[2]}`);
        });
}

// The ladder the owner locked. `affiliate` stays an accepted ARG (aliased to
// partner in code) so old muscle memory still resolves — it just can't be a
// distinct product line any more.
['free', 'silver', 'gold', 'partner', 'architect', 'membership'].forEach(key => {
    check(`!prices ${key} exists`, typeof planLines[key] === 'string' && planLines[key].length > 20);
});
check('retired "affiliate" key no longer holds its own copy (aliased to partner)',
    !Object.prototype.hasOwnProperty.call(planLines, 'affiliate'));
check('affiliate still resolves as an arg alias of partner',
    /PLAN_DETAILS\.affiliate = PLAN_DETAILS\.partner;/.test(src));

// Partner is the repositioned $49.99: managed + own-branded + capped slots. If
// any of those three claims falls out, the price stops being defensible.
check('Partner copy sells the managed own-branded deployment',
    /partner/i.test(planLines.partner || '') && /own branded bot|OWN branded bot/i.test(planLines.partner || ''));
check('Partner copy states the 5 founding slots (scarcity is the offer)',
    /5 founding slots/i.test(planLines.partner || ''));
check('Gold copy states the included site membership (one sub, two surfaces)',
    /included/i.test(planLines.gold || ''));

// The menu line is the most-seen string in the whole pricing surface.
const menuMatch = src.match(/sendMessage\(channel, '(💎 CUHZ Bot plans:(?:\\.|[^'\\])*)'\)/);
check('!prices menu line found', !!menuMatch);
const menuLine = menuMatch ? unquote(`'${menuMatch[1]}'`) : '';
check('menu line keeps the drill-down hint', /!prices silver/.test(menuLine));
check('menu line names the whole ladder',
    ['Free', 'Silver', 'Gold', 'Partner', 'Architect'].every(n => menuLine.includes(n)));

const priceLines = [...Object.values(planLines), menuLine];
priceLines.forEach(text => {
    console.log(`     !prices copy (${text.length} chars): ${text}`);
});

// --- char caps -----------------------------------------------------------

[...allTimers, shippedRewards, pointsInfo, ...priceLines].forEach(text => {
    check(`under Twitch's ${TWITCH_MAX}-char cap (${text.length}): "${text.slice(0, 48)}…"`,
        text.length <= TWITCH_MAX);
});

if (failures) { console.error(`\n❌ test_points_copy: ${failures} check(s) failed`); process.exit(1); }
console.log('✅ test_points_copy: all checks passed');
