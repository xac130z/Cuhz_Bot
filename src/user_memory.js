const logger = require('./logger');
const db = require('./database');
const aiService = require('./ai_service');

/**
 * User Memory Module — gives the bot memory of who users are.
 * Records messages, builds profiles, tracks relationships.
 */

// In-memory command usage tracker (flushed to DB periodically)
const commandUsageBuffer = new Map(); // username -> { cmd: count }

/**
 * Record a chat message to the chat_log and update user_profiles
 * @param {string} channel
 * @param {string} username
 * @param {string} message
 * @param {boolean} isCommand - Whether the message is a bot command
 */
async function recordMessage(channel, username, message, isCommand = false) {
    try {
        const usernameL = username.toLowerCase();

        // Log the message
        await db.prepare(`
            INSERT INTO chat_log (channel, username, message, is_command)
            VALUES (?, ?, ?, ?)
        `).run(channel, usernameL, message, isCommand ? 1 : 0);

        // Upsert user profile
        await db.prepare(`
            INSERT INTO user_profiles (username, display_name, total_messages, last_seen)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(username) DO UPDATE SET
                total_messages = user_profiles.total_messages + 1,
                last_seen = CURRENT_TIMESTAMP
        `).run(usernameL, username);

        // Track command usage in-memory
        if (isCommand) {
            const cmdName = message.split(' ')[0].toLowerCase();
            if (!commandUsageBuffer.has(usernameL)) {
                commandUsageBuffer.set(usernameL, {});
            }
            const cmds = commandUsageBuffer.get(usernameL);
            cmds[cmdName] = (cmds[cmdName] || 0) + 1;
        }

    } catch (error) {
        logger.error(`❌ Failed to record message: ${error.message}`);
    }
}

/**
 * Get user profile with computed fields
 * @param {string} username
 * @returns {Promise<Object|null>}
 */
async function getProfile(username) {
    try {
        const usernameL = username.toLowerCase();
        const profile = await db.prepare(`
            SELECT * FROM user_profiles WHERE username = ?
        `).get(usernameL);

        if (!profile) return null;

        // Compute days since first seen
        if (profile.first_seen) {
            const firstSeen = new Date(profile.first_seen);
            profile.days_active = Math.floor((Date.now() - firstSeen.getTime()) / (1000 * 60 * 60 * 24));
        }

        return profile;
    } catch (error) {
        logger.error(`❌ Failed to get profile for ${username}: ${error.message}`);
        return null;
    }
}

/**
 * Update relationship score based on engagement
 * Called periodically or after significant interactions
 * @param {string} username
 */
async function updateRelationshipScore(username) {
    try {
        const usernameL = username.toLowerCase();
        const profile = await getProfile(usernameL);
        if (!profile) return;

        // Score factors:
        // - Messages sent (logarithmic — 100 msgs = ~20 points)
        // - Days active (1 point per 3 days, max 30)
        // - Command usage (5 points if uses >3 different commands)
        const msgScore = Math.min(30, Math.floor(Math.log2(profile.total_messages + 1) * 5));
        const dayScore = Math.min(30, Math.floor((profile.days_active || 0) / 3));

        // Check unique commands used
        let cmdScore = 0;
        const cmdData = commandUsageBuffer.get(usernameL);
        if (cmdData && Object.keys(cmdData).length >= 3) {
            cmdScore = 10;
        }

        // Subscriber/follower bonus
        const subBonus = profile.is_subscriber ? 15 : 0;
        const followBonus = profile.is_follower ? 10 : 0;

        const totalScore = Math.min(100, msgScore + dayScore + cmdScore + subBonus + followBonus);

        await db.prepare(`
            UPDATE user_profiles SET relationship_score = ? WHERE username = ?
        `).run(totalScore, usernameL);

    } catch (error) {
        logger.error(`❌ Failed to update relationship score: ${error.message}`);
    }
}

/**
 * Get top chatters for a channel within a time window
 * @param {string} channel
 * @param {number} hours - Hours to look back
 * @param {number} limit - Number of results
 * @returns {Promise<Array>}
 */
