const tmi = require('tmi.js');
const express = require('express');
const axios = require('axios');
const config = require('./config');
const { sanitizeChannel, normalizeChannels } = require('./channel_identity');
const { createSharedChatGuard } = require('./shared_chat_guard');
const sharedChatGuard = createSharedChatGuard();
const logger = require('./logger');
const { calendarDiff, formatDuration, formatMinutes } = require('./duration');
const db = require('./database');
const aiService = require('./ai_service');
const moodTracker = require('./mood_tracker');
const contextHandler = require('./context_handler');
const userMemory = require('./user_memory');
const pointsService = require('./points_service');
const loyaltySystem = require('./loyalty');
const modIntel = require('./mod_intel');
const moderation = require('./moderation_service');
const fs = require('fs');
const path = require('path');
const streakService = require('./streak_service');

// ============================================================================
// THE CUHZ LAB — chat-controlled lounge (Lane K). Subscribers steer the lounge
// on stream through CUHZ Bot; operators get a menu. The state machine is
// src/lounge_control.js and the menu is src/lounge_menu.js — both PURE modules
// with zero requires, which is what makes "this never touches points" provable.
// This block in bot.js only: reads tags, forwards text, prints replies, serves
// a read-only JSON route. Nothing here imports the database or points service.
//
// Numeric IDs only, hardcoded on purpose: the isolated boot harness freezes
// process.env to {}, so an env-read operator list would silently become
// "nobody" under test. A Twitch user id is public, not a secret.
//
// Verified against Twitch's public GQL on 2026-09-17:
//   four_a_reason 952381011 · planetcuhz 1293717308 · cuhz_bot room 175727753
//
// PHOENIX IS DELIBERATELY ABSENT until the owner confirms which account is hers.
// Two accounts exist:  phoenixnyc = 757210754 (created 2021-12, default avatar)
//                      phoenixpnyc = 823707557 (created 2022-09) — what earlier docs assumed.
// A wrong guess hands the remote to a stranger or locks out the real person, and
// an id gate that fails open is worse than one that fails closed. One line to add.
// ============================================================================
const { createLoungeControl, HOUSE: LOUNGE_HOUSE, PALETTES: LOUNGE_PALETTES } = require('./lounge_control');
const { parseLab: parseLabCommand, renderMenu: renderLabMenu } = require('./lounge_menu');

// Base list is hardcoded for the reason the K1 spec gives: the isolated boot
// harness freezes process.env to {}, so an env-ONLY gate silently becomes
// "nobody" in every test run. Env is therefore ADDITIVE, never the whole list —
// tests stay deterministic on the base while production can add an operator
// without a code change or a redeploy of code.
//
// To give Phoenix control: have her type `!lounge whoami` in chat, read her
// numeric id out of the bot's reply, then set on Railway:
//     LOUNGE_OPERATOR_EXTRA_IDS=<her id>
// (comma-separated for several). Non-numeric entries are dropped silently.
// Owner decision 2026-09-18: ONLY planetcuhz and Phoenix. four_a_reason removed
// from the base (he can be re-added through LOUNGE_OPERATOR_EXTRA_IDS in seconds).
const LOUNGE_OPERATOR_BASE_IDS = Object.freeze(['1293717308']);
const LOUNGE_OPERATOR_IDS = Object.freeze([
    ...LOUNGE_OPERATOR_BASE_IDS,
    ...String(process.env.LOUNGE_OPERATOR_EXTRA_IDS || '')
        .split(',').map(x => x.trim()).filter(x => /^\d{1,12}$/.test(x)),
]);
// login -> room-id for the channels where the lounge is on. Identity is the
// room-id from tags; the login is only the public URL surface of the endpoint.
const LOUNGE_ROOMS = Object.freeze({ cuhz_bot: '175727753' });
const LOUNGE_ROOM_IDS = new Set(Object.values(LOUNGE_ROOMS));
const LOUNGE_CARD_COUNT = 5;                 // lab.js loads five artworks; the 15 names are those five re-tilted
const LOUNGE_REPLY_BUDGET = 4;               // lounge lines per channel per minute, then silent drops
const LOUNGE_INTENT_RE = /^!(lounge|lab)(\s|$)|^!(vibe|color|zoom|card|glow)\s/;

// Who may steer (declared BEFORE the constructor that reads it — TDZ). Default 'operators' = only the operator list. Set
// LOUNGE_ACCESS=subscribers on Railway to open the safe subset to subs later.
const LOUNGE_ACCESS = process.env.LOUNGE_ACCESS === 'subscribers' ? 'subscribers' : 'operators';
const loungeControl = createLoungeControl({ operatorIds: LOUNGE_OPERATOR_IDS, cardCount: LOUNGE_CARD_COUNT, access: LOUNGE_ACCESS });
const loungeEnabled = () => process.env.LOUNGE_ENABLED !== 'false';   // kill switch; default on

// ============================================================================
// FIRST-TIMER ALERTS — a Discord ping the moment a brand-new human talks.
//
// "Brand new" means NEVER SEEN BEFORE ANYWHERE, read from the database, not the
// in-memory welcome map. That distinction is the whole design: `_channelWelcomes`
// is wiped on every restart, so keying off it would re-alert the entire regular
// chat after each deploy. `user_profiles.total_messages` starts at 1 on the
// first INSERT and only ever climbs, so the row itself is the dedup and it
// survives redeploys for free.
//
// Inert unless DISCORD_ALERT_WEBHOOK_URL is set — no webhook, no alerts, no code
// path taken. Failures are swallowed: an alert must never break chat handling.
// ============================================================================
const DISCORD_ALERT_WEBHOOK = (process.env.DISCORD_ALERT_WEBHOOK_URL || '').trim();
const FIRST_TIMER_WINDOW_MS = 10 * 60 * 1000;
const FIRST_TIMER_MAX_PER_WINDOW = 8;   // a raid shouldn't become 40 phone buzzes
const _firstTimerSeen = new Set();      // race guard within a single boot
let _firstTimerHits = [];               // timestamps inside the window
let _firstTimerSuppressed = 0;
let _alertFailures = 0;
let _alertPausedUntil = 0;

/** True only for a genuinely new human. Safe under the recordMessage race:
 *  a missing profile and a profile at 1 message both mean "first ever". */
async function isFirstTimeEver(login) {
    if (_firstTimerSeen.has(login)) return false;
    try {
        const profile = await userMemory.getProfile(login);
        return !profile || !Number.isFinite(profile.total_messages) || profile.total_messages <= 1;
    } catch (err) {
        return false;   // never guess "new" on a database error — that spams
    }
}

async function alertFirstTimer(channel, login, displayName, message) {
    if (!DISCORD_ALERT_WEBHOOK || Date.now() < _alertPausedUntil) return;
    const t = Date.now();
    _firstTimerHits = _firstTimerHits.filter(ms => t - ms < FIRST_TIMER_WINDOW_MS);
    if (_firstTimerHits.length >= FIRST_TIMER_MAX_PER_WINDOW) {
        _firstTimerSuppressed++;
        if (_firstTimerSuppressed === 1) {
            logger.info(`🔔 first-timer alerts throttled (>${FIRST_TIMER_MAX_PER_WINDOW}/10min) — likely a raid`);
        }
        return;
    }
    _firstTimerHits.push(t);
    const room = String(channel).replace('#', '');
    // Discord renders content as markdown, so anything a stranger typed is
    // fenced as inline code and length-capped. Their first message is the most
    // useful part of the alert and the least trustworthy string in it.
    const safe = String(message || '').replace(/`/g, "'").slice(0, 180);
    const extra = _firstTimerSuppressed ? ` _(+${_firstTimerSuppressed} more suppressed)_` : '';
    _firstTimerSuppressed = 0;
    try {
        await axios.post(DISCORD_ALERT_WEBHOOK, {
            username: 'CUHZ Bot — new face',
            content: `👋 **First time in chat:** \`${login}\` in **#${room}**\n> \`${safe}\`\n<https://twitch.tv/${room}>${extra}`,
            allowed_mentions: { parse: [] },   // a username must never ping @everyone
        }, { timeout: 5000 });
        _alertFailures = 0;
        logger.info(`🔔 first-timer alert sent for ${login} in ${room}`);
    } catch (err) {
        _alertFailures++;
        if (_alertFailures >= 5) {
            _alertPausedUntil = Date.now() + 30 * 60 * 1000;
            _alertFailures = 0;
            logger.error('🔔 first-timer alerts paused 30m after 5 consecutive failures');
        }
    }
}

const _loungeReplies = new Map();   // channel -> [sentAt] within the last minute
const _loungeLogins  = new Map();   // login -> user-id, learned from tags this session (for !lab mute <login>)
const _loungeState   = new Map();   // roomId -> { seq, bootId, json } — serialized once per change, not per poll
let _loungeHouseJson = null;

function loungeActor(tags) {
    const badges = (tags && tags.badges) || {};
    return {
        userId: tags && tags['user-id'],
        login: tags && tags.username,
        broadcaster: Object.hasOwn(badges, 'broadcaster'),
        moderator: !!(tags && tags.mod) || Object.hasOwn(badges, 'moderator'),
        // Read live from tags every time; founders are subscribers too.
        subscriber: !!(tags && tags.subscriber) || Object.hasOwn(badges, 'subscriber') || Object.hasOwn(badges, 'founder'),
    };
}

function loungeSay(channel, text) {
    const t = Date.now();
    const recent = (_loungeReplies.get(channel) || []).filter(ms => t - ms < 60000);
    if (recent.length >= LOUNGE_REPLY_BUDGET) return false;
    recent.push(t);
    _loungeReplies.set(channel, recent);
    sendMessage(channel, text);
    return true;
}

function loungeStateChanged(roomId) { _loungeState.delete(String(roomId)); }

function loungeStateJson(roomId) {
    const s = loungeControl.readState(roomId);
    let c = _loungeState.get(String(roomId));
    if (!c || c.seq !== s.seq || c.bootId !== s.bootId) {
        c = { seq: s.seq, bootId: s.bootId, json: JSON.stringify(s) };
        _loungeState.set(String(roomId), c);
    }
    return c.json;
}

// Unknown, disabled and non-allowlisted channels all get THIS payload, so the
// route cannot be used to enumerate which channels have the lounge on.
function loungeHouseJson() {
    if (!_loungeHouseJson) {
        const s = loungeControl.readState(LOUNGE_ROOMS.cuhz_bot);
        _loungeHouseJson = JSON.stringify({ ...s, seq: 0, updatedAtMs: 0, ...LOUNGE_HOUSE, locked: true, setByLogin: null });
    }
    return _loungeHouseJson;
}

