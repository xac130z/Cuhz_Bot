const db = require('./src/database');

async function testDB() {
    console.log('Testing DB Adapter...');
    try {
        await db.prepare('CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, name TEXT)').run();
        console.log('Table created.');

        const res = await db.prepare('INSERT INTO test_table (name) VALUES (?)').run('test_user');
        console.log('Inserted row:', res);

        const row = await db.prepare('SELECT * FROM test_table WHERE id = ?').get(res.lastInsertRowid);
        console.log('Fetched row:', row);

        const rows = await db.prepare('SELECT * FROM test_table').all();
        console.log('All rows:', rows);

        console.log('✅ DB Adapter works!');
    } catch (err) {
        console.error('❌ DB Adapter failed:', err);
    }
}

testDB();
