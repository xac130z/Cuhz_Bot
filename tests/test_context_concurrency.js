'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load({ get = async () => null, generate = async () => 'hello' } = {}) {
    const sandbox = {
        module: { exports: {} }, process: { env: {} },
        setInterval: () => ({ unref() {} }),
        require(name) {
            if (name === './logger') return { info() {}, error() {}, debug() {} };
            if (name === './database') return { prepare: () => ({ get, run: async () => ({}) }) };
            if (name === './ai_service') return { generateContextAwareResponse: generate };
            throw new Error(`Unexpected dependency ${name}`);
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/context_handler.js'), 'utf8'), sandbox);
    return sandbox.module.exports;
}
const ask = (h, user = 'Tester') => h.handleContextAwareResponse('#planetcuhz', user, 'cuhzbot please explain this?', 'happy', {});

(async () => {
    let release;
    let calls = 0;
    const handler = load({ get: () => new Promise(resolve => { release = resolve; }), generate: async () => { calls++; return '@TESTER @Tester: hello'; } });
    const first = ask(handler);
    assert.equal(await ask(handler, 'tester'), null, 'reservation spans cache await and username case');
    release(null);
    assert.equal(await first, '@Tester hello');
    assert.equal(calls, 1);
    assert.equal(await ask(handler), null, 'successful reply retains 60 second cooldown');

    let finish;
    const delayed = load({ generate: () => new Promise(resolve => { finish = resolve; }) });
    const pending = ask(delayed);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(await ask(delayed), null, 'reservation spans model await');
    finish('hello');
    await pending;

    let attempt = 0;
    const failure = load({ generate: async () => { if (++attempt === 1) throw new Error('offline'); return 'recovered'; } });
    assert.equal(await ask(failure), null);
    assert.equal(await ask(failure), '@Tester recovered', 'failed model releases reservation');
    const empty = load({ generate: async () => null });
    assert.equal(await ask(empty), null);
    assert.equal(await ask(empty), null);
    assert.equal(empty.canRespondToUser('Tester'), true, 'no-response does not arm cooldown');

    for (const [body, expected] of [
        ['@TESTER: hello', '@Tester hello'],
        ['@Tester, @tester hello', '@Tester hello'],
        ['@Other hello @Tester', '@Tester @Other hello @Tester'],
        ['@TesterTwo hello', '@Tester @TesterTwo hello'],
        ['hello @Tester', '@Tester hello @Tester']
    ]) {
        assert.equal(await ask(load({ get: async () => ({ response: body }) })), expected);
    }
    console.log('Context concurrency/mention checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
