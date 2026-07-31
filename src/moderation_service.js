/**
 * moderation_service.js — real Twitch moderation via the Helix API.
 *
 * Twitch removed IRC chat moderation commands (/ban, /timeout, /clear, /slow,
 * /announce, /raid, …) for third-party clients on 2023-02-24. Sending them as
 * chat messages does nothing. Every action here goes through Helix instead,
 * reports success/failure back to chat, and writes a mod_actions audit row.
 *
 * Auth model (two separate grants, both required):
 *   1. The streamer types /mod <botname> in their channel (Twitch checks this
 *      server-side on every call — moderator_id must hold mod status there).
 *   2. The bot's own OAuth token must carry the per-action scope below.
 *      moderator_id must equal the user id inside the token (the bot itself).
 *
 * Exception: POST /helix/raids only works when from_broadcaster_id matches the
 * token's user. The bot's token can never raid on a streamer's behalf, so
 * raid() degrades to an honest prompt instead of pretending.
 */

const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

const SCOPES = {
    ban: 'moderator:manage:banned_users',
    timeout: 'moderator:manage:banned_users',
    unban: 'moderator:manage:banned_users',
    clear: 'moderator:manage:chat_messages',
    slow: 'moderator:manage:chat_settings',
    announce: 'moderator:manage:announcements',
    raid: 'channel:manage:raids'
};

let deps = null; // { db, getTwitchUser, getIds } — injected from bot.js
let http = axios; // swappable in tests

function init(injected) {
    deps = injected;
    if (injected.http) http = injected.http;
}

function apiBase() {
    return config.twitchApiBase || 'https://api.twitch.tv/helix';
}

function authHeaders(ids) {
    return {
        'Client-ID': ids.clientId,
        'Authorization': `Bearer ${config.oauthToken.replace('oauth:', '')}`
    };
}

async function resolveIds(channel, targetLogin) {
    const ids = await deps.getIds();
    if (!ids || !ids.clientId || !ids.botUserId) {
        return { error: '❌ Bot identity not validated yet — try again in a moment.' };
    }
    const broadcaster = await deps.getTwitchUser(channel.replace('#', ''));
    if (!broadcaster) return { error: `❌ Could not resolve channel ${channel}.` };
    let target = null;
    if (targetLogin) {
        target = await deps.getTwitchUser(targetLogin.replace('@', ''));
        if (!target) return { error: `❌ User not found: ${targetLogin}` };
    }
    return { ids, broadcaster, target };
}

/** Map a Helix error to an honest chat message. Never leaks the token. */
function describeError(action, err) {
    const status = err.response && err.response.status;
    const twitchMsg = err.response && err.response.data && err.response.data.message;
    if (status === 401 || status === 403) {
        return `❌ Twitch refused (${status}): bot token is missing scope ${SCOPES[action]} or CUHZ Bot isn't a mod in this channel.`;
    }
    if (status === 429) return '❌ Twitch rate limit hit — wait a few seconds and retry.';
    if (status === 400 && twitchMsg) return `❌ Twitch rejected it: ${twitchMsg}`;
    return `❌ ${action} failed${twitchMsg ? `: ${twitchMsg}` : ' (network or API error).'}`;
}

