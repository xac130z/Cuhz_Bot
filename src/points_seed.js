const fs = require('fs');
const path = require('path');
const db = require('./database');
const logger = require('./logger');

/**
 * Boot-time CUHZ Points restore + Founders Grant.
 *
 * Points were wiped on every deploy while storage was ephemeral SQLite. The
 * only surviving record was Railway log exports; data/points-seed.json holds
 * the award events reconstructed from them (award events only — no chat text).
 *
 * Those logs cover ~47 hours. Roughly 18 months of community history predates
 * them and is unrecoverable, so the restored totals are multiplied by
 * FOUNDERS_MULTIPLIER as an explicit, honest grant — not invented history.
 *
 * SELF-CORRECTING + IDEMPOTENT. On every boot it compares what each cuhzin
 * SHOULD have from the grant against what the ledger shows they were already
 * given (any row whose reason starts with `backfill`), and writes only the
 * difference. So it is safe to:
 *   - run on every boot forever (difference becomes 0)
 *   - raise the multiplier later (tops up to the new level automatically,
 *     even if an earlier deploy already applied a lower one)
 * It never deducts: lowering the multiplier is logged and ignored.
 */

const SEED_PATH = path.resolve(__dirname, '../data/points-seed.json');

// Founders Grant: restored log totals ×10, acknowledging the unrecorded months.
// Override per-environment with POINTS_FOUNDERS_MULTIPLIER.
const DEFAULT_FOUNDERS_MULTIPLIER = 10;

async function seedPoints() {
    if (!fs.existsSync(SEED_PATH)) return;

    let seed;
    try {
        seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    } catch (err) {
        logger.error(`💎 Points seed unreadable, skipping: ${err.message}`);
        return;
    }
    const events = Array.isArray(seed.events) ? seed.events : [];
    if (events.length === 0) return;

    const envMult = parseInt(process.env.POINTS_FOUNDERS_MULTIPLIER, 10);
    const multiplier = Number.isFinite(envMult) && envMult > 0 ? envMult : DEFAULT_FOUNDERS_MULTIPLIER;

    // What each cuhzin should hold from the grant
    const target = {};
    for (const e of events) target[e.u] = (target[e.u] || 0) + e.a * multiplier;

    try {
        await db.ready;   // schema + migrations must exist first

        // What they were already granted (covers per-event rows written by the
        // earlier version of this file, and any previous top-up).
        const rows = await db.prepare(
            `SELECT username, SUM(amount) AS granted
               FROM points_ledger
              WHERE reason LIKE 'backfill%'
              GROUP BY username`
        ).all();
        const granted = {};
        for (const r of rows || []) granted[r.username] = Number(r.granted) || 0;

        const stamp = new Date().toISOString().slice(0, 10);
        let touched = 0, added = 0, lowered = 0;

        for (const [user, want] of Object.entries(target)) {
            const have = granted[user] || 0;
            const delta = want - have;
            if (delta === 0) continue;
            if (delta < 0) { lowered++; continue; }   // never claw back

            await db.prepare(
                `INSERT INTO points_ledger (username, amount, reason) VALUES (?, ?, ?)`
            ).run(user, delta, `backfill:grant_x${multiplier}:${stamp}`);
            await db.prepare(`
                INSERT INTO users (username, points, messages_sent, last_seen)
                VALUES (?, ?, 0, CURRENT_TIMESTAMP)
                ON CONFLICT(username) DO UPDATE SET points = users.points + ?
            `).run(user, delta, delta);
            touched++; added += delta;
        }

        if (touched === 0) {
            logger.info(`💎 Founders Grant ×${multiplier} already applied to all ${Object.keys(target).length} cuhzins — nothing to do.`);
        } else {
            const top = Object.entries(target).sort((a, b) => b[1] - a[1]).slice(0, 5)
                .map(([u, p]) => `${u} ${p}`).join(', ');
            logger.info(`💎 Founders Grant ×${multiplier}: +${added} points across ${touched} cuhzins.`);
            logger.info(`💎 Leaderboard now — ${top}`);
            if (seed.coverage) logger.info(`💎 Reconstructed from logs ${seed.coverage.from} → ${seed.coverage.to}`);
        }
        if (lowered > 0) {
            logger.warn(`💎 ${lowered} cuhzin(s) already hold more than a ×${multiplier} grant — points are never deducted, left as-is.`);
        }
    } catch (err) {
        // A seeding problem must never take the bot down.
        logger.error(`💎 Points seed failed (bot continues normally): ${err.message}`);
    }
}

module.exports = { seedPoints };
