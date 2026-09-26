'use strict';

// ============================================================================
//  CUHZ Bot — Twitch Edge Intelligence Service
//
//  Direct high-speed GQL edge queries to Twitch (gql.twitch.tv).
//  Provides sub-second (20-150ms) ground-truth data with ZERO streamer OAuth tokens:
//    - Resilient Live Stream Telemetry (!uptime fallback, !tags)
//    - Historical Archives (!topclip, !vod / !laststream)
//    - Community & Chatter Identity (!age / !accountage, !followers / !goal)
//    - Official Sub Emotes (!emotes / !subemotes)
//    - Esports Directory Scouting (!category, !rank)
//    - Chat Safety & Rules Status (!chatrules / !chatmode)
// ============================================================================

const axios = require('axios');
const logger = require('./logger');

const GQL_ENDPOINT = 'https://gql.twitch.tv/gql';
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const CACHE_TTL_MS = 30 * 1000; // 30s cache to protect against chat command spam

const _cache = new Map(); // cacheKey -> { timestamp, data }
let _mockFetcher = null;  // Unit testing seam

function normalizeLogin(val) {
    if (!val) return '';
    return String(val).replace(/^#/, '').replace(/^@/, '').trim().toLowerCase();
}

function getCached(key) {
    const entry = _cache.get(key);
    if (entry && (Date.now() - entry.timestamp < CACHE_TTL_MS)) {
        return entry.data;
    }
    return null;
}

function setCached(key, data) {
    _cache.set(key, { timestamp: Date.now(), data });
    // Keep cache bounded
    if (_cache.size > 200) {
        const oldestKey = _cache.keys().next().value;
        _cache.delete(oldestKey);
    }
}

/**
 * Executes a raw Twitch GQL query
 */
async function executeGql(operationName, query, variables = {}) {
    if (_mockFetcher) {
        return await _mockFetcher(operationName, variables);
    }

    try {
        const res = await axios.post(GQL_ENDPOINT, {
            operationName,
            query,
            variables
        }, {
            headers: {
                'Client-ID': GQL_CLIENT_ID,
                'Content-Type': 'application/json'
            },
            timeout: 4500
        });
        return res.data && res.data.data ? res.data.data : null;
    } catch (err) {
        logger.warn(`[TwitchEdge] Query ${operationName} failed: ${err.message}`);
        return null;
    }
}

/**
 * 1. Live Stream Telemetry & Uptime Fallback
 */
async function getLiveStream(channel) {
    const login = normalizeLogin(channel);
    if (!login) return null;

    const cacheKey = `stream:${login}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const query = `query StreamTelemetry($login: String!) {
        user(login: $login) {
            displayName
            stream {
                id
                type
                viewersCount
                createdAt
                previewImageURL(width: 640, height: 360)
                game { id name }
                tags { id localizedName }
            }
        }
    }`;

    const data = await executeGql('StreamTelemetry', query, { login });
    const user = data && data.user;
    if (!user) return null;

    const stream = user.stream;
    const result = {
        login,
        displayName: user.displayName || login,
        isLive: !!stream,
        startedAt: stream ? new Date(stream.createdAt) : null,
        game: stream && stream.game ? stream.game.name : null,
        viewers: stream && typeof stream.viewersCount === 'number' ? stream.viewersCount : 0,
        previewUrl: stream ? stream.previewImageURL : null,
        tags: stream && Array.isArray(stream.tags) ? stream.tags.map(t => t.localizedName) : []
    };

    setCached(cacheKey, result);
    return result;
}

/**
 * 2. Top Legendary Clip
 */
async function getTopClip(channel) {
    const login = normalizeLogin(channel);
    if (!login) return null;

    const cacheKey = `topclip:${login}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const query = `query TopClip($login: String!) {
        user(login: $login) {
            clips(first: 1, criteria: { filter: ALL_TIME }) {
                edges {
                    node {
                        title
                        viewCount
                        slug
                        durationSeconds
                        curator { displayName }
                    }
                }
            }
        }
    }`;

    const data = await executeGql('TopClip', query, { login });
    const clips = data && data.user && data.user.clips && data.user.clips.edges;
    if (!clips || clips.length === 0) return null;

    const node = clips[0].node;
    const result = {
        title: node.title,
        viewCount: node.viewCount,
        url: `https://clips.twitch.tv/${node.slug}`,
        curator: node.curator ? node.curator.displayName : 'Anonymous',
        durationSeconds: node.durationSeconds
    };

    setCached(cacheKey, result);
    return result;
}

/**
 * 3. Last Past Broadcast / VOD
 */
async function getLastVOD(channel) {
    const login = normalizeLogin(channel);
    if (!login) return null;

    const cacheKey = `vod:${login}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const query = `query LastVOD($login: String!) {
        user(login: $login) {
            videos(first: 1, type: ARCHIVE) {
                edges {
                    node {
                        id
                        title
                        lengthSeconds
                        viewCount
                        publishedAt
                    }
                }
            }
        }
    }`;

    const data = await executeGql('LastVOD', query, { login });
    const videos = data && data.user && data.user.videos && data.user.videos.edges;
    if (!videos || videos.length === 0) return null;

    const node = videos[0].node;
    const hours = Math.floor(node.lengthSeconds / 3600);
    const mins = Math.floor((node.lengthSeconds % 3600) / 60);
    const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    const result = {
        id: node.id,
        title: node.title,
        lengthSeconds: node.lengthSeconds,
        durationFormatted: durationStr,
        viewCount: node.viewCount,
        publishedAt: node.publishedAt,
        url: `https://www.twitch.tv/videos/${node.id}`
    };

    setCached(cacheKey, result);
    return result;
}