async function getTopChatters(channel, hours = 24, limit = 5) {
    try {
        const since = new Date(Date.now() - hours * 3600000).toISOString();

        const topChatters = await db.prepare(`
            SELECT username, COUNT(*) as msg_count
            FROM chat_log
            WHERE channel = ? AND created_at >= ? AND is_command = 0
            GROUP BY username
            ORDER BY msg_count DESC
            LIMIT ?
        `).all(channel, since, limit);

        return topChatters;
    } catch (error) {
        logger.error(`❌ Failed to get top chatters: ${error.message}`);
        return [];
    }
}

/**
 * Get recent message history for a user
 * @param {string} username
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getUserHistory(username, limit = 20) {
    try {
        const usernameL = username.toLowerCase();
        const history = await db.prepare(`
            SELECT channel, message, created_at
            FROM chat_log
            WHERE username = ?
            ORDER BY created_at DESC
            LIMIT ?
        `).all(usernameL, limit);

        return history;
    } catch (error) {
        logger.error(`❌ Failed to get user history: ${error.message}`);
        return [];
    }
}

/**
 * Generate an AI summary of who a user is based on their chat history
 * @param {string} username
 * @returns {Promise<string>}
 */
async function generateUserSummary(username) {
    const profile = await getProfile(username);
    if (!profile) return 'Unknown user — no data yet.';

    const history = await getUserHistory(username, 30);
    if (history.length === 0) return `${username} is new — no chat history yet.`;

    // Build a quick summary from data we have
    const daysSinceFirst = profile.days_active || 0;
    const msgCount = profile.total_messages || 0;
    const recentMsgs = history.slice(0, 10).map(h => h.message).join(' | ');

    // Only use AI if we have enough data AND the service is available
    try {
        const prompt = `Based on this Twitch chatter's data, write a 1-sentence fun profile summary (under 150 chars):

Username: ${username}
Days in community: ${daysSinceFirst}
Total messages: ${msgCount}
Relationship score: ${profile.relationship_score}/100
Recent messages: ${recentMsgs}

Write a single friendly sentence about who this person seems to be. Be specific, mention their interests if apparent. Use casual/fun tone.`;

        const result = await aiService.generateContextAwareResponse(prompt, [], 'neutral', {});
        if (result) {
            // Save the summary
            await db.prepare(`
                UPDATE user_profiles SET notes = ? WHERE username = ?
            `).run(result, username.toLowerCase());
            return result;
        }
    } catch (err) {
        logger.warn(`⚠️ Could not generate AI summary for ${username}: ${err.message}`);
    }

    // Fallback without AI
    const summary = `${username} has been here ${daysSinceFirst} days with ${msgCount} messages (score: ${profile.relationship_score}/100)`;
    return summary;
}

/**
 * Flush command usage buffer to DB (call periodically)
 */
async function flushCommandUsage() {
    try {
        for (const [username, cmds] of commandUsageBuffer.entries()) {
            const cmdJson = JSON.stringify(cmds);
            await db.prepare(`
                UPDATE user_profiles SET favorite_commands = ? WHERE username = ?
            `).run(cmdJson, username);
        }
        commandUsageBuffer.clear();
    } catch (error) {
        logger.error(`❌ Failed to flush command usage: ${error.message}`);
    }
}

// Flush command usage every 10 minutes
setInterval(flushCommandUsage, 10 * 60 * 1000);

/**
 * Prune old chat_log entries (keep last 30 days to manage DB size)
 */
async function pruneOldLogs() {
    try {
        const cutoff = new Date(Date.now() - 30 * 24 * 3600000).toISOString();
        const result = await db.prepare(`
            DELETE FROM chat_log WHERE created_at < ?
        `).run(cutoff);

        if (result.changes > 0) {
            logger.info(`🧹 Pruned ${result.changes} old chat log entries`);
        }
    } catch (error) {
        logger.error(`❌ Failed to prune chat logs: ${error.message}`);
    }
}

// Prune old logs once per day
setInterval(pruneOldLogs, 24 * 3600000);

module.exports = {
    recordMessage,
    getProfile,
    updateRelationshipScore,
    getTopChatters,
    getUserHistory,
    generateUserSummary,
    flushCommandUsage
};
