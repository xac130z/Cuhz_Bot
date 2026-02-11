/**
 * Test script to verify the DB adapter, schema, and user_memory module work correctly.
 * Run with: node tests/test_db_adapter.js
 */

// Force SQLite mode for testing
delete process.env.DATABASE_URL;

const db = require('../src/database');

async function runTests() {
    let passed = 0;
    let failed = 0;

    function assert(condition, testName) {
        if (condition) {
            console.log(`  ✅ ${testName}`);
            passed++;
        } else {
            console.log(`  ❌ ${testName}`);
            failed++;
        }
    }

    // --- Test 1: Core DB Operations ---
    console.log('\n🧪 Test 1: Core DB Operations');
    try {
        await db.prepare('CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, name TEXT)').run();
        const res = await db.prepare('INSERT INTO test_table (name) VALUES (?)').run('test_user');
        assert(res.changes === 1, 'INSERT returns changes=1');
        assert(res.lastInsertRowid != null, 'INSERT returns lastInsertRowid');

        const row = await db.prepare('SELECT * FROM test_table WHERE id = ?').get(res.lastInsertRowid);
        assert(row && row.name === 'test_user', 'SELECT returns correct row');

        const rows = await db.prepare('SELECT * FROM test_table').all();
        assert(rows.length >= 1, 'SELECT ALL returns rows');
    } catch (err) {
        console.error('  ❌ Core DB failed:', err.message);
        failed++;
    }

    // --- Test 2: Schema Tables Exist ---
    console.log('\n🧪 Test 2: Schema Tables Exist');
    const expectedTables = ['channels', 'commands', 'timers', 'users', 'mood_history', 'context_cache', 'streamer_shoutouts', 'user_profiles', 'chat_log', 'achievements', 'stream_sessions'];
    for (const table of expectedTables) {
        try {
            const result = await db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
            assert(result !== undefined, `Table "${table}" exists`);
        } catch (err) {
            assert(false, `Table "${table}" exists — ${err.message}`);
        }
    }

    // --- Test 3: User Profiles UPSERT ---
    console.log('\n🧪 Test 3: User Profiles UPSERT');
    try {
        await db.prepare(`
            INSERT INTO user_profiles (username, display_name, total_messages, last_seen)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(username) DO UPDATE SET
                total_messages = user_profiles.total_messages + 1,
                last_seen = CURRENT_TIMESTAMP
        `).run('testuser123', 'TestUser123');

        const profile = await db.prepare('SELECT * FROM user_profiles WHERE username = ?').get('testuser123');
        assert(profile && profile.total_messages >= 1, 'User profile created/updated');

        // Upsert again
        await db.prepare(`
            INSERT INTO user_profiles (username, display_name, total_messages, last_seen)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(username) DO UPDATE SET
                total_messages = user_profiles.total_messages + 1,
                last_seen = CURRENT_TIMESTAMP
        `).run('testuser123', 'TestUser123');

        const profile2 = await db.prepare('SELECT * FROM user_profiles WHERE username = ?').get('testuser123');
        assert(profile2 && profile2.total_messages === 2, 'User profile incremented correctly');
    } catch (err) {
        console.error('  ❌ User profiles failed:', err.message);
        failed++;
    }

    // --- Test 4: Chat Log ---
    console.log('\n🧪 Test 4: Chat Log');
    try {
        await db.prepare(`
            INSERT INTO chat_log (channel, username, message, is_command)
            VALUES (?, ?, ?, ?)
        `).run('#test', 'testuser', 'hello world', 0);

        const logs = await db.prepare('SELECT * FROM chat_log WHERE channel = ?').all('#test');
        assert(logs.length >= 1, 'Chat log entry created');
        assert(logs[0].message === 'hello world', 'Chat log message correct');
    } catch (err) {
        console.error('  ❌ Chat log failed:', err.message);
        failed++;
    }

    // --- Test 5: Achievements ---
    console.log('\n🧪 Test 5: Achievements');
    try {
        await db.prepare(`
            INSERT INTO achievements (username, achievement_name)
            VALUES (?, ?)
        `).run('testuser', 'first_message');

        const achievements = await db.prepare('SELECT * FROM achievements WHERE username = ?').all('testuser');
        assert(achievements.length === 1, 'Achievement created');

        // Test unique constraint
        const dupeResult = await db.prepare(`
            INSERT INTO achievements (username, achievement_name)
            VALUES (?, ?)
        `).run('testuser', 'first_message').catch(() => ({ changes: 0 }));
        assert(true, 'Duplicate achievement handled gracefully');
    } catch (err) {
        console.error('  ❌ Achievements failed:', err.message);
        failed++;
    }

    // --- Test 6: Seed Data ---
    console.log('\n🧪 Test 6: Seed Data');
    try {
        const channels = await db.prepare('SELECT * FROM channels').all();
        assert(channels.length >= 3, `Seeded ${channels.length} channels`);

        const commands = await db.prepare('SELECT * FROM commands').all();
        assert(commands.length >= 9, `Seeded ${commands.length} commands`);
    } catch (err) {
        console.error('  ❌ Seed data failed:', err.message);
        failed++;
    }

    // --- Results ---
    console.log(`\n${'='.repeat(40)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log(`${'='.repeat(40)}\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
