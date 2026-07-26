'use strict';

// ============================================================================
//  CUHZ Bot — Followage service (!followage / !following)
//
//  Twitch removed the old `GET /helix/users/follows` endpoint (deprecated
//  Feb 2023, shut off Aug 2023). The ONLY way to read a follow date now is
//      GET /helix/channels/followers?broadcaster_id=...&user_id=...
//  which requires a user access token carrying `moderator:read:followers`
//  AND the token's user must be the broadcaster or one of their moderators.
//  Documented operating assumption: CuhzBot is modded in every home channel
//  (standing "/mod CuhzBot" practice).
//
//  HARD LAWS:
//   - Honest replies ONLY. A 401/403 (missing scope / bot not modded) is
//     reported as "I need mod status", NEVER as "you're not following".
//     API failures are reported as failures, never as a made-up followage.
//   - Never crash or stall the message loop: every path resolves to a plain
//     result object, and the whole lookup races a hard 3s deadline.
//   - Cache: follow results per (broadcaster,user) ~10 min; broadcaster and
//     user id resolutions (login -> id) cached long-lived per channel/login.
// ============================================================================

const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

// --- Tunables ---------------------------------------------------------------
const REQUEST_TIMEOUT_MS = 2500;                  // per Helix call
const DEADLINE_MS = 3000;                         // whole-lookup budget (<=3s)
const FOLLOW_CACHE_TTL_MS = 10 * 60 * 1000;       // follow answers: 10 min
const NO_PERMISSION_TTL_MS = 60 * 1000;           // 401/403: retry after 1 min
const ID_CACHE_TTL_MS = 6 * 60 * 60 * 1000;       // login -> id: 6 h
const CACHE_MAX_ENTRIES = 2000;

// --- State ------------------------------------------------------------------
let _get = (url, options) => axios.get(url, options);  // network seam (tests)
const _idCache = new Map();      // login -> { id, display, fetchedAt } (null id = no such user)
const _followCache = new Map();  // `${broadcasterId}:${userId}` -> { status, followedAt, fetchedAt }
let _warnedNoPermission = false; // log the scope hint once, not per message

function _now() { return Date.now(); }

function _cachePut(map, key, value) {
    if (map.size >= CACHE_MAX_ENTRIES) {
        // Drop the oldest insertion — simple bound, never grows unbounded.
        const first = map.keys().next().value;
        if (first !== undefined) map.delete(first);
    }
    map.set(key, value);
}

function _apiBase() {
    return config.twitchApiBase || 'https://api.twitch.tv/helix';
}

function _headers(auth) {
    return {
        'Client-ID': auth.clientId,
        'Authorization': `Bearer ${auth.token}`
    };
}

// --- Login -> id resolution (cached) ----------------------------------------
// Returns { id, display } | { id: null } (no such user). Throws on API failure
// so callers can distinguish "unknown user" from "Twitch is down".
async function resolveUser(login, auth) {
    const clean = String(login || '').replace(/^[#@]/, '').toLowerCase();
    if (!clean) return { id: null };

    const cached = _idCache.get(clean);
    if (cached && (_now() - cached.fetchedAt) < ID_CACHE_TTL_MS) {
        return { id: cached.id, display: cached.display };
    }

    const response = await _get(`${_apiBase()}/users`, {
        params: { login: clean },
        headers: _headers(auth),
        timeout: REQUEST_TIMEOUT_MS
    });

    const row = response && response.data && Array.isArray(response.data.data)
        ? response.data.data[0]
        : undefined;
    const entry = row
        ? { id: row.id, display: row.display_name || clean, fetchedAt: _now() }
        : { id: null, display: clean, fetchedAt: _now() };
    _cachePut(_idCache, clean, entry);
    return { id: entry.id, display: entry.display };
}

// --- Followers endpoint ------------------------------------------------------
// Returns { status: 'following', followedAt } | { status: 'not_following' }
//        | { status: 'no_permission' } | { status: 'error' }
async function fetchFollow(broadcasterId, userId, auth) {
    try {
        const response = await _get(`${_apiBase()}/channels/followers`, {
            params: { broadcaster_id: broadcasterId, user_id: userId },
            headers: _headers(auth),
            timeout: REQUEST_TIMEOUT_MS
        });
        const row = response && response.data && Array.isArray(response.data.data)
            ? response.data.data[0]
            : undefined;
        if (row && row.followed_at) {
            return { status: 'following', followedAt: row.followed_at };
        }
        return { status: 'not_following' };
    } catch (error) {
        const httpStatus = error && error.response ? error.response.status : null;
        if (httpStatus === 401 || httpStatus === 403) {
            if (!_warnedNoPermission) {
                _warnedNoPermission = true;
                logger.error(
                    `Followage denied (HTTP ${httpStatus}). The bot token needs the ` +
                    `"moderator:read:followers" scope AND CuhzBot must be modded in the channel.`
                );
            }
            return { status: 'no_permission' };
        }
        logger.error(`Followage API error: ${error && error.message ? error.message : error}`);
        return { status: 'error' };
    }
}

// --- Human duration ----------------------------------------------------------
// Calendar-accurate (UTC) years/months/days: "2 years, 3 months, 12 days".
// Sub-day follows get hours; brand-new follows get "less than an hour".
function formatDuration(followedAt, now = new Date()) {
    const from = followedAt instanceof Date ? followedAt : new Date(followedAt);
    const to = now instanceof Date ? now : new Date(now);
    if (isNaN(from.getTime()) || from > to) return 'less than an hour';

    let years = to.getUTCFullYear() - from.getUTCFullYear();
    let months = to.getUTCMonth() - from.getUTCMonth();
    let days = to.getUTCDate() - from.getUTCDate();

    if (days < 0) {
        months -= 1;
        // Days in the month BEFORE `to` (UTC): day 0 of the current month.
        days += new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0)).getUTCDate();
    }
    if (months < 0) {
        years -= 1;
        months += 12;
    }

    if (years === 0 && months === 0 && days === 0) {
        const hours = Math.floor((to.getTime() - from.getTime()) / (60 * 60 * 1000));
        if (hours < 1) return 'less than an hour';
        return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    }

    const parts = [];
    if (years > 0) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
    if (months > 0) parts.push(`${months} ${months === 1 ? 'month' : 'months'}`);
    if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
    return parts.join(', ');
}

