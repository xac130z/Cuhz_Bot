const tmi = require('tmi.js');
const express = require('express');
const axios = require('axios');
const config = require('./config');
const logger = require('./logger');
const db = require('./database');
const aiService = require('./ai_service');
const moodTracker = require('./mood_tracker');
const contextHandler = require('./context_handler');
const userMemory = require('./user_memory');
const pointsService = require('./points_service');
const loyaltySystem = require('./loyalty');
const modIntel = require('./mod_intel');
const fs = require('fs');
const path = require('path');

// --- Tier System Definition ---
// Canonical access list. Keys MUST be lowercase — lookups do `.toLowerCase()`
// on the channel name before indexing this map. Any channel not listed falls
// through to TIERS.BASIC by default (see the `|| TIERS.BASIC` guard in
// handleMessage), but listing explicitly here makes intent clear.
const TIERS = { BASIC: 'basic', PRO: 'pro', PREMIUM: 'premium' };
const CHANNEL_TIERS = {
    'four_a_reason':         TIERS.PREMIUM,
    'rico2ez':               TIERS.PREMIUM,
    'planetcuhz':            TIERS.PREMIUM,
    'cuhz_bot':              TIERS.PREMIUM, // the bot's own stream
    'thatgirlmahni_':        TIERS.BASIC,
    'qweenstormygirlnz89':   TIERS.BASIC,
    'razredg1':              TIERS.BASIC,
    'snowy_wolfies_ttv':     TIERS.BASIC,
    'ohthatztayy':           TIERS.BASIC,
    'grouch392':             TIERS.BASIC
};

// --- Global Error Handlers (Prevention) ---
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception thrown:', err.stack || err);
});

const startTime = new Date();

// --- Twitch Setup ---
let client;
let connectedChannels = new Set();

// State
let timerIndices = new Map(); // channel -> index
let streamStates = new Map(); // channel (streamKey format) -> { isLive: boolean, startedAt: Date, title: string }

// Canonical streamStates key: strip the IRC '#' prefix and lowercase.
// Writers historically keyed by the raw tmi name ('#chan') while some readers
// used the stripped name ('chan') — every access MUST go through this helper.
function streamKey(channel) {
    return String(channel || '').replace('#', '').toLowerCase();
}
let channelConfigs = new Map(); // channel -> { timers: [], commands: {}, hype: [] }
let dailyMessages = new Map(); // channel -> string (set via !settoday)
let twitchClientId = null; // Fetched dynamically
let botUserId = null; // Captured during validation

// Webhook forwarding health (see "4. Webhook Forwarding" in handleMessage):
// throttled error logging + circuit breaker so a dead endpoint can't spam logs.
let _webhookConsecutiveFailures = 0;
let _webhookPausedUntil = 0;      // epoch ms; webhooks skipped until this time
let _webhookLastErrorLogAt = 0;   // epoch ms of last logged webhook error
const WEBHOOK_FAILURE_THRESHOLD = 5;
const WEBHOOK_PAUSE_MS = 30 * 60 * 1000;           // 30 minutes
const WEBHOOK_ERROR_LOG_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Per-channel welcome tracking (First Contact is scoped to CHANNEL, not global).
// Keyed by `${channel}:${username}` -> { firstContactAt: number, lastWelcomedAt: number }
const _channelWelcomes = new Map();
const WELCOME_BACK_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

// Random pick that avoids repeating the last N picks for a given key.
const _recentPicks = new Map(); // key -> string[]
function pickNoRepeat(key, arr, avoidLast = 3) {
    if (!arr || arr.length === 0) return null;
    const recent = _recentPicks.get(key) || [];
    const pool = arr.filter(x => !recent.includes(x));
    const source = pool.length ? pool : arr;
    const pick = source[Math.floor(Math.random() * source.length)];
    const next = [...recent, pick].slice(-avoidLast);
    _recentPicks.set(key, next);
    return pick;
}

// Per-channel outbound queue: Twitch rate-limited the bot when welcome + achievement
// sends fired within the same second. Queue guarantees ≥1.5s spacing per channel.
const SEND_SPACING_MS = 1500;
const _sendQueues = new Map(); // channel -> { queue: [], draining: bool, lastSentAt: number }

function sendMessage(channel, text) {
    if (!client || !channel || !text) return;
    const key = channel;
    let state = _sendQueues.get(key);
    if (!state) {
        state = { queue: [], draining: false, lastSentAt: 0 };
        _sendQueues.set(key, state);
    }
    state.queue.push(text);
    if (!state.draining) drainQueue(key);
}

function drainQueue(key) {
    const state = _sendQueues.get(key);
    if (!state || state.queue.length === 0) {
        if (state) state.draining = false;
        return;
    }
    state.draining = true;
    const wait = Math.max(0, state.lastSentAt + SEND_SPACING_MS - Date.now());
    setTimeout(() => {
        const next = state.queue.shift();
        if (next != null) {
            try {
                const p = client.say(key, next);
                if (p && typeof p.catch === 'function') {
                    p.catch(err => logger.error(`send error [${key}]:`, err && err.message ? err.message : err));
                }
            } catch (err) {
                logger.error(`send error [${key}]:`, err && err.message ? err.message : err);
            }
            state.lastSentAt = Date.now();
        }
        drainQueue(key);
    }, wait);
}

// Per-user !gamble cooldown timestamps
const _gambleCooldowns = new Map();

// --- Content Data (Non-Crypto) ---
const PUBLIC_COMMANDS = {
    // NOTE: direct !cuhz dispatch is intercepted by USER_VARIANT_POOLS (hype pool);
    // this entry stays because the context handler's Q&A matcher uses it to answer
    // "what is planet cuhz?" with the website link. Intentional dual-registration.
    '!cuhz': '🚀 https://planetcuhz.com',
    '!links': '🔗 https://linktr.ee/PlanetCUHZ',
    '!discord': '💬 Join the CUHZ fam → https://discord.com/invite/wt6Zc7Sgjx',
    '!whatiscuhz': '🌌 Planet CUHZ is the creator ecosystem. Start here → https://planetcuhz.com',
    '!faq': '🌌 Planet CUHZ is the creator ecosystem. Start here → https://planetcuhz.com',
    '!whitepaper': '📄 https://planetcuhz.com/whitepaper',
    '!roadmap': '🧭 https://planetcuhz.com/whitepaper#roadmap',
    '!rules': '📌 Be respectful. No hate. No spam. Stay CUHZ.',
    '!privacy': '🔒 Privacy & security → https://planetcuhz.com/privacy',
    '!gm': 'Good morning CUHZ ☀️',
    '!gn': 'Good night CUHZ 🌙',
    '!giveaway': '🎁 Giveaway status: Check Discord for active giveaways!',
    '!enter': 'Use the link in !giveaway or Discord to enter active giveaways.',
    '!dashboard': '🎛️ Add CUHZ Bot to your channel → https://cuhz-bot-dashboard-846.created.app',
    '!pointsinfo': '💎 Earn Cuhz Points by chatting! Use them for AI commands: !ask (10-20), !code (25), or !ask -brain (50). Use !points to check balance and !top for the leaderboard!'
};

const USER_COMMANDS = {
    '!uni': 'Universal vibes loaded! Welcome to the galaxy! 🌌',
    // !balen — rotated handler; aliases to BALEN_QUOTES via USER_VARIANT_POOLS.
    '!chi': 'Windy City energy! Chi2K is in the building. 🏀',
    '!bot': 'Just a bot doing bot things. 🤖',
    '!drizzy': 'Drizzy in the cut! No drizzle, just reign! ☔👑',
    // !ec — rotated handler; see EC_QUOTES + dispatch block.
    // !four — rotated handler; shares FOUR_QUOTES pool with !4 (see dispatch block).
    '!jay': 'HBN Jay bringing the heat! 300 level energy! 🔥',
    '!rell': 'Rell is here, the vibes are up! 🔥',
    '!jxy': 'Speak up! JxyTalk is in the room. 🎙️',
    '!keem': 'KeemKillem with the plays! Welcome fam! 🎮',
    '!jaylo': 'Jaylo sliding through! Smooth operator! ⛸️',
    '!tank': 'MDG Tank rolling out! Heavy hitter! 🛡️',
    '!badguy': 'It\'s MR BAD GUY... wait, he\'s actually chill! 😈',
    '!neb': 'Nebulous vibes... mysterious and cool. 🌫️',
    '!night': 'The OG bot is here. Respect the elders. 🤖',
    '!papi': 'Papi Cartier has arrived. Luxury vibes only. 💎',
    // !raz moved to BASIC_USER_COMMANDS — razredg1 is a basic-tier member and
    // this map only fires in Pro/Premium, so his own channel couldn't use it.
    '!famous': 'Real Famous K stepping in. Flash the cameras! 📸',
    '!rebound': 'Rebound Mindset. Bounce back stronger every time. 🏀',
    // !snow — rotated handler; aliases to SNOWY_QUOTES via USER_VARIANT_POOLS.
    '!thorn': 'Watch out for the thorns! 🌹',
    '!zuri': 'Zuri Owen in the house! Welcome family! 🏰',
    // !planet — rotated handler; aliases to CUHZ_QUOTES via USER_VARIANT_POOLS
    // (the pool fires first for ALL tiers, so a static entry here is unreachable).
    '!shock': 'Warning: High Voltage in the chat! ⚡',
    '!kay': 'Big Mula in the building! 💰',
    // !limit — rotated handler; aliases to LIMIT_QUOTES via USER_VARIANT_POOLS.
    '!reacts': 'Reactions are LIVE! 👀'
    // '!yoo' removed — duplicate of BASIC_USER_COMMANDS['!yoo'], which is checked
    // first for all tiers, so this entry never fired.
    // '!shoutouts' removed — dead code; the dedicated !shoutouts handlers further
    // down in dispatch always intercept first, and this string had gone stale.
};

const HYPE_MESSAGES = [
    "Let's go CUHZ! 🚀",
    "Planet CUHZ in the building! 🌌",
    "Hype! Hype! Hype! 🔥",
    "Level up your content game! 💎",
    "Welcome to the Planet! 🌍",
    "The orbit is CRAZY rn cuhz! 🪐",
    "CUHZ energy unmatched right now! 💥",
    "We breaking through the atmosphere! 🌠",
    "Strap in cuhz, we going INTERSTELLAR! ✨",
    "This stream hitting different tonight! 🔥🌌"
];

// !quote pool — format: "{emoji} {quote} — {author} {emoji}". 24 entries from
// the authors called out in Phase 6. Picked via pickNoRepeat (no-repeat-last-3).
const MOTIVATIONAL_QUOTES = [
    "🐍 The most important thing is to try and inspire people so that they can be great in whatever they want to do. — Kobe Bryant 🐍",
    "🐍 Everything negative — pressure, challenges — is all an opportunity for me to rise. — Kobe Bryant 🐍",
    "🐍 Dedication sees dreams come true. — Kobe Bryant 🐍",
    "✊ The time is always right to do what is right. — Dr. Martin Luther King Jr. ✊",
    "✊ Darkness cannot drive out darkness; only light can do that. Hate cannot drive out hate; only love can do that. — Dr. Martin Luther King Jr. ✊",
    "✊ I have decided to stick with love. Hate is too great a burden to bear. — Dr. Martin Luther King Jr. ✊",
    "🔥 A man who stands for nothing will fall for anything. — Malcolm X 🔥",
    "🔥 Education is the passport to the future, for tomorrow belongs to those who prepare for it today. — Malcolm X 🔥",
    "🌿 You never know how strong you are until being strong is your only choice. — Bob Marley 🌿",
    "🌿 Love the life you live. Live the life you love. — Bob Marley 🌿",
    "🌍 A people without the knowledge of their past history, origin and culture is like a tree without roots. — Marcus Garvey 🌍",
    "🌍 With confidence, you have won before you have started. — Marcus Garvey 🌍",
    "🥊 Don't count the days, make the days count. — Muhammad Ali 🥊",
    "🥊 He who is not courageous enough to take risks will accomplish nothing in life. — Muhammad Ali 🥊",
    "🌹 You may encounter many defeats, but you must not be defeated. — Maya Angelou 🌹",
    "🌹 I can be changed by what happens to me. But I refuse to be reduced by it. — Maya Angelou 🌹",
    "📜 If there is no struggle, there is no progress. — Frederick Douglass 📜",
    "💙 The game is going to test you. Never fold. Stay down till you come up. — Nipsey Hussle 💙",
    "💙 The highest human act is to inspire. — Nipsey Hussle 💙",
    "🌹 Reality is wrong. Dreams are for real. — Tupac Shakur 🌹",
    "✍️ Not everything that is faced can be changed, but nothing can be changed until it is faced. — James Baldwin ✍️",
    "📚 If you surrender to the air, you can ride it. — Toni Morrison 📚",
    "✊ The revolution has always been in the hands of the young. — Huey P. Newton ✊",
    "✊ You can jail a revolutionary, but you can't jail the revolution. — Fred Hampton ✊"
];

const LUCKY_4_QUOTES = [
    "Luck is what happens when preparation meets opportunity. 🍀",
    "The harder you work, the luckier you get. 💪",
    "4 a reason, 4 a season, 4 a lifetime. You're here for it all. 💎",
    "Positive mind = Positive life. Keep glowing. ✨",
    "Your breakthrough is just around the corner. Keep pushing. 🚀",
    "Believe in the magic of new beginnings. 🌅",
    "Good things take time. Great things take patience. ⏳",
    "Manifesting abundance for you today. 💰",
    "You are exactly where you need to be. Trust the process. 🗺️",
    "Every setback is a setup for a comeback. 🏹",
    "Radiate positivity and the world will reflect it back. ☀️",
    "Luck follows the brave. Be fearless. 🦁",
    "Small steps every day add up to big results. 👣",
    "Your energy introduces you before you even speak. Make it good. ⚡",
    "Focus on the solution, not the problem. 🧩",
    "Today is a great day to have a great day. 🌈",
    "Success is not final, failure is not fatal: it is the courage to continue that counts. 🛡️",
    "You are capable of amazing things. 🌟",
    "Don't stop until you're proud. 🏆",
    "Work hard in silence, let your success be your noise. 📢",
    "The best way to predict the future is to create it. 🔮",
    "Your potential is endless. Go do what you were created to do. 🎨",
    "Stay patient and trust your journey. 🛤️",
    "Good energy is contagious. Pass it on. 🔄",
    "Limitations live only in our minds. 🧠",
    "Push yourself, because no one else is going to do it for you. 🫵",
    "Great things never come from comfort zones. 🌊",
    "Dream it. Wish it. Do it. ✅",
    "Success doesn’t come to you, you go to it. 🏃‍♂️",
    "Work hard, be kind, and amazing things will happen. 💖",
    "The only bad workout is the one that didn't happen. 🏋️‍♂️",
    "Your life is as good as your mindset. 💭",
    "Do something today that your future self will thank you for. 📅",
    "It always seems impossible until it's done. 🏁",
    "Don't wait for opportunity. Create it. 🔨",
    "Every day brings new choices. Choose wisely. 🤔",
    "Be the energy you want to attract. 🧲",
    "Keep going. Everything you need will come to you at the perfect time. ⏱️",
    "You are stronger than you think. 💪",
    "4 the culture. 4 the community. 4 the win. 🌐"
];

// 12 creative variants — Four a Reason energy, dedication + grind, Planet CUHZ brand.
// Rotated via pickNoRepeat (no repeats within last 3 fires).
const AC_QUOTES = [
    "🐍 xAc130z in the frequency — job's NOT finished. CUHZ fam, lock in 💎",
    "🌌 The Captain touched down. Mamba Mentality active — let's get these reps in ⚡",
    "💎 4 a REASON. 4 a SEASON. 4 a LIFETIME. xAc130z is why we're here 🐍",
    "⚡ Dedication on display. The blueprint just walked in — welcome back cuhz 🌌",
    "🐍 Rest at the end, not in the middle. xAc130z showing how it's done 💎",
    "🌌 Planet CUHZ stand UP — the architect is live. Energy officially maxed ⚡",
    "💎 Pressure is a privilege and xAc130z been built for it. Tune in cuhz 🐍",
    "⚡ Mamba hour. No excuses, no shortcuts. xAc130z in the building 🌌",
    "🐍 Thank you for the vision xAc. The galaxy you built is POPPIN' 💎",
    "🌌 Haters stay in the stands — xAc130z in the arena. CUHZ we movin' ⚡",
    "💎 Greatness ain't a moment, it's a lifestyle. Welcome home xAc130z 🐍",
    "⚡ Every setback = setup for a comeback. Captain's back. LET'S WORK 🌌"
];

// !4 / !four — dedicated to @four_a_reason, leader of Planet CUHZ.
// Themes: great streamer, 2K player, real friend, leader. Palette 🫡 🏀 🌌 💎 ⚡ 🚀 🔥.
// 30 variants, no-repeat-last-3 via pickNoRepeat.
const FOUR_QUOTES = [
    "🫡 THE CAPTAIN IN THE CHAT! @four_a_reason leading the CUHZ frequency 🌌",
    "🏀 2K legend in the building — @four_a_reason cookin' defenders like usual 🔥",
    "💎 @four_a_reason — great streamer, realer friend, the blueprint for Planet CUHZ 🌌",
    "🌌 Planet CUHZ runs because @four_a_reason pours into the fam every day. Salute 🫡",
    "🚀 Captain's here. @four_a_reason built this ecosystem brick by brick 💎",
    "🏀 @four_a_reason on 2K is a PROBLEM for defenders — CUHZ fam stand up 🔥",
    "🫡 Four leads from the front every single day. Thank you cuhz ⚡",
    "⚡ @four_a_reason — real friend to the fam, real leader to the movement 💎",
    "🌌 The man, the myth, the mission. @four_a_reason running Planet CUHZ 🫡",
    "💎 Nobody shows up for the CUHZ fam like @four_a_reason does. Respect 🫡",
    "🚀 Captain Four pulled up — the frequency just got sharper. Let's GO 🌌",
    "🏀 2K king + Planet CUHZ leader + day-one friend = @four_a_reason 💎",
    "🫡 Four IS the reason. Four a reason, 4 a season, 4 a lifetime 🌌",
    "🔥 @four_a_reason doesn't just stream — he builds. Planet CUHZ was the vision 💎",
    "🏀 Buckets on the stream, blueprints behind the scenes. That's Captain Four 🫡",
    "⚡ The fam runs on Four's energy. Respect the grind cuhz 💎",
    "🌌 @four_a_reason — certified 2K problem, certified CUHZ leader 🏀",
    "🫡 Real captain. Real streamer. Real friend. @four_a_reason every time 💎",
    "🚀 Behind every Planet CUHZ W, there's @four_a_reason holdin' it down 🌌",
    "🏀 Four's handles on the sticks are ELITE. Pull up and watch the show 🔥",
    "💎 @four_a_reason showed us what building a real community looks like 🌌",
    "🫡 Captain Four don't cap, don't quit, don't stop. That's the standard ⚡",
    "🔥 Four_a_Reason: the streamer who turned a handle into a MOVEMENT 🌌",
    "🌌 Planet CUHZ ain't just a brand — it's Four's vision made real 💎",
    "🏀 2K tournament? Four pullin' up. @four_a_reason stays busy 🚀",
    "🫡 Every cuhz in here is here because Four opened the door. Appreciate him 💎",
    "⚡ @four_a_reason — builder, leader, friend. The whole package 🌌",
    "🚀 When Four's live, the frequency is LOCKED. That's how it's always been 🏀",
    "💎 Captain Four keeps the CUHZ family tight. Real loyalty, both ways 🫡",
    "🔥 @four_a_reason stays raising the bar — on stream and off. Legend cuhz 🌌"
];