function loungeReason(r, actor) {
    const at = actor.login ? `@${actor.login} ` : '';
    switch (r.reason) {
        case 'operators_only':      return `${at}the lounge is operator-controlled right now — !lounge shows what's on.`;
        case 'subscribers_only':    return `${at}the lounge remote is a sub perk 💎 — !lounge shows what's on.`;
        case 'locked':              return `${at}the lounge is locked right now.`;
        case 'your_turn_soon':      return `${at}one change per 10s — you're up in ${Math.ceil((r.retryInMs || 0) / 1000)}s.`;
        case 'channel_floor':
        case 'glow_floor':          return `${at}give it a second — the screen just changed.`;
        case 'cooling':             return `${at}chat's been busy, the lounge is cooling for a minute.`;
        case 'vibe_operator_only':  return `${at}turbo is operator-only. Try chill or hype.`;
        case 'intent_operator_only': return `${at}${r.intent} is an operator control. Subs get: vibe color zoom card glow depth thickness.`;
        case 'out_of_range':        return `${at}${r.intent} is out of range — !lounge art for the limits.`;
        case 'bad_number':          return `${at}${r.intent} takes a number, or "auto" to follow the vibe.`;
        case 'bad_switch':          return `${at}on or off.`;
        case 'color_operator_only': return `${at}that color is operator-only — !lounge colors`;
        case 'muted':               return `${at}you can't change the lounge right now.`;
        case 'bad_vibe':            return `${at}vibes: chill, hype.`;
        case 'bad_color':           return `${at}!lounge colors for the list.`;
        case 'bad_zoom':            return `${at}zoom in, out or reset.`;
        case 'bad_glow':            return `${at}glow on or off.`;
        case 'bad_card':            return `${at}card 1–${LOUNGE_CARD_COUNT}.`;
        default:                    return `${at}!lounge vibe|color|zoom|card|glow|reset`;
    }
}

function describeLoungeState(s) {
    // Only mention a fine control when it is actually overriding the vibe preset,
    // so the common line stays short and a custom look is visibly custom.
    const fine = ['depth', 'thickness', 'rotation', 'position', 'speed', 'tilt']
        .filter(k => s[k] !== null && s[k] !== undefined).map(k => `${k} ${s[k]}`);
    return `${s.vibe} · ${s.palette} · card ${s.card} · zoom ${s.zoom} · glow ${s.glow ? 'on' : 'off'}`
        + (s.shadow ? ' · shadow' : '') + (s.frozen ? ' · FROZEN' : '')
        + (fine.length ? ` · ${fine.join(' · ')}` : '')
        + (s.locked ? ' · locked' : '') + (s.setByLogin ? ` · set by @${s.setByLogin}` : '');
}

// Returns true when the message was a lounge message (handled or deliberately
// silenced), false when it is not ours and must fall through untouched.
function handleLoungeIntent(channel, roomId, actor, message) {
    const r = loungeControl.applyIntent(roomId, actor, message);
    if (r === null) return false;
    switch (r.status) {
        case 'status':
            loungeSay(channel, `🛋️ Lounge: ${describeLoungeState(r.state)}`
                + (r.role === 'viewer' && LOUNGE_ACCESS === 'subscribers' ? ' — subs steer it: !lounge vibe hype' : ''));
            return true;
        case 'colors':
            loungeSay(channel, `🎨 Colors: ${r.palettes.join(' ')} — !lounge color <name>`);
            return true;
        case 'whoami':
            // Public data (it is in every message tag), and only ever the asker's own.
            // This is how the owner confirms an operator's real id without guessing
            // between similar logins.
            loungeSay(channel, `🪪 @${actor.login} — Twitch id ${r.userId} · role ${r.role}`);
            return true;
        case 'applied':
            loungeStateChanged(roomId);
            // Visual changes are answered by the screen itself (the badge names the
            // setter). Only the lock, which changes nothing visible, gets a line.
            if (r.intent === 'lock')   loungeSay(channel, '🔒 Lounge locked — chat control paused.');
            if (r.intent === 'unlock') loungeSay(channel, '🔓 Lounge unlocked — subs can steer again.');
            return true;
        case 'rejected':
            if (!r.quiet) loungeSay(channel, loungeReason(r, actor));
            return true;
        default:                       // cosigned / silent / ignored — quiet by design
            return true;
    }
}

function handleLabMenu(channel, roomId, actor, lab) {
    // Non-operators get silence and one audit line: a refusal confirms a gated
    // surface exists and invites probing. !lab is never advertised.
    if (loungeControl.roleOf(actor) !== 'operator') {
        logger.info(`🧪 !lab ignored from ${actor.login || actor.userId} in ${channel}`);
        return true;
    }
    if (lab.kind === 'menu')    { loungeSay(channel, renderLabMenu(lab.page)); return true; }
    if (lab.kind === 'unknown') { loungeSay(channel, '🧪 Not a lab entry — !lab for the menu.'); return true; }
    if (lab.kind === 'command') return handleLoungeIntent(channel, roomId, actor, lab.cmd);
    switch (lab.action) {
        case 'badge_on':
        case 'badge_off': {
            const on = lab.action === 'badge_on';
            loungeControl.setBadge(roomId, on);
            loungeStateChanged(roomId);
            loungeSay(channel, `🧪 Badge ${on ? 'on' : 'off'}.`);
            return true;
        }
        case 'house_set':
            // The one action with a mandatory confirm: it is the only change to
            // persistent-within-session state. Everything else is one !lounge reset away.
            if (lab.arg !== 'confirm') {
                loungeSay(channel, '🧪 This makes the current look the house default. Say: !lab house set confirm');
                return true;
            }
            loungeControl.setHouse(roomId, actor);
            loungeSay(channel, '🧪 House look saved — !lounge reset brings it back.');
            return true;
        case 'ops':
            loungeSay(channel, `🧪 Access: ${LOUNGE_ACCESS} · Operators: ${LOUNGE_OPERATOR_IDS.join(' ')}`
                + (LOUNGE_OPERATOR_IDS.length > LOUNGE_OPERATOR_BASE_IDS.length ? ' (incl. LOUNGE_OPERATOR_EXTRA_IDS)' : ''));
            return true;
        case 'house_show':
            loungeSay(channel, `🧪 On screen now: ${describeLoungeState(loungeControl.readState(roomId))}`);
            return true;
        case 'queue': {
            const rows = loungeControl.auditOf(roomId).slice(-6)
                .map(e => `${e.login || e.actor}: ${e.intent}${e.value != null ? ' ' + e.value : ''} → ${e.decision}`);
            loungeSay(channel, rows.length ? `🧪 Last: ${rows.join(' · ')}` : '🧪 Nothing yet this session.');
            return true;
        }
        case 'mute':
        case 'unmute': {
            const login = String(lab.arg || '').replace(/^@/, '').toLowerCase();
            const id = _loungeLogins.get(login);
            if (!id) { loungeSay(channel, `🧪 Haven't seen @${login} talk this session — need a message from them first.`); return true; }
            loungeControl.mute(roomId, actor, id, lab.action === 'mute');
            loungeSay(channel, `🧪 @${login} ${lab.action === 'mute' ? 'can no longer' : 'can'} change the lounge.`);
            return true;
        }
        default:
            return true;
    }
}
// Only Twitch USERNOTICE events populate the channel-scoped streak tracker.
const streakTracker = streakService.createTracker();

