const db = require('./database');
const logger = require('./logger');

// =============================================================================
//  CUHZ POINTS SERVICE — THE MODEL (Wave 6 points fix)
// =============================================================================
//  What they are: loyalty points for the CUHZ community. NOT currency, NOT
//  crypto, no cash value. They never expire and never reset.
//
//  Scope: ONE GLOBAL balance per Twitch username across every channel CUHZ Bot
//  sits in. The channel where each earn/spend happened is recorded on the
//  ledger row (points_ledger.channel) for auditability, but the balance itself
//  is global — chat anywhere the bot lives, spend anywhere the bot lives.
//
//  Storage: users.points is the fast balance cache; points_ledger is the
//  append-only source of truth (one row per event: positive = earn, negative =
//  spend). Both persist across restarts, and every query in this file is
//  dialect-safe for BOTH backends (SQLite locally / Postgres on Railway).
//
//  Earn rules (the REAL configured rates — display commands quote EARN below,
//  never hand-typed numbers):
//    +1    per chat message                      reason: chat_message
//    +10   activity bonus, at most once per 10   reason: activity_bonus
//          minutes while you keep chatting. The clock is in-process epoch ms
//          (starts on your first message after boot — no restart farming, and
//          no DB-timestamp timezone parsing, which is what silently killed the
//          old "passive paycheck").
//    +300  one-time follow bonus via !claim      reason: follower_bonus
//    +1000/+5000 monthly Silver/Gold stipend     reason: tier_bonus_YYYY_MM_<tier>
//          (granted by tier_service.grantStipend → claimBonus; the unique
//          per-calendar-month reason string keeps it idempotent)
//    plus !gamble wins and mod !give grants.
//
//  Spend rules (COSTS below): !ask 10 · !ask -brain 50 · !code 25, with the
//  published tier perks applied in bot.js (Silver: base !ask free + brain 80%
//  off → 10; Gold: every brain free). Gamble losses. deductPoints is ATOMIC —
//  the balance check lives inside the UPDATE (points >= cost), so concurrent
//  spends can never drive a balance negative.
//
//  Bugs this rewrite fixed (2026-07): passive paycheck compared UTC DB
//  timestamps parsed as local time (never fired off-UTC) and only paid people
//  who went SILENT for 10–30 min; getWeeklyTop used SQLite-only datetime()
//  which threw on Postgres, so !top was dead in production; deductPoints and
//  claimBonus had check-then-write races; !pointsinfo advertised rates that
//  didn't match the code.
// =============================================================================

/** Real configured earn rates — the single source display commands quote. */
const EARN = Object.freeze({
    CHAT_MESSAGE: 1,           // +1 per chat message
    ACTIVITY_BONUS: 10,        // +10 while actively chatting…
    ACTIVITY_BONUS_MINUTES: 10, // …at most once per this many minutes
    FOLLOW_BONUS: 300          // one-time !claim follow bonus
});

/** Real configured AI spend costs — bot.js command handlers use these too. */
const COSTS = Object.freeze({
    ASK_EYES: 10,          // !ask (Gemini)
    ASK_BRAIN: 50,         // !ask -brain (Claude)
    ASK_BRAIN_SILVER: 10,  // published Silver perk: Claude 80% off (50 → 10)
    CODE_HANDS: 25         // !code (Qwen via Groq)
});

/** UTC 'YYYY-MM-DD HH:MM:SS' N days ago — matches how CURRENT_TIMESTAMP is
 *  stored in BOTH sqlite and (UTC-configured) Postgres, so `created_at >= ?`
 *  compares correctly on either backend. */
function utcCutoffDaysAgo(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 19).replace('T', ' ');
}

const ACTIVITY_PRUNE_SIZE = 5000;
const ACTIVITY_PRUNE_AGE_MS = 6 * 60 * 60 * 1000;

class PointsService {

    constructor() {
        this.EARN = EARN;
        this.COSTS = COSTS;
        // login -> epoch ms of the last activity-bonus mark (bonus granted, or
        // clock started on first message after boot). In-process on purpose:
        // epoch math has no timezone/dialect pitfalls, and worst case after a
        // restart is a 10-minute clock restart — balances themselves are in DB.
        this._activityMarks = new Map();
        // `${user}:${reason}` claims currently inside the check→insert window,
        // so a same-tick double !claim (or stipend re-poll) can't double-award.
        this._claimsInFlight = new Set();
    }

    _safeUser(username) {
        return String(username || '').toLowerCase().replace('@', '').trim();
    }