// 12 warm hype variants for Rocklin — palette 💎 🌹 💖 ✨ ⚡ 🔥 🌌 📡 🚀 only.
// Always names her, rotated via pickNoRepeat (no repeats within last 3 fires).
const ROCK_QUOTES = [
    "💎 ROCKLIN IN THE BUILDING! The vibes just went up 10 levels 🚀",
    "🌹 @Rocklin just pulled up — everybody stand up for our girl 💖",
    "💎 Ayyy it's Rocklin! Glad you made it cuhz, we been waitin' 🔥",
    "⚡ Rock just touched down — frequency officially tuned in 📡",
    "💖 Our sis Rocklin is HERE. Chat got brighter immediately ✨",
    "🌹 ROCK! So good to see you cuhz — pull up a seat, we on one today 💎",
    "🔥 Rocklin in the chat means it's a real day now. Welcome home 🌌",
    "💎 The one and only @Rocklin! You already know we love to see you 💖",
    "⚡ Rock slid in — CUHZ fam fully assembled now 🚀",
    "🌹 Hey Rocklin! So glad you came through, we missed you cuhz 💖",
    "✨ Rocklin's here — somebody turn the hype up, that's fam 🔥",
    "💎 Look who finally pulled up! @Rocklin we got you all night 🌌"
];

// --- New user commands: 8 variants each, pickNoRepeat(..., 2). Everyone-permission. ---

// !ec for edward1chuckk — 8 variants, hype + family + ⚡ energy.
const EC_QUOTES = [
    "⚡ Edward in the chat! Let's get it cuhz 🔥",
    "⚡ @edward1chuckk just pulled up — energy officially maxed ⚡",
    "🔥 EDWARD IN THE BUILDING! CUHZ fam louder than the algorithm ⚡",
    "⚡ Ayy it's Edward! Glad you made it cuhz, we been ready 🔥",
    "💎 Edward slid in — the frequency just got charged ⚡",
    "⚡ @edward1chuckk in the chat means it's go time. Let's WORK 🔥",
    "🔥 Edward touched down. CUHZ fam fully plugged in ⚡",
    "⚡ Welcome back Edward! Real ones always pull through 💎"
];

// !TJ for tjmisses — hook: "ain't no show like a TJ show". Palette 🎬 🎙️ 🔥 ⚡ 💎.
const TJ_QUOTES = [
    "🎬 Ain't no show like a TJ show! @tjmisses in the building 🔥",
    "🎙️ The one, the only — @tjmisses. Ain't no show like a TJ show 💎",
    "🔥 TJ JUST PULLED UP. Say it with me: ain't no show like a TJ show ⚡",
    "🎬 Lights up, cameras on — @tjmisses is live. TJ show or no show 🎙️",
    "💎 Ain't no show like a TJ show, and ain't no energy like TJ energy. Welcome cuhz 🔥",
    "⚡ TJ just walked in and the whole vibe shifted. You already know — TJ show 🎙️",
    "🎙️ @tjmisses on the mic. Ain't no show like a TJ show, never has been 💎",
    "🔥 TJ MISSES IN THE CHAT! Clear the stage — ain't no show like a TJ show 🎬"
];

// !spence — hype + respect, treat him like a solid vet. Palette 🔥 💪🏿 ⚡ 💎 🌌.
const SPENCE_QUOTES = [
    "💪🏿 @spence in the chat — real recognize real. Welcome cuhz 💎",
    "🔥 SPENCE touched down. The standard just got higher ⚡",
    "💎 Spence slid through — respect given, respect earned. Welcome in 🌌",
    "⚡ @spence is here. Take notes, this one moves different 🔥",
    "💪🏿 Spence in the building — veteran energy, rookie hunger 💎",
    "🌌 Ayy it's Spence! Good to see you cuhz, we been ready 🔥",
    "🔥 Spence pulled up and the chat leveled up. That's how it goes 💪🏿",
    "💎 @spence — always a W when you roll through. Welcome home cuhz ⚡"
];

// !snowy for snowy_wolfies_ttv — includes "can't ban the Snowman" callback.
// Palette ❄️ 🧙‍♀️ 💜 ⚡ (no hearts per user preference).
const SNOWY_QUOTES = [
    "❄️ The Snowman has entered the chat! @snowy_wolfies_ttv on deck 💜",
    "❄️ Can't ban the Snowman — @snowy_wolfies_ttv here to stay 🧙‍♀️",
    "💜 Snowy in the building! Positivity dialed to a thousand ❄️",
    "🧙‍♀️ Hogwarts Legacy royalty in the chat — @snowy_wolfies_ttv touched down ❄️",
    "❄️ The frequency just got cooler. Snowy's here cuhz ⚡",
    "⚡ @snowy_wolfies_ttv SLID IN — chat officially upgraded ❄️",
    "❄️ Can't ban the Snowman, can't dim the Snowman — Snowy's HERE 💜",
    "⚡ Snowy in the chat! Hogwarts crew rolling deep tonight 🧙‍♀️"
];

// !kasha for dangbabykasha — Gryffindor energy. Palette 🦁 🔥 ⚡ 💎.
const KASHA_QUOTES = [
    "🦁 Gryffindor ROAR! @dangbabykasha just pulled up 🔥",
    "🦁 Kasha in the chat — bravery checked in ⚡",
    "🔥 @dangbabykasha SLID IN! The lion's den is full now 🦁",
    "⚡ Kasha energy detected. Chat immediately got braver 💎",
    "🦁 Our girl Kasha is here! Gryffindor stand up 🔥",
    "💎 @dangbabykasha touched down — courage on camera ⚡",
    "🦁 Kasha in the building, and the sorting hat agrees — she BUILT different 💎",
    "🔥 Welcome in @dangbabykasha! Real ones know 🦁"
];

// !qween for qweenstormygirlnz89 — Sims + basketball loyal regular.
// Palette 👑 🏀 ✨ 💖 📡.
const QWEEN_QUOTES = [
    "👑 QWEEN STORMY in the chat! Sims slayer, vibe curator 🏀",
    "👑 @qweenstormygirlnz89 we see you cuhz — the frequency is up 📡",
    "✨ Qween Stormy pulled up. Chat officially upgraded 👑",
    "👑 Ayy it's Qween! Good to see you cuhz 💖",
    "💖 @qweenstormygirlnz89 slid through — royalty in the building 👑",
    "👑 Qween energy only. Stormy here to run it 📡",
    "✨ Qween Stormy in the chat means we WINNING today 🏀",
    "💖 Welcome back Qween — the throne was empty without you 👑"
];

// !fvmous for realfvmousk — includes "4 RAIDY" callback. Palette ⭐ 🚀 💎 🔥.
const FVMOUS_QUOTES = [
    "⭐ FVMOUS in the building! @realfvmousk that raid energy unmatched 🚀",
    "⭐ 4 RAIDY! @realfvmousk dropped in with the heat 🔥",
    "🚀 Fvmous just touched down — CUHZ fam stand up ⭐",
    "🔥 @realfvmousk slid in with the 4 RAIDY energy. Let's GO ⭐",
    "💎 Fvmous here! Star power officially in the chat ⭐",
    "⭐ @realfvmousk pulled up. Frequency got famous real quick 💎",
    "🚀 FVMOUS! 4 RAIDY 4 LIFE — welcome home cuhz 💎",
    "🔥 @realfvmousk in the chat — legends always pull through ⭐"
];

// WE ARE LIVE announcement pool — 6 variants, {game} interpolated.
const LIVE_ANNOUNCEMENTS = [
    "🔴 WE ARE LIVE! playing {game}! Get in here cuhz! 🚀",
    "🔴 LIVE NOW — {game} on deck. Pull up cuhz 🚀",
    "🔴 Stream's hot — slidin' on {game}. Come thru 💎",
    "🔴 It's a day. LIVE with {game}. Lock in 🔥",
    "🔴 Frequency tuned. {game} is on. Let's ride ⚡",
    "🔴 We back — {game} is live. CUHZ fam assemble 🌌"
];

// Timer-driven auto-posts — 10 per category, weighted so same category doesn't fire twice in a row.
const TIMER_POOLS = {
    ecosystem: [
        "🌌 Planet CUHZ → https://planetcuhz.com",
        "🌌 Planet CUHZ is the creator ecosystem. Start here → https://planetcuhz.com",
        "💎 Built on love, loyalty, and levelin' up. Welcome to Planet CUHZ → https://planetcuhz.com",
        "🌌 The frequency → https://planetcuhz.com",
        "⚡ Creators supporting creators. That's Planet CUHZ → https://planetcuhz.com",
        "🌌 Real ecosystem, real community, real creators → https://planetcuhz.com",
        "💎 Planet CUHZ — where the CUHZ fam lives → https://planetcuhz.com",
        "🌌 Tap in with the ecosystem → https://planetcuhz.com",
        "🚀 This is Planet CUHZ. Welcome home → https://planetcuhz.com",
        "🌌 CUHZ fam, first time here? → https://planetcuhz.com"
    ],
    discord: [
        "💬 Join the Discord → https://discord.com/invite/wt6Zc7Sgjx",
        "💬 CUHZ fam on Discord → https://discord.com/invite/wt6Zc7Sgjx",
        "💬 Real convos happening in Discord → https://discord.com/invite/wt6Zc7Sgjx",
        "💬 Don't lurk, join the Discord → https://discord.com/invite/wt6Zc7Sgjx",
        "💬 Link up with the fam → https://discord.com/invite/wt6Zc7Sgjx",
        "💬 Where the CUHZ planning happens → https://discord.com/invite/wt6Zc7Sgjx",
        "💬 Free to join, hard to leave → https://discord.com/invite/wt6Zc7Sgjx",
        "💬 Slide in the Discord → https://discord.com/invite/wt6Zc7Sgjx",
        "💬 CUHZ Discord — come say what's up → https://discord.com/invite/wt6Zc7Sgjx",
        "💬 Planet CUHZ Discord is active 24/7 → https://discord.com/invite/wt6Zc7Sgjx"
    ],
    socials: [
        "🔗 All links → https://linktr.ee/PlanetCUHZ",
        "🔗 Every socials link in one spot → https://linktr.ee/PlanetCUHZ",
        "🔗 Follow the whole movement → https://linktr.ee/PlanetCUHZ",
        "🔗 IG, TikTok, YT — all here → https://linktr.ee/PlanetCUHZ",
        "🔗 Don't miss anything CUHZ → https://linktr.ee/PlanetCUHZ",
        "🔗 Bookmark this → https://linktr.ee/PlanetCUHZ",
        "🔗 Linktree central → https://linktr.ee/PlanetCUHZ",
        "🔗 Planet CUHZ universe in one link → https://linktr.ee/PlanetCUHZ",
        "🔗 One link, all the vibes → https://linktr.ee/PlanetCUHZ",
        "🔗 Tap in across platforms → https://linktr.ee/PlanetCUHZ"
    ],
    rules: [
        "📌 Be respectful. No hate. No spam. Stay CUHZ.",
        "📌 House rules: respect the chat, love the cuhz, keep it clean.",
        "📌 Chat is a vibe — keep it that way. No hate, no spam.",
        "📌 CUHZ rules: respect always, hate never.",
        "📌 Good vibes only. Drama gets dropped.",
        "📌 We build up, we don't tear down. Stay CUHZ.",
        "📌 Mods enforce love, not fear. Respect the fam.",
        "📌 Keep it real, keep it clean, keep it CUHZ.",
        "📌 No hate, no spam, no cap. That's the code.",
        "📌 Planet CUHZ code: love louder than hate."
    ],
    support: [
        "🔥 Type !hype, !vibe, or !w to show love in the chat!",
        "🔥 Follow the stream if you're vibin' — it's free 💎",
        "🔥 Drop a follow, tell a friend. That's how we grow.",
        "🔥 Sharing the stream helps more than you think 💎",
        "🔥 Lurkers welcome — drop a !lurk so we know you're here 👀",
        "🔥 If you're enjoying the vibes, a follow helps the fam 💎",
        "🔥 Check !commands to see what this bot can do 🤖",
        "🔥 Raid us when you wrap up — we raid back 💎",
        "🔥 Type !socials to follow CUHZ everywhere 🔗",
        "🔥 Support the stream — follow + share = real MVP moves 💎"
    ]
};

// Welcome-back lines — fire when a user returns after ≥4h away (separate from First Contact).
const WELCOME_BACK_QUOTES = [
    "🌌 Welcome back cuhz! Good to see you again 💎",
    "⚡ Look who's back in the frequency — welcome home 🌌",
    "💎 Cuhz fam back in the building. Let's get it ⚡",
    "🌌 Returning champion detected. Welcome back 🚀",
    "⚡ Been a minute! Good to have you back cuhz 💎",
    "💎 The CUHZ fam missed you — welcome back in 🌌",
    "🚀 Back in the chat where you belong. Welcome home cuhz 💎",
    "🌌 Welcome back! Chat level immediately went up ⚡"
];

// !gg for geniiknight — Slytherin energy. Palette 🐍 💚 ⚡ 🌌.
const GG_QUOTES = [
    "🐍 Slytherin stand UP! @geniiknight just slid in 💚",
    "🐍 GeniiKnight in the chat — the cunning ones always pull through ⚡",
    "💚 @geniiknight touched down. Slytherin pride on display 🐍",
    "🌌 Genii in the building! Strategy + vibes in one package 💚",
    "💚 The knight has arrived — @geniiknight we been ready 🐍",
    "🐍 Slytherin energy activated. @geniiknight setting the tone ⚡",
    "💚 Ayy it's Genii! The common room just got hype 🌌",
    "⚡ @geniiknight slid in quiet but loud — that's the move 🐍"
];

// !limit for h0ffl1m1tzzz — community regular. Loves the rocket — 🚀 anchors
// every line. Palette 🚀 ⚡ 🔥 💯 💎. 8 variants, no-repeat-last-2.
const LIMIT_QUOTES = [
    "🚀 LIMIT in the chat! @h0ffl1m1tzzz pulled up — no ceilings cuhz 🚀",
    "🚀 Taking it to the LIMIT — @h0ffl1m1tzzz just touched down 🚀💯",
    "🚀🚀 No limits, no caps — @h0ffl1m1tzzz is HERE cuhz 🔥",
    "🚀 @h0ffl1m1tzzz slid in — pushing past every ceiling ⚡",
    "🚀 LIMIT pulled up! Real ones go ALL the way cuhz 💎🚀",
    "🚀 @h0ffl1m1tzzz in the building — that's how we MOVE 🚀",
    "🚀 Ayy it's Limit! Glad you here cuhz, we been ready 🔥🚀",
    "🚀 @h0ffl1m1tzzz fully launched — CUHZ fam assembled 🚀💯"
];

// !balen for Balencis — style / luxury / drip energy. Palette 💎 ✨ 👑 🖤 ⚡.
// 8 variants, no-repeat-last-2. Tone: hype + love + family.
const BALEN_QUOTES = [
    "💎 BALENCIS in the chat! @balencis pulled up with the drip ✨",
    "👑 Style stepped IN — @balencis just arrived 💎",
    "✨ @balencis slid in clean as ever — fit on point 💎",
    "💎 Ayy it's Balencis! Glad you here cuhz 🖤",
    "🖤 Luxury energy detected — @balencis in the building ✨",
    "💎 @balencis pulled up — chat got CRISP 👑",
    "⚡ Real style, real ones — @balencis we see you cuhz 💎",
    "✨ Balencis touched down — drip levels MAXED 🖤"
];

// !joee / !fresh for joeefresh91 — clean/fresh energy. Palette ❄️ ✨ 💎 🔥 ⚡.
// 8 variants, no-repeat-last-2. Tone: hype + love + family.
const JOEE_QUOTES = [
    "❄️ JOEE FRESH in the chat! @joeefresh91 pulled up clean 💎",
    "💎 @joeefresh91 slid in fresh as ever — fit unmatched ✨",
    "✨ Fresh just touched down — @joeefresh91 in the building 🔥",
    "🔥 @joeefresh91 here! Real ones recognize real ones 💎",
    "❄️ Ayy it's Joee! Glad you here cuhz — fresh energy locked in ✨",
    "💎 @joeefresh91 pulled up CRISP — chat got cleaner ❄️",
    "✨ Fresh prince of the chat — @joeefresh91 we see you 💎",
    "🔥 @joeefresh91 in the frequency — fresh forever cuhz ❄️"
];

// !p&b / !pb / !peace — peace and blessings to all the CUHZ fam.
// Palette 🙏 ✌️ 🕊️ 💫 ✨ 🌌 💎 🔥 🌍 ☀️ 🌙 💚. 25 variants, no-repeat-last-2.
// Tone: peaceful, blessings, love, family, cosmic — cuhz style.
const PB_QUOTES = [
    "🙏 Peace and blessings to all the CUHZ fam — light over everything ✨",
    "✌️ P&B to every cuhz in the chat — we eating, we vibing, we winning 💫",
    "🕊️ Peace and blessings cuhz — may your day move like the stars 🌌",
    "💫 P&B fam — protect your peace, share your light 🙏",
    "✨ Peace and blessings to the whole planet — CUHZ love unmatched 💚",
    "🌌 P&B cuhz! May your week be light, your hustle be heavy 🔥",
    "🙏 Peace and blessings to every soul tuned in — we family forever ✌️",
    "💎 P&B cuhz — clean energy, clear mind, full heart 🕊️",
    "🌍 Peace and blessings across the planet — CUHZ love global 💫",
    "☀️ P&B fam! Bless up, level up, stay up 🙏",
    "🌙 Peace and blessings under the moon — rest easy cuhz 💫",
    "💚 P&B to all — your peace is a flex, protect it 🙏",
    "🕊️ Peace and blessings cuhz — no smoke, all love ✨",
    "🔥 P&B family! May your blessings outrun your obstacles 💎",
    "✨ Peace and blessings to every cuhz scrolling through 🌌",
    "🙏 P&B! Big love, bigger blessings, biggest mindset 💫",
    "✌️ Peace and blessings cuhz — be the energy you wanna receive 🕊️",
    "💫 P&B to the day-ones and the just-arrived — same family 💚",
    "🌌 Peace and blessings cuhz — keep the circle tight, the love loud 🙏",
    "💎 P&B! Move in peace, dream in color, win in faith ✨",
    "🕊️ Peace and blessings — for your family, your bag, your peace of mind 🙏",
    "☀️ P&B cuhz — sun on your face, blessings on your back 💫",
    "🙏 Peace and blessings to all watching, all listening, all loving 💚",
    "💫 P&B! Walk light, speak love, live blessed 🕊️",
    "✨ Peace and blessings forever cuhz — we owe each other this love 🙏"
];

// !lyrical / !lyric for lyricalmindsetTTV — wordsmith / thoughtful / bars energy.
// Palette 🎤 📝 ✍️ 🧠 💭 🔥 💎. 12 variants, no-repeat-last-2. Tone: praise + love + bars.
const LYRICAL_QUOTES = [
    "🎤 LYRICAL just touched down — @lyricalmindsetttv brought the bars cuhz 📝",
    "📝 @lyricalmindsetttv in the chat — wordsmith energy locked in 💎",
    "✍️ Real mindset, real lyrics — @lyricalmindsetttv we love you cuhz 🔥",
    "🧠 @lyricalmindsetttv pulled up — chat IQ just shot up 🎤",
    "💭 Lyrical Mindset HERE — every line he drops hits different 📝",
    "🔥 @lyricalmindsetttv slid in — bars, brains, and big bro energy 💎",
    "🎤 Ayy it's Lyrical! Real wordplay, real wisdom — welcome home cuhz ✍️",
    "📝 @lyricalmindsetttv in the building — quotables incoming 🧠",
    "💎 Lyrical Mindset on deck — sharpest pen in the chat 🎤",
    "✍️ @lyricalmindsetttv touched down — the bars AND the message 🔥",
    "🧠 Lyrical in the frequency — mindset elevated, vibes elevated 💭",
    "🔥 @lyricalmindsetttv here — day-one CUHZ poet, we appreciate you 📝"
];

