#!/usr/bin/env node
/**
 * CUHZ Points backfill — seed the database from Railway log exports.
 *
 * WHY THIS EXISTS
 * Points were being written to an ephemeral SQLite file, so every deploy wiped
 * them. The only surviving record of what people earned is the Railway log
 * exports. This script replays award events out of those exports and writes
 * them into the real database.
 *
 * IDEMPOTENT: every replayed award is written to points_ledger with a reason
 * tagged `backfill:<sha>` where <sha> is a hash of the exact log line. Re-running
 * with the same file (or with overlapping files) will NOT double-count — already
 * seen hashes are skipped. Safe to run repeatedly as you export more logs.
 *
 * USAGE
 *   node scripts/backfill-points.js <log1.json> [log2.json ...]
 *   node scripts/backfill-points.js --dry-run <log.json>     # report only
 *
 * Run it against the SAME database the bot uses (set DATABASE_URL first, or it
 * writes to the local SQLite file):
 *   DATABASE_URL="postgres://..." node scripts/backfill-points.js logs/*.json
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const files = process.argv.slice(2).filter(a => !a.startsWith('--'));

if (files.length === 0) {
    console.error('Usage: node scripts/backfill-points.js [--dry-run] <log.json> [more.json ...]');
    process.exit(1);
}

// Other channels' bots must never hold CUHZ Points.
const KNOWN_BOTS = new Set([
    'nightbot', 'wizebot', 'streamelements', 'moobot', 'fossabot',
    'soundalerts', 'sery_bot', 'streamlabs', 'cuhz_bot'
]);

// Matches the bot's own award log line, e.g.
//   [2026-07-28T20:33:43.123Z] [INFO] 💰 Added 10 points to phoenixpnyc (passive_paycheck)
const AWARD_RE = /Added\s+(\d+)\s+points?\s+to\s+(\S+?)(?:\s*\((\w+)\))?\s*$/;
const TS_RE = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/;

function lineHash(line) {
    return crypto.createHash('sha1').update(line).digest('hex').slice(0, 16);
}

function extractMessages(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // Fall back to newline-delimited JSON or plain text logs
        return raw.split('\n').filter(Boolean).map(l => {
            try { return JSON.parse(l).message ?? l; } catch { return l; }
        });
    }
    if (Array.isArray(parsed)) return parsed.map(e => (typeof e === 'string' ? e : e.message ?? ''));
    if (parsed && Array.isArray(parsed.logs)) return parsed.logs.map(e => e.message ?? String(e));
    throw new Error(`Unrecognized log format in ${filePath}`);
}

async function main() {
    // Collect unique award events across every supplied file
    const events = new Map(); // hash -> {username, amount, reason, ts}
    let scanned = 0, skippedBots = 0;
    let earliest = null, latest = null;

    for (const f of files) {
        const messages = extractMessages(f);
        for (const msg of messages) {
            if (typeof msg !== 'string') continue;
            scanned++;
            const tsm = msg.match(TS_RE);
            if (tsm) {
                if (!earliest || tsm[1] < earliest) earliest = tsm[1];
                if (!latest || tsm[1] > latest) latest = tsm[1];
            }
            const m = msg.trim().match(AWARD_RE);
            if (!m) continue;
            const username = m[2].toLowerCase().replace('@', '');
            if (KNOWN_BOTS.has(username)) { skippedBots++; continue; }
            events.set(lineHash(msg), {
                username,
                amount: parseInt(m[1], 10),
                reason: m[3] || 'chat_message',
                ts: tsm ? tsm[1] : null
            });
        }
        console.log(`📄 ${path.basename(f)}: scanned ${messages.length} lines`);
    }

    const totals = new Map();
    for (const e of events.values()) {
        totals.set(e.username, (totals.get(e.username) || 0) + e.amount);
    }

    console.log(`\n🗓️  Log coverage: ${earliest || 'unknown'} → ${latest || 'unknown'}`);
    console.log(`🔎 Scanned ${scanned} lines, found ${events.size} unique award events`);
    console.log(`🤖 Skipped ${skippedBots} awards to known bots`);
    console.log(`\n${'user'.padEnd(24)}${'points'.padStart(8)}`);
    for (const [u, p] of [...totals].sort((a, b) => b[1] - a[1])) {
        console.log(`${u.padEnd(24)}${String(p).padStart(8)}`);
    }
    console.log(`${'TOTAL'.padEnd(24)}${String([...totals.values()].reduce((a, b) => a + b, 0)).padStart(8)}`);

    if (DRY_RUN) {
        console.log('\n--dry-run: nothing written.');
        return;
    }

    const db = require('../src/database');
    console.log(`\n💾 Writing to ${db.type.toUpperCase()}…`);
    if (db.type !== 'postgres') {
        console.warn('⚠️  Not Postgres — this DB is ephemeral on a hosted container.');
        console.warn('⚠️  Set DATABASE_URL to the production Postgres before backfilling for real.');
    }

    // Which hashes were already backfilled? (reason column carries the tag)
    const existing = new Set();
    try {
        const rows = await db.prepare(
            `SELECT reason FROM points_ledger WHERE reason LIKE 'backfill:%'`
        ).all();
        for (const r of rows) existing.add(r.reason.split(':')[1]);
    } catch (err) {
        console.error('Could not read points_ledger (does the schema exist yet?):', err.message);
        process.exit(1);
    }
    console.log(`↩️  ${existing.size} events were already backfilled previously — they will be skipped.`);

    let written = 0, skipped = 0;
    for (const [hash, e] of events) {
        if (existing.has(hash)) { skipped++; continue; }
        await db.prepare(
            `INSERT INTO points_ledger (username, amount, reason) VALUES (?, ?, ?)`
        ).run(e.username, e.amount, `backfill:${hash}:${e.reason}`);
        await db.prepare(`
            INSERT INTO users (username, points, messages_sent, last_seen)
            VALUES (?, ?, 0, CURRENT_TIMESTAMP)
            ON CONFLICT(username) DO UPDATE SET points = users.points + ?
        `).run(e.username, e.amount, e.amount);
        written++;
    }

    console.log(`\n✅ Backfill complete: ${written} events written, ${skipped} already present (no double-count).`);
    console.log('Run again with more log exports any time — it stays idempotent.');
    process.exit(0);
}

main().catch(err => { console.error('Backfill failed:', err); process.exit(1); });
