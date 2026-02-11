const db = require('./database');
const logger = require('./logger');
const aiService = require('./ai_service');

class StreamIntel {
    constructor() {
        this.activeSessions = new Map(); // channel -> sessionId
    }

    /**
     * Called when stream status is polled
     * @param {string} channel - Channel name
     * @param {object} status - { isLive, viewers, title, game }
     */
    async updateStreamStatus(channel, status) {
        if (status.isLive) {
            await this.handleLiveStream(channel, status);
        } else {
            await this.handleOfflineStream(channel);
        }
    }

    async handleLiveStream(channel, status) {
        let sessionId = this.activeSessions.get(channel);

        if (!sessionId) {
            // Check if there's an open session in DB (in case bot restarted mid-stream)
            const openSession = await db.prepare('SELECT id FROM stream_sessions WHERE channel = ? AND ended_at IS NULL ORDER BY created_at DESC LIMIT 1').get(channel);

            if (openSession) {
                sessionId = openSession.id;
                this.activeSessions.set(channel, sessionId);
                logger.info(`📺 Resumed tracking stream session #${sessionId} for ${channel}`);
            } else {
                // Start new session
                const res = await db.prepare('INSERT INTO stream_sessions (channel, started_at, peak_viewers, avg_viewers) VALUES (?, CURRENT_TIMESTAMP, ?, ?)')
                    .run(channel, status.viewers, status.viewers);
                sessionId = res.lastInsertRowid;
                this.activeSessions.set(channel, sessionId);
                logger.info(`📺 STREAM STARTED! Tracking session #${sessionId} for ${channel}`);
            }
        }

        // Update stats
        try {
            // Update peak viewers if current is higher
            await db.prepare('UPDATE stream_sessions SET peak_viewers = MAX(peak_viewers, ?), avg_viewers = (avg_viewers + ?) / 2 WHERE id = ?')
                .run(status.viewers, status.viewers, sessionId);
        } catch (err) {
            logger.error(`Failed to update stream stats for ${channel}: ${err.message}`);
        }
    }

    async handleOfflineStream(channel) {
        const sessionId = this.activeSessions.get(channel);
        if (sessionId) {
            // End session
            logger.info(`📺 STREAM ENDED for ${channel}. Finalizing session #${sessionId}...`);
            await db.prepare('UPDATE stream_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);
            this.activeSessions.delete(channel);

            // Generate Recap (Async)
            this.generateRecap(channel, sessionId).catch(err => logger.error('Recap generation failed:', err));
        }
    }

    async generateRecap(channel, sessionId) {
        try {
            // 1. Get Session Data
            const session = await db.prepare('SELECT * FROM stream_sessions WHERE id = ?').get(sessionId);

            // 2. Get Chat Stats
            const chatStats = await db.prepare(`
                SELECT count(*) as total, count(distinct username) as chatters 
                FROM chat_log 
                WHERE channel = ? AND created_at >= ? AND created_at <= ?
            `).get(channel, session.started_at, session.ended_at || new Date().toISOString());

            // 3. Update Session with Chat Stats
            await db.prepare('UPDATE stream_sessions SET total_messages = ?, unique_chatters = ? WHERE id = ?')
                .run(chatStats.total, chatStats.chatters, sessionId);

            // 4. Generate AI Summary (if enough chats)
            if (chatStats.total > 10) {
                // Fetch sample of messages for context
                const messages = await db.prepare(`
                    SELECT username, message FROM chat_log 
                    WHERE channel = ? AND created_at >= ? AND created_at <= ? 
                    ORDER BY RANDOM() LIMIT 50
                `).all(channel, session.started_at, session.ended_at || new Date().toISOString());

                const context = messages.map(m => `${m.username}: ${m.message}`).join('\n');

                // We'll trust AI service to summarize
                // Note: We need to expose a summarizer in ai_service, or just use askBrain
                // For now, simple placeholder
                // const summary = await aiService.askBrain('brain', `Summarize this stream based on these chat logs involved: ${context}`, 'system');
                // await db.prepare('UPDATE stream_sessions SET mood_summary = ? WHERE id = ?').run(summary, sessionId);
            }
        } catch (err) {
            logger.error(`Error generating recap for ${channel} session ${sessionId}:`, err.message);
        }
    }

    async getStats(channel) {
        try {
            const currentSession = this.activeSessions.get(channel);
            if (currentSession) {
                const session = await db.prepare('SELECT * FROM stream_sessions WHERE id = ?').get(currentSession);
                return { isLive: true, ...session };
            }

            // Get last session
            const lastSession = await db.prepare('SELECT * FROM stream_sessions WHERE channel = ? ORDER BY created_at DESC LIMIT 1').get(channel);
            return { isLive: false, ...lastSession };
        } catch (err) {
            return null;
        }
    }
}

module.exports = new StreamIntel();