// --- Tier System Definition ---
// Canonical access list. Keys MUST be lowercase — lookups do `.toLowerCase()`
// on the channel name before indexing this map. Any channel not listed falls
// through to TIERS.BASIC by default (see the `|| TIERS.BASIC` guard in
// handleMessage), but listing explicitly here makes intent clear.
//
// SOLD PLAN → INTERNAL TIER MAPPING (ladder v2, owner-locked 2026-08-06).
// These tier keys are INTERNAL ONLY and must never appear in customer-facing
// chat copy — the public ladder uses different names on purpose ("Pro" collides
// with the planetcuhz.com site membership, so bot chat never sells a "Pro"):
//
//   Free     $0        → TIERS.BASIC    (bot, moderation, points, shoutouts)
//   Silver   $4.99/mo  → TIERS.PRO      (socials rotation, isPP command set)
//   Gold     $14.99/mo → TIERS.PREMIUM  (unlimited chat AI + site Pro included)
//   Partner  $49.99/mo → its OWN managed bot instance, not a row in this map
//                        (own brand/name/avatar, hosted + run for them)
//   Architect custom   → built-to-own custom bot, quoted per build
//
// Provisioning is MANUAL today: on a sale the owner tells an agent
// "add <channel> silver/gold" and the channel gets added/edited here, then the
// bot redeploys. There is no self-serve entitlement engine yet — do not write
// copy anywhere that implies instant automated upgrade.
const TIERS = { BASIC: 'basic', PRO: 'pro', PREMIUM: 'premium' };
const CHANNEL_TIERS = {
    'four_a_reason':         TIERS.PREMIUM,
    'rico2ez':               TIERS.PREMIUM,
    'planetcuhz':            TIERS.PREMIUM,
    'cuhz_bot':              TIERS.PREMIUM, // the bot's own stream
    'thatgirlmahni_':        TIERS.BASIC,
    'stormygirlnz89':        TIERS.BASIC,
    'razredg1':              TIERS.BASIC,
    'snowy_wolfies_ttv':     TIERS.BASIC,
    'ohthatztayy':           TIERS.BASIC,
    'grouch392':             TIERS.BASIC,
    'westsiderelly':         TIERS.BASIC  // added live 2026-08-06 — joined from four_a_reason's stream
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

// Known bot accounts from OTHER channels' toolchains (plus self as belt-and-
// suspenders — our own messages are already dropped by the `self` check in
// handleMessage). These must never earn points, accrue watch minutes, or get
// auto-welcomed: in production they earned 13/85 points in #thatgirlmahni_.
const KNOWN_BOTS = new Set([
    'nightbot', 'wizebot', 'streamelements', 'moobot',
    'fossabot', 'soundalerts', 'sery_bot', 'cuhz_bot'
]);

// Join verification state: the target list is captured at init and compared
// against client.getChannels() ~60s after connect (the old per-channel
// dashboard POST /api/bot/verify 4xx'd in production and never detected
// missing joins anyway). Missing channels are retried with backoff.
let targetChannels = [];
const JOIN_RETRY_DELAYS_MS = [30000, 60000, 120000];

// Persona-fetch log hygiene: each channel's failure is logged once at startup,
// then identical repeats are suppressed to at most once/hour per channel.
// _personaSource feeds the one-line startup summary.
const _personaSource = new Map();   // channel -> 'dashboard' | 'defaults'
const _personaErrorLog = new Map(); // channel -> { msg: string, at: epoch ms }
const PERSONA_ERROR_LOG_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let _personaSummaryLogged = false;

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

// Passive paycheck tuning: a viewer is "still here" if their previous message
// was within PRESENCE_GAP_MS; they get paid at most once per PAYCHECK_INTERVAL_MS.
const PRESENCE_GAP_MS = 15 * 60 * 1000;
const PAYCHECK_INTERVAL_MS = 10 * 60 * 1000;

// Per-user !gamble cooldown timestamps
const _gambleCooldowns = new Map();

/**
 * The command list handed to the AI. persona.commands alone covers only
 * PUBLIC_COMMANDS + dashboard commands — it never included the shoutout pools,
 * so when chat asked "what's @someone's command?" the AI had no data and
 * invented one (it once told chat @imkxddy's command was !kuddy, which did not
 * exist). This merges in every registered pool command so the AI can only name
 * real ones.
 */
function buildAiCommandList(personaCommands) {
    const merged = { ...(personaCommands || {}) };
    for (const cmd of Object.keys(USER_VARIANT_POOLS)) {
        if (!merged[cmd]) merged[cmd] = 'personal shoutout command';
    }
    return merged;
}

// --- Content Data (Non-Crypto) ---

// CUHZ Points reward tiers — SINGLE SOURCE OF TRUTH (same pattern as PG_COMMANDS).
// Edit a tier here and it updates !rewards in chat AND GET /api/rewards, which is
// what planetcuhz.com renders.
// `note` is detail for the website; `name` is the short label chat prints.
// Declared ABOVE PUBLIC_COMMANDS so no module-level literal can hit it in the TDZ.
//
// FIRST-PARTY ONLY (CUHZ_POINTS_ECONOMY.md Rev 2, §2–§3 — non-negotiable):
// CUHZ Bot is a GUEST in 8 channels it does not own, so no tier may depend on a
// host streamer's labor or channel privileges. The retired ladder (Shoutout /
// Pick next game / VIP for a week) all promised somebody else's airtime or badge
// — that was never ours to give. Every tier below is fulfillable by us alone:
// the bot, planetcuhz.com (Chain Studio + store), our own stream, or our Discord.
// Do NOT re-add a host-dependent tier. Not "usually", not "we'll ask them".
//
// NEVER-RAISE RULE (§2c): 500/1000/2500/5000 are public and viewers are banking
// against them right now. These costs may be confirmed or LOWERED, never raised.
// The reward AT a price point may only be swapped for equal-or-greater value.
//
// FIXED VALUE ONLY (owner decision 2026-09-15). Every tier is a bounded good. The
// 1000 tier used to be "25% off the store": an uncapped percentage on an unbounded
// order, the only tier whose cost to us scaled with the buyer's cart. The ladder
// itself prices a point (2500 = the $7 emote pack, ~0.28¢/point, so 1000 ≈ $2.80);
// 25% paid that on an $11 order and $15 on a $60 one. The swap to a flat $5 credit
// is equal-or-greater value at every order under $20 and above the implied point
// rate, so §2c holds — and it can never again pay out more than $5. Do NOT
// reintroduce a percentage tier; if you must, cap it in dollars in the name.
//
// No 7500 "grail" tier here on purpose — it is net-new and awaits owner approval.
const POINT_REWARDS = [
    { cost: 500,  name: 'Custom Chain PFP',     note: 'Made-to-order Chain Studio profile art — any finish, your nameplate, delivered in Discord' },
    // Store-credit tier: copy says "issued via Discord" and never "instant"/"auto-applied".
    // Spec §4 E1 (store platform's single-use discount codes) is UNVERIFIED, and the
    // fallback is a manual $5 refund — so nothing here may imply automatic delivery.
    { cost: 1000, name: '$5 off the store',     note: 'Single-use $5 discount code for anything at planetcuhz.com, one per order — issued via Discord' },
    { cost: 2500, name: 'Emote Pack Vol.1',     note: 'The full $7 emote pack, free — 8 emotes, Twitch + Discord sizes, via Discord DM' },
    // Scoped to the Planet Cuhz channel on purpose: the bot's speech is ours, but a
    // greeting firing in a HOST's chat is our promo in their house. Never advertise
    // this as bot-wide. The "on the Planet Cuhz channel" clause is load-bearing.
    { cost: 5000, name: 'Custom bot greeting (Planet Cuhz)', note: 'Cuhz_Bot greets you by name with your line on the Planet Cuhz channel for a month' }
];

// Twitch hard-caps a message at 500 chars; we budget 450. If POINT_REWARDS ever
// grows past that, drop whole tiers off the end (with an ellipsis) rather than
// slicing a reward name in half or blowing the cap.
const REWARDS_LINE_MAX = 450;
function buildRewardsLine() {
    const prefix = '💎 CUHZ POINTS REWARDS: ';
    // NOTE: no site pointer here on purpose — planetcuhz.com has no /points page
    // yet, and pointing viewers at a dead end teaches them the economy isn't real.
    // Re-add '· more at planetcuhz.com/points' ONLY once that page ships (spec §6).
    // "no host needed" is the Rev 2 promise in four words; "usually same stream" is
    // gone because custom art and discount codes take a day and "same stream"
    // implied on-stream fulfillment — the exact frame Rev 2 retires.
    const suffix = ' → Ask a mod to redeem — delivered by the fam via Discord, no host needed 💎';
    const tiers = POINT_REWARDS.map(r => `${r.cost} = ${r.name}`);
    const shown = tiers.slice();
    let line = prefix + shown.join(' | ') + suffix;
    while (shown.length > 1 && line.length > REWARDS_LINE_MAX) {
        shown.pop();
        line = prefix + shown.join(' | ') + ' | …' + suffix;
    }
    // Single tier still too long (pathological name) — hard trim as a last resort.
    return line.length > REWARDS_LINE_MAX ? line.slice(0, REWARDS_LINE_MAX - 1) + '…' : line;
}

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
    // "hanging out IN CHAT" is load-bearing: the passive paycheck is message-triggered
    // (see PRESENCE_GAP_MS / PAYCHECK_INTERVAL_MS above) — a viewer who never types
    // earns nothing, so the copy must not promise points for silent lurking.
    // The '+ planetcuhz.com' pointer is gone: the site has no leaderboard and no
    // points page (verified live — /leaderboard and /rewards both 404). Restore it
    // as 'planetcuhz.com/points' ONLY after that page ships (spec §5a/§6).
    '!pointsinfo': '💎 EARN CUHZ Points: +1 every chat message, +10 just for hanging out in chat while we\'re live, +300 one-time follow bonus with !claim. Check your bag with !points, leaderboard with !top — spend it with !rewards 💎'
};