// !grouch for grouch392 — "Mr Get Too It", NBA 2K hooper energy. Palette 🏀 🔴 💪 🔥 🎮 💎.
// 8 variants, no-repeat-last-2. Tone: hype + hoops + hustle.
const GROUCH_QUOTES = [
    "🏀 GROUCH in the building! @grouch392 — Mr Get Too It himself 🔴",
    "🔴 @grouch392 pulled up! Buckets on buckets, no days off 🏀",
    "💪 Mr Get Too It touched down — @grouch392 stay grinding cuhz 🔥",
    "🎮 @grouch392 in the chat! Court vision on AND off the sticks 🏀",
    "🔥 Grouch here! Real hooper, real one — welcome home cuhz 💎",
    "🏀 Ayy it's Grouch! @grouch392 get TOO it every single day 💪",
    "💎 @grouch392 slid in — 2K legend, CUHZ fam certified 🔴",
    "🔴 Mr Get Too It in the frequency — @grouch392 we see the work 🏀"
];

// !brady / !blitz for BradyBlitz — four_a_reason channel regular.
// Palette 🏈 🐐 ⚡ 🔥 💎. 8 variants, no-repeat-last-2. Tone: hype + LOVE.
const BRADY_QUOTES = [
    "🏈 BRADY BLITZ in the chat! @BradyBlitz pulled up — CUHZ fam love to see it 🐐",
    "⚡ BradyBlitz just touched down — game on cuhz, glad you here 🔥",
    "🐐 GOAT energy in the building — @BradyBlitz we appreciate you cuhz 🏈",
    "🔥 Brady Blitz pulled UP! Real one, real loyalty — welcome home fam ⚡",
    "💎 @BradyBlitz slid in — chat got better the second you showed up 🏈",
    "🏈 Our cuhz Brady is HERE — fam love to have you cuhz 🐐",
    "⚡ Ayy it's Brady! Always good to see you cuhz — we been ready 🔥",
    "🐐 @BradyBlitz here. Day-one CUHZ energy, real ones recognize real ones 💎"
];

// !cuhz / !planet — definitive Planet CUHZ brand statement (not user-specific).
// Palette 🌌 💎 📡 ⚡. Themes: ecosystem, family, frequency.
const CUHZ_QUOTES = [
    "🌌 Planet CUHZ — a creator ecosystem built on love, loyalty, and levelin' up. You already in the frequency 💎",
    "💎 This is Planet CUHZ. Real fam, real frequency, real family 🌌",
    "📡 Tap in. Planet CUHZ is the frequency — and you tuned in cuhz ⚡",
    "🌌 Planet CUHZ runs on one thing: the fam holdin' each other UP 💎",
    "⚡ Welcome to Planet CUHZ — where creators support creators, no cap 📡",
    "💎 Planet CUHZ = the ecosystem. Frequency tuned, family locked in 🌌",
    "📡 You ever feel the energy hit different? That's the CUHZ frequency ⚡",
    "🌌 Planet CUHZ for life. Family over everything, every single time 💎"
];

// !anti — 6 variants. Viewers were typing '!anti' with no handler. The full
// username behind the 'antisoci...' log prefix couldn't be confirmed anywhere
// in the repo/DB, so this pool is generic hype with NO @-mention on purpose.
// !anti for antisocialtv_ — anti-hero energy. Palette ⚡ 🌌 😤 👀 💎.
// 6 variants, no-repeat-last-2. Username confirmed from production logs.
const ANTI_QUOTES = [
    "⚡ ANTI in the chat! @antisocialtv_ — different breed, same CUHZ fam 💎",
    "🌌 @antisocialtv_ movin' anti but the vibes stay pro cuhz 🔥",
    "😤 @antisocialtv_ — anti everything except the grind. Locked in 💎",
    "⚡ The quiet ones watch everything — @antisocialtv_ in full presence 👀",
    "🌌 Anti the noise, pro the frequency — @antisocialtv_ that's the CUHZ way 📡",
    "🔥 @antisocialtv_ tapped in — outside the wave but forever in the fam 💎"
];

// !blessed / !dj for blesseddj_ — blessed + DJ energy. Palette 🎧 🎶 🙏 ✨ 💿 🔥.
// 8 variants, no-repeat-last-2.
const BLESSED_QUOTES = [
    "🎧 BLESSED DJ in the mix! @blesseddj_ just pulled up — vibes secured 🙏",
    "🎶 @blesseddj_ touched down! Track list blessed, chat blessed ✨",
    "🙏 Blessed energy only — @blesseddj_ in the building cuhz 💿",
    "🔥 DJ on deck! @blesseddj_ keep the frequency SPINNING 🎧",
    "✨ @blesseddj_ slid in — every drop blessed, every vibe right 🎶",
    "💿 The mix just got holy — @blesseddj_ we love you cuhz 🙏",
    "🎧 Ayy it's Blessed! @blesseddj_ pull up and bless the airwaves 🔥",
    "🎶 @blesseddj_ in the frequency — blessed hands, blessed sounds ✨"
];

// !phoenix for phoenixpnyc — rise-from-the-ashes + NYC energy. Palette 🔥 🦅 🗽 ✨ 💎.
// 8 variants, no-repeat-last-2. Most active community chatter in the logs —
// also the one who requested !watchtime.
const PHOENIX_QUOTES = [
    "🔥 PHOENIX RISING! @phoenixpnyc in the chat — NYC stand UP 🗽",
    "🦅 @phoenixpnyc touched down from the ashes — can't keep a real one down 🔥",
    "🗽 Empire state of CUHZ — @phoenixpnyc in the building ✨",
    "🔥 @phoenixpnyc here! Day-one energy, watch-time LEGENDARY 💎",
    "✨ The bird is BACK — @phoenixpnyc we see you cuhz 🦅",
    "💎 @phoenixpnyc pulled up — rises every stream, never misses 🔥",
    "🗽 NYC's finest in the frequency — @phoenixpnyc salute 🦅",
    "🔥 Ayy Phoenix! @phoenixpnyc the chat just heated UP cuhz ✨"
];

// !uncle / !meaux for unclemeaux1906 — OG uncle energy. Palette 🎩 💯 😂 🔥 💎.
const UNCLE_QUOTES = [
    "🎩 UNCLE MEAUX in the building! @unclemeaux1906 — OG status 💯",
    "💯 @unclemeaux1906 pulled up! Uncle wisdom activated cuhz 🎩",
    "🔥 The family elder is HERE — @unclemeaux1906 respect the OG 💎",
    "😂 @unclemeaux1906 slid in — jokes and gems only 🎩",
    "🎩 Ayy it's Unc! @unclemeaux1906 the fam just got realer 💯",
    "💎 @unclemeaux1906 in the frequency — 1906 vintage, timeless energy 🔥"
];

// !breezy for breezyxd23 — cool breeze energy. Palette 🌬️ 😎 🌊 ❄️ 💎.
const BREEZY_QUOTES = [
    "🌬️ BREEZY in the chat! @breezyxd23 just cooled the whole room 😎",
    "😎 @breezyxd23 pulled up — smooth moves only cuhz 🌊",
    "❄️ Chat temperature dropped — @breezyxd23 too cool for gravity 🌬️",
    "🌊 @breezyxd23 slid in like a wave — effortless cuhz 💎",
    "😎 Ayy Breezy! @breezyxd23 keep it smooth, keep it CUHZ 🌬️",
    "💎 @breezyxd23 in the frequency — light work, heavy presence ❄️"
];

// User shoutout rotation pools — all tiers, no repeats within last 2 fires.
// Hoisted to module scope so the map isn't rebuilt on every chat message.
const USER_VARIANT_POOLS = {
    '!ec':      EC_QUOTES,
    '!tj':      TJ_QUOTES,
    '!spence':  SPENCE_QUOTES,
    '!snowy':   SNOWY_QUOTES,
    '!sw':      SNOWY_QUOTES,
    '!snow':    SNOWY_QUOTES,
    '!kasha':   KASHA_QUOTES,
    '!qween':   QWEEN_QUOTES,
    // NOTE: !storm alias intentionally NOT wired here — the existing Pro/Premium
    // !storm handler (with session-tracked first-use vs. repeat) lives downstream
    // and would be hijacked. Use !qween for the new pool.
    '!fvmous':  FVMOUS_QUOTES,
    // NOTE: '!fam' alias removed — the static vibe handler for !fam runs earlier
    // in dispatch and always wins, so the pool entry was dead code.
    '!gg':      GG_QUOTES,
    '!geni':    GG_QUOTES,
    '!grouch':      GROUCH_QUOTES,
    '!brady':       BRADY_QUOTES,
    '!blitz':       BRADY_QUOTES,
    '!limit':       LIMIT_QUOTES,
    '!balen':       BALEN_QUOTES,
    '!joee':        JOEE_QUOTES,
    '!joe':         JOEE_QUOTES,
    '!fresh':       JOEE_QUOTES,
    '!joeefresh':   JOEE_QUOTES,
    '!lyrical':     LYRICAL_QUOTES,
    '!lyric':       LYRICAL_QUOTES,
    '!p&b':         PB_QUOTES,
    '!pb':          PB_QUOTES,
    '!peace':       PB_QUOTES,
    '!anti':    ANTI_QUOTES,
    '!blessed':     BLESSED_QUOTES,
    '!dj':          BLESSED_QUOTES,
    '!phoenix':     PHOENIX_QUOTES,
    '!uncle':       UNCLE_QUOTES,
    '!meaux':       UNCLE_QUOTES,
    '!breezy':      BREEZY_QUOTES,
    '!smutty':      SMUTTY_QUOTES,
    '!pippen':      SMUTTY_QUOTES,
    '!relax':       AYELIK_QUOTES,
    '!lik':         AYELIK_QUOTES,
    '!aye':         AYELIK_QUOTES,
    '!jr':          YOUNGJR_QUOTES,
    '!young':       YOUNGJR_QUOTES,
    '!cuhz':    CUHZ_QUOTES,
    '!planet':  CUHZ_QUOTES,
};

// Canonical social links. Kept in bot.js (config.js is env-only) so the user has
// one place to edit when they add IG/TikTok/YT. Linktree covers the long tail.
const SOCIAL_LINKS = {
    website:  'https://planetcuhz.com',
    linktree: 'https://linktr.ee/PlanetCUHZ',
    discord:  'https://discord.com/invite/wt6Zc7Sgjx',
    // Drop IG/TikTok/YT URLs in here when ready.
    instagram: null,
    tiktok:    null,
    youtube:   null
};

// !lurk — 5 variants; {user} is replaced with @username.
const LURK_QUOTES = [
    "👀 @{user} tapped in from the shadows — we see you cuhz",
    "👀 @{user} locked in on lurk mode. Respect cuhz",
    "👀 @{user} in the cut, watchin' the whole thing. We got you",
    "👀 @{user} on stealth. The frequency's still tuned 📡",
    "👀 @{user} lurkin' with purpose — CUHZ fam either way"
];

// !unlurk / !back — 5 variants; {user} is replaced with @username.
const UNLURK_QUOTES = [
    "⚡ @{user} back in the frequency ⚡",
    "⚡ @{user} stepped out the shadows — welcome back cuhz 🌌",
    "⚡ Unlurk detected! @{user} back on the mic 💎",
    "⚡ @{user} just rejoined the convo — we see you 🔥",
    "⚡ @{user} back in rotation. Chat's fully live now 📡"
];

// Raid farewells — fired before /raid is issued. {target} is the raid destination.
const RAID_FAREWELLS = [
    "🚀 CUHZ FAM WE RAIDIN' @{target}! Pull up and show love 💎",
    "🚀 All aboard — we ridin' out to @{target}! Let's GO cuhz 🔥",
    "🚀 Raiding @{target} — tell 'em CUHZ sent you 🌌",
    "🚀 Next stop: @{target}. CUHZ fam move as one 💎",
    "🚀 RAID TIME! @{target} — keep the frequency alive ⚡"
];

// Incoming raid — fired automatically on tmi.js 'raided' event.
// {raider} = raider's display name, {viewers} = raid party size.
const RAID_INCOMING = [
    "🚨 RAID INCOMING! @{raider} pulled up with {viewers} cuhz — WELCOME HOME 💎",
    "🚨 @{raider} just raided with {viewers} cuhz! CUHZ fam show LOVE 🔥",
    "🚨 The @{raider} crew just touched down — {viewers} strong! Let's GO 🚀",
    "🚨 Raid alert! @{raider} brought the whole fam ({viewers} cuhz) 🌌",
    "🚨 BIG RAID from @{raider} — {viewers} cuhz in the building! 💎",
    "🚨 @{raider} and the fam ({viewers} cuhz) just ARRIVED — chat say hey 🔥",
    "🚨 Raid from @{raider} ({viewers}) — the frequency just got LOUDER ⚡",
    "🚨 @{raider} raidin' deep — {viewers} cuhz pullin' up. Welcome WELCOME 💎"
];

// Sub / resub / gift — fired automatically on tmi.js 'subscription'/'resub'/'subgift'.
// {user} is the subscriber. {months} is the cumulative month count when applicable.
const SUB_HYPE = [
    "💎 @{user} JUST SUBBED! CUHZ fam grew by one — welcome to the family 🌌",
    "💎 SUB ALERT! @{user} locked in. Real ones make real moves 🔥",
    "💎 @{user} pulled the trigger! That's how we do it cuhz 🚀",
    "🚀 @{user} signed UP — CUHZ family for life 💎",
    "🌌 @{user} just made it OFFICIAL. Welcome to the fam ⚡",
    "🔥 NEW SUB: @{user}! Cuhz, that's REAL support — appreciate you 💎",
    "💎 @{user} put their name on it. Salute, cuhz 🫡",
    "⚡ @{user} just boosted the frequency — sub locked in 💎"
];

const RESUB_HYPE = [
    "💎 @{user} resubbed for {months} months! Day-one cuhz energy — appreciate you 🌌",
    "💎 {months} MONTHS DEEP! @{user} keeps rollin' with the fam 🔥",
    "🚀 @{user} renewed — {months} months of CUHZ love. We see you cuhz 💎",
    "🌌 @{user} hit {months} months! Real loyalty looks like THIS ⚡",
    "🔥 @{user} signed back up for the {months}-month milestone. Family forever 💎",
    "💎 RESUB! @{user} ({months} mo) keeps the CUHZ flame lit. Salute 🫡"
];

const SUBGIFT_HYPE = [
    "🎁 @{gifter} just gifted a sub to @{recipient}! THAT is CUHZ energy 💎",
    "🎁 @{gifter} blessed @{recipient} with a sub — pay it forward, fam 🚀",
    "🎁 SUBGIFT! @{gifter} → @{recipient}. Real ones lift real ones 💎",
    "🎁 @{gifter} put @{recipient} on. CUHZ fam takin' care of CUHZ fam 🔥"
];

// !smutty / !pippen for smuttyp1ppen — Pippen namesake + tunes in from the
// fire watch at work. Palette 🏀 🔥 💪 👑 💎. 8 variants, no-repeat-last-2.
const SMUTTY_QUOTES = [
    "🏀 SMUTTY PIPPEN in the building! @smuttyp1ppen — two-way killer energy 🔥",
    "🔥 @smuttyp1ppen tuned in from the FIRE WATCH — that's real dedication cuhz 💪",
    "👑 Pippen pulled up! @smuttyp1ppen — every dynasty needs a real one 🏀",
    "💎 @smuttyp1ppen in the chat! On the clock AND locked in with the fam 🔥",
    "🏀 @smuttyp1ppen touched down — smooth game, smoother name 👑",
    "🔥 Fire watch can't stop the CUHZ watch — @smuttyp1ppen ALWAYS pulls up 💪",
    "💪 @smuttyp1ppen here! Shows up for the fam even mid-shift 😤🏀",
    "👑 @smuttyp1ppen slid in — Pippen never missed a big moment, neither does he 💎"
];

// !relax / !lik / !aye for ayelikrelaxx — chill-master energy. Palette 🌊 😌 😌 💨 🛋️ 💎.
// 6 variants, no-repeat-last-2. Requested live in Four's chat.
const AYELIK_QUOTES = [
    "😌 AYE LIK RELAXX in the chat — instant chill mode activated 🌊",
    "🌊 @ayelikrelaxx pulled up! Stress leaves when he arrives, no cap 😌",
    "💨 Aye... lik... relaxx cuhz. @ayelikrelaxx said breathe easy 🛋️",
    "😌 @ayelikrelaxx slid in — smoothest energy in the frequency 💎",
    "🛋️ The chill-master @ayelikrelaxx touched down — vibes officially maxed 🌊",
    "💎 @ayelikrelaxx here! Chat calm, vibes right, that's the relaxx effect 😌"
];

// !jr / !young for young_jr2424 — young hooper energy. Palette 🏀 ⚡ 🌟 🔥 💎.
// 6 variants, no-repeat-last-2. Requested live in Four's chat.
const YOUNGJR_QUOTES = [
    "🌟 YOUNG JR in the building! @young_jr2424 — the future pulled UP 🏀",
    "⚡ @young_jr2424 touched down! Young legs, old-soul game 🔥",
    "🏀 JR here! @young_jr2424 — 2424 on the jersey, buckets on the mind 💎",
    "🔥 @young_jr2424 slid in — next-gen CUHZ energy locked in 🌟",
    "💎 Young Jr in the frequency — @young_jr2424 the fam raised him right ⚡",
    "🌟 @young_jr2424 pulled up! Youth in the name, vet in the game 🏀"
];

// Proving Grounds command directory — SINGLE SOURCE OF TRUTH.
// Add a new PG command here and it shows up in !pg automatically.
const PG_COMMANDS = [
    { cmd: '!top100points',  desc: 'Top 100 in points' },
    { cmd: '!top100ovrrank', desc: 'Top 100 by OVR rank' }
];

// !top100ovrrank — four_a_reason ONLY. Four ranked the Top 100 by OVR in
// Proving Grounds. 5 variants, no-repeat-last-2.
const TOP100OVR_QUOTES = [
    "🏆 Four ranked the TOP 100 by OVR in Proving Grounds — every name, on camera 👑 https://youtu.be/X3srv7B_ErU",
    "📊 TOP 100 OVR in Proving Grounds, ranked by @four_a_reason. The list is THE list 🏀 https://youtu.be/X3srv7B_ErU",
    "👑 @four_a_reason put the whole TOP 100 OVR ranking together — respect the work 💎 https://youtu.be/X3srv7B_ErU",
    "🔥 Who's really HIM? @four_a_reason ranked the TOP 100 by OVR — go find out 🏀 https://youtu.be/X3srv7B_ErU",
    "💎 @four_a_reason did the homework so we ain't gotta — TOP 100 OVR rank 📊 https://youtu.be/X3srv7B_ErU"
];