/** Audit every attempt; never let logging break moderation. */
async function audit(channel, actor, action, target, detail, result) {
    try {
        await deps.db.prepare(`
            INSERT INTO mod_actions (channel, actor, action, target, detail, result)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(channel, actor, action, target || null, detail || null, result);
    } catch (err) {
        logger.error('mod_actions audit write failed:', err.message);
    }
}

/** Shared runner: resolve ids -> call helix -> audit -> honest message. */
async function run(action, channel, actor, targetLogin, detail, call) {
    const r = await resolveIds(channel, targetLogin);
    if (r.error) {
        await audit(channel, actor, action, targetLogin, detail, `blocked: ${r.error}`);
        return { ok: false, message: r.error };
    }
    try {
        await call(r);
        await audit(channel, actor, action, targetLogin, detail, 'ok');
        return { ok: true };
    } catch (err) {
        const message = describeError(action, err);
        logger.error(`Helix ${action} failed in ${channel}:`, (err.response && JSON.stringify(err.response.data)) || err.message);
        await audit(channel, actor, action, targetLogin, detail, `fail: ${(err.response && err.response.status) || err.message}`);
        return { ok: false, message };
    }
}

/** Ban (no duration) or timeout (durationSec set). */
async function banOrTimeout(channel, actor, targetLogin, durationSec, reason) {
    const action = durationSec ? 'timeout' : 'ban';
    const result = await run(action, channel, actor, targetLogin, durationSec ? `${durationSec}s` : null, async ({ ids, broadcaster, target }) => {
        const data = { user_id: target.id };
        if (durationSec) data.duration = durationSec;
        if (reason) data.reason = String(reason).slice(0, 500);
        await http.post(`${apiBase()}/moderation/bans`, { data }, {
            params: { broadcaster_id: broadcaster.id, moderator_id: ids.botUserId },
            headers: authHeaders(ids), timeout: 10000
        });
    });
    if (result.ok) {
        result.message = durationSec
            ? `⏳ @${targetLogin.replace('@', '')} timed out for ${durationSec}s.`
            : `🔨 @${targetLogin.replace('@', '')} banned.`;
    }
    return result;
}

async function unban(channel, actor, targetLogin) {
    const result = await run('unban', channel, actor, targetLogin, null, async ({ ids, broadcaster, target }) => {
        await http.delete(`${apiBase()}/moderation/bans`, {
            params: { broadcaster_id: broadcaster.id, moderator_id: ids.botUserId, user_id: target.id },
            headers: authHeaders(ids), timeout: 10000
        });
    });
    if (result.ok) result.message = `✅ @${targetLogin.replace('@', '')} unbanned / timeout lifted.`;
    return result;
}

async function clearChat(channel, actor) {
    const result = await run('clear', channel, actor, null, null, async ({ ids, broadcaster }) => {
        await http.delete(`${apiBase()}/chat/messages`, {
            params: { broadcaster_id: broadcaster.id, moderator_id: ids.botUserId },
            headers: authHeaders(ids), timeout: 10000
        });
    });
    if (result.ok) result.message = '🧹 Chat cleared.';
    return result;
}

async function setSlowMode(channel, actor, seconds) {
    const on = seconds > 0;
    const result = await run('slow', channel, actor, null, on ? `${seconds}s` : 'off', async ({ ids, broadcaster }) => {
        const body = on ? { slow_mode: true, slow_mode_wait_time: seconds } : { slow_mode: false };
        await http.patch(`${apiBase()}/chat/settings`, body, {
            params: { broadcaster_id: broadcaster.id, moderator_id: ids.botUserId },
            headers: authHeaders(ids), timeout: 10000
        });
    });
    if (result.ok) result.message = on ? `🐢 Slow mode: one message every ${seconds}s.` : '🐇 Slow mode off.';
    return result;
}

async function announce(channel, actor, text) {
    const result = await run('announce', channel, actor, null, text.slice(0, 60), async ({ ids, broadcaster }) => {
        await http.post(`${apiBase()}/chat/announcements`,
            { message: text.slice(0, 500), color: 'primary' },
            {
                params: { broadcaster_id: broadcaster.id, moderator_id: ids.botUserId },
                headers: authHeaders(ids), timeout: 10000
            });
    });
    // Announcements show themselves — no extra confirmation needed on success.
    return result;
}

/**
 * Raids can only be started by the broadcaster's own token. The bot's token
 * can never do this for another channel — say so instead of failing silently.
 */
async function raid(channel, actor, targetLogin) {
    const streamer = channel.replace('#', '');
    await audit(channel, actor, 'raid', targetLogin, null, 'prompted-broadcaster');
    return {
        ok: false,
        message: `🚀 Hype is up for @${targetLogin.replace('@', '')} — @${streamer}, Twitch only lets the broadcaster launch: type /raid ${targetLogin.replace('@', '')} to send everyone over!`
    };
}

/** Which moderation capabilities does the current token actually cover? */
function capabilityReport(scopes) {
    const have = new Set(scopes || []);
    return {
        ban: have.has(SCOPES.ban),
        clear: have.has(SCOPES.clear),
        slow: have.has(SCOPES.slow),
        announce: have.has(SCOPES.announce)
    };
}

module.exports = { init, banOrTimeout, unban, clearChat, setSlowMode, announce, raid, capabilityReport, SCOPES };
