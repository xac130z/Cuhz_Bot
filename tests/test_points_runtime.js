'use strict';

// Execute the complete checked-out bot and actual points service in isolated
// VMs. Only the handler/API under test runs: no real bot bootstrap, environment,
// filesystem writes, network, timers, or Twitch client. SQL runs in :memory:.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { evaluateBotBoot, readBotSource } = require('./helpers/isolated_bot_boot');

const sourceRoot = path.resolve(__dirname, '../src');
const databaseSource = fs.readFileSync(path.join(sourceRoot, 'database.js'), 'utf8');
const classSource = databaseSource.replace(
    /const db = new DBAdapter\(\);\s*module\.exports = db;\s*$/,
    'module.exports = DBAdapter;'
);
assert.notEqual(classSource, databaseSource, 'never construct the real database singleton');
const adapterContext = {
    module: { exports: {} },
    require(name) {
        if (name === 'pg') return { Pool: class { constructor() { throw new Error('Network forbidden'); } } };
        if (name === 'path') return path;
        if (name === 'fs') return {};
        throw new Error(`Unexpected database dependency: ${name}`);
    },
};
vm.runInNewContext(classSource, adapterContext, { filename: 'database.js', timeout: 1000 });
const DBAdapter = adapterContext.module.exports;
const serviceSource = fs.readFileSync(path.join(sourceRoot, 'points_service.js'), 'utf8');
const quietLogger = { info() {}, debug() {}, error() {}, warn() {} };
function serviceFor(db, logger = quietLogger) {
    const context = {
        module: { exports: {} },
        require(name) {
            if (name === './database') return db;
            if (name === './logger') return logger;
            throw new Error(`Unexpected points dependency: ${name}`);
        },
    };
    vm.runInNewContext(serviceSource, context, { filename: 'points_service.js', timeout: 1000 });
    return context.module.exports;
}

let Database;
try {
    Database = require('better-sqlite3');
    const probe = new Database(':memory:');
    probe.close();
} catch (_) {
    // Same test-only Node 22 bridge as the reviewed integrity suite. A missing
    // SQLite engine fails this suite; it never silently skips handler coverage.
    const { DatabaseSync } = require('node:sqlite');
    Database = class {
        constructor(filename) { this.db = new DatabaseSync(filename); }
        prepare(sql) { return this.db.prepare(sql); }
        exec(sql) { return this.db.exec(sql); }
        close() { return this.db.close(); }
        transaction(callback) {
            return () => {
                this.db.exec('BEGIN');
                try {
                    const result = callback();
                    this.db.exec('COMMIT');
                    return result;
                } catch (error) {
                    this.db.exec('ROLLBACK');
                    throw error;
                }
            };
        }
    };
}

function fixture(options = {}) {
    const sqlite = new Database(':memory:');
    const adapter = Object.create(DBAdapter.prototype);
    adapter.type = 'sqlite';
    adapter.sqlite = sqlite;
    sqlite.exec(adapter._getSchema('sqlite').join(';') + ';');
    sqlite.exec('ALTER TABLE users ADD COLUMN last_paycheck TIMESTAMP');
    const now = Date.now();
    if (options.user !== false) {
        sqlite.prepare(`INSERT INTO users (username, points, messages_sent, last_seen, last_paycheck)
            VALUES (?, ?, ?, ?, ?)`).run('alice', options.points ?? 100, 8,
            new Date(now - (options.seenMinutes ?? 1) * 60000).toISOString(),
            options.noPaycheck ? null : new Date(now - (options.payMinutes ?? 1) * 60000).toISOString());
        sqlite.prepare('INSERT INTO points_ledger (username, amount, reason) VALUES (?, ?, ?)')
            .run('alice', options.points ?? 100, 'opening');
    }
    if (options.rejectAwards) {
        sqlite.exec(`CREATE TRIGGER reject_award BEFORE INSERT ON points_ledger
            BEGIN SELECT RAISE(ABORT, 'injected ledger failure'); END;`);
    }
    if (options.rejectPaycheck) {
        sqlite.exec(`CREATE TRIGGER reject_paycheck BEFORE INSERT ON points_ledger
            WHEN NEW.reason = 'passive_paycheck'
            BEGIN SELECT RAISE(ABORT, 'injected paycheck failure'); END;`);
    }
    if (options.rejectSpend) {
        sqlite.exec(`CREATE TRIGGER reject_spend BEFORE INSERT ON points_ledger
            WHEN NEW.amount < 0
            BEGIN SELECT RAISE(ABORT, 'injected spend failure'); END;`);
    }
    const sqlEvents = [];
    const originalPrepare = adapter.prepare.bind(adapter);
    adapter.prepare = sql => {
        const compact = sql.trim().replace(/\s+/g, ' ');
        sqlEvents.push(compact);
        if ((options.balanceReadFails && compact.startsWith('SELECT points FROM users')) ||
            (options.activityReadFails && compact.startsWith('SELECT last_seen, last_paycheck'))) {
            return { async get() { throw new Error('injected read failure'); } };
        }
        return originalPrepare(sql);
    };
    const messages = [];
    const watchMinutes = [];
    const errors = [];
    const logger = { ...quietLogger, error: (...args) => errors.push(args.join(' ')) };
    const pointsService = serviceFor(adapter, logger);
    const evidence = evaluateBotBoot(readBotSource(), {
        './database': adapter,
        './points_service': pointsService,
        './logger': logger,
        './user_memory': {
            recordMessage() {},
            async addWatchMinutes(username, minutes) { watchMinutes.push({ username, minutes }); },
        },
        './loyalty': { async checkAchievements() { return []; } },
    });
    const channel = options.channel || '#fixture_channel';
    evidence.runtime.configure(channel, { commands: {}, settings: { auto_welcome: false } },
        (target, message) => { messages.push({ channel: target, text: message }); });
    return {
        evidence, messages, watchMinutes, errors, sqlEvents, pointsService,
        async message(text = '!ping', username = 'alice', self = false) {
            await evidence.runtime.handleMessage(channel, { username, badges: {}, mod: options.mod || false }, text, self);
            assert.deepEqual(evidence.forbiddenAttempts, [], 'no forbidden runtime side effects');
        },
        user: () => sqlite.prepare('SELECT * FROM users WHERE username = ?').get('alice'),
        ledger: () => sqlite.prepare('SELECT username, amount, reason FROM points_ledger ORDER BY id').all(),
        close: () => sqlite.close(),
    };
}

