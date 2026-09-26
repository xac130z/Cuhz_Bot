/**
 * test_boot.js — guards against the class of bug that took the bot down on
 * 2026-08-02: a module-level object literal (USER_VARIANT_POOLS) referencing a
 * `const` declared later in the file. That throws a temporal-dead-zone
 * ReferenceError at import time, so the process dies before the /health
 * endpoint ever binds and Railway fails the deploy with "Healthcheck failure".
 *
 * Syntax checks (`node --check`) do NOT catch this — the file parses fine and
 * only explodes when evaluated. This test evaluates it.
 *
 * 2026-09-26: the evaluation now happens in a CHILD process and the verdict is
 * read from its stdout, not its exit code. Reason: with better-sqlite3 v11
 * loaded, Node 24's process teardown intermittently trips the native
 * `Assertion failed: (env) != nullptr` (Abort trap: 6) AFTER the verdict is
 * already decided, corrupting the exit code of an otherwise-passing run.
 * Production is unaffected (the Postgres path never loads the addon). The
 * TDZ guarantee is unchanged: a load-time crash still fails this test.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const BOT = path.resolve(__dirname, '../src/bot.js');

const childScript = `
let verdict = 'PASS';
let detail = '';
try {
    require(${JSON.stringify(BOT)});
} catch (err) {
    if (err instanceof ReferenceError && /before initialization/.test(err.message)) {
        verdict = 'FAIL_TDZ';
        detail = err.message;
    } else {
        // Anything else (missing env, no network) is benign for this guard.
        detail = String(err.message).split('\\n')[0];
    }
}
console.log('BOOT_VERDICT:' + verdict + (detail ? ' — ' + detail : ''));
// Hard exit; the parent judges by the verdict line, never by this exit path.
process.exit(0);
`;

const res = spawnSync(process.execPath, ['-e', childScript], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 30000,
    env: process.env,
});

const out = `${res.stdout || ''}${res.stderr || ''}`;
if (out.includes('BOOT_VERDICT:PASS')) {
    console.log('✅ test_boot: src/bot.js evaluates without a load-time crash');
    process.exit(0);
} else if (out.includes('BOOT_VERDICT:FAIL_TDZ')) {
    console.error('❌ test_boot FAILED — temporal dead zone.');
    console.error('   A module-level constant is used before it is declared.');
    console.error('   Move the declaration ABOVE its first use (see the NOTE above USER_VARIANT_POOLS).');
    console.error(out.split('\n').find(l => l.includes('BOOT_VERDICT')) || '');
    process.exit(1);
} else {
    console.error('❌ test_boot FAILED — src/bot.js crashed at import before reaching the verdict.');
    console.error(out.slice(-2000));
    process.exit(1);
}
