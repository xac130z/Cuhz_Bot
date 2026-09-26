// Ported from the reviewed local cuhzbot-points candidate on 2026-09-09.
'use strict';
const assert = require('node:assert/strict');
const { evaluateBotBoot, readBotSource } = require('./helpers/isolated_bot_boot');

let checks = 0;
function test(name, callback) {
    callback();
    checks++;
    console.log(`  ✅ ${name}`);
}

const source = readBotSource();
test('complete actual bot module reaches EOF and registers routes in inert app', () => {
    const evidence = evaluateBotBoot(source);
    assert.equal(evidence.reachedEnd, true);
    assert.equal(evidence.listenRequests, 1);
    assert.equal(evidence.seedRequests, 0, 'legacy automatic points seed stays retired');
    assert.equal(evidence.fileExistenceProbes, 1);
    assert.ok(evidence.routes.some(row => row.method === 'GET' && row.route === '/health'));
    assert.ok(evidence.routes.some(row => row.method === 'GET' && row.route === '/api/rewards'));
    assert.ok(evidence.routes.some(row => row.method === 'GET' && row.route === '/'));
    assert.deepEqual(evidence.forbiddenAttempts, []);
});
test('injected temporal dead zone fails instead of passing early', () => {
    assert.throws(() => evaluateBotBoot(`const broken = later; const later = 1;\n${source}`),
        error => error.name === 'ReferenceError' && /before initialization/.test(error.message));
});
test('unrelated TypeError before EOF also fails', () => {
    assert.throws(() => evaluateBotBoot(`${source}\nthrow new TypeError('injected boot failure');`),
        error => error.name === 'TypeError' && /injected boot failure/.test(error.message));
});
test('config and process environment are fixtures, with no dotenv import', () => {
    const evidence = evaluateBotBoot(`${source}\nif (Object.keys(process.env).length !== 0) throw new Error('environment leaked');
      if (config.port !== 0 || config.channels.length !== 0) throw new Error('config leaked');`);
    assert.ok(evidence.requiredModules.includes('./config'));
    assert.ok(!evidence.requiredModules.includes('dotenv'));
});
test('process listeners stay confined to the isolated context', () => {
    const signals = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'];
    const before = signals.map(signal => process.listenerCount(signal));
    const evidence = evaluateBotBoot(source);
    assert.deepEqual(signals.map(signal => process.listenerCount(signal)), before);
    assert.deepEqual([...evidence.registeredSignals].sort(), [...signals].sort());
});
test('bot dependencies never enter the real module cache', () => {
    const before = Object.keys(require.cache).sort();
    evaluateBotBoot(source);
    assert.deepEqual(Object.keys(require.cache).sort(), before);
});
for (const [operation, attempt] of [
    ['filesystem read', "require('fs').readFileSync('forbidden')"],
    ['filesystem write', "require('fs').writeFileSync('forbidden', 'value')"],
    ['database query', "require('./database').prepare('SELECT 1')"],
    ['database mutation', "require('./database').mutatePoints({})"],
    ['fetch', "fetch('https://example.invalid')"],
    ['axios', "require('axios').get('https://example.invalid')"],
    ['chat client', "new (require('tmi.js').Client)({})"],
    ['timeout', 'setTimeout(() => {}, 1)'],
    ['interval', 'setInterval(() => {}, 1)'],
    ['process exit', 'process.exit(0)'],
    ['unapproved dependency', "require('dotenv')"],
]) {
    test(`${operation} is forbidden even if bot catches the error`, () => {
        assert.throws(() => evaluateBotBoot(`${source}\ntry { ${attempt}; } catch (_) {}`), /Isolated boot forbids/);
    });
}
console.log(`✅ test_boot_isolated: ${checks} checks passed (isolated evaluation, not live startup)`);
