'use strict';
// The bot's proactive copy is the ONLY thing guiding a viewer on an unattended
// stream. These tests exist because the stream title advertised "!tools" for
// weeks while no such handler existed — every viewer who tried it got silence.
// A promise in copy that the bot cannot keep is the honesty law's exact failure
// case, and it is trivially preventable by grep.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'bot.js'), 'utf8');

const handlers = new Set([
    ...src.matchAll(/msg === '!([a-z0-9&]+)'/g),
    ...src.matchAll(/msg\.startsWith\('!([a-z0-9&]+) /g),
].map(m => m[1]));

// Plain string slicing rather than a built regex — escaping a bracket through a
// template literal into a RegExp constructor is exactly the kind of thing that
// silently matches nothing and makes a test pass for the wrong reason.
const poolOf = name => {
    const start = src.indexOf(`const ${name} = [`);
    assert.notEqual(start, -1, `${name} not found`);
    const end = src.indexOf('\n];', start);
    assert.notEqual(end, -1, `${name} has no closing bracket`);
    return src.slice(start, end);
};
const commandsIn = text => [...new Set([...text.matchAll(/!([a-z0-9&]+)/g)].map(m => m[1]))];

for (const pool of ['TIMER_MESSAGES', 'BASIC_TIMER_MESSAGES']) {
    check(`${pool} only advertises commands that actually exist`, () => {
        const missing = commandsIn(poolOf(pool)).filter(c => !handlers.has(c));
        assert.deepEqual(missing, [], `${pool} promises ${missing.map(c => '!' + c).join(' ')} with no handler`);
    });
}

check('!tools exists — the stream title advertises it', () => {
    assert.ok(handlers.has('tools'), '!tools must have a handler');
    assert.ok(handlers.has('rig') && handlers.has('setup'), 'aliases !rig / !setup');
});

check('the timer pool orients a newcomer before it drops a link', () => {
    const lines = poolOf('TIMER_MESSAGES').split('\n').filter(l => l.trim().startsWith('"'));
    const firstLink = lines.findIndex(l => /https?:\/\//.test(l));
    assert.ok(firstLink > 0, 'the first timer line must not be a bare link');
    const orienting = lines.slice(0, firstLink).join(' ');
    assert.match(orienting, /!tools|!help/, 'early lines must point at a command that explains the channel');
});

check('no timer promises chat control of the lounge while it is undeployed', () => {
    // The lounge controller ships on an unmerged branch. Advertising `!lounge vibe`
    // before it is on main would be a door that does not open — exactly what the
    // !tools gap already did to this channel once.
    const all = poolOf('TIMER_MESSAGES') + poolOf('BASIC_TIMER_MESSAGES');
    assert.doesNotMatch(all, /!lounge\s+(vibe|color|zoom|card|glow|depth)/,
        'do not advertise lounge chat control until PR #17 is merged and deployed');
});

check('no crypto vocabulary in any proactive copy (standing law)', () => {
    const all = poolOf('TIMER_MESSAGES') + poolOf('BASIC_TIMER_MESSAGES') + poolOf('HYPE_MESSAGES');
    const m = all.match(/\b(blockchain|crypto\w*|token|web3|nft|bitcoin|solana|memecoin)\b/i);
    assert.equal(m, null, `forbidden vocabulary "${m && m[0]}" in bot copy`);
});

console.log(`\n${passed} chat-guidance checks passed.`);