const USER_COMMANDS = {
    '!uni': 'Universal vibes loaded! Welcome to the galaxy! 🌌',
    // !balen — rotated handler; aliases to BALEN_QUOTES via USER_VARIANT_POOLS.
    '!chi': 'Windy City energy! Chi2K is in the building. 🏀',
    // !bot — was a throwaway joke; now the onboarding CTA. Handled in dispatch
    // next to !getcuhzbot so it can't be shadowed by this canned map.
    '!drizzy': 'Drizzy in the cut! No drizzle, just reign! ☔👑',
    // !ec — rotated handler; see EC_QUOTES + dispatch block.
    // !four — rotated handler; shares FOUR_QUOTES pool with !4 (see dispatch block).
    '!jay': 'HBN Jay bringing the heat! 300 level energy! 🔥',
    // !rell moved to USER_VARIANT_POOLS (Hell Rell rotation, all tiers);
    // WestSideRelly has his own !west there — two different Rells.
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

// !qween for stormygirlnz89 — Sims + basketball loyal regular.
// Palette 👑 🏀 ✨ 💖 📡.
const QWEEN_QUOTES = [
    "👑 QWEEN STORMY in the chat! Sims slayer, vibe curator 🏀",
    "👑 @stormygirlnz89 we see you cuhz — the frequency is up 📡",
    "✨ Qween Stormy pulled up. Chat officially upgraded 👑",
    "👑 Ayy it's Qween! Good to see you cuhz 💖",
    "💖 @stormygirlnz89 slid through — royalty in the building 👑",
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

// !geni for geniiknight — Slytherin energy. Palette 🐍 💚 ⚡ 🌌.
// (!gg was reassigned to end-of-game GG; !geni is their command now.)
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

// !rell for Hell Rell — heat/fire energy, day-one supporter. 8 variants.
const HELLRELL_QUOTES = [
    "🔥 HELL RELL in the building! @hellrell the heat just walked in 😤",
    "😤 @hellrell pulled up — certified real one, no debate 🔥",
    "💯 Rell in the chat! @hellrell been holding us down since day one 🔥",
    "🔥 Ayy it's Rell! @hellrell the energy ALWAYS up when he pull up ⚡",
    "⚡ @hellrell slid in — loyalty like his don't come standard 💎",
    "💎 Hell Rell here! @hellrell supports the fam every single time 🔥",
    "😤 @hellrell touched down — turn the heat UP cuhz 🔥",
    "🔥 Rell in the frequency! @hellrell real recognize real 💯"
];

// !west for WestSideRelly — West Side energy, day-one supporter. 8 variants.
const WESTSIDE_QUOTES = [
    "🌴 WEST SIDE in the building! @westsiderelly pulled up 🤙",
    "🤙 @westsiderelly touched down — West Side stand UP 🌴",
    "🌇 Westside Relly in the chat! @westsiderelly always shows love 💎",
    "💎 @westsiderelly slid in — supports the fam without fail 🌴",
    "🌴 Ayy it's Relly! @westsiderelly the West keeps us WARM 🤙",
    "🔥 @westsiderelly here! West Side loyalty, CUHZ family 🌇",
    "🤙 West Side Relly in the frequency — @westsiderelly we appreciate you 💎",
    "🌇 @westsiderelly pulled up! Coast to coast, same fam 🌴"
];

// NOTE: every *_QUOTES constant referenced by USER_VARIANT_POOLS below must be
// defined ABOVE it. The map is a module-level object literal, so it is evaluated
// at import time — referencing a `const` declared later throws a ReferenceError
// (temporal dead zone) and the bot never boots. Add new quote pools here.

// !shoota / !dashoota for Rico_DaShoota — sharpshooter + put-in-the-work
// energy (💪💪📚📚 is his calling card). NOT the same person as rico2ez (!rico).
// Palette 🎯 🏀 💪 📚 🔥 💎. 8 variants, no-repeat-last-2.
const SHOOTA_QUOTES = [
    "🎯 SHOOTA in the building! @Rico_DaShoota — green light every time 🏀",
    "🏀 @Rico_DaShoota pulled up! Catch and shoot, nothing but net 🎯",
    "💪 Da Shoota touched down — @Rico_DaShoota puts in that WORK 📚",
    "🔥 @Rico_DaShoota slid in! Range don't stop at the arc 🎯",
    "📚 Class in session — @Rico_DaShoota out here schooling folks 💪",
    "🎯 Ayy it's Shoota! @Rico_DaShoota built different cuhz 💎",
    "💎 @Rico_DaShoota in the frequency — shooters shoot, always 🏀",
    "🏀 Shoota pulled UP! @Rico_DaShoota that jumper stay pure 🔥"
];

// !kuddy for imkxddy — day-one supporter (2y+ follower). Palette 🎯 💯 🔥 👑 💎.
// 8 variants, no-repeat-last-2.
const KUDDY_QUOTES = [
    "🎯 KUDDY in the building! @imkxddy pulled up — day one, every time 💯",
    "💯 @imkxddy touched down! Been here YEARS, still shows up 🔥",
    "🔥 Ayy it's Kuddy! @imkxddy loyalty like that is rare cuhz 👑",
    "👑 @imkxddy slid in — real supporter, zero days off 💎",
    "💎 Kuddy in the frequency! @imkxddy we appreciate you fam 🎯",
    "🎯 @imkxddy here! Longtime CUHZ, longtime love 💯",
    "🔥 Kuddy pulled UP — @imkxddy the day-ones always come back 👑",
    "💯 @imkxddy in the chat! Certified real one since way back 🔥"
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
    '!rell':        HELLRELL_QUOTES,
    '!hellrell':    HELLRELL_QUOTES,
    '!west':        WESTSIDE_QUOTES,
    '!westside':    WESTSIDE_QUOTES,
    '!relly':       WESTSIDE_QUOTES,
    '!shoota':      SHOOTA_QUOTES,
    '!dashoota':    SHOOTA_QUOTES,
    '!kuddy':       KUDDY_QUOTES,
    '!imkxddy':     KUDDY_QUOTES,
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




// !gg — end-of-game good game, all channels. (Reassigned from geniiknight,
// who now uses !geni.) 10 variants, no-repeat-last-3.
const GOODGAME_QUOTES = [
    "🤝 GG! Good game cuhz — respect to everybody who laced up 🏀",
    "🏀 GG GG GG! That's a wrap — run it back? 🔥",
    "🤝 Good game fam. Win or lose we shake hands and hoop again 💎",
    "🔥 GG! Buckets were had, respect was earned 🏀",
    "💎 GG cuhz! Good game to both squads — that's how we do it 🤝",
    "🏀 GAME. GG to everybody — see you next possession 🔥",
    "🤝 GG! No hard feelings, just hoops. Run it back cuhz 💯",
    "💯 Good game! Sportsmanship over everything — that's the CUHZ way 🤝",
    "🔥 GG! Whistle blew, respect stays. Good hoops fam 🏀",
    "🏀 GG cuhz! Take the W or take the lesson — either way we back tomorrow 💎"
];

// !mute — the community's "MUTE GAME ON LEGEND" chant. NOT a moderation
// command; nobody gets muted. 10 variants, no-repeat-last-3.
const MUTE_LEGEND_QUOTES = [
    "🔇 MUTE GAME ON LEGEND 🏆",
    "🔇 Mute game... ON LEGEND. That's the only setting cuhz 🏀",
    "🏆 MUTE GAME ON LEGEND — say it with your chest 🔇",
    "🔇 You already know — MUTE GAME ON LEGEND 💯",
    "🏀 Mute game on legend. No sound, just buckets 🔇",
    "🔥 MUTE GAME ON LEGEND! The CUHZ anthem 🏆",
    "🔇 Volume off, difficulty MAXED — mute game on legend cuhz 🏀",
    "💯 Mute game on legend. Period. 🔇",
    "🏆 If you know, you know — MUTE GAME ON LEGEND 🔥",
    "🔇 MUTE GAME ON LEGEND — the standard, not the exception 💎"
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

// Placement is load-bearing: this registry holds direct references to the quote
// pools, so it MUST come after every one of them. Declared earlier it throws
// 'Cannot access RICO_QUOTES before initialization' at boot — the same temporal
// dead-zone class as the September P0. tests/test_boot_isolated.js catches it.
// ============================================================================
// THE CUHZNS — arrival recognition.
//
// The bot already had ~30 hand-written personality pools, but the ONLY way to
// reach one was for somebody to type that person's command. So a cuhzn walked
// in and got the same generic "Welcome to the Planet, cuhz!" as a stranger,
// while a line written specifically for them sat unused two screens away.
// This connects the two: your own line fires when YOU arrive.
//
// KEYED ON THE IMMUTABLE NUMERIC TWITCH ID, never a login. handleAutoShoutout()
// keys on `streamer_username` and that is exactly the bug that silently broke
// recognition when qweenstormygirlnz89 became stormygirlnz89. Twitch also
// recycles abandoned logins after ~6 months, so a login key eventually greets
// an impostor with a friend's line. Every id below was resolved from Twitch's
// public GQL on 2026-09-17 and each pool was read to confirm it names that
// person (e.g. QWEEN_QUOTES says "QWEEN STORMY", WESTSIDE says "@westsiderelly").
//
// ECONOMY NOTE: POINT_REWARDS sells a 5,000-point "Custom bot greeting" — a
// line YOU choose, on planetcuhz, for a month. This registry is a different
// thing: house-written lines for the known crew, content that is already free
// to trigger via !four, !rico, !snowy and so on. It automates existing free
// content; it does not give away the paid product. Keep it that way — if a
// viewer wants THEIR OWN words on arrival, that stays the 5,000-point reward.
// ============================================================================
// `receipt` is ONE sentence of character, grounded in what the production logs
// actually show this person doing (Railway runtime logs 2026-09-02..09 and the
// 2026-09-09 reconciliation evidence; per-line citations in
// verification/CUHZN_RECOGNITION_EVIDENCE_2026-09-17.md). It describes durable
// BEHAVIOUR, never a number — numbers go stale in a week and are printed live by
// cuhznReceipt() instead. Where the evidence is too thin to characterise someone
// honestly, receipt is null and the live stats speak alone.
const CUHZNS = {
    // 607 command rows; !grouch x20 !pnx x16 !famous x12 !mahni x12 !ac x11 — he
    // runs more shoutouts for OTHER people than anyone in the fam. Six channels.
    '952381011':  { login: 'four_a_reason',     pool: FOUR_QUOTES,
                    receipt: 'The one who puts everybody else on \u2014 nobody runs more shoutouts in this fam.' },
    // 127 retained messages spread over five channels.
    '1354688041': { login: 'rico2ez',           pool: RICO_QUOTES,
                    receipt: 'In the building across the whole planet.' },
    // Runs the bot on #thatgirlmahni_ (CHANNEL_TIERS) and still chats in
    // #four_a_reason and #grouch392.
    '732620163':  { login: 'thatgirlmahni_',    pool: MAHNI_QUOTES,
                    receipt: 'Runs CUHZ Bot on her own stream and still pulls up to everybody else\u2019s.' },
    // Every retained message is in #four_a_reason; 17 log mentions as
    // qweenstormygirlnz89 + 130 as stormygirlnz89 — the rename that broke the
    // old login-keyed recognition, and exactly why this registry keys on id.
    '824566475':  { login: 'stormygirlnz89',    pool: QWEEN_QUOTES,
                    receipt: 'Reason\u2019s-chat regular \u2014 same energy under every name.' },
    // !W x7 !quote x4 !AC x3; 1,269 messages across five channels; the highest
    // earned balance in the reconciliation (the number is printed live, not here).
    '1388723253': { login: 'snowy_wolfies_ttv', pool: SNOWY_QUOTES,
                    receipt: 'Calls the Ws, pulls up to everybody\u2019s chat, and it shows.' },
    // 1,230 messages across six channels; 5,053 log mentions — more than anyone
    // but Reason. If the bot is in a room, Grouch has been in it.
    '557152408':  { login: 'grouch392',         pool: GROUCH_QUOTES,
                    receipt: 'In every room on the planet \u2014 if the bot is there, Grouch is there.' },
    // Four channels; the most recent ledger activity in the 2026-09-12 snapshots
    // (ten consecutive rows) — earning and spending, not lurking.
    '128186931':  { login: 'westsiderelly',     pool: WESTSIDE_QUOTES,
                    receipt: 'Pulls up across the planet and always cashing in.' },
    // 166 messages but present in FIVE channels — low volume, high presence.
    '199116767':  { login: 'razredg1',    pool: ['Raz Red G in the building! Keeping it 100 since day one \u{1F534}'],
                    receipt: 'Doesn\u2019t say much \u2014 never misses.' },
    // 17 retained messages in two channels: not enough to characterise honestly.
    // The live receipt (messages / watch time / points) says what there is to say.
    '731191493':  { login: 'ohthatztayy', pool: ['It\u2019s giving 2K legend energy \u2014 ohthatztayy locked in! \u{1F3AE}\u{1F3C0}'],
                    receipt: null },
    // Phoenix is deliberately absent: phoenixnyc (757210754) vs phoenixpnyc
    // (823707557) is still unconfirmed, and greeting the wrong account with
    // someone's personal line is worse than a generic welcome. Same rule as
    // LOUNGE_OPERATOR_IDS. One line to add once the owner confirms.
};

/** The arriving user's own line, or null for everyone else. Id only. */
function cuhznGreeting(userId, channelLogin) {
    const c = CUHZNS[String(userId || '').trim()];
    if (!c) return null;
    // Don't greet someone in their own house — they're the broadcaster there.
    if (c.login === String(channelLogin || '').replace('#', '').toLowerCase()) return null;
    const line = pickNoRepeat(`cuhzn:${c.login}`, c.pool, Math.min(3, c.pool.length));
    return c.receipt ? `${line} ${c.receipt}` : line;
}

/**
 * Pure. Live stats -> one honest receipt line, or null when there is not enough
 * to say. Every number is the same one the person would get from !points,
 * !watchtime and their profile — same helpers, same rows — so the greeting can
 * never contradict the commands. Pure so it is testable without a database.
 */
function formatCuhznReceipt(login, profile, balance, nowMs = Date.now()) {
    const parts = [];
    const msgs = profile && Number.isSafeInteger(profile.total_messages) ? profile.total_messages : 0;
    const mins = profile && Number.isSafeInteger(profile.total_watch_minutes) ? profile.total_watch_minutes : 0;
    const pts  = Number.isSafeInteger(balance) ? balance : 0;
    if (msgs > 0) parts.push(`${msgs.toLocaleString('en-US')} messages`);
    if (mins > 0) parts.push(`${formatMinutes(mins)} watched`);
    if (pts > 0)  parts.push(`${pts.toLocaleString('en-US')} CUHZ Points`);
    if (profile && profile.first_seen) {
        const t = new Date(profile.first_seen).getTime();
        // Only cite tenure that is real. A profile created in the last day is
        // "new", and "here since today" would read as a bug.
        if (Number.isFinite(t) && nowMs - t >= 24 * 60 * 60 * 1000) {
            parts.push(`here since ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`);
        }
    }
    // Two real facts minimum, or say nothing: a one-item receipt reads as padding.
    if (parts.length < 2) return null;
    return `\u{1F9FE} @${login} \u2014 ${parts.join(' \u00b7 ')}`;
}

/** Live lookup. A stats failure must never suppress the greeting itself. */
async function cuhznReceipt(login) {
    try {
        const [profile, balance] = await Promise.all([
            userMemory.getProfile(login),
            pointsService.getBalance(login),
        ]);
        return formatCuhznReceipt(login, profile, balance);
    } catch (err) {
        logger.error('cuhzn receipt failed (greeting still sent):', err.message);
        return null;
    }
}

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
    '!dashboard', '!schedule', '!stream',
    '!followage', '!viewers', '!streamstats'
]);

const TIMER_MESSAGES = [
    // ORIENTATION FIRST. A viewer who lands on an unattended stream sees artwork
    // and silence; they do not know this channel has a bot, points, or an AI.
    // These three lines answer "what am I looking at / what can I do / why stay"
    // before any link drop, because a link means nothing to someone with no context.
    "👋 New here? This is CUHZ Bot's own channel — the bot running this chat is the product. Type !tools to see the whole rig, or !help for every command 🤖",
    "🛋️ That artwork on screen is the CUHZ Bot Infinity Lounge — our mascot rendered inside itself, forever. Built live on this channel 🌌",
    "💬 Talk to the bot: !ask <anything> for AI · !hype !vibe !w for the vibes · !points for your bag. It answers, try it 💎",
    "🌌 Planet CUHZ → https://planetcuhz.com",
    "🔗 All links → https://linktr.ee/PlanetCUHZ",
    "💬 Join the Discord → https://discord.com/invite/wt6Zc7Sgjx",
    // Points line: the timer loop is the bot's only proactive surface, so it's how
    // the earn loop gets discovered. Claims mirror verified code (chat_message +1,
    // passive_paycheck +10, claimBonus 300) — and "in chat" because the paycheck is
    // message-triggered, so pure lurking pays nothing. The instant spends named here
    // (!ask 10 · !code 25 · !ask -brain 50) are Pro/Premium-only, which is why this
    // line lives in THIS pool and BASIC_TIMER_MESSAGES must never copy it.
    "💎 You're stacking CUHZ Points right now — +1 every message, +10 for hanging out in chat while we're live, +300 one-time with !claim. Spend instantly: !ask (10) · !code (25) · !ask -brain (50) — or save up: !rewards 💎"
];

const BASIC_TIMER_MESSAGES = [
    // Routes to the !bot handler (one source of truth for onboarding) instead of the
    // retired "pull up to @four_a_reason's stream" pointer superseded by PR #4.
    '🤖 Want CUHZ Bot in your channel — mod tools, hype, points & AI? Type !bot to pull up 🚀',
    '🌌 Planet CUHZ — the creator ecosystem where we all level up together 💎',
    '💬 Join the CUHZ fam on Discord → https://discord.com/invite/wt6Zc7Sgjx',
    '🔥 Type !hype, !vibe, or !w to show love in the chat!',
    '💎 Every message stacks CUHZ Points: +1 per chat, +10 for hanging out in chat, +300 one-time with !claim. !points for your bag, !rewards for the goods 💎'
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
        _personaSource.set(channel.toLowerCase(), 'defaults');
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
        _personaSource.set(channel.toLowerCase(), 'dashboard');
        logger.info(`Loaded ${Object.keys(persona.commands).length} commands, ${persona.timers.length} timers at ${persona.interval}min intervals for ${channel}`);
    } catch (error) {
        // Log each channel's failure once, then suppress identical repeats to
        // once/hour per channel (was 141 identical 404 lines in 23h — the
        // defaults fallback below makes the failure non-fatal).
        const errKey = channel.toLowerCase();
        const prev = _personaErrorLog.get(errKey);
        const nowMs = Date.now();
        if (!prev || prev.msg !== error.message || nowMs - prev.at >= PERSONA_ERROR_LOG_INTERVAL_MS) {
            logger.error(`Error fetching persona for ${channel}: ${error.message} (defaults in use; repeats muted for 1h)`);
            _personaErrorLog.set(errKey, { msg: error.message, at: nowMs });
        }
        _personaSource.set(errKey, 'defaults');

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

    // Real Helix moderation (IRC /commands are dead since 2023-02) — see moderation_service.js
    moderation.init({
        db,
        getTwitchUser,
        getIds: async () => {
            if (!twitchClientId || !botUserId) await fetchClientId();
            return { clientId: twitchClientId, botUserId };
        }
    });

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
                channelsToJoin = normalizeChannels(response.data.channels.map(ch => ch.name));
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
        channelsToJoin = normalizeChannels(config.channels);
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

    targetChannels = [...channelsToJoin];

    client.connect().then(() => {
        logger.info('Successfully initiated connection to Twitch IRC.');
        // Verify actual IRC membership ~60s after connect (joins are async and
        // can silently fail — qweenstormygirlnz89 never joined in production).
        setTimeout(() => verifyChannelJoins(0), 60000);
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

    client.on('usernotice', streakService.createNoticeHandler({
        tracker: streakTracker,
        send: sendMessage,
        info: (message) => logger.info(message),
        error: (message, err) => logger.error(message, err && err.message ? err.message : err)
    }));
    logger.info('🚨 Raid / sub / resub / subgift / watch-streak event handlers registered');
}

// Join verification v2: the old implementation POSTed to the dashboard's
// /api/bot/verify, which doesn't exist in production (only in
// mock_dashboard.js) — every call 4xx'd AND it only ran on successful 'join'
// events, so a channel that never joined was never checked. This version
// compares actual IRC membership (client.getChannels()) against the target
// list and retries missing joins with backoff (3 attempts: 30s/60s/120s).
function verifyChannelJoins(attempt) {
    try {
        if (!client || targetChannels.length === 0) return;
        const joined = new Set((client.getChannels() || []).map(c => c.toLowerCase()));
        const missing = targetChannels.filter(ch => !joined.has(ch.toLowerCase()));

        if (attempt === 0) {
            logger.info(`🚪 Channels: joined ${targetChannels.length - missing.length}/${targetChannels.length}`);
            logPersonaSummary();
        }

        if (missing.length === 0) {
            if (attempt > 0) {
                logger.info(`🚪 Channels: joined ${targetChannels.length}/${targetChannels.length} (recovered after ${attempt} retr${attempt === 1 ? 'y' : 'ies'})`);
            }
            return;
        }

        if (attempt >= JOIN_RETRY_DELAYS_MS.length) {
            logger.warn(`🚪 Channels STILL MISSING after ${attempt} retries: ${missing.join(', ')}`);
            return;
        }

        const delayMs = JOIN_RETRY_DELAYS_MS[attempt];
        logger.warn(`🚪 Channels missing: ${missing.join(', ')} — retry ${attempt + 1}/${JOIN_RETRY_DELAYS_MS.length} in ${delayMs / 1000}s`);
        setTimeout(async () => {
            for (const ch of missing) {
                try {
                    await client.join(ch);
                    logger.info(`🚪 Rejoined ${ch}`);
                } catch (err) {
                    logger.warn(`🚪 Retry join failed for ${ch}: ${err && err.message ? err.message : err}`);
                }
            }
            verifyChannelJoins(attempt + 1);
        }, delayMs);
    } catch (err) {
        logger.error('Error verifying channel joins:', err && err.message ? err.message : err);
    }
}

// One-line startup summary of persona sources (fires with the join check).
function logPersonaSummary() {
    if (_personaSummaryLogged || _personaSource.size === 0) return;
    _personaSummaryLogged = true;
    const total = _personaSource.size;
    const loaded = [..._personaSource.values()].filter(v => v === 'dashboard').length;
    logger.info(`🎭 Personas: ${loaded}/${total} loaded from dashboard (defaults in use for the rest)`);
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

// P3: automatic historical grants are retired. Existing balances/provenance
// remain untouched; a restart must not run a multiplier or backfill again.

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
        }
        // No-op polls (live and already announced) are intentionally NOT
        // logged — only state transitions are (was 101 useless lines/day).
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
    // Before context, memory, points, welcomes, commands, or any async work.
    // tmi's local `self` flag alone does not cover mirrored shared-chat echoes.
    if (!sharedChatGuard.accept(tags, self, config.username, botUserId)) return;

    // Instrumentation: every command attempt is visible in the logs.
    if (message.startsWith('!')) {
        logger.info(`⌨️ CMD ${message.split(' ')[0]} by ${tags.username} in ${channel}`);
    }

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
    // Other channels' bots (nightbot, streamelements, ...) get NO points, NO
    // watch-minute accrual, and NO welcomes — they earned 13/85 points in
    // #thatgirlmahni_ in production.
    const isKnownBot = KNOWN_BOTS.has(username.toLowerCase());
    try {
        const usernameL = username.toLowerCase();
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();

        // 1. Passive Paycheck (+10 points per 10 minutes of continuous presence)
        //
        // FIXED: the old rule only paid when the gap between two messages landed
        // BETWEEN 10 and 30 minutes, so anyone chatting steadily (gap always < 10
        // min) earned nothing. Production log proof: planetcuhz 34 messages -> 0
        // paychecks, phoenixpnyc 17 -> 0, while a sporadic chatter got several.
        // Now: still-present (last message within PRESENCE_GAP) + at least
        // PAYCHECK_INTERVAL since their last paycheck -> pay. Steady chatters are
        // rewarded, people who left are not.
        const user = isKnownBot ? null : await db.prepare('SELECT last_seen, last_paycheck FROM users WHERE username = ?').get(usernameL);

        if (!isKnownBot) {
            if (user) {
                const sinceSeen = now.getTime() - new Date(user.last_seen).getTime();
                const lastPay = user.last_paycheck ? new Date(user.last_paycheck).getTime() : null;
                const sincePay = lastPay === null ? null : now.getTime() - lastPay;

                if (lastPay === null) {
                    // First time we've seen them since this feature shipped — start
                    // their clock now rather than paying for unknown history.
                    await db.prepare('UPDATE users SET last_paycheck = CURRENT_TIMESTAMP WHERE username = ?').run(usernameL);
                } else if (sinceSeen <= PRESENCE_GAP_MS && sincePay >= PAYCHECK_INTERVAL_MS) {
                    const paid = await pointsService.addPoints(usernameL, 10, 'passive_paycheck');
                    if (paid) {
                        // Credit the real elapsed presence, capped so a long gap that
                        // still passed the presence check can't over-credit.
                        const earnedMinutes = Math.min(Math.round(sincePay / 60000), 30);
                        await userMemory.addWatchMinutes(usernameL, earnedMinutes);
                        await db.prepare('UPDATE users SET last_paycheck = CURRENT_TIMESTAMP WHERE username = ?').run(usernameL);
                    }
                }
            }

            // 2. Earn Active Point (+1 per message)
            await pointsService.addPoints(usernameL, 1, 'chat_message');

            // 3. Update User Stats (Last Seen, Msg Count). A failed award must
            // never create an unledgered fallback point through this upsert.
            const upsertUser = db.prepare(`
                INSERT INTO users (username, points, messages_sent, last_seen)
                VALUES (?, 0, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(username) DO UPDATE SET
                    messages_sent = users.messages_sent + 1,
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
        }

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
        // A direct request gets its answer, not a welcome/shoutout AND an answer.
        const isDirectedRequest = isCommand || contextHandler.isQuestionOrRequest(message);
        const canWelcome = !isKnownBot && !isDirectedRequest && (!persona.settings || persona.settings.auto_welcome);
        let cuhznGreeted = false;   // a personal greeting replaces the generic auto-shoutout, never stacks on it
        if (canWelcome) {
            const welcomeKey = `${channel}:${usernameL}`;
            const welcomeState = _channelWelcomes.get(welcomeKey);
            const joinTier = CHANNEL_TIERS[channel.replace('#', '').toLowerCase()] || TIERS.BASIC;
            const nowMs = now.getTime();

            const cuhznLine = cuhznGreeting(tags['user-id'], channel);

            if (!welcomeState) {
                // A known cuhzn gets their OWN line on arrival, in any tier —
                // recognition is the point, and it reads as generic otherwise.
                // Then the receipt: what THEY have actually put in, live.
                if (cuhznLine) {
                    sendMessage(channel, `${cuhznLine}`);
                    const receipt = await cuhznReceipt(usernameL);
                    if (receipt) sendMessage(channel, receipt);
                    cuhznGreeted = true;
                } else if (joinTier === TIERS.BASIC) {
                    sendMessage(channel, `Wassup cuhz, Welcome to the stream! @${tags.username}`);
                } else {
                    const randomWelcome = WELCOME_QUOTES[Math.floor(Math.random() * WELCOME_QUOTES.length)];
                    sendMessage(channel, `${randomWelcome} @${tags.username} 🌌`);
                }
                _channelWelcomes.set(welcomeKey, { firstContactAt: nowMs, lastWelcomedAt: nowMs });
                // Brand-new human? Ping Discord. Checked here rather than per
                // message because this branch already only runs on first contact,
                // so it costs one query per new arrival, not one per line of chat.
                if (DISCORD_ALERT_WEBHOOK && await isFirstTimeEver(usernameL)) {
                    _firstTimerSeen.add(usernameL);
                    alertFirstTimer(channel, usernameL, tags.username, message);
                }
            } else if (nowMs - welcomeState.lastWelcomedAt >= WELCOME_BACK_COOLDOWN_MS) {
                // Only fire welcome-back if the user ALSO hasn't chatted in the last 4h
                // (prevents re-welcoming someone who just idled in the tab).
                const lastSeenMs = user ? new Date(user.last_seen).getTime() : 0;
                if (!user || (nowMs - lastSeenMs) >= WELCOME_BACK_COOLDOWN_MS) {
                    // Their own line here too: being recognised once and then
                    // generically thereafter is worse than never being recognised.
                    const line = cuhznLine || `${pickNoRepeat(`welcomeback:${channel}`, WELCOME_BACK_QUOTES, 3)} @${tags.username}`;
                    sendMessage(channel, line);
                    if (cuhznLine) {
                        const receipt = await cuhznReceipt(usernameL);
                        if (receipt) sendMessage(channel, receipt);
                        cuhznGreeted = true;
                    }
                    welcomeState.lastWelcomedAt = nowMs;
                }
            }
        }

        // Auto-shoutout for fellow streamers (pro/premium only)
        const joinChannelTier = CHANNEL_TIERS[channel.replace('#', '').toLowerCase()] || TIERS.BASIC;
        if (!isKnownBot && !isDirectedRequest && !cuhznGreeted && joinChannelTier !== TIERS.BASIC) {
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
    if (!isKnownBot && isPremium && config.enableContextAware && !msg.startsWith('!')) {
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
                buildAiCommandList(persona.commands),
                personalityConfig,
                userProfile,  // Pass user profile for AI personalization
                streamState   // Pass live stream info (game/title) for grounding
            );

            if (aiResponse) {
                sendMessage(channel, aiResponse);
                return;
            }
        } catch (error) {
            logger.error('Context-aware response error:', error.message);
        }
    }

    // 0.65. !tools — the stream title has advertised "!tools" while no such command
    // existed, so every viewer who tried it got silence. That is the worst possible
    // first interaction: the channel's most visible copy making a promise the bot
    // breaks. One source of truth for "what is this channel running".
    if (msg === '!tools' || msg === '!rig' || msg === '!setup') {
        sendMessage(channel, '🛠️ THE RIG — CUHZ Bot: points, AI chat, mod tools, hype & shoutouts (all live in this chat) · the Infinity Lounge overlay you\'re watching · planetcuhz.com. All of it built open, on stream.');
        sendMessage(channel, '👉 Try it: !help (every command) · !ask <question> (AI) · !points (your bag) · !rewards (what points buy) · !bot (get CUHZ Bot in YOUR channel) 🚀');
        return;
    }

    // 0.7. THE CUHZ LAB — chat-controlled lounge. Sits ABOVE the bare !vibe
    // handler on purpose: `!vibe hype` belongs to the lounge, bare `!vibe` does
    // not and keeps its existing reply. Only allowlisted room-ids ever reach the
    // state machine; every other channel falls through this block untouched.
    // No points, no database, no network in here.
    if (loungeEnabled() && LOUNGE_ROOM_IDS.has(String(tags['room-id'] || '')) && LOUNGE_INTENT_RE.test(msg)) {
        const roomId = String(tags['room-id']);
        const actor = loungeActor(tags);
        if (actor.login && /^\d{1,12}$/.test(String(actor.userId || ''))) {
            _loungeLogins.set(String(actor.login).toLowerCase(), String(actor.userId));
        }
        const lab = parseLabCommand(message);
        const handled = lab ? handleLabMenu(channel, roomId, actor, lab)
                            : handleLoungeIntent(channel, roomId, actor, message);
        if (handled) return;
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
    // Onboarding CTA — every tier, every channel. Two lines: what you get, then
    // the two concrete steps. Step 1 (/mod cuhz_bot) is the one that actually
    // matters: Twitch checks mod status server-side on every moderation call, so
    // without it the bot can read chat but cannot moderate. Deliberately no
    // token/OAuth link here — onboarding never needs a streamer's credentials.
    // !prices — the sales answer, ONE line so it never floods chat (same
    // discipline as !help). Prices are CANON (BRAND_PRICE_GUARDRAILS §9 /
    // site src/data/pricing.ts): bot plans Silver $4.99 / Gold $14.99 /
    // Affiliate $49.99, site membership Pro $9.99 / Team $24.99 is a
    // SEPARATE product and named here so the two never get conflated in chat.
    // All tiers, all channels — a price question can come from anywhere.
    // !pay — HOW to pay, with guest discipline: the Venmo handle appears ONLY
    // in our own channels (planetcuhz, cuhz_bot). In host channels the bot is
    // a guest, so payment routes through the Discord — never a raw handle in
    // someone else's chat. Interim rail until Stripe checkout opens; the buyer
    // notes their Twitch name so delivery can be granted on planetcuhz.com.
    if (msg === '!pay' || msg === '!venmo' || msg === '!buy') {
        const OWN_CHANNELS = ['planetcuhz', 'cuhz_bot'];
        if (OWN_CHANNELS.includes(cleanChannel)) {
            sendMessage(channel, '💸 Pay the Planet: venmo.com/u/WRodriguezx — put your TWITCH NAME + what you\'re grabbing in the note (e.g. "yourname — Chain Pack $9"). Delivery lands on your planetcuhz.com account + Discord. Menu: !prices 💎');
        } else {
            sendMessage(channel, '💸 Ready to grab something? Pull up to the Discord and the fam sorts payment direct: https://discord.com/invite/wt6Zc7Sgjx · menu: !prices 💎');
        }
        return;
    }

    if (msg === '!prices' || msg === '!price' || msg === '!plans' || msg === '!pricing'
        || msg.startsWith('!prices ') || msg.startsWith('!price ') || msg.startsWith('!plans ')) {
        // Drill-down: `!prices <plan>` = ONE line of what that plan actually
        // gets you — feature copy mirrors the site's Pricing.tsx bullets
        // verbatim-in-spirit so chat and site can't tell different stories.
        // Ladder v2 (owner-locked 2026-08-06): every plan is a CHANNEL
        // subscription that maps to a tier this code can actually grant today
        // (see CHANNEL_TIERS). Silver/Gold copy names only shipped behaviour —
        // no per-user badges/arrivals/bonus-point vapor until an entitlement
        // engine exists. "Affiliate Pack" is retired: $49.99 self-serve has no
        // living competitor, so that price is now Partner — a managed,
        // own-branded deployment we build and run, which is what it's worth.
        const PLAN_DETAILS = {
            free:      '🆓 Community — FREE, live NOW: CUHZ Bot in your channel · CUHZ Points (+1/msg) · !ask AI (10 pts) · shoutouts · !points !top !rewards. Start: type !bot 🚀',
            community: null, // alias of free — filled below
            silver:    '🥈 Silver — $4.99/mo: your channel upgraded — socials on auto-rotation every stream · extra commands & engagement (!followage !streamstats !gamble +more) · everything Free has. → planetcuhz.com/pricing',
            gold:      '🥇 Gold — $14.99/mo: UNLIMITED AI in your chat (Gemini + Claude) · priority · site Pro membership INCLUDED — one sub covers chat + planetcuhz.com. → planetcuhz.com/pricing',
            partner:   '🛰️ Partner — $49.99/mo: your OWN branded bot — your name, avatar & personality, built + hosted + run for you, monthly service touch, powered by VQNC Labs. 5 founding slots. Ask in the Discord 🌌',
            affiliate: null, // retired name — accepted as an arg alias of partner, filled below
            architect: '🏗️ Architect — custom quote: a bot you OWN, custom-coded — your branding, avatar & backstory, private AI on your game & rules. Ask in the Discord → planetcuhz.com/pricing',
            membership:'🪐 Site membership (separate from the bot): Pro $9.99/mo · Team $24.99/mo — planetcuhz.com tools & AI studio. → planetcuhz.com/pricing'
        };
        PLAN_DETAILS.community = PLAN_DETAILS.free;
        // Anyone who learned the old vocabulary still lands on the right line.
        PLAN_DETAILS.affiliate = PLAN_DETAILS.partner;
        const arg = msg.split(/\s+/)[1];
        if (arg && PLAN_DETAILS[arg]) {
            sendMessage(channel, PLAN_DETAILS[arg]);
            return;
        }
        sendMessage(channel, '💎 CUHZ Bot plans: Free · Silver $4.99/mo · Gold $14.99/mo (unlimited AI + site Pro included) · Partner $49.99/mo (your own branded bot, run for you — 5 founding slots) · Architect custom. Details: !prices silver (or free/gold/partner/architect) → planetcuhz.com/pricing 💎');
        return;
    }

    if (msg === '!bot' || msg === '!getcuhzbot' || msg === '!addbot') {
        sendMessage(channel, '🤖 CUHZ Bot — moderation, hype, points, shoutouts & AI for your stream. Free to try 🚀');
        sendMessage(channel, '➡️ Get it in YOUR channel: 1️⃣ type /mod cuhz_bot in your chat 2️⃣ pull up to https://discord.com/invite/wt6Zc7Sgjx and say you want the bot. More → https://planetcuhz.com 🌌');
        return;
    }

    // 0.84. Mahni Rotation (ALL tiers)
    if (msg === '!streak') {
        sendMessage(channel, streakTracker.commandReply(channel));
        return;
    }

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
    // !gg — end-of-game good game, every channel.
    if (msg === '!gg' || msg === '!goodgame') {
        const line = pickNoRepeat(`goodgame:${cleanChannel}`, GOODGAME_QUOTES, 3);
        sendMessage(channel, line);
        return;
    }

    // !mute — community chant, all channels. Not moderation.
    if (msg === '!mute' || msg === '!mutegame') {
        const line = pickNoRepeat(`mutelegend:${cleanChannel}`, MUTE_LEGEND_QUOTES, 3);
        sendMessage(channel, line);
        return;
    }

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

    // 1.5. Menu-driven help. `!help` sends ONE line (the category menu);
    // `!help <category>` sends ONE line for that category. Replaces the old
    // 3-5 message wall of text that flooded chat for ~7 seconds.
    if (msg === '!help' || msg === '!commands' || msg.startsWith('!help ')) {
        const isPP = isProOrPremium;
        const sections = {
            utility:   '🛠️ Utility: !lurk !unlurk !points !rewards !watchtime !top !weekly !uptime !game !socials !ping !nf !sub !raid !claim !streak'
                       + (isPP ? ' !discord !links !gamble !achievements !followage !viewers !streamstats !schedule' : ''),
            vibes:     '🔥 Vibes: !hype !vibe !w !bet !gz !nocap !l !fam !goat !quote !gm !gn !mute !gg',
            // !bot is ungated on purpose — it's the "get CUHZ Bot in YOUR channel"
            // CTA, so the people who most need to see it are in Basic channels.
            brand:     '🌌 Brand: !tools !bot !prices !pay !cuhz !planet'
                       + (isPP ? ' !whatiscuhz !rules !pointsinfo !faq !roadmap !whitepaper !dashboard !getcuhzbot' : ''),
            shoutouts: '🎤 Shoutouts: ' + (isPP
                       ? '!ac !4 !four !ec !rock !pnx !tj !spence !snowy !snow !kasha !qween !fvmous !geni !brady !limit !balen !joee !joe !lyrical !p&b !grouch !blessed !phoenix !uncle !breezy !smutty !kuddy !shoota !relax !jr !mahni !storm !juan !rico !bern !dame !anti'
                       : '!4 !four !ec !rock !tj !spence !snowy !snow !kasha !qween !fvmous !geni !brady !limit !balen !joee !joe !lyrical !p&b !grouch !blessed !phoenix !uncle !breezy !smutty !kuddy !shoota !relax !jr !mahni !tay !yoo !anti'),
            crew:      isPP ? '🎤 Crew: !uni !chi !drizzy !jay !rell !jxy !keem !jaylo !tank !neb !papi !raz !famous !rebound !thorn !zuri !shock !kay !yoo !tay !badguy !night !reacts' : null,
            ai:        isPremium ? '🤖 AI: !ask !code !whois !topchatters — or just ask me naturally 💎' : null,
            // !mod leads: it's the self-documenting panel with live scope status.
            mods:      '🛡️ Mods: !mod !so !raid !give !title !game !ban !timeout !announce !chatreport !mood !settoday !cleartoday'
                       + (isPP ? ' !addstreamer !removestreamer' : ''),
            pg:        cleanChannel === 'four_a_reason' ? '🏀 Proving Grounds: !pg !top100points !top100ovrrank' : null,
            // Advertised only where it is live (honesty law: no doors that don't open).
            lounge:    (loungeEnabled() && LOUNGE_ROOM_IDS.has(String(tags['room-id'] || '')))
                       ? (LOUNGE_ACCESS === 'subscribers'
                           ? '🛋️ Lounge (subs): !lounge · vibe chill|hype · color <name> · zoom in|out|reset · card 1-5 · glow on|off · depth 1-8 · thickness 0-10 · reset · !lounge colors · !lounge whoami'
                           : '🛋️ Lounge: !lounge shows what is on screen · !lounge colors · !lounge whoami — steering is operator-only right now')
                       : null
        };

        // `!help <category>` — one targeted line
        if (msg.startsWith('!help ')) {
            const key = msg.slice(6).trim().replace(/^!/, '');
            if (sections[key]) {
                sendMessage(channel, sections[key]);
            } else {
                const valid = Object.keys(sections).filter(k => sections[k]).join(' ');
                sendMessage(channel, `🤖 No '${key}' category cuhz. Try: ${valid}`);
            }
            return;
        }

        // Bare `!help` — the menu, one message
        const cats = Object.keys(sections).filter(k => sections[k]);
        sendMessage(channel, `🤖 CUHZ BOT — say !help + a category: ${cats.join(' · ')} 💎`);
        return;
    }

    // 1.55. Basic Tier Shoutouts Directory
    if (!isProOrPremium && msg === '!shoutouts') {
        sendMessage(channel, '🎤 Shoutouts: !4 !four !ec !rock !tj !spence !snowy !snow !kasha !qween !fvmous !geni !brady !limit !balen !joee !joe !lyrical !p&b !grouch !blessed !phoenix !uncle !breezy !smutty !kuddy !shoota !relax !jr !cuhz !planet !mahni !tay !yoo !anti');
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
            sendMessage(channel, '🎤 Shoutouts: !ac !4 !four !ec !rock !pnx !tj !spence !snowy !snow !kasha !qween !fvmous !geni !brady !limit !balen !joee !joe !lyrical !p&b !grouch !blessed !phoenix !uncle !breezy !smutty !kuddy !shoota !relax !jr !cuhz !planet !mahni !storm !juan !rico !bern !dame !anti');
            sendMessage(channel, '🎤 Crew: !uni !chi !bot !drizzy !jay !rell !west !jxy !keem !jaylo !tank !neb !papi !raz !famous !rebound !thorn !zuri !shock !kay !yoo !tay !badguy !night !reacts');
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
            // Internal tier names ("Pro"/"Premium") never ship to chat — they
            // collide with the site membership and aren't what anyone bought.
            sendMessage(channel, `Follow-age is an upgraded-channel perk cuhz 💎 — !prices`);
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
                // Calendar-accurate diff (src/duration.js). The old fixed 365/30
                // decomposition was off by up to ±18 days in production —
                // verified against Helix followed_at ground truth.
                const timeStr = formatDuration(calendarDiff(new Date(followData.followed_at), new Date()));
                client.say(channel, `@${targetUsername} has been following for ${timeStr}! 📅`);
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
                const balanceText = balance === null ? 'Balance is unavailable right now.' : `Balance: ${balance} 💎`;
                client.say(channel, `🎉 FOLLOW BONUS CLAIMED! @${tags.username} received 300 points! ${balanceText}`);
            } else {
                client.say(channel, `⚠️ @${tags.username} the follower bonus could not be confirmed. It may already be claimed, or points may be unavailable. Check !points later.`);
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

    // !rewards — the "what are points actually FOR" answer. All tiers, every
    // channel, ONE line built straight from POINT_REWARDS so chat and the
    // website (GET /api/rewards) can never drift apart.
    if (msg === '!rewards' || msg === '!shop' || msg === '!redeem') {
        sendMessage(channel, buildRewardsLine());
        return;
    }

    if (msg === '!points' || msg === '!balance') {
        const balance = await pointsService.getBalance(tags.username);
        if (balance === null) {
            sendMessage(channel, `⚠️ @${tags.username} your CUHZ Points balance is unavailable right now. Try !points again later.`);
            return;
        }
        sendMessage(channel, `💰 @${tags.username} you got ${balance} CUHZ Points in the bank`);
        return;
    }

    // !watchtime — all tiers. Aggregate watch minutes across every CUHZ channel,
    // accrued alongside presence points (passive paycheck) in handleMessage.
    if (msg === '!watchtime') {
        try {
            const profile = await userMemory.getProfile(tags.username);
            const mins = profile && profile.total_watch_minutes ? profile.total_watch_minutes : 0;
            if (mins > 0) {
                sendMessage(channel, `@${tags.username} has watched for ${formatMinutes(mins)} across the CUHZ fam 💎`);
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
            const granted = await pointsService.addPoints(target, amount, `admin_grant_by_${tags.username}`);
            if (granted) {
                client.say(channel, `💸 @${tags.username} gave ${amount} points to @${target}!`);
            } else {
                client.say(channel, `⚠️ @${tags.username} the points grant to @${target} could not be confirmed. Check the balance before trying again.`);
            }
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
        if (balance === null) {
            client.say(channel, `⚠️ @${tags.username} your CUHZ Points balance is unavailable right now. Gamble is paused for this request.`);
            return;
        }
        if (balance < amount) {
            client.say(channel, `🚫 You're broke cuhz! You only have ${balance} points.`);
            return;
        }

        const win = Math.random() < 0.5;
        const settled = win
            ? await pointsService.addPoints(tags.username, amount, 'gamble_win')
            : await pointsService.deductPoints(tags.username, amount, 'gamble_loss');
        if (!settled) {
            client.say(channel, `⚠️ @${tags.username} the gamble points result could not be confirmed. Check !points later before trying again.`);
            return;
        }
        if (win) {
            client.say(channel, `🎰 WINNER! @${tags.username} won ${amount} CUHZ Points! 🟢`);
        } else {
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
                const balanceText = balance === null ? 'Balance is unavailable.' : `Current balance: ${balance}.`;
                // A false mutation result may include a lost COMMIT reply. Even
                // a low balance cannot prove this was an insufficient-funds refusal.
                client.say(channel, `⚠️ @${tags.username} the points payment could not be confirmed for ${brainName}. ${balanceText} Check !points later before trying again.`);
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
                const balanceText = balance === null ? 'Balance is unavailable.' : `Current balance: ${balance}.`;
                client.say(channel, `⚠️ @${tags.username} the points payment could not be confirmed. ${balanceText} Check !points later before trying again.`);
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
        const res = await moderation.announce(channel, tags.username, announcement);
        if (!res.ok) client.say(channel, res.message);
        return;
    }

    if (msg.startsWith('!raid ') && isMod) {
        // Loose-parse first @username-like token, same pattern as !so.
        const match = message.match(/@?([A-Za-z0-9_]{3,25})/g);
        const rawTarget = match && match.length >= 2 ? match[1] : null; // [0] is "raid"
        if (!rawTarget) return;
        const target = rawTarget.replace('@', '').toLowerCase();
        const farewell = pickNoRepeat(`raid:${cleanChannel}`, RAID_FAREWELLS, 2).replace('{target}', target);
        sendMessage(channel, farewell);
        // Twitch only lets the broadcaster's own token start a raid — prompt honestly
        // instead of sending a dead /raid chat command (removed by Twitch in 2023).
        const res = await moderation.raid(channel, tags.username, target);
        sendMessage(channel, res.message);
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
            const persistent = db.type === 'postgres';
            client.say(channel, `🤖 Status: LIVE | Scopes: ${validation.scopes.length} | Followage: ${hasFollowerScope ? '✅' : '❌'} | Title/Game: ${hasBroadcastScope ? '✅' : '❌'} | Points storage: ${persistent ? '✅ Postgres (safe)' : '⚠️ SQLite (RESETS ON DEPLOY)'}`);
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

    // --- Real Helix moderation (IRC /commands were removed by Twitch 2023-02;
    // --- the old client.say('/ban …') pattern silently did nothing) ---

    if (msg.startsWith('!ban ') && isMod) {
        const parts = message.split(' ');
        const target = parts[1];
        const reason = parts.slice(2).join(' ') || undefined;
        if (!target) return;
        const res = await moderation.banOrTimeout(channel, tags.username, target, null, reason);
        client.say(channel, res.message);
        return;
    }

    if (msg.startsWith('!timeout ') && isMod) {
        const parts = message.split(' ');
        const target = parts[1];
        const duration = Math.max(1, Math.min(parseInt(parts[2], 10) || 600, 1209600)); // Twitch max 14d
        const reason = parts.slice(3).join(' ') || undefined;
        if (!target) return;
        const res = await moderation.banOrTimeout(channel, tags.username, target, duration, reason);
        client.say(channel, res.message);
        return;
    }

    if (msg === '!clear' && isMod) {
        const res = await moderation.clearChat(channel, tags.username);
        client.say(channel, res.message);
        return;
    }

    if (msg.startsWith('!slow ') && isMod) {
        const seconds = Math.max(1, Math.min(parseInt(message.split(' ')[1], 10) || 10, 120));
        const res = await moderation.setSlowMode(channel, tags.username, seconds);
        client.say(channel, res.message);
        return;
    }

    if (msg === '!slowoff' && isMod) {
        const res = await moderation.setSlowMode(channel, tags.username, 0);
        client.say(channel, res.message);
        return;
    }

    if ((msg.startsWith('!unban ') || msg.startsWith('!untimeout ')) && isMod) {
        const target = message.split(' ')[1];
        if (!target) return;
        const res = await moderation.unban(channel, tags.username, target);
        client.say(channel, res.message);
        return;
    }

    // Self-documenting mod panel: what can CUHZ Bot's mod kit do RIGHT NOW in
    // this channel — including whether the token scopes actually back each one.
    if ((msg === '!mod' || msg === '!modcommands') && isMod) {
        const validation = await validateToken();
        const cap = moderation.capabilityReport(validation && validation.scopes);
        const mark = (ok) => ok ? '✅' : '⚠️';
        sendMessage(channel, `🛡️ CUHZ Bot mod kit — enforcement: ${mark(cap.ban)} !ban [reason] !timeout [secs] [reason] !unban !untimeout · ${mark(cap.clear)} !clear · ${mark(cap.slow)} !slow [secs] !slowoff · ${mark(cap.announce)} !announce <text>`);
        sendMessage(channel, `🛡️ Stream: !title !game !so !raid · Intel: !chatreport !userreport !mood !personality !botcheck · Points: !give · Setup: !settoday !cleartoday !refresh${(cap.ban && cap.clear && cap.slow && cap.announce) ? '' : ' — ⚠️ = bot token missing that scope (run !botcheck)'}`);
        // Tier/owner-gated extras: only listed where they'd actually run.
        if (isProOrPremium) sendMessage(channel, `🛡️ Auto-shoutouts (upgraded channels): !addstreamer <user> · !removestreamer <user> · !liststreamers`);
        if (tags.username === 'planetcuhz') sendMessage(channel, `👑 Owner: !status · !aistats`);
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
                // Receiver requires a 'text' field — without it every attempt
                // got 400 {"error":"Missing text"} in production.
                text: `[twitch] #${channel.replace('#', '')} ${tags.username}: ${message}`,
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
        const target = sanitizeChannel(channel);
        if (!target) return res.status(400).json({ error: 'Channel is required' });
        await client.join(target);
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
        sharedChatGuard: sharedChatGuard.stats(),
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

// --- Public Points API (no auth) ---
// planetcuhz.com embeds the dashboard and renders these directly, so they are
// deliberately unauthenticated: read-only, no chat content, no PII beyond the
// public Twitch display names already visible in chat and on !top.
// Cached 60s so a busy site can't hammer the DB.

// Normalized the same way points_service does, so lookups match stored rows.
function normalizePointsUser(name) {
    return String(name || '').toLowerCase().replace('@', '').trim();
}

app.get('/api/points/leaderboard', async (req, res) => {
    try {
        const raw = parseInt(req.query.limit, 10);
        const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 10;
        const rows = await pointsService.getRichList(limit);
        res.set('Cache-Control', 'public, max-age=60');
        res.json({
            updated_at: new Date().toISOString(),
            leaderboard: rows.map((r, i) => ({
                rank: i + 1,
                username: r.username,
                points: r.points
            }))
        });
    } catch (err) {
        logger.error('/api/points/leaderboard failed:', err.message);
        res.status(500).json({ error: 'internal error' });
    }
});

app.get('/api/points/user/:username', async (req, res) => {
    try {
        const username = normalizePointsUser(req.params.username);
        if (!username) return res.status(404).json({ error: 'not found' });

        const points = await pointsService.getBalance(username);
        if (points === null) {
            res.set('Cache-Control', 'no-store');
            return res.status(503).json({ error: 'points balance unavailable' });
        }

        // points_service exposes no rank query and we don't own that file, so
        // rank comes from the top-100 rich list; anyone below that returns null.
        const top = await pointsService.getRichList(100);
        const idx = top.findIndex(r => normalizePointsUser(r.username) === username);

        // getBalance() returns 0 for both "no row" and "row with 0 points", so a
        // 0-balance user absent from the top 100 is treated as not found. A real
        // 0-point holder can't be told apart without a query we're not allowed to add.
        if (points === 0 && idx === -1) {
            return res.status(404).json({ error: 'not found' });
        }

        res.set('Cache-Control', 'public, max-age=60');
        res.json({
            username,
            points,
            rank: idx === -1 ? null : idx + 1
        });
    } catch (err) {
        logger.error('/api/points/user failed:', err.message);
        res.status(500).json({ error: 'internal error' });
    }
});

// Same POINT_REWARDS registry the bot announces via !rewards — single source of truth.
app.get('/api/rewards', (req, res) => {
    try {
        res.set('Cache-Control', 'public, max-age=60');
        res.json({
            updated_at: new Date().toISOString(),
            rewards: POINT_REWARDS.map(r => ({ cost: r.cost, name: r.name, note: r.note || null }))
        });
    } catch (err) {
        logger.error('/api/rewards failed:', err.message);
        res.status(500).json({ error: 'internal error' });
    }
});

// THE CUHZ LAB — read-only lounge state for the OBS page (Lane K). This is the
// ONLY lounge route and it is GET-only. Route-level CORS because the global
// cors() above allows POST and would otherwise be inherited. Unknown, disabled
// and non-allowlisted channels get the identical house-default payload, so the
// route is not a channel-enumeration oracle. The JSON is serialized once per
// state change, not per request, so a poll flood cannot starve the IRC loop.
app.use('/api/lounge', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    res.set('Allow', 'GET');
    res.status(405).json({ error: 'GET only' });
});
app.get('/api/lounge/state', cors({ methods: ['GET'], origin: '*' }), (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.type('application/json');
        const raw = typeof req.query.channel === 'string' ? req.query.channel : '';
        const login = String(sanitizeChannel(raw) || '').replace(/^#/, '');
        const roomId = loungeEnabled() ? LOUNGE_ROOMS[login] : null;
        res.send(roomId ? loungeStateJson(roomId) : loungeHouseJson());
    } catch (err) {
        logger.error('/api/lounge/state failed:', err.message);
        res.status(500).json({ error: 'internal error' });
    }
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
    // Lane K: turbo decay and idle revert. Started here, not at module level —
    // the isolated boot harness forbids timers and never invokes this callback.
    const loungeClock = setInterval(() => {
        for (const roomId of LOUNGE_ROOM_IDS) {
            if (loungeControl.tick(roomId)) loungeStateChanged(roomId);
        }
    }, 5000);
    if (typeof loungeClock.unref === 'function') loungeClock.unref();
    initializeTwitchClient();
});