/**
 * 4. Chatter / Streamer Account Age
 */
async function getAccountAge(targetUser) {
    const login = normalizeLogin(targetUser);
    if (!login) return null;

    const cacheKey = `age:${login}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const query = `query AccountAge($login: String!) {
        user(login: $login) {
            displayName
            createdAt
        }
    }`;

    const data = await executeGql('AccountAge', query, { login });
    if (!data || !data.user || !data.user.createdAt) return null;

    const created = new Date(data.user.createdAt);
    const diffMs = Date.now() - created.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const years = Math.floor(diffDays / 365);
    const remainingDays = diffDays % 365;

    const result = {
        login,
        displayName: data.user.displayName || login,
        createdAt: created,
        daysOld: diffDays,
        yearsOld: years,
        remainingDays,
        dateFormatted: created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    };

    setCached(cacheKey, result);
    return result;
}

/**
 * 5. Verified Follower Count
 */
async function getFollowerCount(channel) {
    const login = normalizeLogin(channel);
    if (!login) return null;

    const cacheKey = `followers:${login}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const query = `query FollowerCount($login: String!) {
        user(login: $login) {
            displayName
            followers { totalCount }
        }
    }`;

    const data = await executeGql('FollowerCount', query, { login });
    if (!data || !data.user || !data.user.followers) return null;

    const total = data.user.followers.totalCount || 0;
    const result = {
        login,
        displayName: data.user.displayName || login,
        totalCount: total,
        formatted: total.toLocaleString()
    };

    setCached(cacheKey, result);
    return result;
}

/**
 * 6. Subscriber Emotes
 */
async function getSubEmotes(channel) {
    const login = normalizeLogin(channel);
    if (!login) return [];

    const cacheKey = `emotes:${login}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const query = `query ChannelEmotes($login: String!) {
        user(login: $login) {
            subscriptionProducts {
                displayName
                emotes { token }
            }
        }
    }`;

    const data = await executeGql('ChannelEmotes', query, { login });
    const products = data && data.user && data.user.subscriptionProducts;
    if (!products || !Array.isArray(products)) return [];

    const tokens = [];
    for (const prod of products) {
        if (prod.emotes && Array.isArray(prod.emotes)) {
            for (const em of prod.emotes) {
                if (em.token) tokens.push(em.token);
            }
        }
    }

    setCached(cacheKey, tokens);
    return tokens;
}

/**
 * 7. Category Directory & Streamer Rank
 */
async function getCategoryRank(gameName, channel) {
    const login = normalizeLogin(channel);
    const cleanGame = String(gameName || '').trim();
    if (!cleanGame) return null;

    const cacheKey = `category:${cleanGame.toLowerCase()}:${login}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const query = `query CategoryRank($game: String!) {
        game(name: $game) {
            name
            viewersCount
            streams(first: 20) {
                edges {
                    node {
                        broadcaster { login displayName }
                        viewersCount
                    }
                }
            }
        }
    }`;

    const data = await executeGql('CategoryRank', query, { game: cleanGame });
    const game = data && data.game;
    if (!game) return null;

    const streams = (game.streams && game.streams.edges) ? game.streams.edges : [];
    let rank = null;
    let streamerNode = null;

    for (let i = 0; i < streams.length; i++) {
        const b = streams[i].node.broadcaster;
        if (b && b.login.toLowerCase() === login) {
            rank = i + 1;
            streamerNode = streams[i].node;
            break;
        }
    }

    const result = {
        game: game.name,
        categoryViewers: game.viewersCount || 0,
        rank: rank, // e.g. 1 if top in category, null if > 20
        topStreamer: streams.length > 0 ? streams[0].node.broadcaster.displayName : null,
        topViewers: streams.length > 0 ? streams[0].node.viewersCount : 0
    };

    setCached(cacheKey, result);
    return result;
}

/**
 * 8. Chat Safety & Rules Status
 */
async function getChatRules(channel) {
    const login = normalizeLogin(channel);
    if (!login) return null;

    const cacheKey = `rules:${login}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const query = `query ChatRules($login: String!) {
        user(login: $login) {
            chatSettings {
                followersOnlyDurationMinutes
                slowModeDurationSeconds
                blockLinks
            }
        }
    }`;

    const data = await executeGql('ChatRules', query, { login });
    const s = data && data.user && data.user.chatSettings;
    if (!s) return null;

    const result = {
        followersOnlyMinutes: s.followersOnlyDurationMinutes,
        slowModeSeconds: s.slowModeDurationSeconds,
        blockLinks: !!s.blockLinks
    };

    setCached(cacheKey, result);
    return result;
}

/**
 * Clean human-readable uptime duration formatter
 */
function formatUptimeDuration(startedAt) {
    if (!startedAt) return 'offline';
    const diff = Math.max(0, Date.now() - new Date(startedAt).getTime());
    const totalMinutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0) {
        return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
    }
    return `${hours}h ${minutes}m`;
}

function clearCache() {
    _cache.clear();
}

function setMockFetcher(fn) {
    _mockFetcher = fn;
}

module.exports = {
    normalizeLogin,
    getLiveStream,
    getTopClip,
    getLastVOD,
    getAccountAge,
    getFollowerCount,
    getSubEmotes,
    getCategoryRank,
    getChatRules,
    formatUptimeDuration,
    clearCache,
    setMockFetcher
};