// !top100points — four_a_reason ONLY. Four put the Top 100 Proving Grounds
// scorers on camera and named every grinder. 5 variants, no-repeat-last-2.
const TOP100_QUOTES = [
    "🏆 Four put the TOP 100 in Proving Grounds points ON CAMERA — real ones get named. Salute @four_a_reason 👑 https://www.youtube.com/watch?v=RnjofXgGo6k",
    "👑 100 hoopers, one man with the receipts. @four_a_reason showing love to every Proving Grounds grinder 🏀 https://www.youtube.com/watch?v=RnjofXgGo6k",
    "🌹 Top 100 in Proving Grounds points — @four_a_reason gave every grinder their flowers on camera 🏀 https://www.youtube.com/watch?v=RnjofXgGo6k",
    "🔥 Most chase the spotlight. @four_a_reason SHARES it — TOP 100 Proving Grounds scorers, all named 👑 https://www.youtube.com/watch?v=RnjofXgGo6k",
    "💎 @four_a_reason counted the TOP 100 in Proving Grounds points so the grind don't go unseen. Legend behavior 🏆 https://www.youtube.com/watch?v=RnjofXgGo6k"
];

// Manual !raid (chat command, no args) — raid welcome + follow pitch.
// Cleaned up from phoenixpnyc's raid call: "Hit follow, here at least twice
// daily, catch highlights on IG, TikTok and YouTube." 15 variants, no-repeat-3.
// Different from RAID_INCOMING (auto on 'raided' event) which interpolates {viewers}.
const RAID_HYPE_MANUAL = [
    "🚨 RAID SQUAD! Hit that follow — we're live at least twice a day, and the highlights hit IG, TikTok & YouTube 💎",
    "🔥 Welcome raiders! Smash the follow cuhz — live here twice daily, highlights on IG, TikTok & YouTube 🌌",
    "🚨 New faces in the frequency! Follow up — we run it back at least twice a day + clips on IG, TikTok & YouTube ⚡",
    "💎 Raid energy! Tap that follow so you never miss us — live twice daily, highlights posted on IG, TikTok & YouTube 🔥",
    "🌌 Pull up and stay cuhz! Follow the channel — we're here at least twice a day, catch the recap on IG, TikTok & YouTube 🚨",
    "⚡ RAID ALERT! One follow keeps you locked in — twice-daily streams + all the best moments on IG, TikTok & YouTube 💎",
    "🔥 Welcome to the planet, raiders! Hit follow — live at least 2x a day, highlights land on IG, TikTok & YouTube 🌍",
    "🚨 Y'all made it! Drop a follow cuhz — we go live twice daily and the clips live on IG, TikTok & YouTube ✨",
    "💎 Raiders = family now. Follow up! At least two streams a day, highlights on IG, TikTok & YouTube 🚀",
    "🌌 The frequency just grew! Hit follow so you're here for the next one — live 2x daily, clips on IG, TikTok & YouTube 🔥",
    "⚡ Welcome welcome! Follow the channel cuhz — we stream at least twice a day and post the heat to IG, TikTok & YouTube 💎",
    "🚨 Raid gang! That follow button is free — twice-daily lives + highlight reels on IG, TikTok & YouTube 🌌",
    "🔥 Ayy the raid pulled UP! Follow to lock in — live at least twice a day, catch replays on IG, TikTok & YouTube ⚡",
    "💫 New cuhz alert! Hit follow before you dip — we're live 2x daily and the highlights stay posted on IG, TikTok & YouTube 💎",
    "🚀 RAID TOUCHDOWN! Follow the movement — at least two streams a day, best moments on IG, TikTok & YouTube 🌌"
];

// New follower — manual chat command !nf (tmi.js doesn't emit follower events;
// auto-detection requires Twitch EventSub which is outside the chat layer).
// {user} = the new follower's @handle as typed.
const NEW_FOLLOWER_HYPE = [
    "💎 NEW FOLLOWER ALERT! @{user} just joined the CUHZ fam — welcome cuhz 🌌",
    "🌌 @{user} hit follow! That's how the family grows 🔥",
    "🔥 Welcome @{user}! Real ones tap that follow — appreciate you 💎",
    "💎 @{user} locked in with a follow. CUHZ fam +1 ⚡",
    "🚀 @{user} just followed — pull up a seat, you're home now 💎",
    "🌌 NEW FOLLOWER: @{user}! Glad you're here cuhz 🔥",
    "⚡ @{user} hit the follow button — the frequency just gained one more 💎",
    "💎 Fresh follower @{user} — welcome to Planet CUHZ 🌌"
];



// --- Welcome Quotes (Dynamic) ---
const WELCOME_QUOTES = [
    "Welcome to the Planet, cuhz! 🌌",
    "Ayyy! Look who just pulled up! Welcome to the family! 🚀",
    "The energy just went up! Welcome in cuhz! ⚡",
    "Planet Cuhz is better with you here. Welcome! 🌍",
    "Yo! Grab a seat, we vibing out today. Welcome! 🎧",
    "New challenger approaching! Just kidding, welcome fam! 🎮",
    "Glad you could make it! Let's get these Ws in the chat! 🏆",
    "Welcome to the resistance against bad vibes. You're safe here. 🛡️",
    "Cuhz has entered the building! Make some noise! 📢",
    "Yo cuhz! Good to see you. Stay awhile and listen! 👂",
    "Welcome! Don't forget to follow if you're enjoying the vibes! 💖",
    "A legendary viewer has appeared! Welcome in! 🌟"
];

// --- Custom Command Variations ---
const STORM_SUFFIXES = [
    "The forecast calls for 100% chance of Ws! 🌩️",
    "Bringing the thunder and the lightning! ⚡",
    "Category 5 vibes incoming! 🌀",
    "Make it rain on 'em! 💸",
    "The calm before the storm... wait, YOU are the storm! 🌪️"
];

const JUAN_SUFFIXES = [
    "The Juan and Only! 🔫",
    "Juan love, Juan heart! ❤️",
    "We found the chosen Juan! 🕶️",
    "Takes one to know Juan! 🤝",
    "Juan step at a time to greatness! 👣"
];

const RICO_QUOTES = [
    "Rico2ez makes it look easy because he put in the work when no one was watching. 💪",
    "The smoothest player in the game just walked in. Welcome, Rico2ez! 😎",
    "Easy mode activated. Rico2ez is in the building! 🏆",
    "Some people make it hard. Rico2ez makes it 2ez. 🎯",
    "The blueprint is in his name — Rico2ez, always winning. 👑",
    "Pressure? Rico2ez doesn't feel it. He creates it. 🔥",
    "When Rico2ez steps in, the energy shifts. Lock in cuhz! ⚡",
    "Rico2ez — because struggling is optional when you're built different. 💎",
    "The legend is live. Rico2ez showing how it's done! 🚀",
    "It ain't luck, it ain't chance. It's Rico2ez being Rico2ez. 🌟",
    "Effortless. Relentless. Unstoppable. That's Rico2ez. 🦁",
    "Watch closely cuhz — Rico2ez is about to school everyone. 📚",
    "The moves look easy because Rico2ez stayed ready. 🏃‍♂️",
    "Rico2ez in the chat — vibes automatically elevated. 🌌",
    "They call it 2ez because for Rico, it always is. Salute! 🫡",
    "Greatness doesn't announce itself... except when Rico2ez pulls up. 🔊",
    "Consistency. Focus. Rico2ez. Three things that hit different. 🎯",
    "Rico2ez came to play and cuhz, he never loses. 💰",
    "Stay ready so you don't have to get ready. Rico2ez philosophy. 🛡️",
    "The grind is real, the results are realer. Rico2ez in the building! 🏗️"
];

const DAME_QUOTES = [
    "Dame has arrived! The chat just leveled up! 🚀",
    "Dame time! Check your clocks cuhz, it's Dame Time! ⌚",
    "Everyone stand back, Dame is dropping knowledge! 🧠",
    "Ain't no game when Dame is in the chat! 🎮",
    "The one, the only, DAME! Welcome back to the planet! 🌍",
    "Dame is holding it down! Pure legendary status! 🏆",
    "Ice in his veins, fire in the chat! Dame is here! 🧊",
    "You already know what it is! Dame making moves! 💯"
];

// PNX for PhoenixPNYC — spiritual + grounded tone, palette ☮️ 📡 ⚡.
// Each line is a complete string — DO NOT re-prepend ☮️ in the handler (that was the old bug).
const PNX_QUOTES = [
    "☮️ PhoenixPNYC in the frequency — peace in, peace out 📡",
    "📡 PNX slid in. Inner peace, outer energy ⚡",
    "☮️ The peacekeeper's here. Stay grounded cuhz 📡",
    "⚡ PNX touched down — high frequency, low ego ☮️",
    "📡 Phoenix in the chat — good vibes broadcasting ☮️",
    "☮️ Ayy PNX! Grounded energy, elevated vibe 📡",
    "⚡ PNX in the building — the frequency of Planet CUHZ ☮️",
    "☮️ Welcome back PNX. No stress, just signal 📡"
];

const BERN_QUOTES = [
    "Bernie2K in the building! Courts on fire when he pulls up 🏀🔥",
    "Bernie got the sticks on lock — buckets only cuhz 🎮🏆",
    "Don't reach on Bernie2K, he'll cook you every time 🍳🏀",
    "Bernie2K making it look 2EZ out there! Hooper mentality 💪🔥",
    "When Bernie loads in, the other team should just quit 🎮😤",
    "Bernie2K dropping dimes and draining threes — can't guard him 🏀💎",
    "The court belongs to Bernie2K. Step up or step aside 👑🔥",
    "Bernie2K with the green light every play — shooter's touch 🟢🏀"
];

const MAHNI_QUOTES = [
    "Mahni in the building! The music, the energy, the vibes — she brings it ALL 🎶🏆",
    "When Mahni drops a track, the whole planet feels it 🌍🔥",
    "Streamer. Artist. Supporter. Mahni does it all and makes it look easy 💎",
    "Mahni's music hits different — that's not opinion, that's fact 🎧💯",
    "She supports her people like no other. Mahni is the real MVP 🫡❤️",
    "Mahni with the champion mindset! Can't stop, won't stop 🏆🚀",
    "Mahni's got bars, beats, and a heart of gold. Respect the grind 🎤✨",
    "If you haven't heard Mahni's music yet, you're sleeping cuhz 😴🔊",
    "The queen of the vibes just walked in. Mahni is HERE 👑🌌",
    "Mahni putting on for her people every single day. That's loyalty 💪❤️",
    "Music that moves you. Energy that inspires you. That's Mahni 🎵⚡",
    "Mahni came to win and she brought the whole squad with her 🏆👊",
    "Real recognize real — and Mahni is as real as it gets 💯🔥",
    "She's not just making music, she's building a movement. Salute Mahni 🫡🌟",
    "Mahni shows up for her community every time. That's rare cuhz 💎🙏",
    "The beats hit hard, the lyrics hit harder. Mahni on another level 🎶📈",
    "When the vibes need saving, Mahni pulls up with the soundtrack 🎧🦸‍♀️",
    "Mahni's grind is unmatched. Artist by day, supporter by heart ❤️🎤",
    "If loyalty had a face, it'd be Mahni. She holds it down for everyone 👑💪",
    "Mahni — the music speaks, the hustle screams, the heart inspires 🏆🌌"
];

// --- CUHZ Vibe Commands (All Tiers) ---
const VIBE_MESSAGES = [
    'We on a different frequency cuhz 🌌',
    'Vibes immaculate rn no cap 💎',
    'Planet CUHZ energy is LIVE ⚡',
    'We built different over here 🚀',
    'Tuned in to the right wavelength cuhz 📡',
    'The cosmic frequency is unmatched tonight 🌠',
    'Straight vibin on Planet CUHZ rn 🪐',
    'This the energy we came for cuhz ✨',
    'Whole stream locked in on another level 🔒💎',
    'The vibe check is immaculate 💯'
];
const W_MESSAGES = [
    'W in the chat for the cuhz fam 🏆',
    'BIG W energy rn 💪',
    'We don\'t take L\'s on Planet CUHZ 🚀',
    'Nothing but W\'s today cuhz 🔥',
    'Certified W moment 💎',
    'That\'s a massive W for the whole planet 🌍',
    'W after W after W cuhz 🏆🏆🏆',
    'Stack them W\'s up cuhz! 📈',
    'The W factory is OPEN tonight 🔥',
    'Planet CUHZ stays winning no cap 💪🌌'
];
const BET_MESSAGES = [
    'Bet. We locked in cuhz. 🎯',
    'Bet bet bet! Let\'s ride 🚀',
    'Say less cuhz, bet. 💪',
    'That\'s a bet. No cap. 🔥',
    'You already know it\'s a bet cuhz 🤝',
    'Bet on Planet CUHZ every time 🌌',
    'Lock it in. Bet. 🔒',
    'That\'s a cosmic bet right there 🪐💎'
];
const GZ_MESSAGES = [
    'GG EZ cuhz! Let\'s gooo 🔥',
    'Big W for the cuhz! 🏆',
    'Congrats cuhz, you earned that 💎',
    'That\'s what we\'re talking about! GZ! 🚀',
    'You went crazy cuhz, GZ! 🌌',
    'Planet CUHZ is proud of you! GZ 🪐✨',
    'Built different and it shows. GG! 💪',
    'That was clean cuhz. Respect. GZ 🔥💎'
];
const NOCAP_MESSAGES = [
    'No cap no cap — this stream is different 🌌',
    'Facts only cuhz, no 🧢 allowed on Planet CUHZ',
    'Straight facts no printer cuhz 💯',
    'No cap detected. Certified real one. 🔥',
    'Zero cap zone right here cuhz 🚫🧢',
    'Speaking nothing but truth on this planet 🌍💎',
    'Cap-free since day one cuhz ✨',
    'That\'s on everything. No cap. 💪🌌'
];
const L_MESSAGES = [
    'An L today is just setup for a bigger W tomorrow cuhz 💪',
    'Legends don\'t dodge L\'s, they learn from em cuhz 🔥',
    'That L just made you stronger. Watch. 🌌',
    'Every L is a lesson in disguise cuhz, keep pushing 💎',
    'You think Kobe never took L\'s? He came back harder every time cuhz 🐍',
    'L\'s build character. W\'s build legacy. You need both cuhz 🏆',
    'Take that L, flip it, and turn it into fuel cuhz 🚀',
    'The comeback is always greater than the setback cuhz ✨',
    'Real ones don\'t crumble from an L, they evolve cuhz 🪐',
    'That L was just the universe testing your grind cuhz 🌠',
    'Greatness ain\'t a straight line — L\'s are part of the journey cuhz 💯',
    'You didn\'t lose, you just found what doesn\'t work cuhz 🧠',
    'Even the stars had to burn before they shined cuhz 🌟',
    'Dust yourself off cuhz, the mission ain\'t over 🛸',
    'That L got you one step closer to the biggest W of your life cuhz 🔥',
    'Pressure makes diamonds cuhz, remember that 💎',
    'Fall seven times, stand up eight. That\'s the CUHZ way 🌌',
    'L\'s don\'t define you — how you respond does cuhz 💪',
    'The grind don\'t stop for one bad day cuhz, keep going 🚀',
    'You think greatness is easy? Nah, it\'s built on L\'s cuhz 🏗️',
    'That L was temporary. Your potential is forever cuhz ✨',
    'Champions eat L\'s for breakfast and still dominate cuhz 🏆',
    'Ain\'t no L big enough to stop what you\'re building cuhz 🌍',
    'Stay locked in cuhz, the W is right around the corner 🔒',
    'Planet CUHZ don\'t quit after an L — we reload and go again cuhz 🪐🔥'
];

// --- Basic Tier Custom Shoutouts (accessible in ALL tiers) ---
const BASIC_USER_COMMANDS = {
    // !snow — rotated handler; aliases to SNOWY_QUOTES via USER_VARIANT_POOLS.
    '!raz': 'Raz Red G! Keeping it 💯 from the start. 🔴',
    '!tay': 'It\'s giving 2K legend energy — ohthatztayy locked in! 🕹️🏀',
    '!yoo': 'Yoo! Welcome to the stream. 👋'
};

// --- Commands blocked for Basic tier (info/link dumps) ---
const BASIC_BLOCKED_COMMANDS = new Set([
    '!cuhz', '!links', '!discord', '!whatiscuhz', '!faq',
    '!whitepaper', '!roadmap', '!rules', '!privacy',
    '!giveaway', '!enter',
    '!dashboard', '!pointsinfo', '!schedule', '!stream',
    '!followage', '!viewers', '!streamstats'
]);

const TIMER_MESSAGES = [
    "🌌 Planet CUHZ → https://planetcuhz.com",
    "🔗 All links → https://linktr.ee/PlanetCUHZ",
    "💬 Join the Discord → https://discord.com/invite/wt6Zc7Sgjx"
];

const BASIC_TIMER_MESSAGES = [
    '🤖 Want CUHZ Bot in your channel? Pull up to @four_a_reason\'s stream! → twitch.tv/four_a_reason 🚀',
    '🌌 Planet CUHZ — the creator ecosystem where we all level up together 💎',
    '💬 Join the CUHZ fam on Discord → https://discord.com/invite/wt6Zc7Sgjx',
    '🔥 Type !hype, !vibe, or !w to show love in the chat!'
];

// AI Warriors removed per user request

// --- Channel Personas ---
const DEFAULT_CONFIG = {
    timers: TIMER_MESSAGES,
    commands: PUBLIC_COMMANDS,
    hype: HYPE_MESSAGES
};

async function fetchChannelPersona(channel) {
    const cleanChannel = channel.toLowerCase().replace('#', '');
    const isBasicChannel = (CHANNEL_TIERS[cleanChannel] || TIERS.BASIC) === TIERS.BASIC;
    const defaultTimers = isBasicChannel ? BASIC_TIMER_MESSAGES : TIMER_MESSAGES;

    if (!config.apiBase || !config.botApiSecret) {
        logger.info(`No API config, using defaults for ${channel}`);
        const persona = { ...DEFAULT_CONFIG, timers: [...defaultTimers] };
        if (cleanChannel === 'planetcuhz') {
            persona.timers.push("📱 Follow Planet CUHZ on YouTube and TikTok! 🚀");
        }
        channelConfigs.set(channel.toLowerCase(), persona);
        return;
    }

    try {
        logger.info(`Fetching configuration for ${channel}...`);
        const [cmdRes, timerRes, setRes] = await Promise.all([
            axios.get(`${config.apiBase}/api/bot/commands/${cleanChannel}`, {
                headers: { 'Authorization': `Bearer ${config.botApiSecret}` },
                timeout: 5000
            }),
            axios.get(`${config.apiBase}/api/bot/timers/${cleanChannel}`, {
                headers: { 'Authorization': `Bearer ${config.botApiSecret}` },
                timeout: 5000
            }),
            axios.get(`${config.apiBase}/api/bot/settings/${cleanChannel}`, {
                headers: { 'Authorization': `Bearer ${config.botApiSecret}` },
                timeout: 5000
            })
        ]);

        const persona = {
            // PUBLIC_COMMANDS spread LAST so code-maintained built-ins (e.g. !discord)
            // always win over stale DB-seeded rows; DB still adds custom commands
            commands: { ...cmdRes.data.commands, ...PUBLIC_COMMANDS },
            timers: timerRes.data.timers && timerRes.data.timers.length > 0 ? [...timerRes.data.timers] : [...defaultTimers],
            interval: timerRes.data.interval || 60,
            settings: setRes.data || { auto_welcome: 1, auto_marketing: 1 },
            hype: HYPE_MESSAGES
        };

        // Add planetcuhz specific timer
        if (cleanChannel === 'planetcuhz') {
            const promoMsg = "📱 Follow Planet CUHZ on YouTube and TikTok! 🚀";
            if (!persona.timers.includes(promoMsg)) {
                persona.timers.push(promoMsg);
            }
        }

        channelConfigs.set(channel.toLowerCase(), persona);
        logger.info(`Loaded ${Object.keys(persona.commands).length} commands, ${persona.timers.length} timers at ${persona.interval}min intervals for ${channel}`);
    } catch (error) {
        logger.error(`Error fetching persona for ${channel}:`, error.message);

        const fallbackPersona = { ...DEFAULT_CONFIG, timers: [...defaultTimers] };
        if (cleanChannel === 'planetcuhz') {
            fallbackPersona.timers.push("📱 Follow Planet CUHZ on YouTube and TikTok! 🚀");
        }
        channelConfigs.set(channel.toLowerCase(), fallbackPersona);
    }
}