let checks = 0;
async function test(name, callback) {
    await callback();
    checks++;
    console.log(`  ✅ ${name}`);
}
async function isolated(name, callback, options) {
    await test(name, async () => {
        const f = fixture(options);
        try { await callback(f); } finally { f.close(); }
    });
}
function responseFixture() {
    return {
        statusCode: 200, headers: {}, body: undefined,
        status(code) { this.statusCode = code; return this; },
        set(key, value) { this.headers[key] = value; return this; },
        json(body) { this.body = body; return this; },
    };
}
async function getPoints(f, username) {
    const route = f.evidence.routes.find(row => row.route === '/api/points/user/:username');
    assert.ok(route);
    const res = responseFixture();
    await route.handlers.at(-1)({ params: { username } }, res);
    assert.deepEqual(f.evidence.forbiddenAttempts, []);
    return res;
}

(async () => {
    await test('balance distinguishes missing/zero/valid accounts and normalizes identity', async () => {
        for (const [row, expected] of [[undefined, 0], [{ points: 0 }, 0], [{ points: 42 }, 42]]) {
            const service = serviceFor({ prepare() { return { async get(name) {
                assert.equal(name, 'alice'); return row;
            } }; } });
            assert.equal(await service.getBalance('@ALICE'), expected);
        }
    });
    await test('balance read errors return null and log a failure', async () => {
        const errors = [];
        const service = serviceFor({ prepare() { throw new Error('read unavailable'); } },
            { ...quietLogger, error: text => errors.push(text) });
        assert.equal(await service.getBalance('alice'), null);
        assert.equal(errors.length, 1);
    });
    await test('invalid persisted balances are unavailable, never numeric zero', async () => {
        for (const points of [null, undefined, NaN, Infinity, -Infinity, '0', '10', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
            const service = serviceFor({ prepare() { return { async get() { return { points }; } }; } });
            assert.equal(await service.getBalance('alice'), null);
        }
    });
    await isolated('first message creates exactly one ledgered point and one message', async f => {
        await f.message();
        assert.equal(f.user().points, 1);
        assert.equal(f.user().messages_sent, 1);
        assert.equal(f.ledger().length, 1);
        assert.equal(f.ledger()[0].reason, 'chat_message');
        assert.ok(f.sqlEvents.some(sql => /messages_sent = users\.messages_sent \+ 1/.test(sql)));
    }, { user: false });
    await isolated('existing message preserves and increments balance/message counts', async f => {
        await f.message();
        assert.equal(f.user().points, 101);
        assert.equal(f.user().messages_sent, 9);
        assert.equal(f.ledger().at(-1).amount, 1);
    });
    await isolated('failed first award tracks a message without creating a fallback point', async f => {
        await f.message();
        assert.equal(f.user().points, 0);
        assert.equal(f.user().messages_sent, 1);
        assert.equal(f.ledger().length, 0);
        assert.ok(f.errors.some(text => /Failed to add points/.test(text)));
    }, { user: false, rejectAwards: true });
    await isolated('failed existing award preserves balance and ledger but still tracks activity', async f => {
        await f.message();
        assert.equal(f.user().points, 100);
        assert.equal(f.user().messages_sent, 9);
        assert.equal(f.ledger().length, 1);
    }, { rejectAwards: true });
    await isolated('confirmed paycheck awards 10 plus message point and advances clock/watch minutes', async f => {
        const before = f.user().last_paycheck;
        await f.message();
        assert.equal(f.user().points, 111);
        assert.notEqual(f.user().last_paycheck, before);
        assert.deepEqual(f.ledger().map(row => row.amount), [100, 10, 1]);
        assert.deepEqual(f.watchMinutes, [{ username: 'alice', minutes: 12 }]);
    }, { payMinutes: 12 });
    await isolated('failed paycheck leaves clock/watch minutes unchanged and permits message award', async f => {
        const before = f.user().last_paycheck;
        await f.message();
        assert.equal(f.user().points, 101);
        assert.equal(f.user().last_paycheck, before);
        assert.deepEqual(f.watchMinutes, []);
        assert.deepEqual(f.ledger().map(row => row.reason), ['opening', 'chat_message']);
    }, { payMinutes: 12, rejectPaycheck: true });
    await isolated('initial paycheck clock starts without awarding unknown presence', async f => {
        await f.message();
        assert.ok(f.user().last_paycheck);
        assert.equal(f.user().points, 101);
        assert.deepEqual(f.watchMinutes, []);
    }, { noPaycheck: true });
    for (const options of [{ seenMinutes: 20, payMinutes: 20 }, { payMinutes: 1 }]) {
        await isolated(`presence/paycheck interval gate remains unchanged: ${JSON.stringify(options)}`, async f => {
            const before = f.user().last_paycheck;
            await f.message();
            assert.equal(f.user().points, 101);
            assert.equal(f.user().last_paycheck, before);
            assert.deepEqual(f.watchMinutes, []);
        }, options);
    }
    await isolated('self messages and known bots still receive no activity awards', async f => {
        await f.message('!ping', 'alice', true);
        await f.message('!ping', 'NightBot');
        assert.equal(f.user().points, 100);
        assert.equal(f.user().messages_sent, 8);
        assert.equal(f.ledger().length, 1);
        assert.deepEqual(f.watchMinutes, []);
        assert.equal(f.sqlEvents.length, 0);
    });
    for (const command of ['!points', '!balance']) {
        await isolated(`${command} reports a read failure without showing zero/null`, async f => {
            await f.message(command);
            assert.equal(f.messages.length, 1);
            assert.match(f.messages[0].text, /balance is unavailable/);
            assert.doesNotMatch(f.messages[0].text, /got 0|got null|have null/);
        }, { balanceReadFails: true });
        await isolated(`${command} reports a confirmed balance`, async f => {
            await f.message(command);
            assert.match(f.messages[0].text, /you got 101 CUHZ Points/);
        });
    }
    await isolated('a real zero balance remains readable after a failed message award', async f => {
        await f.message('!points');
        assert.match(f.messages[0].text, /you got 0 CUHZ Points/);
    }, { user: false, rejectAwards: true });
    await isolated('activity read failure does not prevent an honest balance response', async f => {
        await f.message('!balance');
        assert.match(f.messages[0].text, /you got 100 CUHZ Points/);
        assert.equal(f.user().messages_sent, 8);
    }, { activityReadFails: true });
    await isolated('gamble never coerces unavailable balance to zero or performs a wager', async f => {
        await f.message('!gamble 10');
        assert.match(f.messages.at(-1).text, /balance is unavailable/);
        assert.deepEqual(f.ledger().map(row => row.reason), ['opening', 'chat_message']);
    }, { channel: '#planetcuhz', balanceReadFails: true });
    for (const command of ['!ask fixture question', '!code fixture question']) {
        await isolated(`${command.split(' ')[0]} failure does not display an unavailable balance`, async f => {
            await f.message(command);
            assert.match(f.messages.at(-1).text, /payment could not be confirmed/);
            assert.doesNotMatch(f.messages.at(-1).text, /only have|null/);
        }, { channel: '#planetcuhz', points: 0, balanceReadFails: true });
        await isolated(`${command.split(' ')[0]} storage failure is not called insufficient funds`, async f => {
            await f.message(command);
            assert.match(f.messages.at(-1).text, /payment could not be confirmed/);
            assert.equal(f.user().points, 101);
        }, { channel: '#planetcuhz', rejectSpend: true });
        await isolated(`${command.split(' ')[0]} failed payment with a low balance does not infer its cause`, async f => {
            await f.message(command);
            assert.match(f.messages.at(-1).text, /payment could not be confirmed/);
            assert.match(f.messages.at(-1).text, /Current balance: 1\./);
            assert.doesNotMatch(f.messages.at(-1).text, /Broke|only have/);
        }, { channel: '#planetcuhz', points: 0 });
    }
    await isolated('confirmed follower bonus may report its balance as unavailable', async f => {
        f.evidence.runtime.verifiedFollowerFixture();
        await f.message('!claim');
        assert.equal(f.user().points, 401);
        assert.match(f.messages.at(-1).text, /received 300 points! Balance is unavailable/);
        assert.doesNotMatch(f.messages.at(-1).text, /Balance: null|Balance: 0/);
    }, { balanceReadFails: true });
    await isolated('failed follower bonus does not assert a duplicate or announce success', async f => {
        f.evidence.runtime.verifiedFollowerFixture();
        await f.message('!claim');
        assert.equal(f.user().points, 100);
        assert.match(f.messages.at(-1).text, /bonus could not be confirmed/);
        assert.doesNotMatch(f.messages.at(-1).text, /received 300|You already claimed|Nice try/);
    }, { rejectAwards: true });
    for (const win of [true, false]) {
        await isolated(`failed gamble ${win ? 'credit' : 'debit'} does not announce a result`, async f => {
            f.evidence.runtime.gambleFixture(win);
            await f.message('!gamble 10');
            assert.equal(f.user().points, 100);
            assert.match(f.messages.at(-1).text, /gamble points result could not be confirmed/);
            assert.doesNotMatch(f.messages.at(-1).text, /WINNER|you lost|doubled up/);
        }, { channel: '#planetcuhz', rejectAwards: true });
        await isolated(`confirmed gamble ${win ? 'credit' : 'debit'} reports only the settled amount`, async f => {
            f.evidence.runtime.gambleFixture(win);
            await f.message('!gamble 10');
            assert.equal(f.user().points, win ? 111 : 91);
            assert.match(f.messages.at(-1).text, win ? /won 10 CUHZ Points/ : /lost 10 points/);
            assert.equal(f.ledger().at(-1).amount, win ? 10 : -10);
        }, { channel: '#planetcuhz' });
    }
    await isolated('failed moderator grant does not announce success', async f => {
        await f.message('!give @alice 10');
        assert.equal(f.user().points, 100);
        assert.match(f.messages.at(-1).text, /points grant to @alice could not be confirmed/);
        assert.doesNotMatch(f.messages.at(-1).text, /gave 10/);
    }, { mod: true, rejectAwards: true });
    await isolated('confirmed moderator grant preserves amount and success reply', async f => {
        await f.message('!give @alice 10');
        assert.equal(f.user().points, 111);
        assert.match(f.messages.at(-1).text, /gave 10 points to @alice/);
        assert.equal(f.ledger().at(-1).reason, 'admin_grant_by_alice');
    }, { mod: true });
    await isolated('grant authorization remains moderator-only', async f => {
        await f.message('!give @alice 10');
        assert.equal(f.user().points, 101);
        assert.deepEqual(f.ledger().map(row => row.reason), ['opening', 'chat_message']);
        assert.equal(f.messages.length, 0);
    });
    await isolated('user API returns 503/no-store for unavailable balance before rank lookup', async f => {
        const res = await getPoints(f, 'alice');
        assert.equal(res.statusCode, 503);
        assert.equal(res.headers['Cache-Control'], 'no-store');
        assert.equal(res.body.error, 'points balance unavailable');
        assert.equal(f.sqlEvents.length, 1);
    }, { balanceReadFails: true });
    await isolated('user API preserves real zero balance and rank', async f => {
        const res = await getPoints(f, '@ALICE');
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.points, 0);
        assert.equal(res.body.rank, 1);
    }, { points: 0 });
    await isolated('user API preserves missing-account 404 behavior', async f => {
        const res = await getPoints(f, 'missing');
        assert.equal(res.statusCode, 404);
    });
    await test('all six current balance-read call sites are covered by this suite', async () => {
        assert.equal((readBotSource().match(/await pointsService\.getBalance\(/g) || []).length, 6);
    });
    console.log(`✅ test_points_runtime: ${checks} checks passed (actual handlers/services; isolated SQLite fixtures)`);
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
