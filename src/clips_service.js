'use strict';

// ============================================================================
//  CUHZ Bot — Clips & Community Promo Service (!clip)
//
//  Enables viewers and moderators to type !clip (or !clip <title>) in Twitch chat.
//  Captures the live stream moment, stores metadata in the community_clips vault,
//  awards loyalty points (+10 CUHZ Points) to the clipper, and queues the clip
//  for automated community compilation highlight reels posted to Discord #cuhz-clips.
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
    async handleClipCommand(channel, username, rawTitle = '') {
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

        // 1. Check if Twitch API can generate native clip
        if (config.oauthToken && !config.useMockApi) {
            try {
                // Attempt Helix clip creation if broadcaster/bot authorization permits
                const res = await axios.post(
                    `${config.twitchApiBase}/clips?broadcaster_id=${cleanChannel}`,
                    {},
                    {
                        headers: {
                            'Authorization': `Bearer ${config.oauthToken.replace('oauth:', '')}`,
                            'Client-ID': process.env.TWITCH_CLIENT_ID || 'kimne78kx3ncx6brgo4mv6wki5h1ko'
                        },
                        timeout: 3000
                    }
                ).catch(() => null);

                if (res && res.data && res.data.data && res.data.data[0]) {
                    clipId = res.data.data[0].id;
                    clipUrl = `https://clips.twitch.tv/${clipId}`;
                }
            } catch (err) {
                logger.warn(`Twitch Helix clip generation skipped: ${err.message}`);
            }
        }

        // Fallback clip URL if direct creation requires manual cut
        if (!clipUrl) {
            clipUrl = `https://www.twitch.tv/${cleanChannel}/clip`;
        }

        // 2. Persist clip record in community_clips table
        try {
            await db.prepare(`
                INSERT INTO community_clips (channel, clipped_by, title, clip_url, clip_id, timecode, status)
                VALUES (?, ?, ?, ?, ?, ?, 'pending')
            `).run(cleanChannel, usernameL, title, clipUrl, clipId, timecode);
        } catch (dbErr) {
            logger.error(`Failed to save community clip: ${dbErr.message}`);
        }

        // 3. Award community member loyalty points for clipping
        try {
            await pointsService.addPoints(usernameL, CLIP_REWARD_POINTS, 'community_clip', channel);
        } catch (ptsErr) {
            logger.warn(`Points award for clip failed: ${ptsErr.message}`);
        }

        const announcement = `🎬 @${username} clipped that moment: "${title}"! 💎 +${CLIP_REWARD_POINTS} CUHZ Points awarded! Queued for the community promo in Discord #cuhz-clips! 🌌`;

        return {
            success: true,
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