function getChannelConfig(channel) {
    const cleanChannel = channel.toLowerCase();
    return channelConfigs.get(cleanChannel) || DEFAULT_CONFIG;
}

// --- Twitch API Helpers ---

function sanitizeChannel(name) {
    if (!name) return null;
    const clean = name.trim().toLowerCase();
    return clean.startsWith('#') ? clean : `#${clean}`;
}

async function fetchClientId() {
    if (twitchClientId && botUserId) return twitchClientId;

    try {
        logger.info('Fetching Client ID validation...');
        const authBase = config.twitchAuthBase || 'https://id.twitch.tv/oauth2';
        // Pass token without 'oauth:' prefix if present
        const token = config.oauthToken.replace('oauth:', '');

        const response = await axios.get(`${authBase}/validate`, {
            headers: {
                'Authorization': `OAuth ${token}`
            },
            timeout: 10000
        });

        if (response.data && response.data.client_id) {
            twitchClientId = response.data.client_id;
            botUserId = response.data.user_id;
            logger.info(`Identity Validated: Bot is logged in as '${response.data.login}' (ID: ${botUserId})`);
            logger.info(`Client ID: ${twitchClientId}`);
            return twitchClientId;
        }
    } catch (error) {
        logger.error('Error fetching Client ID from token validation. Check your BOT_OAUTH_TOKEN.');
        logger.error('Error details:', error.message);
        return null;
    }
}

async function checkStreamStatus(channelName) {
    if (!twitchClientId) await fetchClientId();
    if (!twitchClientId) return null;

    try {
        const apiBase = config.twitchApiBase || 'https://api.twitch.tv/helix';
        const cleanName = channelName.replace('#', '');
        const token = config.oauthToken.replace('oauth:', '');

        const response = await axios.get(`${apiBase}/streams?user_login=${cleanName}`, {
            headers: {
                'Client-ID': twitchClientId,
                'Authorization': `Bearer ${token}`
            },
            timeout: 10000
        });

        const data = response.data.data;
        if (data && data.length > 0) {
            // Stream is live
            const stream = data[0];
            return {
                isLive: true,
                startedAt: new Date(stream.started_at),
                title: stream.title,
                game: stream.game_name
            };
        } else {
            return { isLive: false };
        }
    } catch (error) {
        logger.error(`Error checking stream status for ${channelName}:`, error.message);
        return null; // Keep previous state on error
    }
}

// --- Twitch ID & Follow Helpers ---

async function getTwitchUser(username) {
    if (!twitchClientId) await fetchClientId();
    if (!twitchClientId) return null;

    try {
        const apiBase = config.twitchApiBase || 'https://api.twitch.tv/helix';
        const token = config.oauthToken.replace('oauth:', '');
        const cleanName = username.replace('#', '').replace('@', '');

        const response = await axios.get(`${apiBase}/users`, {
            params: { login: cleanName },
            headers: {
                'Client-ID': twitchClientId,
                'Authorization': `Bearer ${token}`
            },
            timeout: 5000
        });

        if (response.data && response.data.data.length > 0) {
            return response.data.data[0];
        }
        return null;
    } catch (error) {
        logger.error(`Error resolving user ${username}:`, error.message);
        return null;
    }
}

async function getFollowData(broadcasterId, userId) {
    if (!twitchClientId) await fetchClientId();
    if (!twitchClientId) return null;

    try {
        const apiBase = config.twitchApiBase || 'https://api.twitch.tv/helix';
        const token = config.oauthToken.replace('oauth:', '');

        logger.info(`🔍 Checking follow: broadcaster=${broadcasterId}, user=${userId}`);

        const response = await axios.get(`${apiBase}/channels/followers`, {
            params: {
                broadcaster_id: broadcasterId,
                user_id: userId
                // no moderator_id param — Twitch infers the moderator from the token
            },
            headers: {
                'Client-ID': twitchClientId,
                'Authorization': `Bearer ${token}`
            },
            timeout: 5000
        });

        logger.info(`📊 Follow API response: ${JSON.stringify(response.data)}`);

        if (response.data && response.data.data && response.data.data.length > 0) {
            return response.data.data[0]; // Returns { user_id, user_name, followed_at }
        }
        return null; // Not following
    } catch (error) {
        // Log the actual error for debugging
        if (error.response) {
            logger.error(`❌ Follow API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            if (error.response.status === 401 || error.response.status === 403) {
                logger.error('⚠️ OAuth token missing "moderator:read:followers" scope (or bot not modded in this channel). Regenerate token with this scope.');
                // Distinguish auth failure from "not following" so the chat reply
                // doesn't falsely claim the viewer isn't a follower.
                return { authError: true };
            }
        } else {
            logger.error(`❌ Follow API error: ${error.message}`);
        }
        return null;
    }
}

async function updateChannelInfo(broadcasterId, data) {
    if (!twitchClientId) await fetchClientId();
    if (!twitchClientId) return false;

    try {
        const apiBase = config.twitchApiBase || 'https://api.twitch.tv/helix';
        const token = config.oauthToken.replace('oauth:', '');

        await axios.patch(`${apiBase}/channels?broadcaster_id=${broadcasterId}`, data, {
            headers: {
                'Client-ID': twitchClientId,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
        return true;
    } catch (error) {
        logger.error(`Error updating channel info: ${error.message}`);
        if (error.response) {
            logger.error(`API Error: ${JSON.stringify(error.response.data)}`);
        }
        return false;
    }
}

async function getGameId(gameName) {
    if (!twitchClientId) await fetchClientId();
    if (!twitchClientId) return null;

    try {
        const apiBase = config.twitchApiBase || 'https://api.twitch.tv/helix';
        const token = config.oauthToken.replace('oauth:', '');
        const response = await axios.get(`${apiBase}/games?name=${encodeURIComponent(gameName)}`, {
            headers: {
                'Client-ID': twitchClientId,
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.data && response.data.data.length > 0) {
            return response.data.data[0].id;
        }
        return null;
    } catch (error) {
        return null;
    }
}

async function validateToken() {
    try {
        const authBase = config.twitchAuthBase || 'https://id.twitch.tv/oauth2';
        const token = config.oauthToken.replace('oauth:', '');
        const response = await axios.get(`${authBase}/validate`, {
            headers: { 'Authorization': `OAuth ${token}` }
        });
        return response.data;
    } catch (error) {
        return null;
    }
}

// --- Bot Logic ---

async function initializeTwitchClient() {
    // 1. Fetch Client ID early for API calls
    await fetchClientId();

    // 2. Poll the dashboard for channels to join
    let channelsToJoin = [];

    if (config.apiBase && config.botApiSecret) {
        try {
            logger.info(`Attempting to connect to dashboard at: ${config.apiBase}`);
            const response = await axios.get(`${config.apiBase}/api/bot/channels`, {
                headers: { 'Authorization': `Bearer ${config.botApiSecret}` },
                timeout: 10000
            });

            if (response.data && response.data.channels && response.data.channels.length > 0) {
                channelsToJoin = response.data.channels.map(ch => sanitizeChannel(ch.name)).filter(n => !!n);
                logger.info(`Found ${channelsToJoin.length} channels to join from dashboard:`, channelsToJoin);
            } else {
                logger.info('No channels returned from dashboard, checking config.');
            }
        } catch (error) {
            logger.error('Error fetching channels from dashboard:', error.message);
        }
    }

    // Fallback to config if no dashboard channels
    if (channelsToJoin.length === 0 && config.channels && config.channels.length > 0) {
        channelsToJoin = config.channels.map(ch => sanitizeChannel(ch)).filter(n => !!n);
        logger.info(`Using channels from config:`, channelsToJoin);
    }

    // Ensure ALL tiered channels are joined (basic channels may not be in dashboard)
    const tieredChannels = Object.keys(CHANNEL_TIERS).map(ch => `#${ch.toLowerCase()}`);
    for (const ch of tieredChannels) {
        if (!channelsToJoin.includes(ch)) {
            channelsToJoin.push(ch);
            logger.info(`Adding tiered channel not in dashboard: ${ch}`);
        }
    }

    if (channelsToJoin.length === 0) {
        logger.warn('No channels configured to join!');
    }

    // 3. Create Client
    const oauthToken = config.oauthToken.startsWith('oauth:') ? config.oauthToken : `oauth:${config.oauthToken}`;

    logger.info(`Initializing Twitch Client for user: ${config.username}`);
    logger.info(`Final Channel List: ${channelsToJoin.join(', ')}`);

    client = new tmi.Client({
        options: { debug: true, connectionTimeout: 10000 },
        connection: {
            reconnect: true,
            secure: true
        },
        identity: {
            username: config.username,
            password: oauthToken
        },
        channels: channelsToJoin
    });

    client.connect().then(() => {
        logger.info('Successfully initiated connection to Twitch IRC.');
    }).catch(err => {
        logger.error('Twitch connection FAILED:', err);
    });
    setupEventHandlers();
}

function setupEventHandlers() {
    client.on('connected', (addr, port) => {
        logger.info(`Connected to Twitch at ${addr}:${port}`);
    });

    client.on('disconnected', (reason) => {
        logger.error(`🔌 Twitch IRC DISCONNECTED: ${reason}`);
    });

    // Twitch tells us (via NOTICE) when our messages get dropped — e.g.
    // followers-only mode in a channel where the bot doesn't follow/isn't
    // modded. Without this the bot is silently mute and nobody knows why.
    client.on('notice', (channel, msgid, message) => {
        const muted = ['msg_followersonly', 'msg_followersonly_zero', 'msg_followersonly_followed',
            'msg_subsonly', 'msg_emoteonly', 'msg_slowmode', 'msg_timedout', 'msg_banned',
            'msg_rejected', 'msg_rejected_mandatory', 'msg_verified_email', 'msg_requires_verified_phone_number'];
        if (muted.includes(msgid)) {
            logger.error(`🔇 MESSAGE BLOCKED in ${channel} [${msgid}]: ${message} — mod the bot (/mod ${config.username}) or adjust chat mode`);
        } else {
            logger.warn(`📢 Twitch NOTICE in ${channel} [${msgid}]: ${message}`);
        }
    });

    // Periodic IRC connection health check — actively reconnects after 3
    // consecutive bad checks (tmi's built-in reconnect can give up for good;
    // without this the bot becomes a zombie that still passes /health).
    let badHealthChecks = 0;
    setInterval(async () => {
        if (client && client.readyState() !== 'OPEN') {
            badHealthChecks++;
            logger.warn(`🔌 Twitch IRC connection state: ${client.readyState()} (${badHealthChecks}/3 before forced reconnect)`);
            if (badHealthChecks >= 3) {
                badHealthChecks = 0;
                logger.warn('🔌 Forcing tmi reconnect...');
                try {
                    await client.connect();
                    logger.info('🔌 Forced reconnect succeeded');
                } catch (err) {
                    logger.error(`🔌 Forced reconnect failed: ${err.message ?? err}`);
                }
            }
        } else {
            badHealthChecks = 0;
        }
    }, 60000);

    client.on('join', async (channel, username, self) => {
        if (self && !connectedChannels.has(channel)) {
            connectedChannels.add(channel);
            logger.info(`Joined channel: ${channel}`);

            // Fetch persona from Dashboard
            await fetchChannelPersona(channel);

            // Initialize AI features
            if (config.enableMoodDetection) {
                moodTracker.initChannel(channel);
            }
            if (config.enableContextAware) {
                contextHandler.initChannel(channel);
            }

            // Start Timers & Status Checks
            startRotationalTimer(channel);
            startStreamPoller(channel);
            startMoodAnalyzer(channel);

            verifyJoin(channel);
        }
    });

    client.on('message', handleMessage);

    // --- Raid / Sub / Gift event handlers (auto-celebrate) ---
    client.on('raided', (channel, raider, viewers) => {
        try {
            const cleanChannel = channel.replace('#', '').toLowerCase();
            const line = pickNoRepeat(`raidin:${cleanChannel}`, RAID_INCOMING, 2)
                .replace('{raider}', raider)
                .replace('{viewers}', viewers);
            sendMessage(channel, line);
            logger.info(`🚨 Raid into ${channel} from ${raider} (${viewers} viewers)`);
        } catch (err) {
            logger.error('Raid event handler error:', err && err.message ? err.message : err);
        }
    });

    client.on('subscription', (channel, username, method, msgText, userstate) => {
        try {
            const cleanChannel = channel.replace('#', '').toLowerCase();
            const line = pickNoRepeat(`sub:${cleanChannel}`, SUB_HYPE, 2).replace('{user}', username);
            sendMessage(channel, line);
            logger.info(`💎 New sub in ${channel}: ${username}`);
        } catch (err) {
            logger.error('Subscription event handler error:', err && err.message ? err.message : err);
        }
    });

    client.on('resub', (channel, username, monthsLegacy, msgText, userstate, methods) => {
        try {
            const cleanChannel = channel.replace('#', '').toLowerCase();
            // Prefer the cumulative-months tag from userstate if present (tmi.js
            // populates it for resubs). Fall back to the legacy positional arg.
            const months = (userstate && userstate['msg-param-cumulative-months']) || monthsLegacy || 1;
            const line = pickNoRepeat(`resub:${cleanChannel}`, RESUB_HYPE, 2)
                .replace('{user}', username)
                .replace('{months}', months);
            sendMessage(channel, line);
            logger.info(`💎 Resub in ${channel}: ${username} (${months} months)`);
        } catch (err) {
            logger.error('Resub event handler error:', err && err.message ? err.message : err);
        }
    });

    client.on('subgift', (channel, username, streakMonths, recipient, methods, userstate) => {
        try {
            const cleanChannel = channel.replace('#', '').toLowerCase();
            const line = pickNoRepeat(`subgift:${cleanChannel}`, SUBGIFT_HYPE, 2)
                .replace('{gifter}', username)
                .replace('{recipient}', recipient);
            sendMessage(channel, line);
            logger.info(`🎁 Subgift in ${channel}: ${username} → ${recipient}`);
        } catch (err) {
            logger.error('Subgift event handler error:', err && err.message ? err.message : err);
        }
    });

    logger.info('🚨 Raid / sub / resub / subgift event handlers registered');
}

async function verifyJoin(channel) {
    if (config.apiBase && config.botApiSecret) {
        try {
            await axios.post(`${config.apiBase}/api/bot/verify`, {
                channel: channel.replace('#', ''),
                status: 'active'
            }, {
                headers: { 'Authorization': `Bearer ${config.botApiSecret}` },
                timeout: 10000
            });
        } catch (error) {
            logger.error('Error verifying channel join:', error.message);
        }
    }
}

function startStreamPoller(channel) {
    // Check immediately
    updateStreamState(channel);

    // Poll every 60 seconds
    setInterval(() => {
        updateStreamState(channel);
    }, 60000);
}

// ... imports
const streamIntel = require('./stream_intel');

// ... existing code ...

// --- Persistence Helper ---
const STATE_FILE = path.join(__dirname, 'stream_states.json');

function loadStreamStates() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            const parsed = JSON.parse(data);
            // Convert strings back to dates/maps
            for (const [key, val] of Object.entries(parsed)) {
                if (val.startedAt) val.startedAt = new Date(val.startedAt);
                if (val.lastAnnounced) val.lastAnnounced = new Date(val.lastAnnounced);
                // Older deploys saved '#chan' keys — normalize on rehydration.
                streamStates.set(streamKey(key), val);
            }
            logger.info('Loaded stream states from disk.');
        }
    } catch (e) {
        logger.error('Failed to load stream states:', e.message);
    }
}

function saveStreamStates() {
    try {
        const obj = Object.fromEntries(streamStates);
        fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2));
    } catch (e) {
        logger.error('Failed to save stream states:', e.message);
    }
}

// Load on startup
loadStreamStates();

// --- Graceful shutdown (Railway sends SIGTERM on every deploy) ---
let shuttingDown = false;
async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`👋 ${signal} received — saving state and disconnecting...`);
    try { saveStreamStates(); } catch (e) { logger.error(`Shutdown state save failed: ${e.message}`); }
    try { if (client) await client.disconnect(); } catch (e) { /* already down */ }
    try { if (db.pgPool) await db.pgPool.end(); } catch (e) { /* pool already closed */ }
    process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

async function updateStreamState(channel) {
    const status = await checkStreamStatus(channel);
    const current = streamStates.get(streamKey(channel));
    const wasLive = current && current.isLive;

    // Default game name if undefined
    const gameName = (status && status.game) ? status.game : 'something cool';

    // 1. Stream is LIVE
    if (status && status.isLive) {
        // Check if we should announce (Live now, wasn't live OR not announced recently)
        // We add a 'lastAnnounced' timestamp to prevent spam on restarts
        const now = Date.now();
        const lastAnnounced = current ? (current.lastAnnounced ? new Date(current.lastAnnounced).getTime() : 0) : 0;
        const cooldown = 60 * 60 * 1000; // 1 hour cooldown for "We are live" message

        const shouldAnnounce = !wasLive || (now - lastAnnounced > cooldown);

        // Update state
        const newState = {
            ...status,
            game: gameName,
            lastAnnounced: shouldAnnounce ? new Date() : (current ? current.lastAnnounced : null)
        };

        streamStates.set(streamKey(channel), newState);
        saveStreamStates(); // Persist immediately

        await streamIntel.updateStreamStatus(channel, newState);

        if (shouldAnnounce) {
            logger.info(`🔴 STREAM LIVE: ${channel} playing ${gameName}`);
            const template = pickNoRepeat(`live:${channel}`, LIVE_ANNOUNCEMENTS, 2);
            sendMessage(channel, template.replace('{game}', gameName));
        } else {
            logger.info(`🔴 Stream live (already announced): ${channel}`);
        }
    }
    // 2. Stream went OFFLINE
    else if (wasLive) {
        streamStates.set(streamKey(channel), { isLive: false, lastAnnounced: current.lastAnnounced });
        saveStreamStates();

        await streamIntel.updateStreamStatus(channel, { isLive: false });
        logger.info(`⚫ STREAM ENDED: ${channel}`);
    }
}