// --- Chat reply (cuhz voice; plain text; validateOutbound-safe) ---------------
function buildReply(result, now = new Date()) {
    const name = result.targetDisplay || result.targetLogin || 'cuhz';
    const channelName = result.channelLogin || 'the channel';
    switch (result.status) {
        case 'following':
            return `@${name} has been riding with ${channelName} for ${formatDuration(result.followedAt, now)} — real one, cuhz 💜📅`;
        case 'not_following':
            return `@${name} you're not following ${channelName} yet, cuhz — smash that follow and make it official! 🚀`;
        case 'unknown_user':
            return `Couldn't find a Twitch user named "${name}", cuhz — check the spelling! 🔍`;
        case 'no_permission':
            return `I need mod status to check followage, cuhz — have the streamer /mod me and run it back 🛡️`;
        default:
            return `The follow-checker glitched for a sec, cuhz — run it back in a minute 🔧`;
    }
}

// --- Main entry ---------------------------------------------------------------
// getFollowage({ channelLogin, targetLogin, targetUserId, targetDisplay, auth })
//   auth: { clientId, token } or an async function returning that (or null).
//   targetUserId: pass the tmi `user-id` tag when asking about the sender —
//   skips a /users round-trip entirely.
// Always resolves (never throws) to:
//   { status: 'following'|'not_following'|'unknown_user'|'no_permission'|'error',
//     followedAt?, targetDisplay, targetLogin, channelLogin }
async function getFollowage(opts) {
    const deadlineMs = opts.deadlineMs || DEADLINE_MS;
    const base = {
        targetLogin: opts.targetLogin,
        targetDisplay: opts.targetDisplay || opts.targetLogin,
        channelLogin: String(opts.channelLogin || '').replace(/^#/, '')
    };

    // NOTE: deliberately NOT unref'd — the deadline must be able to fire even on
    // an otherwise-idle event loop, and it is cleared in `finally` on resolution.
    let timer = null;
    const deadline = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ ...base, status: 'error' }), deadlineMs);
    });

    try {
        // The lookup keeps running past the deadline and warms the caches for
        // the next attempt; chat just never waits more than `deadlineMs`.
        return await Promise.race([deadline, lookup(opts, base)]);
    } catch (error) {
        logger.error(`Followage lookup failed: ${error && error.message ? error.message : error}`);
        return { ...base, status: 'error' };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function lookup(opts, base) {
    const auth = typeof opts.auth === 'function' ? await opts.auth() : opts.auth;
    if (!auth || !auth.clientId || !auth.token) return { ...base, status: 'error' };

    // 1. Broadcaster id (cached ~6h per channel).
    let broadcaster;
    try {
        broadcaster = await resolveUser(base.channelLogin, auth);
    } catch (error) {
        logger.error(`Followage broadcaster resolve failed: ${error && error.message ? error.message : error}`);
        return { ...base, status: 'error' };
    }
    if (!broadcaster.id) return { ...base, status: 'error' };

    // 2. Target user id — tmi tags carry it for the sender; only look up others.
    let userId = opts.targetUserId || null;
    if (!userId) {
        let target;
        try {
            target = await resolveUser(opts.targetLogin, auth);
        } catch (error) {
            logger.error(`Followage user resolve failed: ${error && error.message ? error.message : error}`);
            return { ...base, status: 'error' };
        }
        if (!target.id) return { ...base, status: 'unknown_user' };
        userId = target.id;
        if (target.display) base.targetDisplay = opts.targetDisplay || target.display;
    }

    // 3. Follow check, cached ~10 min per (broadcaster, user).
    const cacheKey = `${broadcaster.id}:${userId}`;
    const cached = _followCache.get(cacheKey);
    if (cached) {
        const ttl = cached.status === 'no_permission' ? NO_PERMISSION_TTL_MS : FOLLOW_CACHE_TTL_MS;
        if ((_now() - cached.fetchedAt) < ttl) {
            return { ...base, status: cached.status, followedAt: cached.followedAt };
        }
        _followCache.delete(cacheKey);
    }

    const result = await fetchFollow(broadcaster.id, userId, auth);
    if (result.status !== 'error') {
        // Definitive answers (and short-lived permission denials) are cached;
        // transient API errors are not, so the next try goes straight through.
        _cachePut(_followCache, cacheKey, {
            status: result.status,
            followedAt: result.followedAt,
            fetchedAt: _now()
        });
    }
    return { ...base, status: result.status, followedAt: result.followedAt };
}

module.exports = {
    getFollowage,
    formatDuration,
    buildReply,
    // Exposed for tests:
    _internal: {
        resolveUser,
        fetchFollow,
        setNet: (fn) => { _get = fn; },
        reset: () => {
            _idCache.clear();
            _followCache.clear();
            _warnedNoPermission = false;
            _get = (url, options) => axios.get(url, options);
        },
        _idCache,
        _followCache,
        FOLLOW_CACHE_TTL_MS,
        NO_PERMISSION_TTL_MS
    }
};
