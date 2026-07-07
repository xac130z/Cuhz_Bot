const { Pool } = require('pg');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DBAdapter {
  constructor() {
    this.type = process.env.DATABASE_URL ? 'postgres' : 'sqlite';
    this.pgPool = null;
    this.sqlite = null;

    if (this.type === 'postgres') {
      console.log('🔌 Connecting to PostgreSQL...');
      this.pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }, // Required for Railway/Heroku
        max: 10,          // Connection pool size
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      });

      // Connection pool error handler (prevents unhandled rejections)
      this.pgPool.on('error', (err) => {
        console.error('❌ PostgreSQL pool error:', err.message);
      });

      this.initPostgres();

      // Periodic health check every 5 minutes
      setInterval(() => this._pgHealthCheck(), 5 * 60 * 1000);
    } else {
      console.log('📁 Using local SQLite database...');
      const dataDir = path.resolve(__dirname, '../data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
      }
      const dbPath = path.resolve(dataDir, 'bot.db');
      this.sqlite = new Database(dbPath);
      this.sqlite.pragma('journal_mode = WAL');
      this.initSqlite();
    }
  }

  /** Periodic Postgres health check */
  async _pgHealthCheck() {
    try {
      await this.pgPool.query('SELECT 1');
    } catch (err) {
      console.error('❌ PostgreSQL health check failed:', err.message);
    }
  }

  prepare(sql) {
    if (this.type === 'sqlite') {
      const stmt = this.sqlite.prepare(sql);
      return {
        run: (...args) => {
          try { return Promise.resolve(stmt.run(...args)); }
          catch (err) {
            // Handle unique constraint violations gracefully (like Postgres adapter does)
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
              return Promise.resolve({ changes: 0, lastInsertRowid: null });
            }
            return Promise.reject(err);
          }
        },
        get: (...args) => {
          try { return Promise.resolve(stmt.get(...args)); }
          catch (err) { return Promise.reject(err); }
        },
        all: (...args) => {
          try { return Promise.resolve(stmt.all(...args)); }
          catch (err) { return Promise.reject(err); }
        }
      };
    } else {
      // Postgres implementation
      // Convert SQLite '?' placeholders to '$1', '$2', etc.
      let pgSql = sql;
      let paramCount = 0;
      while (pgSql.includes('?')) {
        paramCount++;
        pgSql = pgSql.replace('?', `$${paramCount}`);
      }

      return {
        run: async (...args) => {
          let finalSql = pgSql;
          const isInsert = finalSql.trim().toUpperCase().startsWith('INSERT');

          // Only add RETURNING id if this is an INSERT and it doesn't already have RETURNING
          // and the target table likely has an 'id' column (most do)
          if (isInsert && !finalSql.toUpperCase().includes('RETURNING')) {
            // Only add RETURNING id if the query doesn't use ON CONFLICT DO NOTHING
            // (those might not insert anything, and RETURNING would be empty anyway)
            if (!finalSql.toUpperCase().includes('DO NOTHING')) {
              finalSql += ' RETURNING id';
            }
          }

          try {
            const res = await this.pgPool.query(finalSql, args);
            return {
              changes: res.rowCount,
              lastInsertRowid: (res.rows && res.rows.length > 0 && res.rows[0].id !== undefined)
                ? res.rows[0].id
                : null
            };
          } catch (err) {
            // Handle "column id does not exist" gracefully — retry without RETURNING
            if (err.message && err.message.includes('column "id" does not exist') && finalSql.includes('RETURNING id')) {
              const retryRes = await this.pgPool.query(pgSql, args);
              return { changes: retryRes.rowCount, lastInsertRowid: null };
            }
            // Unique violation — return 0 changes instead of throwing for upsert compat
            if (err.code === '23505') {
              return { changes: 0, lastInsertRowid: null };
            }
            throw err;
          }
        },
        get: async (...args) => {
          const res = await this.pgPool.query(pgSql, args);
          return res.rows[0];
        },
        all: async (...args) => {
          const res = await this.pgPool.query(pgSql, args);
          return res.rows;
        }
      };
    }
  }

  exec(sql) {
    if (this.type === 'sqlite') {
      return this.sqlite.exec(sql);
    } else {
      return this.pgPool.query(sql);
    }
  }

  // ----- SCHEMA DEFINITIONS -----

  /** Shared schema as SQL arrays — each statement is one CREATE TABLE */
  _getSchema(dialect) {
    const isPostgres = dialect === 'postgres';
    const SERIAL = isPostgres ? 'SERIAL' : 'INTEGER';
    const AUTOINCREMENT = isPostgres ? '' : 'AUTOINCREMENT';
    const PK = isPostgres ? 'PRIMARY KEY' : `PRIMARY KEY ${AUTOINCREMENT}`;
    const BOOL_TRUE = isPostgres ? 'TRUE' : '1';
    const BOOL_FALSE = isPostgres ? 'FALSE' : '0';
    const TIMESTAMP = isPostgres ? 'TIMESTAMP' : 'DATETIME';
    const FK = (col, ref) => isPostgres
      ? `${col} INTEGER NOT NULL REFERENCES ${ref} ON DELETE CASCADE`
      : `${col} INTEGER NOT NULL`;

    return [
      // Core tables
      `CREATE TABLE IF NOT EXISTS channels (
        id ${SERIAL} ${PK},
        name TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'active',
        auto_welcome BOOLEAN DEFAULT ${BOOL_TRUE},
        auto_marketing BOOLEAN DEFAULT ${BOOL_TRUE},
        created_at ${TIMESTAMP} DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS commands (
        id ${SERIAL} ${PK},
        ${FK('channel_id', 'channels(id)')},
        trigger TEXT NOT NULL,
        response TEXT NOT NULL,
        is_active BOOLEAN DEFAULT ${BOOL_TRUE}
      )`,
      `CREATE TABLE IF NOT EXISTS timers (
        id ${SERIAL} ${PK},
        ${FK('channel_id', 'channels(id)')},
        message TEXT NOT NULL,
        interval_minutes INTEGER DEFAULT 60,
        is_active BOOLEAN DEFAULT ${BOOL_TRUE},
        last_run ${TIMESTAMP}
      )`,
      `CREATE TABLE IF NOT EXISTS users (
        id ${SERIAL} ${PK},
        username TEXT UNIQUE NOT NULL,
        points INTEGER DEFAULT 0,
        messages_sent INTEGER DEFAULT 0,
        last_seen ${TIMESTAMP} DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS mood_history (
        id ${SERIAL} ${PK},
        channel TEXT NOT NULL,
        mood TEXT NOT NULL,
        energy INTEGER DEFAULT 50,
        toxicity INTEGER DEFAULT 0,
        message_sample TEXT,
        created_at ${TIMESTAMP} DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS context_cache (
        id ${SERIAL} ${PK},
        channel TEXT NOT NULL,
        query TEXT NOT NULL,
        response TEXT NOT NULL,
        expires_at ${TIMESTAMP},
        created_at ${TIMESTAMP} DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS streamer_shoutouts (
        id ${SERIAL} ${PK},
        channel TEXT NOT NULL,
        streamer_username TEXT NOT NULL,
        is_active BOOLEAN DEFAULT ${BOOL_TRUE},
        last_shoutout ${TIMESTAMP},
        shoutout_count INTEGER DEFAULT 0,
        created_at ${TIMESTAMP} DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(channel, streamer_username)
      )`,

      // ===== Phase 2: Cuhz Economy =====
      `CREATE TABLE IF NOT EXISTS points_ledger (
        id ${SERIAL} ${PK},
        username TEXT NOT NULL,
        amount INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at ${TIMESTAMP} DEFAULT CURRENT_TIMESTAMP
      )`,


      // ===== Phase 1: Chat Memory & User Profiles =====
      `CREATE TABLE IF NOT EXISTS user_profiles (
        id ${SERIAL} ${PK},
        username TEXT UNIQUE NOT NULL,
        display_name TEXT,
        first_seen ${TIMESTAMP} DEFAULT CURRENT_TIMESTAMP,
        last_seen ${TIMESTAMP} DEFAULT CURRENT_TIMESTAMP,
        total_messages INTEGER DEFAULT 0,
        total_watch_minutes INTEGER DEFAULT 0,
        favorite_commands TEXT,
        topics_of_interest TEXT,
        relationship_score INTEGER DEFAULT 0,
        notes TEXT,
        is_follower BOOLEAN DEFAULT ${BOOL_FALSE},
        is_subscriber BOOLEAN DEFAULT ${BOOL_FALSE}
      )`,
      `CREATE TABLE IF NOT EXISTS chat_log (
        id ${SERIAL} ${PK},
        channel TEXT NOT NULL,
        username TEXT NOT NULL,
        message TEXT NOT NULL,
        is_command BOOLEAN DEFAULT ${BOOL_FALSE},
        created_at ${TIMESTAMP} DEFAULT CURRENT_TIMESTAMP
      )`,

      // ===== Phase 4: Achievements =====
      `CREATE TABLE IF NOT EXISTS achievements (
        id ${SERIAL} ${PK},
        username TEXT NOT NULL,
        achievement_name TEXT NOT NULL,
        earned_at ${TIMESTAMP} DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(username, achievement_name)
      )`,

      // ===== Phase 3: Stream Sessions =====
      `CREATE TABLE IF NOT EXISTS stream_sessions (
        id ${SERIAL} ${PK},
        channel TEXT NOT NULL,
        started_at ${TIMESTAMP} DEFAULT CURRENT_TIMESTAMP,
        ended_at ${TIMESTAMP},
        peak_viewers INTEGER DEFAULT 0,
        avg_viewers INTEGER DEFAULT 0,
        total_messages INTEGER DEFAULT 0,
        unique_chatters INTEGER DEFAULT 0,
        mood_summary TEXT,
        created_at ${TIMESTAMP} DEFAULT CURRENT_TIMESTAMP
      )`
    ];
  }

  /** Get index creation statements */
  _getIndexes() {
    return [
      'CREATE INDEX IF NOT EXISTS idx_chat_log_channel_time ON chat_log(channel, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_chat_log_username ON chat_log(username, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username)',
      'CREATE INDEX IF NOT EXISTS idx_mood_history_channel ON mood_history(channel, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_achievements_username ON achievements(username)'
    ];
  }

  initSqlite() {
    const schema = this._getSchema('sqlite');
    const indexes = this._getIndexes();

    // Execute all schema + indexes as one exec block
    const fullSql = [...schema, ...indexes].join(';\n') + ';';
    this.sqlite.exec(fullSql);

    // Add FK for SQLite commands/timers (declared in schema but need pragma)
    this.sqlite.pragma('foreign_keys = ON');

    this.seedData();
  }

  async initPostgres() {
    try {
      const schema = this._getSchema('postgres');
      const indexes = this._getIndexes();

      // Execute schema statements individually (Postgres doesn't always like multi-statement CREATE TABLE)
      for (const stmt of [...schema, ...indexes]) {
        await this.pgPool.query(stmt);
      }

      console.log('✅ PostgreSQL Schema Initialized');
      await this.seedData();
    } catch (err) {
      console.error('❌ Failed to initialize PostgreSQL schema:', err);
    }
  }

  async seedData() {
    try {
      const countRes = await this.prepare('SELECT COUNT(*) as count FROM channels').get();
      const count = countRes ? parseInt(countRes.count) : 0;

      if (count === 0) {
        console.log('🌱 Seeding initial data...');
        const channels = ['#xac130z', '#planetcuhz', '#rico2ez'];

        for (const channelName of channels) {
          const cRes = await this.prepare('INSERT INTO channels (name) VALUES (?)').run(channelName);
          const channelId = cRes.lastInsertRowid;

          // Default commands
          const insertCmd = this.prepare('INSERT INTO commands (channel_id, trigger, response) VALUES (?, ?, ?)');
          await insertCmd.run(channelId, '!cuhz', '🚀 https://planetcuhz.com');
          await insertCmd.run(channelId, '!links', '🔗 https://linktr.ee/PlanetCUHZ');
          await insertCmd.run(channelId, '!discord', '💬 https://discord.gg/wt6Zc7Sgjx');

          // Default timers
          const insertTimer = this.prepare('INSERT INTO timers (channel_id, message, interval_minutes) VALUES (?, ?, ?)');
          await insertTimer.run(channelId, '🌌 Planet CUHZ → https://planetcuhz.com', 60);
          await insertTimer.run(channelId, '🔗 All links → https://linktr.ee/PlanetCUHZ', 60);
        }
      }
    } catch (err) {
      console.error('Error seeding data:', err);
    }
  }
}

const db = new DBAdapter();
module.exports = db;
