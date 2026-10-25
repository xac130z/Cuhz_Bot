'use strict';

// ============================================================================
//  CUHZ Bot — Clips & Community Promo Service (!clip)
//
//  Enables viewers and moderators to type !clip (or !clip <title>) in Twitch chat.
//  Requests a native clip or provides the manual clip tool, stores pending
//  metadata and attempts the existing +10 loyalty award. Report each outcome
//  separately: a pending row is not proof of capture or Discord delivery.
// ============================================================================

const axios = require('axios');
const db = require('./database');
const config = require('./config');
const logger = require('./logger');
const pointsService = require('./points_service');

const CLIP_REWARD_POINTS = 10;
const COOLDOWN_MS = 15 * 1000; // 15s per-user cooldown to prevent chat spam
const _userCooldowns = new Map(); // username -> lastClipMs

class ClipsService {
    /**
     * Check if user is on cooldown
     */
    isOnCooldown(username) {
        const last = _userCooldowns.get(username.toLowerCase()) || 0;
        return (Date.now() - last) < COOLDOWN_MS;
    }

    /**
     * Record a new community clip from Twitch chat
     */
    async handleClipCommand(channel, username, rawTitle = '', broadcasterId = null) {
        const usernameL = username.toLowerCase();
        const cleanChannel = channel.replace('#', '').toLowerCase();

        if (this.isOnCooldown(usernameL)) {
            return {
                success: false,
                cooldown: true,
                message: `@${username} chill cuhz, clip command is on cooldown (15s)! ⏳`
            };
        }

        _userCooldowns.set(usernameL, Date.now());

        const title = rawTitle.trim() || `Hype Moment by @${cleanChannel}`;
        let clipUrl = null;
        let clipId = null;
        let timecode = null;
        let verified = false;

        // This private context comes from TMI's room-id, never the login/title.
        const roomId = typeof broadcasterId === 'string' && /^[1-9][0-9]{0,127}$/.test(broadcasterId) ? broadcasterId : null;
        const configuredClient = process.env.TWITCH_CLIENT_ID;
        const clientId = typeof configuredClient === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(configuredClient) ? configuredClient : '';
        const token = typeof config.oauthToken === 'string' ? config.oauthToken.replace(/^oauth:/, '').trim() : '';
        // Missing native authorization/context keeps the manual tool available.
        if (roomId && clientId && token && !config.useMockApi) {
            const headers = { 'Authorization': `Bearer ${token}`, 'Client-ID': clientId };
            try {
                const res = await axios.post(
                    `${config.twitchApiBase}/clips`,
                    {},
                    {
                        headers,
                        params: { broadcaster_id: roomId },
                        timeout: 3000,
                        maxContentLength: 65536, maxRedirects: 0
                    }
                );

                const id = Array.isArray(res?.data?.data) ? res.data.data[0]?.id : null;
                if (res?.status === 202 && typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)) {
                    clipId = id;
                    clipUrl = `https://clips.twitch.tv/${clipId}`;
                    // One bounded read, no polling or repeated creation. Empty,
                    // lost or mismatched reads leave asynchronous acceptance intact.
                    try {
                        const check = await axios.get(`${config.twitchApiBase}/clips`, {
                            headers, params: { id: clipId }, timeout: 3000, maxContentLength: 65536, maxRedirects: 0
                        });
                        verified = check?.status === 200 && Array.isArray(check?.data?.data) &&
                            check.data.data.some(clip => clip?.id === clipId && clip?.broadcaster_id === roomId);
                    } catch {
                        // Acceptance is known; completion remains unverified.
                    }
                }
            } catch {
                // Do not log provider error payloads or repeat an uncertain POST.
                logger.warn('Twitch Helix clip creation is unconfirmed.');
            }
        }

        // Fallback clip URL if direct creation requires manual cut
        if (!clipUrl) {
            clipUrl = `https://www.twitch.tv/${encodeURIComponent(cleanChannel)}/clip`;
        }

        // 2. Persist clip record in community_clips table
        let recorded = false;
        try {
            const result = await db.prepare(`
                INSERT INTO community_clips (channel, clipped_by, title, clip_url, clip_id, timecode, status)
                VALUES (?, ?, ?, ?, ?, ?, 'pending')
            `).run(cleanChannel, usernameL, title, clipUrl, clipId, timecode);
            recorded = result?.changes === 1;
        } catch (dbErr) {
            logger.error(`Failed to save community clip: ${dbErr.message}`);
        }

        // 3. Award community member loyalty points for clipping
        let awarded = false;
        try {
            awarded = await pointsService.addPoints(usernameL, CLIP_REWARD_POINTS, 'community_clip', channel) === true;
        } catch (ptsErr) {
            logger.warn(`Points award for clip failed: ${ptsErr.message}`);
        }

        // Twitch's 202 starts asynchronous creation; it does not prove the
        // clip is published. Do not infer a failed write from a lost reply.
        const capture = verified ? 'verified' : clipId ? 'accepted' : 'unconfirmed';
        const captureText = verified ? 'Twitch clip verified.' : clipId ? 'Twitch accepted your clip request; creation is not verified.' : 'Clip creation is unconfirmed; open the manual clip tool.';
        const recordText = recorded ? 'Request saved for community review.' : 'Request save is unconfirmed.';
        const pointsText = awarded ? `+${CLIP_REWARD_POINTS} CUHZ Points confirmed.` : 'Points status is unconfirmed; do not retry for points.';
        const chatUrl = clipId ? `https://www.twitch.tv/${encodeURIComponent(cleanChannel)}/clip/${clipId}` : clipUrl;
        // Keep the complete user title in metadata, not in an acknowledgement:
        // its length or embedded links must not erase/block outcome qualifiers.
        const announcement = `🎬 @${username.slice(0, 25)} ${captureText} ${recordText} 💎 ${pointsText} ${chatUrl}`;

        return {
            success: recorded,
            capture,
            record: recorded ? 'confirmed' : 'unconfirmed',
            points: awarded ? 'confirmed' : 'unconfirmed',
            title,
            clipUrl,
            announcement
        };
    }

    /**
     * Fetch pending clips for promo compilation
     */
    async getPendingClips(limit = 10) {
        try {
            return await db.prepare(`
                SELECT id, channel, clipped_by, title, clip_url, clip_id, timecode, created_at
                FROM community_clips
                WHERE status = 'pending'
                ORDER BY created_at DESC
                LIMIT ?
            `).all(limit);
        } catch (err) {
            logger.error(`Failed to fetch pending clips: ${err.message}`);
            return [];
        }
    }

    /**
     * Mark clips as compiled
     */
    async markClipsCompiled(clipIds) {
        if (!clipIds || clipIds.length === 0) return;
        const placeholders = clipIds.map(() => '?').join(',');
        try {
            await db.prepare(`
                UPDATE community_clips
                SET status = 'compiled'
                WHERE id IN (${placeholders})
            `).run(...clipIds);
        } catch (err) {
            logger.error(`Failed to mark clips compiled: ${err.message}`);
        }
    }
}

module.exports = new ClipsService();