function startMoodAnalyzer(channel) {
    if (!config.enableMoodDetection) return;

    // AI guardrail: Gemini sentiment analysis runs ONLY in Premium channels
    // (planetcuhz, four_a_reason, rico2ez). No AI calls for any other stream.
    const analyzerTier = CHANNEL_TIERS[channel.replace('#', '').toLowerCase()] || TIERS.BASIC;
    if (analyzerTier !== TIERS.PREMIUM) {
        logger.info(`🛡️ Mood analyzer skipped for ${channel} (AI is Premium-only)`);
        return;
    }

    logger.info(`🤖 Mood analyzer initialized for ${channel}`);

    // Analyze mood every 2 minutes
    setInterval(async () => {
        if (moodTracker.shouldAnalyzeMood(channel)) {
            const messageBuffer = moodTracker.getMessageBuffer(channel);

            if (messageBuffer.length >= 5) {
                try {
                    const sentiment = await aiService.analyzeSentiment(messageBuffer);
                    const newPersonality = moodTracker.updateMood(channel, sentiment);

                    // Check if hype injection is needed (with cooldown).
                    // Premium-only: injection is an advertised Premium AI feature and
                    // was leaking into basic channels. Mood analysis itself keeps
                    // running for all tiers (feeds mod commands like !mood).
                    const hypeTier = CHANNEL_TIERS[channel.replace('#', '').toLowerCase()] || TIERS.BASIC;
                    if (hypeTier === TIERS.PREMIUM && moodTracker.needsHypeInjection(channel) && client && client.readyState() === 'OPEN') {
                        // Try AI-generated proactive message first, fall back to static hype
                        const recentContext = contextHandler.getContext(channel);
                        let hypeMsg = await aiService.generateProactiveMessage(channel, recentContext, sentiment.mood);

                        if (!hypeMsg) {
                            const persona = getChannelConfig(channel);
                            hypeMsg = persona.hype[Math.floor(Math.random() * persona.hype.length)];
                        }

                        client.say(channel, `💫 ${hypeMsg}`);
                        moodTracker.recordHypeInjection(channel);
                        logger.info(`💉 Injected hype into ${channel} (low energy detected)`);
                    }

                    // Alert mods if toxicity is high
                    if (sentiment.toxicity > 60 && client && client.readyState() === 'OPEN') {
                        logger.warn(`⚠️ High toxicity detected in ${channel}: ${sentiment.toxicity}`);
                        // Could send a private message to mods here
                    }

                } catch (error) {
                    logger.error(`Failed to analyze mood for ${channel}:`, error.message);
                }
            }
        }
    }, config.moodAnalysisInterval * 1000);
}

function startRotationalTimer(channel) {
    timerIndices.set(channel, 0);
    const persona = getChannelConfig(channel);
    const intervalMs = (persona.interval || 60) * 60 * 1000; // Default to 60 minutes if not specified

    logger.info(`Rotational timer initialized for ${channel} (Every ${persona.interval || 60}m, Smart Mode)`);

    setInterval(() => {
        if (client && client.readyState() === 'OPEN') {
            const persona = getChannelConfig(channel);
            // Check if Auto-Marketing is enabled
            if (persona.settings && !persona.settings.auto_marketing) {
                return;
            }

            // Smart Check: Only send if stream is LIVE
            const state = streamStates.get(streamKey(channel));
            const isLive = state ? state.isLive : false; // Default to false if unknown to avoid spam

            // Allow sending if Mock API is enabled (for testing) OR actually live
            const shouldSend = config.useMockApi || isLive;

            if (shouldSend) {
                const dailyMsg = dailyMessages.get(channel.toLowerCase());
                const index = timerIndices.get(channel) || 0;

                // If daily message is set, alternate it every other cycle
                const timerTier = CHANNEL_TIERS[channel.replace('#', '').toLowerCase()] || TIERS.BASIC;
                if (dailyMsg && index % 2 === 0) {
                    sendMessage(channel, dailyMsg);
                } else if (timerTier === TIERS.BASIC && Array.isArray(persona.timers) && persona.timers.length > 0) {
                    // Basic tier: rotate the channel's own timers (dashboard-set or
                    // BASIC_TIMER_MESSAGES defaults) — these were loaded but never
                    // sent before. Pro/Premium keep the TIMER_POOLS path unchanged.
                    const line = pickNoRepeat(`timer:${channel}:persona`, persona.timers, Math.min(3, persona.timers.length - 1));
                    if (line) sendMessage(channel, line);
                } else {
                    // Pick a TIMER_POOLS category that isn't the one we fired last time.
                    const lastKey = `timerCat:${channel}`;
                    const lastCat = _recentPicks.get(lastKey) || [];
                    const allCats = Object.keys(TIMER_POOLS);
                    const available = allCats.filter(c => !lastCat.includes(c));
                    const cat = (available.length ? available : allCats)[Math.floor(Math.random() * (available.length || allCats.length))];
                    _recentPicks.set(lastKey, [cat]);
                    const line = pickNoRepeat(`timer:${channel}:${cat}`, TIMER_POOLS[cat], 3);
                    if (line) sendMessage(channel, line);
                }

                // Rotate daily-slot alternation
                const nextIndex = (index + 1) % 2;
                timerIndices.set(channel, nextIndex);
            } else {
                // logger.debug(`Skipping timer for ${channel} (Stream Offline)`);
            }
        }
    }, intervalMs); // FIXED: Now uses the calculated interval instead of hardcoded 12 minutes

    logger.info(`Rotational timer started for ${channel} at ${persona.interval || 60} minute intervals`);
}

/**
 * Handle automatic shoutouts for fellow streamers
 * @param {string} channel - Channel name
 * @param {string} usernameLower - Username in lowercase
 * @param {string} displayName - Display name for mention
 */
async function handleAutoShoutout(channel, usernameLower, displayName) {
    try {
        // Check if this user is in the auto-shoutout list
        const streamer = await db.prepare(`
            SELECT * FROM streamer_shoutouts 
            WHERE channel = ? AND streamer_username = ? AND is_active = 1
        `).get(channel, usernameLower);

        if (!streamer) {
            return; // Not in the list, skip
        }

        // Check cooldown (24 hours since last shoutout)
        if (streamer.last_shoutout) {
            const lastShoutout = new Date(streamer.last_shoutout);
            const hoursSinceLastShoutout = (Date.now() - lastShoutout.getTime()) / (1000 * 60 * 60);

            if (hoursSinceLastShoutout < 24) {
                return; // Too soon, skip
            }
        }

        // Give the shoutout!
        client.say(channel, `🎬 Big shoutout to fellow streamer @${displayName}! Check them out at https://twitch.tv/${usernameLower} 🚀`);

        // Update database
        await db.prepare(`
            UPDATE streamer_shoutouts 
            SET last_shoutout = CURRENT_TIMESTAMP, shoutout_count = shoutout_count + 1 
            WHERE channel = ? AND streamer_username = ?
        `).run(channel, usernameLower);

        logger.info(`🎬 Auto-shoutout sent for ${usernameLower} in ${channel}`);

    } catch (err) {
        logger.error('Error in handleAutoShoutout:', err.message);
    }
}

