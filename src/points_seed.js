const fs = require('fs');
const path = require('path');
const db = require('./database');
const logger = require('./logger');

/**
 * Boot-time CUHZ Points restore.
 *
 * Points were lost on every deploy while storage was ephemeral SQLite. The only
 * surviving record was Railway log exports; data/points-seed.json holds the
 * award events reconstructed from them (award events only — no chat content).
 *
 * This applies the seed once, automatically, so restoring history needs no CLI
 * and no manual step. It is IDEMPOTENT: every event carries a hash written into
 * points_ledger.reason as `backfill:<hash>:<reason>`. Events already present are
 * skipped, so this runs harmlessly on every boot forever.
 *
 * FOUNDERS_GRANT_MULTIPLIER: set POINTS_FOUNDERS_MULTIPLIER (env) to award a
 * multiple of the reconstructed totals, acknowledging the ~18 months of history
 * that predates any surviving log. 1 = restore exactly what the logs show.
 */

const SEED_PATH = path.resolve(__dirname, '../data/points-seed.json');

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

    const multiplier = Math.max(1, parseInt(process.env.POINTS_FOUNDERS_MULTIPLIER, 10) || 1);

    try {
        await db.ready;   // schema + migrations must exist first

        // One query tells us everything already applied.
        const rows = await db.prepare(
            `SELECT reason FROM points_ledger WHERE reason LIKE 'backfill:%'`
        ).all();
        const seen = new Set((rows || []).map(r => String(r.reason).split(':')[1]));

        const pending = events.filter(e => !seen.has(e.h));
        if (pending.length === 0) {
            logger.info(`💎 Points seed: all ${events.length} historical events already applied.`);
            return;
        }

        logger.info(`💎 Points seed: restoring ${pending.length} historical events` +
                    (multiplier > 1 ? ` (founders grant ×${multiplier})` : '') + '…');

        const totals = {};
        for (const e of pending) {
            const amount = e.a * multiplier;
            await db.prepare(
                `INSERT INTO points_ledger (username, amount, reason) VALUES (?, ?, ?)`
            ).run(e.u, amount, `backfill:${e.h}:${e.r}`);
            await db.prepare(`
                INSERT INTO users (username, points, messages_sent, last_seen)
                VALUES (?, ?, 0, CURRENT_TIMESTAMP)
                ON CONFLICT(username) DO UPDATE SET points = users.points + ?
            `).run(e.u, amount, amount);
            totals[e.u] = (totals[e.u] || 0) + amount;
        }

        const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([u, p]) => `${u} ${p}`).join(', ');
        logger.info(`💎 Points restored for ${Object.keys(totals).length} cuhzins. Top: ${top}`);
        if (seed.coverage) {
            logger.info(`💎 Seed covers ${seed.coverage.from} → ${seed.coverage.to}`);
        }
    } catch (err) {
        // Never let a seeding problem take the bot down.
        logger.error(`💎 Points seed failed (bot continues normally): ${err.message}`);
    }
}

module.exports = { seedPoints };
