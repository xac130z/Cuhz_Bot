'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { evaluateBotBoot } = require('./helpers/isolated_bot_boot');
let checks = 0;
function pass(name) { checks++; console.log(`PASS ${name}`); }
async function main() {
    const seedSource = fs.readFileSync(path.join(__dirname, '../src/points_seed.js'), 'utf8');
    const seed = { module: { exports: {} }, require() { throw new Error('Retired seed cannot import anything'); } };
    vm.runInNewContext(seedSource, seed, { timeout: 1000 });
    const result = await seed.module.exports.seedPoints();
    assert.equal(result.status, 'disabled'); assert.equal(result.reason, 'legacy_seed_retired');
    pass('even an explicit legacy seed call imports nothing and awards nothing');
    const boot = evaluateBotBoot();
    assert.equal(boot.seedRequests, 0); assert.ok(!boot.requiredModules.includes('./points_seed'));
    pass('actual whole bot evaluation no longer imports or invokes automatic historical grants');

    const source = fs.readFileSync(path.join(__dirname, '../scripts/backfill-points.js'), 'utf8');
    function run(args) {
        const logs = [], calls = [], exits = [];
        const context = {
            process: { argv: ['node', 'backfill-points.js', ...args], exit(code) { exits.push(code); throw new Error(`fixture_exit_${code}`); } },
            console: { log: (...s) => logs.push(s.join(' ')), error: (...s) => logs.push(s.join(' ')), warn: (...s) => logs.push(s.join(' ')) },
            require(name) {
                calls.push(`require:${name}`);
                if (name === 'crypto') return crypto;
                if (name === 'path') return path;
                if (name === 'fs') return { readFileSync() { calls.push('read'); return JSON.stringify([
                    '[2026-09-10T12:00:00.000Z] [INFO] Added 10 points to fixture_person (chat_message)',
                ]); } };
                throw new Error(`Forbidden module: ${name}`);
            },
        };
        try { vm.runInNewContext(source, context, { timeout: 1000 }); }
        catch (error) { assert.equal(error.message, 'fixture_exit_1'); }
        return { logs, calls, exits };
    }
    for (const args of [['synthetic.json'], ['--apply', 'synthetic.json'], ['--force', 'synthetic.json']]) {
        const r = run(args); assert.deepEqual(r.exits, [1]); assert.ok(!r.calls.includes('read'));
        assert.ok(r.logs.some(text => text.includes('replay is disabled')));
    }
    pass('legacy default/apply/force modes refuse before reading input or importing a database');
    const report = run(['--dry-run', 'synthetic.json']);
    assert.deepEqual(report.exits, []); assert.ok(report.calls.includes('read'));
    assert.ok(report.logs.some(text => text.includes('not verified balances')));
    assert.ok(report.logs.some(text => text.includes('nothing written')));
    assert.ok(report.logs.some(text => text.includes('fixture_person')));
    assert.ok(!report.calls.some(text => /database|dotenv|pg/.test(text)));
    pass('synthetic dry-run report remains usable with an explicit unverified-candidate label and no database import');
    console.log(`${checks}/${checks} isolated legacy-retirement checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
