// Ported from the reviewed local cuhzbot-points candidate on 2026-09-09.
/**
 * Actual adapter + service regressions. Never import the database singleton:
 * capture its class in a VM, skip its constructor, and inject isolated storage.
 * Postgres uses a transaction/row-lock contract double, not a real connection.
 * SQLite runs real SQL in :memory: when its optional native module is available.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const databaseSource = fs.readFileSync(path.join(root, 'src/database.js'), 'utf8');
const classSource = databaseSource.replace(
  /const db = new DBAdapter\(\);\s*module\.exports = db;\s*$/,
  'module.exports = DBAdapter;'
);
assert.notEqual(classSource, databaseSource, 'capture class without running the singleton constructor');
const adapterContext = {
  module: { exports: {} },
  require(name) {
    if (name === 'pg') return { Pool: class { constructor() { throw new Error('Real connections forbidden'); } } };
    if (name === 'path') return path;
    if (name === 'fs') return {}; // No database file access, even accidentally.
    throw new Error(`Unexpected adapter dependency: ${name}`);
  },
};
vm.runInNewContext(classSource, adapterContext, { filename: 'database.js' });
const DBAdapter = adapterContext.module.exports;
const serviceSource = fs.readFileSync(path.join(root, 'src/points_service.js'), 'utf8');
const quietLogger = { info() {}, error() {}, debug() {} };
function serviceFor(adapter) {
  const context = {
    module: { exports: {} },
    require(name) {
      if (name === './database') return adapter;
      if (name === './logger') return quietLogger;
      throw new Error(`Unexpected service dependency: ${name}`);
    },
  };
  vm.runInNewContext(serviceSource, context, { filename: 'points_service.js' });
  return context.module.exports;
}

// Model committed data and transaction isolation, including a serial row lock.
// Query faults normally happen before the named statement takes effect. A
// separate acknowledgement-loss fixture proves the unknown-outcome limitation.
function postgresFixture(options = {}) {
  const adapter = Object.create(DBAdapter.prototype);
  adapter.type = 'postgres';
  let users = new Map([['alice', 100]]);
  let ledger = [{ username: 'alice', amount: 100, reason: 'opening' }];
  let queue = Promise.resolve();
  const events = [];
  const faults = new Set(options.failAt || []);
  const failure = new Error('injected database failure');
  failure.code = '23505'; // Must not be swallowed like generic prepare().run.
  adapter.pgPool = {
    query() { throw new Error('Transaction must use its leased client'); },
    async connect() {
      events.push({ stage: 'CONNECT' });
      if (faults.has('CONNECT')) throw failure;
      const previous = queue;
      let unlock;
      queue = new Promise(resolve => { unlock = resolve; });
      await previous;
      let txUsers;
      let txLedger;
      let released = false;
      return {
        async query(sql, args = []) {
          assert.equal(released, false, 'no query after client release');
          const compact = sql.trim().replace(/\s+/g, ' ');
          const stage = compact.startsWith('INSERT INTO points_ledger') ? 'ledger'
            : /^(INSERT INTO users|UPDATE users)/.test(compact) ? 'balance' : compact;
          events.push({ stage, sql: compact, args });
          if (faults.has(stage)) throw failure;
          if (stage === 'BEGIN') {
            txUsers = new Map(users);
            txLedger = ledger.map(row => ({ ...row }));
            return { rowCount: null };
          }
          if (stage === 'ROLLBACK') { txUsers = txLedger = undefined; return { rowCount: null }; }
          assert.ok(txUsers, 'all points statements require an active transaction');
          if (stage === 'COMMIT') {
            users = txUsers; ledger = txLedger; txUsers = txLedger = undefined;
            if (options.commitAcknowledgementLost) throw failure;
            return { rowCount: null };
          }
          if (stage === 'balance' && compact.startsWith('INSERT')) {
            assert.match(compact, /SET points = users\.points \+ \$3$/, 'Postgres UPSERT qualifies existing balance');
            const [user, initial, increase] = args;
            txUsers.set(user, txUsers.has(user) ? txUsers.get(user) + increase : initial);
            return { rowCount: Object.hasOwn(options, 'balanceRowCount') ? options.balanceRowCount : 1 };
          }
          if (stage === 'balance') {
            const [cost, user, minimum] = args;
            if (!txUsers.has(user)) return { rowCount: 0 };
            if (/AND points >= \$3$/.test(compact) && txUsers.get(user) < minimum) return { rowCount: 0 };
            txUsers.set(user, txUsers.get(user) - cost);
            return { rowCount: Object.hasOwn(options, 'balanceRowCount') ? options.balanceRowCount : 1 };
          }
          if (stage === 'ledger') {
            if (options.ledgerNoRow) return { rowCount: 0 };
            txLedger.push({ username: args[0], amount: args[1], reason: args[2] });
            return { rowCount: 1 };
          }
          throw new Error(`Unexpected SQL: ${compact}`);
        },
        release(error) {
          assert.equal(released, false, 'client released exactly once');
          released = true;
          events.push({ stage: 'RELEASE', error });
          unlock(); // Uncommitted data is discarded, including failed rollback.
        },
      };
    },
  };
  return {
    adapter, service: serviceFor(adapter), events, failure,
    snapshot: () => ({ users: Object.fromEntries(users), ledger: ledger.map(row => ({ ...row })) }),
  };
}

function sqliteFixture(Database, options = {}) {
  const adapter = Object.create(DBAdapter.prototype);
  adapter.type = 'sqlite';
  const sqlite = new Database(':memory:');
  sqlite.exec(adapter._getSchema('sqlite').join(';') + ';');
  sqlite.prepare('INSERT INTO users (username, points) VALUES (?, ?)').run('alice', 100);
  sqlite.prepare('INSERT INTO points_ledger (username, amount, reason) VALUES (?, ?, ?)').run('alice', 100, 'opening');
  if (options.rejectLedger) {
    sqlite.exec(`CREATE TRIGGER reject_points_ledger BEFORE INSERT ON points_ledger
      BEGIN SELECT RAISE(ABORT, 'injected ledger failure'); END;`);
  }
  if (options.ignoreLedger) {
    sqlite.exec(`CREATE TRIGGER ignore_points_ledger BEFORE INSERT ON points_ledger
      BEGIN SELECT RAISE(IGNORE); END;`);
  }
  const events = [];
  adapter.sqlite = {
    prepare(sql) { events.push('statement'); return sqlite.prepare(sql); },
    transaction(callback) {
      return sqlite.transaction(() => {
        events.push('begin');
        const result = callback();
        assert.ok(!result || typeof result.then !== 'function', 'SQLite transaction callback is synchronous');
        events.push('end');
        return result;
      });
    },
  };
  return {
    adapter, service: serviceFor(adapter), events,
    close: () => sqlite.close(),
    snapshot: () => ({
      users: Object.fromEntries(sqlite.prepare('SELECT username, points FROM users ORDER BY username').all().map(row => [row.username, row.points])),
      ledger: sqlite.prepare('SELECT username, amount, reason FROM points_ledger ORDER BY id').all(),
    }),
  };
}

let checks = 0;
async function test(name, body) {
  await body();
  checks++;
  console.log(`  ✅ ${name}`);
}

async function commonCases(label, fixture) {
  async function isolated(name, body, options) {
    await test(`${label}: ${name}`, async () => {
      const f = fixture(options);
      try { await body(f); } finally { f.close?.(); }
    });
  }
  await isolated('credit existing/new users and debit keep ledger agreement', async f => {
    assert.equal(await f.service.addPoints('@Alice', 25, 'credit'), true);
    assert.equal(await f.service.addPoints('BOB', 50, 'new'), true);
    assert.equal(await f.service.deductPoints('Alice', 10, 'spend'), true);
    const state = f.snapshot();
    assert.deepEqual(state.users, { alice: 115, bob: 50 });
    for (const [user, balance] of Object.entries(state.users)) {
      assert.equal(state.ledger.filter(row => row.username === user).reduce((sum, row) => sum + row.amount, 0), balance);
    }
    assert.deepEqual(state.ledger.slice(1).map(row => row.amount), [25, 50, -10]);
  });
  await isolated('insufficient funds and missing user change nothing', async f => {
    const before = f.snapshot();
    assert.equal(await f.service.deductPoints('alice', 101, 'spend'), false);
    assert.equal(await f.service.deductPoints('ghost', 1, 'spend'), false);
    assert.deepEqual(f.snapshot(), before);
  });
  await isolated('concurrent full-balance debits permit exactly one', async f => {
    const outcomes = await Promise.all([
      f.service.deductPoints('alice', 100, 'first'),
      f.service.deductPoints('alice', 100, 'second'),
    ]);
    assert.equal(outcomes.filter(Boolean).length, 1);
    assert.equal(f.snapshot().users.alice, 0);
    assert.equal(f.snapshot().ledger.length, 2);
  });
  await isolated('concurrent credits accumulate without lost updates', async f => {
    assert.deepEqual(await Promise.all([
      f.service.addPoints('alice', 20, 'first'),
      f.service.addPoints('alice', 30, 'second'),
    ]), [true, true]);
    assert.equal(f.snapshot().users.alice, 150);
    assert.equal(f.snapshot().ledger.length, 3);
  });
  await isolated('invalid values fail before SQL; zero-cost behavior is retained', async f => {
    const before = f.snapshot();
    for (const invalid of [NaN, Infinity, -Infinity, 0.5, -0.5, Number.MAX_SAFE_INTEGER + 1, -Number.MAX_SAFE_INTEGER - 1, '10', null, undefined]) {
      assert.equal(await f.service.addPoints('alice', invalid, 'invalid'), false);
      assert.equal(await f.service.deductPoints('alice', invalid, 'invalid'), false);
      assert.equal(await f.adapter.mutatePoints({ username: 'alice', amount: invalid, reason: 'invalid' }), false);
    }
    assert.equal(await f.service.addPoints('alice', 0, 'zero'), false);
    assert.equal(await f.service.deductPoints('alice', 0, 'zero'), true);
    assert.equal(await f.adapter.mutatePoints({ username: 'alice', amount: 0, reason: 'zero' }), true);
    // Retain the existing nonpositive no-cost contract; do not turn it into a credit.
    assert.equal(await f.service.addPoints('alice', -10, 'negative'), false);
    assert.equal(await f.service.deductPoints('alice', -10, 'negative'), true);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.events.length, 0);
  });
}

(async () => {
  console.log('test_points_integrity:');
  await commonCases('Postgres contract', postgresFixture);
  await test('Postgres commits through one leased client and releases it', async () => {
    const f = postgresFixture();
    assert.equal(await f.service.addPoints('alice', 10, 'credit'), true);
    assert.deepEqual(f.events.map(event => event.stage), ['CONNECT', 'BEGIN', 'balance', 'ledger', 'COMMIT', 'RELEASE']);
    assert.equal(f.events.at(-1).error, undefined);
  });
  for (const operation of ['addPoints', 'deductPoints']) {
    for (const stage of ['CONNECT', 'BEGIN', 'balance', 'ledger', 'COMMIT']) {
      await test(`Postgres ${operation}: ${stage} failure reports false and preserves committed data`, async () => {
        const f = postgresFixture({ failAt: [stage] });
        const before = f.snapshot();
        assert.equal(await f.service[operation]('alice', 50, 'test'), false);
        assert.deepEqual(f.snapshot(), before);
        if (stage === 'CONNECT') {
          assert.equal(f.events.length, 1);
        } else {
          assert.equal(f.events.at(-2).stage, 'ROLLBACK');
          assert.equal(f.events.at(-1).stage, 'RELEASE');
          assert.equal(f.events.at(-1).error, f.failure, 'discard failed client');
        }
      });
    }
  }
  await test('Postgres rollback failure still releases/discards and preserves the original error', async () => {
    const f = postgresFixture({ failAt: ['ledger', 'ROLLBACK'] });
    const before = f.snapshot();
    await assert.rejects(f.adapter.mutatePoints({ username: 'alice', amount: -50, reason: 'test' }), error => error === f.failure);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.events.at(-1).stage, 'RELEASE');
    assert.equal(f.events.at(-1).error, f.failure);
  });
  await test('Postgres missing ledger row rolls back instead of reporting success', async () => {
    const f = postgresFixture({ ledgerNoRow: true });
    const before = f.snapshot();
    assert.equal(await f.service.addPoints('alice', 50, 'test'), false);
    assert.deepEqual(f.snapshot(), before);
  });
  await test('Postgres malformed affected-row counts fail and roll back', async () => {
    for (const count of [null, undefined, 2, -1, '1']) {
      const f = postgresFixture({ balanceRowCount: count });
      const before = f.snapshot();
      assert.equal(await f.service.addPoints('alice', 50, 'test'), false);
      assert.deepEqual(f.snapshot(), before);
    }
  });
  await test('Postgres lost COMMIT acknowledgement is unknown and never automatically retried', async () => {
    const f = postgresFixture({ commitAcknowledgementLost: true });
    assert.equal(await f.service.deductPoints('alice', 50, 'test'), false);
    // The server committed before the simulated reply was lost. The boolean
    // interface cannot distinguish this from a definite failure; callers must
    // reconcile before retrying. A ROLLBACK attempt does not undo a commit.
    assert.equal(f.snapshot().users.alice, 50);
    assert.equal(f.snapshot().ledger.at(-1).amount, -50);
    assert.equal(f.events.filter(event => event.stage === 'balance').length, 1);
    assert.equal(f.events.at(-1).error, f.failure);
  });

  let Database;
  try {
    Database = require('better-sqlite3');
    const probe = new Database(':memory:');
    probe.close();
  } catch (error) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      // Test-only bridge for runtimes whose optional native module has a
      // different ABI. All SQL still runs against a real in-memory SQLite DB.
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
            } catch (failure) {
              this.db.exec('ROLLBACK');
              throw failure;
            }
          };
        }
      };
      console.log('  SQLite engine: node:sqlite (:memory:; test-only transaction bridge)');
    } catch (_) {
      Database = null;
      console.log(`  ⚠ SQLite cases skipped: optional native module unavailable (${error.code || error.name}) and node:sqlite absent. Use the matching Node 20 runtime for full coverage.`);
    }
  }
  if (Database) {
    await commonCases('SQLite :memory:', options => sqliteFixture(Database, options));
    for (const operation of ['addPoints', 'deductPoints']) {
      for (const mode of ['rejectLedger', 'ignoreLedger']) {
        await test(`SQLite ${operation}: ${mode} rolls back the balance`, async () => {
          const f = sqliteFixture(Database, { [mode]: true });
          try {
            const before = f.snapshot();
            assert.equal(await f.service[operation]('alice', 50, 'test'), false);
            assert.deepEqual(f.snapshot(), before);
            if (operation === 'addPoints') {
              assert.equal(await f.service.addPoints('newuser', 50, 'test'), false);
              assert.deepEqual(f.snapshot(), before, 'failed credit does not leave a new account');
            }
          } finally { f.close(); }
        });
      }
    }
    await test('SQLite completes the transaction before yielding to another caller', async () => {
      const f = sqliteFixture(Database);
      try {
        const pending = f.adapter.mutatePoints({ username: 'alice', amount: -50, reason: 'test' });
        assert.deepEqual(f.events, ['begin', 'statement', 'statement', 'statement', 'end']);
        assert.equal(f.snapshot().users.alice, 50);
        assert.equal(f.snapshot().ledger.at(-1).amount, -50);
        assert.equal(await pending, true);
      } finally { f.close(); }
    });
    await test('SQLite rolls back a credit whose resulting balance exceeds safe integers', async () => {
      const f = sqliteFixture(Database);
      try {
        assert.equal(await f.service.addPoints('alice', Number.MAX_SAFE_INTEGER - 100, 'boundary'), true);
        assert.equal(f.snapshot().users.alice, Number.MAX_SAFE_INTEGER);
        const before = f.snapshot();
        assert.equal(await f.service.addPoints('alice', 1, 'overflow'), false);
        assert.deepEqual(f.snapshot(), before);
      } finally { f.close(); }
    });
  }
  console.log(`✅ test_points_integrity: ${checks} checks passed`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
