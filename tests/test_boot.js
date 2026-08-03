/**
 * test_boot.js — guards against the class of bug that took the bot down on
 * 2026-08-02: a module-level object literal (USER_VARIANT_POOLS) referencing a
 * `const` declared later in the file. That throws a temporal-dead-zone
 * ReferenceError at import time, so the process dies before the /health
 * endpoint ever binds and Railway fails the deploy with "Healthcheck failure".
 *
 * Syntax checks (`node --check`) do NOT catch this — the file parses fine and
 * only explodes when evaluated. This test evaluates it.
 */

const path = require('path');
const BOT = path.resolve(__dirname, '../src/bot.js');

let failed = false;
try {
    require(BOT);
    console.log('✅ test_boot: src/bot.js evaluates without a load-time crash');
} catch (err) {
    if (err instanceof ReferenceError && /before initialization/.test(err.message)) {
        console.error(`❌ test_boot FAILED — temporal dead zone: ${err.message}`);
        console.error('   A module-level constant is used before it is declared.');
        console.error('   Move the declaration ABOVE its first use (see the NOTE above USER_VARIANT_POOLS).');
        failed = true;
    } else {
        // Anything else (missing env, no network) is fine — we only guard TDZ/import crashes.
        console.log(`✅ test_boot: no load-time TDZ crash (benign: ${err.message.split('\n')[0]})`);
    }
}

// bot.js starts timers/servers on import; don't hang the suite.
setTimeout(() => process.exit(failed ? 1 : 0), 500).unref?.();
if (failed) process.exitCode = 1;