async function handleMessage(channel, tags, message, self) {
    if (self) return;

    // --- Add to AI Context & Mood Buffers ---
    const username = tags.username;
    if (config.enableMoodDetection) {
        moodTracker.addMessage(channel, username, message);
    }
    if (config.enableContextAware) {
        contextHandler.addToContext(channel, username, message);
    }

    // --- Record to Chat Memory ---
    const isCommand = message.startsWith('!');
    userMemory.recordMessage(channel, username, message, isCommand);

    // Declared here so both the points/welcome block and later command dispatch can read it.
    const msg = message.toLowerCase();

    // --- Track User Activity ---
    try {
        const usernameL = username.toLowerCase();
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();

        // 1. Check Passive Paycheck (Active for 10 mins -> +10 points)
        // We check last_seen before updating it to see how long since last active
        const user = await db.prepare('SELECT last_seen FROM users WHERE username = ?').get(usernameL);

        if (user) {
            const lastSeenTime = new Date(user.last_seen).getTime();
            const timeDiff = now.getTime() - lastSeenTime;

            // If they've been chatting actively (last msg was within 10-20 mins ago)
            // AND it's been at least 10 minutes since last activity logged
            if (timeDiff > 10 * 60 * 1000 && timeDiff < 30 * 60 * 1000) {
                await pointsService.addPoints(usernameL, 10, 'passive_paycheck');
                // !watchtime: each presence-point award = one ~10-minute active
                // viewing window (the paycheck's own "active for 10 mins" unit).
                await userMemory.addWatchMinutes(usernameL, 10);
            }
        }

        // 2. Earn Active Point (+1 per message)
        await pointsService.addPoints(usernameL, 1, 'chat_message');

        // 3. Update User Stats (Last Seen, Msg Count)
        const upsertUser = db.prepare(`
            INSERT INTO users (username, points, messages_sent, last_seen)
            VALUES (?, 1, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(username) DO UPDATE SET
                messages_sent = messages_sent + 1,
                last_seen = CURRENT_TIMESTAMP
        `);
        await upsertUser.run(usernameL);

        // 4. Check Achievements (Async) — decoupled from points so a failure here
        //    can't break point awarding, and routed through the send queue.
        loyaltySystem.checkAchievements(usernameL).then(newAchievements => {
            if (newAchievements && newAchievements.length > 0) {
                newAchievements.forEach(ach => {
                    sendMessage(channel, `🏆 ACHIEVEMENT UNLOCKED: @${tags.username} earned '${ach}'!`);
                });
            }
        }).catch(err => logger.error('Achievement check failed:', err && err.message ? err.message : err));

        // ... commands ...

        if (msg === '!achievements') {
            const achievements = await loyaltySystem.getAchievements(tags.username);
            if (achievements.length === 0) {
                client.say(channel, `📜 @${tags.username} has no achievements yet. Keep chatting!`);
            } else {
                const list = achievements.map(a => a.achievement_name).join(', ');
                client.say(channel, `🏆 @${tags.username}'s Achievements: ${list}`);
            }
            return;
        }


        const persona = getChannelConfig(channel);
        // Per-channel First Contact: each channel gets to welcome the user once.
        // Returning-user welcome: fire a lighter "welcome back" line if it's been ≥4h
        // since we last welcomed them in THIS channel (and they haven't spoken in 4h+).
        const canWelcome = !persona.settings || persona.settings.auto_welcome;
        if (canWelcome) {
            const welcomeKey = `${channel}:${usernameL}`;
            const welcomeState = _channelWelcomes.get(welcomeKey);
            const joinTier = CHANNEL_TIERS[channel.replace('#', '').toLowerCase()] || TIERS.BASIC;
            const nowMs = now.getTime();

            if (!welcomeState) {
                // First Contact for this channel — full hype welcome.
                if (joinTier === TIERS.BASIC) {
                    sendMessage(channel, `Wassup cuhz, Welcome to the stream! @${tags.username}`);
                } else {
                    const randomWelcome = WELCOME_QUOTES[Math.floor(Math.random() * WELCOME_QUOTES.length)];
                    sendMessage(channel, `${randomWelcome} @${tags.username} 🌌`);
                }
                _channelWelcomes.set(welcomeKey, { firstContactAt: nowMs, lastWelcomedAt: nowMs });
            } else if (nowMs - welcomeState.lastWelcomedAt >= WELCOME_BACK_COOLDOWN_MS) {
                // Only fire welcome-back if the user ALSO hasn't chatted in the last 4h
                // (prevents re-welcoming someone who just idled in the tab).
                const lastSeenMs = user ? new Date(user.last_seen).getTime() : 0;
                if (!user || (nowMs - lastSeenMs) >= WELCOME_BACK_COOLDOWN_MS) {
                    const line = pickNoRepeat(`welcomeback:${channel}`, WELCOME_BACK_QUOTES, 3);
                    sendMessage(channel, `${line} @${tags.username}`);
                    welcomeState.lastWelcomedAt = nowMs;
                }
            }
        }

        // Auto-shoutout for fellow streamers (pro/premium only)
        const joinChannelTier = CHANNEL_TIERS[channel.replace('#', '').toLowerCase()] || TIERS.BASIC;
        if (joinChannelTier !== TIERS.BASIC) {
            await handleAutoShoutout(channel, usernameL, tags.username);
        }

    } catch (err) {
        logger.error('Error tracking user points/welcome:', err.message);
    }

    const cleanChannel = channel.replace('#', '').toLowerCase();

    // --- Tier System Definition ---

    const tier = CHANNEL_TIERS[cleanChannel] || TIERS.BASIC;
    const isPremium = tier === TIERS.PREMIUM;
    const isProOrPremium = tier === TIERS.PRO || tier === TIERS.PREMIUM;

    // Legacy mapping for existing commands that relied on isVerifiedStream
    const isVerifiedStream = isPremium;

    const isMod = tags.mod || (tags.badges && tags.badges.broadcaster);
    const persona = getChannelConfig(channel);

    // 0. Global Connectivity Test
    if (msg === '!ping') {
        client.say(channel, `Pong! 🏓 The bot is active in ${channel}.`);
        return;
    }

    // 0.5. Context-Aware Response (AI) - Premium Only
    if (isPremium && config.enableContextAware && !msg.startsWith('!')) {
        try {
            const currentPersonality = moodTracker.getCurrentPersonality(channel);
            const personalityConfig = moodTracker.getPersonalityConfig(currentPersonality);

            // Get user profile for personalization
            const userProfile = await userMemory.getProfile(tags.username);

            // Stream context (game/title/live) makes AI replies concretely
            // smarter with zero extra messages.
            const streamState = streamStates.get(streamKey(channel)) || null;

            const aiResponse = await contextHandler.handleContextAwareResponse(
                channel,
                tags.username,
                message,
                currentPersonality,
                persona.commands,
                personalityConfig,
                userProfile,  // Pass user profile for AI personalization
                streamState   // Pass live stream info (game/title) for grounding
            );

            if (aiResponse) {
                client.say(channel, aiResponse);
                return;
            }
        } catch (error) {
            logger.error('Context-aware response error:', error.message);
        }
    }

    // 0.8. CUHZ Vibe Commands (ALL tiers)
    if (msg === '!vibe') {
        client.say(channel, VIBE_MESSAGES[Math.floor(Math.random() * VIBE_MESSAGES.length)]);
        return;
    }
    if (msg === '!w') {
        client.say(channel, W_MESSAGES[Math.floor(Math.random() * W_MESSAGES.length)]);
        return;
    }
    if (msg === '!bet') {
        client.say(channel, BET_MESSAGES[Math.floor(Math.random() * BET_MESSAGES.length)]);
        return;
    }
    if (msg === '!gz') {
        client.say(channel, GZ_MESSAGES[Math.floor(Math.random() * GZ_MESSAGES.length)]);
        return;
    }
    if (msg === '!nocap') {
        client.say(channel, NOCAP_MESSAGES[Math.floor(Math.random() * NOCAP_MESSAGES.length)]);
        return;
    }
    if (msg === '!l') {
        client.say(channel, L_MESSAGES[Math.floor(Math.random() * L_MESSAGES.length)]);
        return;
    }
    if (msg === '!fam') {
        client.say(channel, 'Cuhz fam in the building! Tag someone who needs to see this stream 👀');
        return;
    }
    if (msg === '!goat') {
        client.say(channel, 'GOAT behavior detected 🐐 Keep going cuhz!');
        return;
    }
    if (msg === '!getcuhzbot') {
        client.say(channel, '🤖 Want CUHZ Bot in your channel? Pull up to @four_a_reason\'s stream and ask about it! → https://twitch.tv/four_a_reason 🚀');
        return;
    }

    // 0.84. Mahni Rotation (ALL tiers)
    if (msg === '!mahni') {
        client.say(channel, MAHNI_QUOTES[Math.floor(Math.random() * MAHNI_QUOTES.length)]);
        return;
    }

    // 0.849. !rock — all tiers, 12 variants, no repeats within last 3 fires.
    // !top100points — four_a_reason's channel only (his video, his shoutout)
    // !pg — Proving Grounds command directory (four_a_reason only, since every
    // PG command it lists is locked to his channel).
    if (msg === '!pg' || msg === '!provinggrounds' || msg === '!pgcommands') {
        if (cleanChannel !== 'four_a_reason') return;
        const list = PG_COMMANDS.map(c => `${c.cmd} — ${c.desc}`).join(' | ');
        sendMessage(channel, `🏀 PROVING GROUNDS commands: ${list} 👑 All straight from @four_a_reason`);
        return;
    }

    if (msg === '!top100ovrrank' || msg === '!top100ovr') {
        if (cleanChannel !== 'four_a_reason') return;
        const line = pickNoRepeat(`top100ovr:${cleanChannel}`, TOP100OVR_QUOTES, 2);
        sendMessage(channel, line);
        return;
    }

    if (msg === '!top100points' || msg === '!top100') {
        if (cleanChannel !== 'four_a_reason') return;
        const line = pickNoRepeat(`top100:${cleanChannel}`, TOP100_QUOTES, 2);
        sendMessage(channel, line);
        return;
    }

    if (msg === '!rock') {
        const line = pickNoRepeat(`rock:${cleanChannel}`, ROCK_QUOTES, 3);
        sendMessage(channel, line);
        return;
    }

    // 0.849b. User rotation commands — pools defined in USER_VARIANT_POOLS (module scope).
    if (USER_VARIANT_POOLS[msg]) {
        const pool = USER_VARIANT_POOLS[msg];
        const line = pickNoRepeat(`user:${msg}:${cleanChannel}`, pool, 2);
        sendMessage(channel, line);
        return;
    }

    // 0.85. Basic User Commands (ALL tiers — custom shoutouts for basic channel owners)
    if (BASIC_USER_COMMANDS[msg]) {
        client.say(channel, BASIC_USER_COMMANDS[msg]);
        return;
    }

    // 0.86. Daily Message System (Mod/Broadcaster only)
    if (msg.startsWith('!settoday ') && isMod) {
        const todayMsg = message.slice('!settoday '.length).trim();
        if (todayMsg) {
            dailyMessages.set(channel.toLowerCase(), `📢 Today: ${todayMsg}`);
            client.say(channel, `✅ Today's update set: "${todayMsg}"`);
        }
        return;
    }
    if (msg === '!cleartoday' && isMod) {
        dailyMessages.delete(channel.toLowerCase());
        client.say(channel, '✅ Today\'s update cleared.');
        return;
    }

    // 1. Exact Match Public Commands (Dashboard Persona Specific)
    // Block info/link commands for Basic tier
    if (!isProOrPremium && BASIC_BLOCKED_COMMANDS.has(msg)) {
        // Basic tier doesn't get info/link commands — silent skip
    } else if (persona.commands[msg]) {
        client.say(channel, persona.commands[msg]);
        return;
    }

    // --- Special Master Commands (Precedence) - Pro/Premium Tier Only ---
    if (isProOrPremium) {
        if (msg === '!ac') {
            const line = pickNoRepeat(`ac:${cleanChannel}`, AC_QUOTES, 3);
            sendMessage(channel, line);
            return;
        }

        // In-memory session tracking for command usage (resets on restart)
        if (!global.sessionCommandUsage) {
            global.sessionCommandUsage = new Map(); // key: specific_command_user (e.g. "!storm_username")
        }

        if (msg.startsWith('!storm')) {
            const key = `!storm_${tags.username}`;
            const count = (global.sessionCommandUsage.get(key) || 0) + 1;
            global.sessionCommandUsage.set(key, count);

            if (count === 1) {
                // First use: Unique welcome
                const suffix = STORM_SUFFIXES[Math.floor(Math.random() * STORM_SUFFIXES.length)];
                client.say(channel, `🌪️ cuhzin glad to have you back in the chat! ${suffix}`);
            } else {
                // Reuse: Hype shoutout
                client.say(channel, `⚡ STORM IS IN THE BUILDING! bringing the energy! Don't blink! 🌩️`);
            }
            return;
        }

        if (msg.startsWith('!juan')) {
            const key = `!juan_${tags.username}`;
            const count = (global.sessionCommandUsage.get(key) || 0) + 1;
            global.sessionCommandUsage.set(key, count);

            if (count === 1) {
                // First use: Unique welcome
                const suffix = JUAN_SUFFIXES[Math.floor(Math.random() * JUAN_SUFFIXES.length)];
                client.say(channel, `🔫 the juan and only! Wassup cuhzin glad to see you, what level are you in cod? ${suffix}`);
            } else {
                // Reuse: Hype shoutout
                client.say(channel, `🎯 The Juan and Only is holding it down! staying active! 🔥`);
            }
            return;
        }

        if (msg === '!rico') {
            const randomRico = RICO_QUOTES[Math.floor(Math.random() * RICO_QUOTES.length)];
            client.say(channel, `🎯 ${randomRico}`);
            return;
        }

        if (msg === '!pnx') {
            // Quotes already include their leading emoji — no prefix here (was the doubled-emoji bug).
            const line = pickNoRepeat(`pnx:${cleanChannel}`, PNX_QUOTES, 3);
            sendMessage(channel, line);
            return;
        }

        if (msg === '!dame') {
            const randomDame = DAME_QUOTES[Math.floor(Math.random() * DAME_QUOTES.length)];
            client.say(channel, `⌚ ${randomDame}`);
            return;
        }

        if (msg === '!bern') {
            const randomBern = BERN_QUOTES[Math.floor(Math.random() * BERN_QUOTES.length)];
            client.say(channel, `🏀 ${randomBern}`);
            return;
        }

        if (USER_COMMANDS[msg]) {
            client.say(channel, USER_COMMANDS[msg]);
            return;
        }
    }

    // 1.5. Dynamic Help System based on Tiers. Grouped + each sendMessage stays
    // under Twitch's 500-char per-line limit. Audited against actual dispatch
    // (USER_VARIANT_POOLS, BASIC_USER_COMMANDS, master commands, etc.).
    if (msg === '!help' || msg === '!commands') {
        const utility   = '🛠️ Utility: !lurk !unlurk !points !watchtime !top !weekly !uptime !game !socials !commands !ping !nf !sub !raid';
        const vibes     = '🔥 Vibes: !hype !vibe !w !bet !gz !nocap !l !fam !goat !quote !gm !gn';
        const brand     = '🌌 Brand: !cuhz !planet !whatiscuhz !rules !pointsinfo';
        const shoutouts = '🎤 Shoutouts: !ac !4 !four !ec !rock !pnx !tj !spence !snowy !snow !kasha !qween !fvmous !gg !brady !limit !balen !joee !joe !lyrical !p&b !grouch !blessed !phoenix !uncle !breezy !smutty !relax !jr !mahni !storm !juan !rico !bern !dame !anti';
        const crew      = '🎤 Crew: !uni !chi !bot !drizzy !jay !rell !jxy !keem !jaylo !tank !neb !papi !raz !famous !rebound !thorn !zuri !shock !kay !yoo !tay !badguy !night !reacts';
        const modsPro   = '🛡️ Mods: !so !raid !give !title !game !ban !timeout !announce !chatreport !mood !settoday !cleartoday';
        const ai        = 'AI: !ask !code !whois !topchatters';

        if (isPremium) {
            sendMessage(channel, utility + ' !discord !links !claim !gamble !achievements !followage');
            sendMessage(channel, vibes + ' | ' + brand + ' !getcuhzbot !faq !roadmap !whitepaper !dashboard');
            sendMessage(channel, shoutouts + (cleanChannel === 'four_a_reason' ? ' !pg !top100points !top100ovrrank' : ''));
            sendMessage(channel, crew + ' | ' + ai);
            sendMessage(channel, modsPro + ' !addstreamer !removestreamer — Ask naturally for AI help 💎');
        } else if (tier === TIERS.PRO) {
            sendMessage(channel, utility + ' !discord !links !claim !gamble !achievements !followage');
            sendMessage(channel, vibes + ' | ' + brand);
            sendMessage(channel, shoutouts);
            sendMessage(channel, crew + ' | ' + modsPro);
        } else {
            // Basic — limited shoutouts, no AI, no info-link dump
            sendMessage(channel, utility + ' !claim');
            sendMessage(channel, vibes + ' | 🌌 Brand: !cuhz !planet');
            sendMessage(channel, '🎤 Shoutouts: !4 !four !ec !rock !tj !spence !snowy !snow !kasha !qween !fvmous !gg !brady !limit !balen !joee !joe !lyrical !p&b !grouch !blessed !phoenix !uncle !breezy !smutty !relax !jr !mahni !tay !yoo !anti | Mods: !so !raid !settoday — Stay CUHZ 🚀');
        }
        return;
    }

    // 1.55. Basic Tier Shoutouts Directory
    if (!isProOrPremium && msg === '!shoutouts') {
        sendMessage(channel, '🎤 Shoutouts: !4 !four !ec !rock !tj !spence !snowy !snow !kasha !qween !fvmous !gg !brady !limit !balen !joee !joe !lyrical !p&b !grouch !blessed !phoenix !uncle !breezy !smutty !relax !jr !cuhz !planet !mahni !tay !yoo !anti');
        sendMessage(channel, '🔥 Vibes: !hype !vibe !w !bet !gz !nocap !l !fam !goat | Want CUHZ Bot? Pull up to @four_a_reason → twitch.tv/four_a_reason 🚀');
        return;
    }

    // 1.6. Support & Command Help - Pro/Premium only since Basic doesn't get custom commands
    if (isProOrPremium) {
        if (msg.includes('how do i get a command') || msg.includes('how to get a custom command')) {
            client.say(channel, `Custom commands are for regulars! If you're on the list and want an update, email SUPPORT@PLANETCUHZ.COM`);
            return;
        }

        if (msg.includes('how to change my message') || msg.includes('how do i change my message') || msg.includes('change my command')) {
            client.say(channel, `If you want to change your custom command message, please email SUPPORT@PLANETCUHZ.COM`);
            return;
        }

        // 1.6. Directory Command (Pro/Premium full list)
        if (msg === '!shoutouts') {
            sendMessage(channel, '🎤 Shoutouts: !ac !4 !four !ec !rock !pnx !tj !spence !snowy !snow !kasha !qween !fvmous !gg !brady !limit !balen !joee !joe !lyrical !p&b !grouch !blessed !phoenix !uncle !breezy !smutty !relax !jr !cuhz !planet !mahni !storm !juan !rico !bern !dame !anti');
            sendMessage(channel, '🎤 Crew: !uni !chi !bot !drizzy !jay !rell !jxy !keem !jaylo !tank !neb !papi !raz !famous !rebound !thorn !zuri !shock !kay !yoo !tay !badguy !night !reacts');
            sendMessage(channel, 'Want your own? Email SUPPORT@PLANETCUHZ.COM 💎');
            return;
        }

        // 1.7. Support Query Detection ("How do I get a command?")
        const helpPattern = /how (do|can) i (get|have|make) a (command|custom command)/i;
        if (helpPattern.test(message)) {
            client.say(channel, "Custom commands are for regulars! If you're on the list and want an update, email SUPPORT@PLANETCUHZ.COM");
            return;
        }
    }

    // 2. Dynamic Commands
    if (msg.startsWith('!followage') || msg.startsWith('!following')) {
        // 1. Determine target user (sender or specified user)
        const args = message.split(' ');
        const targetUsername = args[1] ? args[1].replace('@', '') : tags.username;

        // Log every attempt so production logs show usage (was fully silent before).
        logger.info(`📅 !followage attempt in ${channel} for ${targetUsername} (by ${tags.username}, tier: ${tier})`);

        if (!isProOrPremium) {
            // Basic tier: friendly upsell instead of silence (in BASIC_BLOCKED_COMMANDS)
            sendMessage(channel, `Follow-age is a Pro/Premium perk cuhz 💎`);
            return;
        }
        try {
            // 2. Get IDs for Channel and Target User
            const channelUser = await getTwitchUser(channel.replace('#', ''));
            const targetUser = await getTwitchUser(targetUsername);

            if (!channelUser || !targetUser) {
                logger.warn(`Could not resolve IDs for followage check: Ch=${channel} User=${targetUsername}`);
                client.say(channel, `⚠️ Can't look up follow data right now — the bot may need re-authorization. Try again later!`);
                return;
            }

            // 3. Check follow status
            const followData = await getFollowData(channelUser.id, targetUser.id);

            if (followData && followData.authError) {
                client.say(channel, `⚠️ Follow lookup needs the bot re-authorized (missing follower scope) — ping @planetcuhz to fix it!`);
                return;
            }

            if (followData) {
                const start = new Date(followData.followed_at);
                const now = new Date();
                const diffTime = Math.abs(now - start);

                const years = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 365));
                const months = Math.floor((diffTime % (1000 * 60 * 60 * 24 * 365)) / (1000 * 60 * 60 * 24 * 30));
                const days = Math.floor((diffTime % (1000 * 60 * 60 * 24 * 30)) / (1000 * 60 * 60 * 24));
                const hours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

                let timeStr = "";
                if (years > 0) timeStr += `${years}y `;
                if (months > 0) timeStr += `${months}m `;
                if (days > 0) timeStr += `${days}d `;
                if (timeStr === "") timeStr = `${hours}h`; // Fallback for very new follows

                client.say(channel, `@${targetUsername} has been following for ${timeStr.trim()}! 📅`);
            } else {
                client.say(channel, `@${targetUsername} is not following ${channel} (yet)!`);
            }
        } catch (err) {
            logger.error('Error in !followage:', err.message);
        }
        return;
    }

    if (msg === '!claim') {
        try {
            // 1. Get IDs
            const channelUser = await getTwitchUser(channel.replace('#', ''));
            const targetUser = await getTwitchUser(tags.username);

            if (!channelUser || !targetUser) {
                client.say(channel, `⚠️ Follower lookup failed — bot may need re-authorization. Contact a mod!`);
                return;
            }

            // 2. Verify Follow
            const followData = await getFollowData(channelUser.id, targetUser.id);
            if (followData && followData.authError) {
                // Can't verify follows until the bot token has the follower scope —
                // fail closed, don't hand out bonuses unverified.
                client.say(channel, `⚠️ Can't verify follows right now — claim is paused until the bot gets re-authorized. Hold tight cuhz!`);
                return;
            }
            if (!followData) {
                client.say(channel, `🚫 You must be following the channel to claim your 300 point bonus!`);
                return;
            }

            // 3. Attempt to Claim (Logic in pointsService handles "one time only" check)
            const success = await pointsService.claimBonus(tags.username, 'follower_bonus', 300);

            if (success) {
                const balance = await pointsService.getBalance(tags.username);
                client.say(channel, `🎉 FOLLOW BONUS CLAIMED! @${tags.username} received 300 points! Balance: ${balance} 💎`);
            } else {
                client.say(channel, `🚫 Nice try cuhz! You already claimed your follower bonus.`);
            }
        } catch (err) {
            logger.error('Error in !claim:', err.message);
        }
        return;
    }


    if (msg === '!streamstats') {
        if (!isProOrPremium) return; // in BASIC_BLOCKED_COMMANDS — Pro/Premium perk
        const stats = await streamIntel.getStats(channel);
        if (!stats) {
            client.say(channel, "📊 No stream data available yet.");
        } else if (stats.isLive) {
            client.say(channel, `🔴 LIVE | Viewers: ${stats.viewers} (Peak: ${stats.peak_viewers || stats.viewers}) | Started: ${new Date(stats.started_at).toLocaleTimeString()}`);
        } else {
            client.say(channel, `⚫ OFFLINE | Last Stream: ${new Date(stats.started_at).toLocaleDateString()} | Duration: ${stats.ended_at ? Math.round((new Date(stats.ended_at) - new Date(stats.started_at)) / 60000) + 'm' : 'Unknown'}`);
        }
        return;
    }

    // !nf / !newfollower — manual new-follower hype. REQUIRES an @username so
    // we don't accidentally celebrate the streamer (the typer) as the follower.
    // Usage: !nf @username
    if (msg === '!nf' || msg.startsWith('!nf ') || msg === '!newfollower' || msg.startsWith('!newfollower ')) {
        const match = message.match(/@?([A-Za-z0-9_]{3,25})/g);
        // [0] is the command word ("nf" / "newfollower"), [1] is the target.
        const target = match && match.length >= 2 ? match[1].replace('@', '') : null;
        if (!target) {
            sendMessage(channel, `🛟 Usage: !nf @username — give the new follower their flowers 💎`);
            return;
        }
        const line = pickNoRepeat(`nf:${cleanChannel}`, NEW_FOLLOWER_HYPE, 2).replace('{user}', target);
        sendMessage(channel, line);
        return;
    }

    // !sub — manual sub celebration. REQUIRES @username for the same reason as
    // !nf above. The 'subscription' tmi.js event listener still auto-fires on
    // real subs and uses the actual subber's username.
    if (msg === '!sub' || msg.startsWith('!sub ')) {
        const match = message.match(/@?([A-Za-z0-9_]{3,25})/g);
        const target = match && match.length >= 2 ? match[1].replace('@', '') : null;
        if (!target) {
            sendMessage(channel, `🛟 Usage: !sub @username — shout out the new sub 💎`);
            return;
        }
        const line = pickNoRepeat(`submanual:${cleanChannel}`, SUB_HYPE, 2).replace('{user}', target);
        sendMessage(channel, line);
        return;
    }

    // !raid — bare (no args) is a manual incoming-raid hype for everyone.
    // The mod-only !raid <target> farewell stays at its existing site below.
    if (msg === '!raid') {
        const line = pickNoRepeat(`raidmanual:${cleanChannel}`, RAID_HYPE_MANUAL, 3);
        sendMessage(channel, line);
        return;
    }

    // --- Phase 8: Utility commands ---
    if (msg === '!lurk') {
        const line = pickNoRepeat(`lurk:${cleanChannel}`, LURK_QUOTES, 2).replace('{user}', tags.username);
        sendMessage(channel, line);
        return;
    }

    if (msg === '!unlurk' || msg === '!back') {
        const line = pickNoRepeat(`unlurk:${cleanChannel}`, UNLURK_QUOTES, 2).replace('{user}', tags.username);
        sendMessage(channel, line);
        return;
    }

    if (msg === '!socials') {
        const extras = [];
        if (SOCIAL_LINKS.instagram) extras.push(`IG: ${SOCIAL_LINKS.instagram}`);
        if (SOCIAL_LINKS.tiktok)    extras.push(`TikTok: ${SOCIAL_LINKS.tiktok}`);
        if (SOCIAL_LINKS.youtube)   extras.push(`YT: ${SOCIAL_LINKS.youtube}`);
        const tail = extras.length ? ` | ${extras.join(' | ')}` : '';
        sendMessage(channel, `🔗 Planet CUHZ socials → ${SOCIAL_LINKS.linktree} | 💬 Discord → ${SOCIAL_LINKS.discord} | 🌌 Site → ${SOCIAL_LINKS.website}${tail}`);
        return;
    }

    // Viewer version of !game (bare, no args). Mod version (!game <name>) stays below.
    if (msg === '!game') {
        const state = streamStates.get(streamKey(channel));
        const gameName = state && state.game ? state.game : null;
        if (gameName) sendMessage(channel, `🎮 Currently playing ${gameName}`);
        else sendMessage(channel, `🎮 No game set right now cuhz — check back in a sec`);
        return;
    }

    if (msg === '!uptime') {
        const state = streamStates.get(streamKey(channel));
        const channelName = channel.replace('#', '');

        if (state && state.isLive && state.startedAt) {
            // startedAt may be a string if the state was rehydrated/serialized — coerce.
            const startedAt = state.startedAt instanceof Date ? state.startedAt : new Date(state.startedAt);
            const diff = Date.now() - startedAt.getTime();
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff / (1000 * 60)) % 60);
            sendMessage(channel, `🔴 ${channelName} has been live for ${hours}h ${minutes}m — grinding 💎`);
        } else {
            sendMessage(channel, `Stream's offline right now cuhz. Check the schedule 📅`);
        }
        return;
    }

    if (msg === '!viewers') {
        if (!isProOrPremium) return; // in BASIC_BLOCKED_COMMANDS — Pro/Premium perk
        const stats = await streamIntel.getStats(channel);
        if (stats && stats.isLive) {
            client.say(channel, `👥 Current viewers: ${stats.viewers} (Peak: ${stats.peak_viewers || stats.viewers}) 🔴`);
        } else {
            client.say(channel, `📴 Stream is currently offline.`);
        }
        return;
    }

    if (msg === '!schedule' || msg === '!stream') {
        if (!isProOrPremium) return; // in BASIC_BLOCKED_COMMANDS — Pro/Premium perk
        client.say(channel, `@${tags.username} 🗓 Check the schedule tab & turn on notifications for updates!`);
        return;
    }

    if (msg === '!hype') {
        const messages = persona.hype || HYPE_MESSAGES;
        const randomHype = messages[Math.floor(Math.random() * messages.length)];
        client.say(channel, randomHype);
        return;
    }

    if (msg === '!quote' || msg === '!motivation') {
        // Quotes already include their own author-framed emojis — no prefix here.
        const line = pickNoRepeat(`quote:${cleanChannel}`, MOTIVATIONAL_QUOTES, 3);
        sendMessage(channel, line);
        return;
    }

    // !4 / !four — dedicated to @four_a_reason. Own pool (FOUR_QUOTES), not an
    // alias of !ac. Shared no-repeat key so !4 and !four don't fire the same
    // line back-to-back.
    if (msg === '!4' || msg === '!four') {
        const line = pickNoRepeat(`four:${cleanChannel}`, FOUR_QUOTES, 3);
        sendMessage(channel, line);
        return;
    }

    // --- Phase 1: Chat Memory Commands (Restricted to Verified Streams) ---
    if (msg.startsWith('!whois ') && isVerifiedStream) {
        const target = message.split(' ')[1]?.replace('@', '');
        if (target) {
            try {
                const summary = await userMemory.generateUserSummary(target);
                client.say(channel, `📋 @${target}: ${summary}`);
            } catch (err) {
                logger.error('Error in !whois:', err.message);
            }
        }
        return;
    }

    if (msg === '!topchatters' && isVerifiedStream) {
        try {
            const top = await userMemory.getTopChatters(channel, 24, 5); // Keep original parameters for now, diff had (5)
            if (top.length === 0) {
                client.say(channel, `📊 No chat data yet for today!`);
            } else {
                const list = top.map((c, i) => `${i + 1}. @${c.username} (${c.msg_count})`).join(' | ');
                client.say(channel, `🏆 Top chatters today: ${list}`);
            }
        } catch (err) {
            logger.error('Error in !topchatters:', err.message);
        }
        return;
    }




    // 3. Mod / Owner Commands

    // --- Mod Intelligence Commands ---

    if (msg === '!chatreport' && isMod) {
        if (!isPremium) return; // AI guardrail — Premium channels only
        const health = await modIntel.getChatHealth(channel);
        if (health) {
            client.say(channel, `🛡️ Chat Report: Mood=${health.mood} (${health.energy}% Energy, ${health.toxicity}% Toxicity) | Activity=${health.messagesLastHour} msgs by ${health.activeChatters} users (Last Hour)`);
        } else {
            client.say(channel, `⚠️ Failed to generate report.`);
        }
        return;
    }

    if (msg.startsWith('!userreport ') && isMod) {
        if (!isPremium) return; // AI guardrail — Premium channels only
        const target = message.split(' ')[1]?.replace('@', '');
        if (target) {
            client.say(channel, `🔍 Analyzing ${target}... specific report generating... standby...`);
            const report = await modIntel.generateUserReport(target);
            // It might be long, so maybe split or categorize
            // For Twitch limit comfort, maybe keep it short in prompt or split here
            // But prompt asked for "brief", so likely okay.
            client.say(channel, `📋 Report on @${target}: ${report}`);
        }
        return;
    }


    // --- Dev Service Promotion Commands ---
    if (['!build', '!agents'].includes(msg)) {
        let promo = "Yo cuhz, if you want your own custom Twitch bot, home assistant, or a full AI development team, let @planetcuhz know right here in the stream! 🚀";

        if (cleanChannel === 'planetcuhz') promo = "Looking to level up your brand with a custom bot or AI team? Let @planetcuhz know — they're in the chat! 🌌";
        if (cleanChannel === 'rico2ez') promo = "Yo cuhz, if you want your own custom Twitch bot, home assistant, or a full AI development team, let @planetcuhz know right here in the stream! 🚀";

        client.say(channel, promo);
        return;
    }

    // Mood Detection Commands
    if (msg === '!mood' && isMod) {
        if (!config.enableMoodDetection) {
            client.say(channel, `📊 Mood detection is currently disabled.`);
        } else {
            const moodState = moodTracker.getMoodState(channel);
            client.say(channel, `📊 Current mood: ${moodState.currentMood} | Energy: ${moodState.energy}/100 | Toxicity: ${moodState.toxicity}/100 | Personality: ${moodState.currentPersonality}`);
        }
        return;
    }

    if (msg.startsWith('!personality ') && isMod) {
        if (!config.enableMoodDetection) {
            client.say(channel, `🎭 Mood detection is disabled — personality changes are unavailable.`);
            return;
        }
        const mode = message.split(' ')[1]?.toLowerCase();
        if (moodTracker.setPersonality(channel, mode)) {
            client.say(channel, `🎭 Personality set to: ${mode}`);
        } else {
            client.say(channel, `❌ Invalid personality. Options: hype, chill, supportive, moderated, neutral`);
        }
        return;
    }

    if (msg === '!aistats' && tags.username === 'planetcuhz' && isVerifiedStream) {
        const s = aiService.getStats();
        const cacheStats = await contextHandler.getCacheStats();
        const eyes = `👁️${s.eyes.available ? '✅' : '❌'}(${s.eyes.failures})`;
        const brain = `🧠${s.brain.available ? '✅' : '❌'}(${s.brain.failures})`;
        const hands = `🔧${s.hands.available ? '✅' : '❌'}(${s.hands.failures})`;
        client.say(channel, `🤖 Tri-Brain: ${eyes} ${brain} ${hands} | ${s.requestsThisMinute}/${s.maxRequestsPerMinute} req/min | Cache: ${cacheStats.active_entries}`);
        return;
    }

    // --- Points & Economy Commands ---
    if (msg === '!points' || msg === '!balance') {
        const balance = await pointsService.getBalance(tags.username);
        sendMessage(channel, `💰 @${tags.username} you got ${balance} CUHZ points in the bank`);
        return;
    }

    // !watchtime — all tiers. Aggregate watch minutes across every CUHZ channel,
    // accrued alongside presence points (passive paycheck) in handleMessage.
    if (msg === '!watchtime') {
        try {
            const profile = await userMemory.getProfile(tags.username);
            const mins = profile && profile.total_watch_minutes ? profile.total_watch_minutes : 0;
            if (mins > 0) {
                const hours = Math.floor(mins / 60);
                const minutes = mins % 60;
                sendMessage(channel, `@${tags.username} has watched for ${hours}h ${minutes}m across the CUHZ fam 💎`);
            } else {
                sendMessage(channel, `@${tags.username} just started tracking! Hang out in chat and your watch time stacks up 💎`);
            }
        } catch (err) {
            logger.error('Error in !watchtime:', err.message);
        }
        return;
    }

    // !weekly — 7-day points leaderboard (service existed, was never wired to a command)
    if (msg === '!weekly') {
        const top = await pointsService.getWeeklyTop(5);
        if (top.length === 0) {
            sendMessage(channel, `📊 No points earned this week yet — get chatting cuhz!`);
        } else {
            const list = top.map((r, i) => `${i + 1}. ${r.username} (${r.points})`).join(' | ');
            sendMessage(channel, `🏆 This week's grind: ${list} 💎`);
        }
        return;
    }

    if (msg === '!richlist' || msg === '!top') {
        const weeklyTop = await pointsService.getWeeklyTop(5);
        if (weeklyTop.length === 0) {
            sendMessage(channel, "🏆 No weekly leaderboard data yet — keep chattin' cuhz 💎");
        } else {
            const list = weeklyTop.map((u, i) => `${i + 1}. ${u.username} (${u.points})`).join(' | ');
            sendMessage(channel, `🏆 Top cuhz this week: ${list}`);
        }
        return;
    }

    if (msg.startsWith('!give ') && isMod) {
        const args = message.split(' ');
        const target = args[1]?.replace('@', '');
        const amount = parseInt(args[2]);

        if (target && !isNaN(amount)) {
            await pointsService.addPoints(target, amount, `admin_grant_by_${tags.username}`);
            client.say(channel, `💸 @${tags.username} gave ${amount} points to @${target}!`);
        }
        return;
    }

    if (msg.startsWith('!gamble ')) {
        if (!isProOrPremium) return; // advertised as Pro/Premium only
        // 30s per-user cooldown — every gamble is 2 chat lines; no casino spam
        const gKey = `gamble:${tags.username.toLowerCase()}`;
        const gLast = _gambleCooldowns.get(gKey) || 0;
        if (Date.now() - gLast < 30000) return;
        _gambleCooldowns.set(gKey, Date.now());
        const args = message.split(' ');
        const amount = parseInt(args[1]);

        if (isNaN(amount) || amount <= 0) {
            client.say(channel, `Usage: !gamble <amount>`);
            return;
        }

        const balance = await pointsService.getBalance(tags.username);
        if (balance < amount) {
            client.say(channel, `🚫 You're broke cuhz! You only have ${balance} points.`);
            return;
        }

        const win = Math.random() < 0.5;
        if (win) {
            await pointsService.addPoints(tags.username, amount, 'gamble_win');
            client.say(channel, `🎰 WINNER! @${tags.username} doubled up to ${balance + amount} points! 🟢`);
        } else {
            await pointsService.deductPoints(tags.username, amount, 'gamble_loss');
            client.say(channel, `🎰 RIP @${tags.username}... you lost ${amount} points. 🔴`);
        }
        return;
    }

    // --- Tri-Brain Direct Commands (Gated by Economy) ---
    // !ask generic -> Gemini (10 pts)
    // !ask -brain -> Claude (50 pts)
    if (msg.startsWith('!ask ') && isVerifiedStream) {
        let question = message.substring(5).trim();
        let cost = 10;
        let brain = 'eyes'; // Default Gemini
        let brainName = 'The Eyes (Gemini)';

        if (question.startsWith('-brain')) {
            brain = 'brain'; // Claude
            brainName = 'The Brain (Claude)';
            cost = 50;
            question = question.substring(6).trim();
        }

        if (question) {
            const success = await pointsService.deductPoints(tags.username, cost, `ask_${brain}`);
            if (!success) {
                const balance = await pointsService.getBalance(tags.username);
                client.say(channel, `🚫 Broke User Alert: You need ${cost} points for ${brainName} but only have ${balance}. Chat more to earn!`);
                return;
            }

            try {
                const reply = await aiService.askBrain(brain, question, tags.username);
                const prefix = brain === 'brain' ? '🧠' : '👁️';
                client.say(channel, `${prefix} ${reply}`);
            } catch (err) {
                logger.error('Error in !ask:', err.message);
                // Refund on error? Maybe later.
            }
        }
        return;
    }

    if (msg.startsWith('!code ') && isVerifiedStream) {
        const query = message.substring(6).trim();
        const cost = 25;

        if (query) {
            const success = await pointsService.deductPoints(tags.username, cost, 'ask_hands');
            if (!success) {
                const balance = await pointsService.getBalance(tags.username);
                client.say(channel, `🚫 You need ${cost} points for The Hands (Code) but only have ${balance}.`);
                return;
            }

            try {
                const reply = await aiService.askBrain('hands', query, tags.username);
                client.say(channel, `💻 ${reply}`);
            } catch (err) {
                logger.error('Error in !code:', err.message);
            }
        }
        return;
    }


    if (msg.startsWith('!announce ') && isMod) {
        const announcement = message.substring(10);
        client.say(channel, `/announce ${announcement}`);
        return;
    }

    if (msg.startsWith('!raid ') && isMod) {
        // Loose-parse first @username-like token, same pattern as !so.
        const match = message.match(/@?([A-Za-z0-9_]{3,25})/g);
        const rawTarget = match && match.length >= 2 ? match[1] : null; // [0] is "raid"
        if (!rawTarget) return;
        const target = rawTarget.replace('@', '').toLowerCase();
        // Fire farewell template first (goes through the send queue so the /raid
        // command that follows is spaced ≥1.5s after — no Twitch rate-limit blowup).
        const farewell = pickNoRepeat(`raid:${cleanChannel}`, RAID_FAREWELLS, 2).replace('{target}', target);
        sendMessage(channel, farewell);
        sendMessage(channel, `/raid ${target}`);
        return;
    }

    if (msg.startsWith('!so')) {
        // Mod + broadcaster only — silently drop for everyone else.
        if (!isMod) return;
        // Loose-parse: grab the first @username-like token, ignore trailing context
        // (e.g. "!so @four_a_reason [raiding in from NBA 2K26]").
        const match = message.match(/@?([A-Za-z0-9_]{3,25})/g);
        const rawTarget = match && match.length >= 2 ? match[1] : null; // [0] is "so"
        if (!rawTarget) return;
        const cleanTarget = rawTarget.replace('@', '').toLowerCase();
        const hypeLines = [
            `CUHZ fam supports CUHZ fam 💎`,
            `Go pull up — tell 'em cuhz sent you 🌌`,
            `Frequency tuned, show 'em love ⚡`,
            `Real ones support real ones 🔥`,
            `They been cookin' — go see for yourself 🚀`,
            `Planet CUHZ in the building 🌌`
        ];
        const hype = hypeLines[Math.floor(Math.random() * hypeLines.length)];
        sendMessage(channel, `🚀 Go show @${cleanTarget} some love → twitch.tv/${cleanTarget}   ${hype}`);
        return;
    }

    if (msg.startsWith('!title ') && isMod) {
        const newTitle = message.substring(7).trim();
        const user = await getTwitchUser(channel.replace('#', ''));
        if (user && newTitle) {
            const success = await updateChannelInfo(user.id, { title: newTitle });
            if (success) client.say(channel, `✅ Stream title updated to: ${newTitle}`);
            else client.say(channel, `❌ Failed to update title. Check bot perks.`);
        }
        return;
    }

    if (msg.startsWith('!game ') && isMod) {
        const gameName = message.substring(6).trim();
        const user = await getTwitchUser(channel.replace('#', ''));
        const gameId = await getGameId(gameName);
        if (user && gameId) {
            const success = await updateChannelInfo(user.id, { game_id: gameId });
            if (success) client.say(channel, `🎮 Category updated to: ${gameName}`);
            else client.say(channel, `❌ Failed to update category.`);
        } else if (gameName && !gameId) {
            client.say(channel, `❌ Could not find game: ${gameName}`);
        }
        return;
    }

    if (msg === '!botcheck' && isMod) {
        const validation = await validateToken();
        if (validation) {
            const hasFollowerScope = (validation.scopes || []).includes('moderator:read:followers');
            const hasBroadcastScope = (validation.scopes || []).includes('channel:manage:broadcast');
            client.say(channel, `🤖 Status: LIVE | Scopes: ${validation.scopes.length} | Followage Fix: ${hasFollowerScope ? '✅' : '❌'} | Title/Game: ${hasBroadcastScope ? '✅' : '❌'}`);
        } else {
            client.say(channel, `❌ Token invalid or expired.`);
        }
        return;
    }

    if (msg.startsWith('!refresh') && isMod) {
        client.say(channel, `🔄 Refreshing persona from dashboard...`);
        await fetchChannelPersona(channel);
        client.say(channel, `✅ Persona reloaded!`);
        return;
    }



    // Auto-shoutout management commands (Pro/Premium only)
    if (msg.startsWith('!addstreamer ') && isMod && isProOrPremium) {
        const streamerName = message.split(' ')[1]?.replace('@', '').toLowerCase();
        if (streamerName) {
            try {
                await db.prepare(`
                    INSERT INTO streamer_shoutouts (channel, streamer_username, is_active)
                    VALUES (?, ?, 1)
                    ON CONFLICT(channel, streamer_username) DO UPDATE SET is_active = 1
                `).run(channel, streamerName);
                client.say(channel, `✅ @${streamerName} added to auto-shoutout list!`);
                logger.info(`Added ${streamerName} to auto-shoutout list for ${channel}`);
            } catch (err) {
                logger.error('Error adding streamer:', err.message);
            }
        }
        return;
    }

    if (msg.startsWith('!removestreamer ') && isMod && isProOrPremium) {
        const streamerName = message.split(' ')[1]?.replace('@', '').toLowerCase();
        if (streamerName) {
            try {
                await db.prepare(`
                    UPDATE streamer_shoutouts 
                    SET is_active = 0 
                    WHERE channel = ? AND streamer_username = ?
                `).run(channel, streamerName);
                client.say(channel, `❌ @${streamerName} removed from auto-shoutout list.`);
                logger.info(`Removed ${streamerName} from auto-shoutout list for ${channel}`);
            } catch (err) {
                logger.error('Error removing streamer:', err.message);
            }
        }
        return;
    }

    if (msg === '!liststreamers' && isMod && isProOrPremium) {
        try {
            const streamers = await db.prepare(`
                SELECT streamer_username, shoutout_count 
                FROM streamer_shoutouts 
                WHERE channel = ? AND is_active = 1
                ORDER BY streamer_username
            `).all(channel);

            if (streamers.length === 0) {
                client.say(channel, '📊 No streamers in auto-shoutout list.');
            } else {
                const list = streamers.map(s => `@${s.streamer_username} (${s.shoutout_count})`).join(', ');
                client.say(channel, `🎬 Auto-shoutout list: ${list}`);
            }
        } catch (err) {
            logger.error('Error listing streamers:', err.message);
        }
        return;
    }

    if (msg.startsWith('!ban ') && isMod) {
        const target = message.split(' ')[1];
        if (target) client.say(channel, `/ban ${target}`);
        return;
    }

    if (msg.startsWith('!timeout ') && isMod) {
        const parts = message.split(' ');
        const target = parts[1];
        const duration = parts[2] || 600;
        if (target) client.say(channel, `/timeout ${target} ${duration}`);
        return;
    }

    if (msg === '!clear' && isMod) {
        client.say(channel, '/clear');
        return;
    }

    if (msg.startsWith('!slow ') && isMod) {
        const seconds = message.split(' ')[1] || 10;
        client.say(channel, `/slow ${seconds}`);
        return;
    }

    if (msg === '!slowoff' && isMod) {
        client.say(channel, '/slowoff');
        return;
    }

    if (msg.startsWith('!unban ') && isMod) {
        const target = message.split(' ')[1];
        if (target) client.say(channel, `/unban ${target}`);
        return;
    }

    if (msg.startsWith('!untimeout ') && isMod) {
        const target = message.split(' ')[1];
        if (target) client.say(channel, `/untimeout ${target}`);
        return;
    }

    // Warriors command removed per user request

    if (msg === '!status' && tags.username === 'planetcuhz') {
        const state = streamStates.get(streamKey(channel));
        const liveStatus = state ? (state.isLive ? 'LIVE 🔴' : 'OFFLINE ⚫') : 'UNKNOWN ⚪';
        client.say(channel, `✅ Bot Online. Stream: ${liveStatus}. Ver: Non-Crypto v1.2 (Smart Mode)`);
        return;
    }

    // 4. Webhook Forwarding
    // Never attempt when unset/empty; circuit breaker stops the 400-spam
    // (124 errors/6h in production) after 5 consecutive failures.
    if (config.webhookUrl && String(config.webhookUrl).trim() !== '' && Date.now() >= _webhookPausedUntil) {
        try {
            await axios.post(config.webhookUrl, {
                platform: 'twitch',
                channel: channel.replace('#', ''),
                user: tags.username,
                message: message,
                timestamp: new Date().toISOString()
            }, {
                headers: { 'Authorization': `Bearer ${config.webhookToken}` },
                timeout: 5000
            });
            _webhookConsecutiveFailures = 0; // healthy again
        } catch (error) {
            _webhookConsecutiveFailures++;

            // Log the response body at most once per hour (not on every failure).
            const now = Date.now();
            if (now - _webhookLastErrorLogAt >= WEBHOOK_ERROR_LOG_INTERVAL_MS) {
                _webhookLastErrorLogAt = now;
                const body = error.response?.data !== undefined ? ` | response body: ${JSON.stringify(error.response.data)}` : '';
                logger.error(`Webhook error: ${error.message}${body} (consecutive failures: ${_webhookConsecutiveFailures}; further webhook errors muted for 1h)`);
            }

            // Circuit breaker: 5 consecutive failures → pause for 30 minutes.
            if (_webhookConsecutiveFailures >= WEBHOOK_FAILURE_THRESHOLD) {
                _webhookPausedUntil = now + WEBHOOK_PAUSE_MS;
                _webhookConsecutiveFailures = 0;
                logger.warn(`🔌 Webhooks paused for 30 minutes after ${WEBHOOK_FAILURE_THRESHOLD} consecutive failures`);
            }
        }
    }
}

