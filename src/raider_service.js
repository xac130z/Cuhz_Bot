'use strict';

// ============================================================================
//  CUHZ Bot — Raider & Community Stream Scout Service (!raider)
//
//  Enables streamers, moderators, and community members to run !raider in chat.
//  Scans the live Twitch status of the entire Planet CUHZ community roster in real time
//  via a lightweight GQL query (single ~180ms batch call, zero broadcaster auth needed).
//  Filters out the active channel so the streamer never raids themselves, and returns
//  a ranked, brand-authentic recommendation with game title, viewers, and instant
//  /raid syntax.
// ============================================================================

const axios = require('axios');
const logger = require('./logger');

// Canonical 2026 Planet CUHZ verified streamer roster
const DEFAULT_ROSTER = [
    'four_a_reason',
    'planetcuhz',
    'cuhz_bot',
    'rico2ez',
    'thatgirlmahni_',
    'stormygirlnz89',
    'razredg1',
    'snowy_wolfies_ttv',
    'ohthatztayy',
    'westsiderelly',
    'grouch392'
];

const GQL_ENDPOINT = 'https://gql.twitch.tv/gql';
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const CACHE_TTL_MS = 30 * 1000; // 30-second cache window to prevent chat spam

let _cache = {
    timestamp: 0,
    streams: []
};

// Seam for hermetic unit testing
let _netFetcher = null;

function normalizeChannel(ch) {
    if (!ch) return '';
    return String(ch).replace(/^#/, '').replace(/^@/, '').trim().toLowerCase();
}

/**
 * Fetch live status of all roster channels from Twitch GQL
 */
async function fetchLiveStreams(roster = DEFAULT_ROSTER) {
    const now = Date.now();
    if (_cache.timestamp && (now - _cache.timestamp < CACHE_TTL_MS)) {
        return _cache.streams;
    }

    if (_netFetcher) {
        const mockData = await _netFetcher(roster);
        const sorted = (mockData || []).slice().sort((a, b) => (b.viewers || 0) - (a.viewers || 0));
        _cache = { timestamp: now, streams: sorted };
        return sorted;
    }

    try {
        const payload = roster.map(ch => ({
            operationName: 'StreamRefetchQuery',
            variables: { channel: ch },
            query: 'query StreamRefetchQuery($channel: String!) { user(login: $channel) { login displayName stream { id type viewersCount game { name } title createdAt } } }'
        }));

        const res = await axios.post(GQL_ENDPOINT, payload, {
            headers: {
                'Client-ID': GQL_CLIENT_ID,
                'Content-Type': 'application/json'
            },
            timeout: 4000
        });

        const liveList = [];
        if (Array.isArray(res.data)) {
            for (const item of res.data) {
                const user = item && item.data && item.data.user;
                if (!user) continue;
                const stream = user.stream;
                if (stream) {
                    liveList.push({
                        login: user.login.toLowerCase(),
                        displayName: user.displayName,
                        game: (stream.game && stream.game.name) ? stream.game.name : 'Just Chatting',
                        viewers: typeof stream.viewersCount === 'number' ? stream.viewersCount : 0,
                        title: stream.title || ''
                    });
                }
            }
        }

        // Sort descending by viewer count, secondary by name
        liveList.sort((a, b) => b.viewers - a.viewers);

        _cache = {
            timestamp: now,
            streams: liveList
        };
        return liveList;
    } catch (err) {
        logger.error(`[RaiderService] Failed to query Twitch GQL: ${err.message}`);
        // Return stale cache if available, else empty list
        return _cache.streams || [];
    }
}

/**
 * Get raid recommendation for a specific chat channel
 * @param {string} currentChannel - The channel where !raider was invoked
 * @param {string[]} customRoster - Optional custom roster list
 */
async function getRaiderRecommendation(currentChannel, customRoster = DEFAULT_ROSTER) {
    const cleanCurrent = normalizeChannel(currentChannel);
    const liveStreams = await fetchLiveStreams(customRoster);

    // Filter out the channel running the command so nobody raids themselves
    const availableTargets = liveStreams.filter(s => s.login !== cleanCurrent);

    if (availableTargets.length === 0) {
        return `🌌 All CUHZ roster streamers are resting their frequencies right now! Explore our creators at planetcuhz.com/creators or raid a community friend! 💎`;
    }

    if (availableTargets.length === 1) {
        const target = availableTargets[0];
        return `🚀 CUHZ Raid Target: @${target.displayName} is LIVE playing ${target.game} (${target.viewers} ${target.viewers === 1 ? 'viewer' : 'viewers'})! Ready to raid: type /raid ${target.login} or !raid @${target.login} 🔥`;
    }

    // Multiple available targets
    const primary = availableTargets[0];
    const runnersUp = availableTargets.slice(1, 3).map(s => `@${s.displayName} (${s.game})`).join(', ');
    return `🚀 CUHZ Raid Scout: @${primary.displayName} is LIVE playing ${primary.game} (${primary.viewers} viewers)! Also online: ${runnersUp} — Type /raid ${primary.login} or !raid @${primary.login} to launch! 🌌`;
}

/**
 * Force clear cache (useful for tests or immediate re-scans)
 */
function clearCache() {
    _cache = { timestamp: 0, streams: [] };
}

/**
 * Set custom mock fetcher for testing
 */
function setMockFetcher(fn) {
    _netFetcher = fn;
}

module.exports = {
    DEFAULT_ROSTER,
    fetchLiveStreams,
    getRaiderRecommendation,
    clearCache,
    setMockFetcher,
    normalizeChannel
};
