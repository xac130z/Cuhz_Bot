const db = require('./database');
const logger = require('./logger');
const aiService = require('./ai_service');
const userMemory = require('./user_memory');
const moodTracker = require('./mood_tracker');

class ModIntel {

    /**
     * Generate a quick health report of the chat for mods
     */
    async getChatHealth(channel) {
        try {
            // 1. Get recent mood
            const mood = moodTracker.getMoodState(channel);

            // 2. Get activity stats (last hour)
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            const stats = await db.prepare(`
                SELECT count(*) as total, count(distinct username) as chatters 
                FROM chat_log 
                WHERE channel = ? AND created_at > ?
            `).get(channel, oneHourAgo);

            return {
                mood: mood.currentMood,
                energy: mood.energy,
                toxicity: mood.toxicity,
                messagesLastHour: stats.total,
                activeChatters: stats.chatters
            };
        } catch (err) {
            logger.error('Error getting chat health:', err);
            return null;
        }
    }

    /**
     * Generate a detailed AI report for a specific user
     */
    async generateUserReport(username) {
        try {
            const profile = await userMemory.getProfile(username);
            if (!profile) return "User not found in memory.";

            // Fetch recent messages
            const history = await userMemory.getUserHistory(username, 20);
            const recentMsgs = history.map(m => `[${m.created_at}] ${m.message}`).join('\n');

            const prompt = `
                Analyze this user for a moderator report.
                
                User: ${username}
                First Seen: ${profile.first_seen}
                Total Msgs: ${profile.total_messages}
                Known Interests: ${profile.topics_of_interest}
                
                Recent Chat History:
                ${recentMsgs}
                
                Provide a brief "Mod Assessment":
                1. Engagement Level (High/Low)
                2. Vibe Check (Positive/Toxic/Neutral)
                3. Recommended Action (None/Watch/VIP)
            `.trim();

            const report = await aiService.askBrain('brain', prompt, 'system');
            return report;
        } catch (err) {
            logger.error('Error generating user report:', err);
            return "Failed to generate report.";
        }
    }
}

module.exports = new ModIntel();