    /** Append a ledger row. Falls back to the legacy 3-column insert if the
     *  `channel` column migration hasn't landed yet (older Postgres mid-boot). */
    async _logLedger(username, amount, reason, channel) {
        const chan = channel ? String(channel).replace('#', '').toLowerCase() : null;
        try {
            await db.prepare('INSERT INTO points_ledger (username, amount, reason, channel) VALUES (?, ?, ?, ?)')
                .run(username, amount, reason, chan);
        } catch (err) {
            if (err && err.message && /channel/i.test(err.message)) {
                await db.prepare('INSERT INTO points_ledger (username, amount, reason) VALUES (?, ?, ?)')
                    .run(username, amount, reason);
            } else {
                throw err;
            }
        }
    }

    /**
     * The per-chat-message earn path — call once per chat message.
     * One users upsert (points + messages_sent + last_seen together) plus the
     * ledger rows: always +EARN.CHAT_MESSAGE, and +EARN.ACTIVITY_BONUS when the
     * user has kept chatting past the activity interval.
     * @returns {Promise<{earned: number, activityBonus: number}>}
     */
    async recordChatActivity(username, channel) {
        const safeUser = this._safeUser(username);
        if (!safeUser) return { earned: 0, activityBonus: 0 };

        // Activity bonus clock (in-process epoch ms — see header).
        const now = Date.now();
        const mark = this._activityMarks.get(safeUser);
        let activityBonus = 0;
        if (mark === undefined) {
            this._activityMarks.set(safeUser, now); // first message after boot: clock starts
        } else if (now - mark >= EARN.ACTIVITY_BONUS_MINUTES * 60 * 1000) {
            activityBonus = EARN.ACTIVITY_BONUS;
            this._activityMarks.set(safeUser, now);
        }
        this._pruneActivityMarks(now);

        const earned = EARN.CHAT_MESSAGE + activityBonus;
        try {
            // Single upsert: balance, message count, and last_seen move together.
            await db.prepare(`
                INSERT INTO users (username, points, messages_sent, last_seen)
                VALUES (?, ?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(username) DO UPDATE SET
                    points = points + excluded.points,
                    messages_sent = messages_sent + 1,
                    last_seen = CURRENT_TIMESTAMP
            `).run(safeUser, earned);

            await this._logLedger(safeUser, EARN.CHAT_MESSAGE, 'chat_message', channel);
            if (activityBonus > 0) {
                await this._logLedger(safeUser, activityBonus, 'activity_bonus', channel);
                logger.info(`💰 Activity bonus: +${activityBonus} CUHZ points to ${safeUser}`);
            }
            return { earned, activityBonus };
        } catch (err) {
            logger.error(`❌ Failed to record chat activity for ${safeUser}: ${err.message}`);
            return { earned: 0, activityBonus: 0 };
        }
    }

    _pruneActivityMarks(now) {
        if (this._activityMarks.size <= ACTIVITY_PRUNE_SIZE) return;
        for (const [user, ts] of this._activityMarks) {
            if (now - ts > ACTIVITY_PRUNE_AGE_MS) this._activityMarks.delete(user);
        }
    }

    /**
     * Add points to a user and log the transaction.
     * @param {string} [channel] optional channel context for the ledger row
     */
    async addPoints(username, amount, reason, channel) {
        if (!Number.isFinite(amount) || amount <= 0) return false;

        try {
            const safeUser = this._safeUser(username);
            if (!safeUser) return false;

            // 1. Update user balance (fast cache). last_seen deliberately NOT
            //    touched — a stipend or mod !give is not chat activity.
            await db.prepare(`
                INSERT INTO users (username, points, messages_sent, last_seen)
                VALUES (?, ?, 0, CURRENT_TIMESTAMP)
                ON CONFLICT(username) DO UPDATE SET
                    points = points + excluded.points
            `).run(safeUser, amount);

            // 2. Log transaction to ledger
            await this._logLedger(safeUser, amount, reason, channel);

            logger.info(`💰 Added ${amount} points to ${safeUser} (${reason})`);
            return true;
        } catch (err) {
            logger.error(`❌ Failed to add points for ${username}: ${err.message}`);
            return false;
        }
    }