// --- Express Setup ---
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

function verifyDashboardRequest(req, res, next) {
    // Simple verification - enhance as needed
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${config.botApiSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

app.post('/send-message', verifyDashboardRequest, (req, res) => {
    const { channel, message } = req.body;
    if (!client) return res.status(503).json({ error: 'Bot not connected' });

    const target = channel.startsWith('#') ? channel : `#${channel}`;
    client.say(target, message)
        .then(() => res.json({ status: 'success' }))
        .catch(err => res.status(500).json({ error: err.message }));
});

app.post('/join-channel', verifyDashboardRequest, async (req, res) => {
    const { channel } = req.body;
    if (!client) return res.status(503).json({ error: 'Bot not connected' });

    try {
        await client.join(channel.startsWith('#') ? channel : `#${channel}`);
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/leave-channel', verifyDashboardRequest, async (req, res) => {
    const { channel } = req.body;
    if (!client) return res.status(503).json({ error: 'Bot not connected' });

    try {
        const target = channel.startsWith('#') ? channel : `#${channel}`;
        await client.part(target);
        connectedChannels.delete(target);
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Public healthcheck — minimal on purpose. The old payload leaked 500 log
// entries (chat content + usernames) and full stream state to anyone.
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        connected: client ? client.readyState() === 'OPEN' : false
    });
});

// Rich diagnostics moved behind dashboard auth.
app.get('/health/full', verifyDashboardRequest, (req, res) => {
    res.json({
        status: 'ok',
        connected: client ? client.readyState() === 'OPEN' : false,
        channels: Array.from(connectedChannels),
        streamStates: Object.fromEntries(streamStates),
        startTime: startTime.toISOString(),
        logs: logger.getLogs()
    });
});

app.get('/api/system-status', (req, res) => {
    res.json({
        tiers: CHANNEL_TIERS,
        ai: {
            gemini: !!process.env.GEMINI_API_KEY,
            claude: !!process.env.ANTHROPIC_API_KEY,
            qwen: !!process.env.GROQ_API_KEY,
            contextAware: config.enableContextAware
        }
    });
});

app.get('/', (req, res) => {
    try {
        const templatePath = path.join(__dirname, 'dashboard.html');
        const html = fs.readFileSync(templatePath, 'utf8');
        res.send(html);
    } catch (err) {
        res.status(500).send('Dashboard template missing.');
    }
});

app.listen(config.port, () => {
    logger.info(`Bot API listening on port ${config.port}`);
    initializeTwitchClient();
});
