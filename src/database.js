const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

const dbPath = path.resolve(dataDir, 'bot.db');
const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL,
    trigger TEXT NOT NULL,
    response TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS timers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    interval_minutes INTEGER DEFAULT 60,
    is_active BOOLEAN DEFAULT 1,
    last_run DATETIME,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    points INTEGER DEFAULT 0,
    messages_sent INTEGER DEFAULT 0,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed initial data if empty
const channelCount = db.prepare('SELECT COUNT(*) as count FROM channels').get();
if (channelCount.count === 0) {
  const insertChannel = db.prepare('INSERT INTO channels (name) VALUES (?)');
  const insertCommand = db.prepare('INSERT INTO commands (channel_id, trigger, response) VALUES (?, ?, ?)');
  const insertTimer = db.prepare('INSERT INTO timers (channel_id, message) VALUES (?, ?)');

  const channels = ['#fourareason4', '#planetcuhz', '#rico_santanax'];

  channels.forEach(channelName => {
    const result = insertChannel.run(channelName);
    const channelId = result.lastInsertRowid;

    // Default commands
    insertCommand.run(channelId, '!cuhz', '🚀 https://planetcuhz.com');
    insertCommand.run(channelId, '!links', '🔗 https://linktr.ee/PlanetCUHZ');
    insertCommand.run(channelId, '!discord', '💬 https://discord.gg/5rFRaeBuHn');

    // Default timers (60 minutes)
    insertTimer.run(channelId, '🌌 Planet CUHZ → https://planetcuhz.com', 60);
    insertTimer.run(channelId, '🔗 All links → https://linktr.ee/PlanetCUHZ', 60);
  });
}

module.exports = db;
