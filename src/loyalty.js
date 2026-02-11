const db = require('./database');
const logger = require('./logger');

class LoyaltySystem {

    constructor() {
        this.achievements = [
            { id: 'first_chat', name: 'First Contact', description: 'Sent your first message', condition: (stats) => stats.messages_sent >= 1 },
            { id: 'regular', name: 'Regular', description: 'Sent 100 messages', condition: (stats) => stats.messages_sent >= 100 },
            { id: 'dedicated', name: 'Dedicated', description: 'Sent 1000 messages', condition: (stats) => stats.messages_sent >= 1000 },
            { id: 'veteran', name: 'Veteran', description: 'Sent 5000 messages', condition: (stats) => stats.messages_sent >= 5000 },
            { id: 'point_hoarder', name: 'Point Hoarder', description: 'Amassed 1000 points', condition: (stats) => stats.points >= 1000 },
            { id: 'wealthy', name: 'Planet Oligarch', description: 'Amassed 10,000 points', condition: (stats) => stats.points >= 10000 },
            {
                id: 'night_owl', name: 'Night Owl', description: 'Chatted between 3AM and 5AM', condition: (stats, context) => {
                    const hour = new Date().getHours();
                    return hour >= 3 && hour < 5;
                }
            }
        ];
    }

    /**
     * Check if user earned any new achievements
     * @param {string} username 
     * @returns {string[]} List of newly earned achievement names
     */
    async checkAchievements(username) {
        try {
            const user = await db.prepare('SELECT points, messages_sent FROM users WHERE username = ?').get(username);

            if (!user) return [];

            const earned = await db.prepare('SELECT achievement_name FROM achievements WHERE username = ?').all(username);
            const earnedSet = new Set(earned.map(e => e.achievement_name));

            const newAchievements = [];

            for (const ach of this.achievements) {
                if (!earnedSet.has(ach.name)) {
                    // Check condition
                    if (ach.condition(user)) {
                        await this.grantAchievement(username, ach.name);
                        newAchievements.push(ach.name);
                    }
                }
            }
            return newAchievements;
        } catch (err) {
            logger.error(`Error checking achievements for ${username}: ${err.message}`);
            return [];
        }
    }

    async grantAchievement(username, achievementName) {
        try {
            await db.prepare('INSERT INTO achievements (username, achievement_name) VALUES (?, ?)').run(username, achievementName);
            logger.info(`🏆 Achievement unlocked: ${username} earned '${achievementName}'`);
        } catch (err) {
            // Ignore unique constraint violation
        }
    }

    async getAchievements(username) {
        return await db.prepare('SELECT achievement_name, earned_at FROM achievements WHERE username = ? ORDER BY earned_at DESC').all(username);
    }
}

module.exports = new LoyaltySystem();
