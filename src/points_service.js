const db = require('./database');
const logger = require('./logger');

// =============================================
//  POINTS SERVICE (The Economy)
// =============================================

class PointsService {

    /**
     * Add points to a user and log the transaction
     */
    async addPoints(username, amount, reason) {
        if (amount <= 0) return false;

        try {
            const safeUser = username.toLowerCase().replace('@', '');

            // 1. Update user balance (fast cache)
            const upsertUser = db.prepare(`
                INSERT INTO users (username, points, messages_sent, last_seen)
                VALUES (?, ?, 0, CURRENT_TIMESTAMP)
                ON CONFLICT(username) DO UPDATE SET
                    points = points + ?
            `);
            await upsertUser.run(safeUser, amount, amount);

            // 2. Log transaction to ledger
            const logTx = db.prepare('INSERT INTO points_ledger (username, amount, reason) VALUES (?, ?, ?)');
            await logTx.run(safeUser, amount, reason);

            logger.info(`💰 Added ${amount} ${amount === 1 ? 'point' : 'points'} to ${safeUser} (${reason})`);
            return true;
        } catch (err) {
            logger.error(`❌ Failed to add points for ${username}: ${err.message}`);
            return false;
        }
    }

    /**
     * Deduct points if balance is sufficient
     * @returns {Promise<boolean>} true if successful, false if insufficient funds
     */
    async deductPoints(username, amount, reason) {
        if (amount <= 0) return true; // No cost

        try {
            const safeUser = username.toLowerCase().replace('@', '');

            // 1. Check balance
            const user = await db.prepare('SELECT points FROM users WHERE username = ?').get(safeUser);
            const currentPoints = user ? user.points : 0;

            if (currentPoints < amount) {
                logger.debug(`🚫 ${safeUser} insufficient funds: ${currentPoints} < ${amount}`);
                return false;
            }

            // 2. Deduct from balance
            await db.prepare('UPDATE users SET points = points - ? WHERE username = ?').run(amount, safeUser);

            // 3. Log transaction (negative amount)
            const logTx = db.prepare('INSERT INTO points_ledger (username, amount, reason) VALUES (?, ?, ?)');
            await logTx.run(safeUser, -amount, reason);

            logger.info(`💸 Deducted ${amount} ${amount === 1 ? 'point' : 'points'} from ${safeUser} (${reason})`);
            return true;
        } catch (err) {
            logger.error(`❌ Failed to deduct points for ${username}: ${err.message}`);
            return false;
        }
    }

    /**
     * Get current balance
     */
    async getBalance(username) {
        try {
            const safeUser = username.toLowerCase().replace('@', '');
            const user = await db.prepare('SELECT points FROM users WHERE username = ?').get(safeUser);
            return user ? user.points : 0;
        } catch (err) {
            return 0;
        }
    }

    /**
     * Get top point holders
     */
    async getRichList(limit = 5) {
        try {
            const rows = await db.prepare('SELECT username, points FROM users ORDER BY points DESC LIMIT ?').all(limit);
            return rows;
        } catch (err) {
            logger.error('Failed to get rich list:', err);
            return [];
        }
    }

    /**
     * Top point earners in the last 7 days (rolled up from points_ledger).
     * Negative ledger entries (spends) reduce the weekly total — so this is NET earnings.
     */
    async getWeeklyTop(limit = 5) {
        try {
            // Cutoff computed in JS — datetime('now','-7 days') is SQLite-only
            // and would crash on the production Postgres.
            const since = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
            const rows = await db.prepare(`
                SELECT username, SUM(amount) AS points
                FROM points_ledger
                WHERE created_at >= ?
                GROUP BY username
                HAVING SUM(amount) > 0
                ORDER BY SUM(amount) DESC
                LIMIT ?
            `).all(since, limit);
            return rows;
        } catch (err) {
            logger.error('Failed to get weekly top:', err);
            return [];
        }
    }

    /**
     * Claim a one-time bonus (like follower bonus)
     * Checks ledger to ensuring no prior claim of this type
     */
    async claimBonus(username, bonusType, amount) {
        try {
            const safeUser = username.toLowerCase().replace('@', '');

            // 1. Check if already claimed
            const existingClaim = await db.prepare('SELECT id FROM points_ledger WHERE username = ? AND reason = ?').get(safeUser, bonusType);

            if (existingClaim) {
                return false; // Already claimed
            }

            // 2. Award points
            return await this.addPoints(safeUser, amount, bonusType);
        } catch (err) {
            logger.error(`❌ Failed to claim bonus for ${username}: ${err.message}`);
            return false;
        }
    }
}

module.exports = new PointsService();
