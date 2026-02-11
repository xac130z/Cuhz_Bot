const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'data/bot.db');
const db = new Database(dbPath);

console.log('--- Tables ---');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables.map(t => t.name));

console.log('\n--- Users Last Seen Yesterday (2026-02-09) ---');
// Assuming UTC for CURRENT_TIMESTAMP
const yesterdayStart = '2026-02-09 00:00:00';
const yesterdayEnd = '2026-02-09 23:59:59';
// Check precise format in DB first
const sampleUser = db.prepare('SELECT last_seen FROM users LIMIT 1').get();
if (sampleUser) {
    console.log(`Sample last_seen format: ${sampleUser.last_seen}`);
}

const users = db.prepare(`
    SELECT username, messages_sent, last_seen 
    FROM users 
    WHERE last_seen >= ? AND last_seen <= ?
`).all(yesterdayStart, yesterdayEnd);

if (users.length === 0) {
    console.log('No users explicitly "last seen" on 2026-02-09.');
    console.log('Checking all users active since 2026-02-09 (including today)...');
    const recentUsers = db.prepare(`
        SELECT username, messages_sent, last_seen 
        FROM users 
        WHERE last_seen >= ?
    `).all(yesterdayStart);
    console.log(recentUsers);
} else {
    console.log(users);
}