    /**
     * Deduct points if the balance is sufficient — ATOMIC: the balance check is
     * inside the UPDATE (`points >= amount`), so two concurrent spends can never
     * take the same points twice or push a balance negative.
     * @returns {Promise<boolean>} true if deducted, false if insufficient
     */
    async deductPoints(username, amount, reason, channel) {
        if (!Number.isFinite(amount)) return false;
        if (amount <= 0) return true; // No cost (e.g. Gold free brains)

        try {
            const safeUser = this._safeUser(username);
            if (!safeUser) return false;

            const res = await db.prepare(
                'UPDATE users SET points = points - ? WHERE username = ? AND points >= ?'
            ).run(amount, safeUser, amount);

            if (!res || !res.changes) {
                logger.debug(`🚫 ${safeUser} insufficient points for ${amount} (${reason})`);
                return false;
            }

            await this._logLedger(safeUser, -amount, reason, channel);
            logger.info(`💸 Deducted ${amount} points from ${safeUser} (${reason})`);
            return true;
        } catch (err) {
            logger.error(`❌ Failed to deduct points for ${username}: ${err.message}`);
            return false;
        }
    }

    /** Current global balance (0 for unknown users). */
    async getBalance(username) {
        try {
            const safeUser = this._safeUser(username);
            const user = await db.prepare('SELECT points FROM users WHERE username = ?').get(safeUser);
            return user ? user.points : 0;
        } catch (err) {
            return 0;
        }
    }

    /** All-time top balances (users table). */
    async getRichList(limit = 5) {
        try {
            return await db.prepare('SELECT username, points FROM users ORDER BY points DESC LIMIT ?').all(limit);
        } catch (err) {
            logger.error('Failed to get rich list:', err);
            return [];
        }
    }

    /**
     * Top NET point earners of the last 7 days, rolled up from points_ledger
     * (spends subtract). The cutoff is computed in JS as a UTC timestamp string
     * so the query works on BOTH sqlite and Postgres — the old version used
     * SQLite-only datetime() and returned nothing in production.
     */
    async getWeeklyTop(limit = 5) {
        try {
            return await db.prepare(`
                SELECT username, SUM(amount) AS points
                FROM points_ledger
                WHERE created_at >= ?
                GROUP BY username
                HAVING SUM(amount) > 0
                ORDER BY SUM(amount) DESC
                LIMIT ?
            `).all(utcCutoffDaysAgo(7), limit);
        } catch (err) {
            logger.error('Failed to get weekly top:', err);
            return [];
        }
    }

    /**
     * Claim a one-time bonus (follower bonus, monthly tier stipends).
     * Idempotent per (user, reason): the ledger is checked for a prior claim,
     * and an in-flight guard closes the same-tick double-claim window.
     */
    async claimBonus(username, bonusType, amount, channel) {
        const safeUser = this._safeUser(username);
        if (!safeUser) return false;

        const flightKey = `${safeUser}:${bonusType}`;
        if (this._claimsInFlight.has(flightKey)) return false;
        this._claimsInFlight.add(flightKey);
        try {
            const existingClaim = await db.prepare(
                'SELECT id FROM points_ledger WHERE username = ? AND reason = ?'
            ).get(safeUser, bonusType);
            if (existingClaim) return false; // Already claimed

            return await this.addPoints(safeUser, amount, bonusType, channel);
        } catch (err) {
            logger.error(`❌ Failed to claim bonus for ${username}: ${err.message}`);
            return false;
        } finally {
            this._claimsInFlight.delete(flightKey);
        }
    }

    // --- Display copy (cuhz voice, validateOutbound-safe, REAL rates only) ---

    /** The !points / !balance reply. */
    buildPointsLine(displayName, balance) {
        const b = Number(balance || 0).toLocaleString('en-US');
        return `💰 @${displayName} — ${b} CUHZ points on the books. Earn: +${EARN.CHAT_MESSAGE} per message, +${EARN.ACTIVITY_BONUS} every ${EARN.ACTIVITY_BONUS_MINUTES} min you keep chattin'. !claim = one-time +${EARN.FOLLOW_BONUS} follow bonus · !top = weekly leaders 💎`;
    }

    /** The static !pointsinfo reply. */
    buildPointsInfoLine() {
        return `💎 CUHZ points never expire — one balance everywhere the bot lives. Earn: +${EARN.CHAT_MESSAGE} per chat message, +${EARN.ACTIVITY_BONUS} activity bonus every ${EARN.ACTIVITY_BONUS_MINUTES} min you stay chattin', one-time +${EARN.FOLLOW_BONUS} !claim follow bonus. Spend on AI: !ask ${COSTS.ASK_EYES} · !ask -brain ${COSTS.ASK_BRAIN} · !code ${COSTS.CODE_HANDS} (Silver/Gold ride cheaper). !points = balance · !top = weekly leaders`;
    }
}

const service = new PointsService();

// Test-only internals (mirrors tier_service's _internal pattern).
service._internal = {
    EARN,
    COSTS,
    utcCutoffDaysAgo,
    activityMarks: service._activityMarks,
    claimsInFlight: service._claimsInFlight
};

module.exports = service;
