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
    auto_welcome BOOLEAN DEFAULT 1,
    auto_marketing BOOLEAN DEFAULT 1,
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

  CREATE TABLE IF NOT EXISTS mood_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    mood TEXT NOT NULL,
    energy INTEGER DEFAULT 50,
    toxicity INTEGER DEFAULT 0,
    message_sample TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS context_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    query TEXT NOT NULL,
    response TEXT NOT NULL,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS streamer_shoutouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    streamer_username TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    last_shoutout DATETIME,
    shoutout_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel, streamer_username)
  );

  CREATE INDEX IF NOT EXISTS idx_mood_channel_time ON mood_history(channel, created_at);
  CREATE INDEX IF NOT EXISTS idx_context_query ON context_cache(query);
  CREATE INDEX IF NOT EXISTS idx_shoutout_channel ON streamer_shoutouts(channel, is_active);
`);

// Seed initial data if empty
const channelCount = db.prepare('SELECT COUNT(*) as count FROM channels').get();
if (channelCount.count === 0) {
  const insertChannel = db.prepare('INSERT INTO channels (name) VALUES (?)');
  const insertCommand = db.prepare('INSERT INTO commands (channel_id, trigger, response) VALUES (?, ?, ?)');
  const insertTimer = db.prepare('INSERT INTO timers (channel_id, message, interval_minutes) VALUES (?, ?, ?)');

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
