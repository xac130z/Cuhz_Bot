#!/usr/bin/env node
/**
 * Legacy award-log report ONLY. P3 retired database replay: line hashes and
 * overlapping backfill reason totals do not prove safe historical recovery.
 * This report preserves the old diagnostic parser, not verified user totals.
 * Usage: node scripts/backfill-points.js --dry-run <log.json> [more.json ...]
 * Never treat this parser's candidates as an approved credit artifact.
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
if (!DRY_RUN) {
    console.error('Legacy points replay is disabled. Use --dry-run for a report; recovery requires a separately approved artifact.');
    process.exit(1);
}
const files = process.argv.slice(2).filter(a => !a.startsWith('--'));

if (files.length === 0) {
    console.error('Usage: node scripts/backfill-points.js --dry-run <log.json> [more.json ...]');
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
    console.log('Legacy diagnostic candidates only — not verified balances or approved recovery credits.');
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

    console.log('\n--dry-run: nothing written.');
}

main().catch(err => { console.error('Backfill failed:', err); process.exit(1); });
