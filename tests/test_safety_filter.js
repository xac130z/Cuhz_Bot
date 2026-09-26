/**
 * Safety-filter tests. The bot once called a streamer a "demon" on stream;
 * Planet CUHZ is a faith-friendly community ("peace and blessings").
 * These lock the guardrail in place.
 */
const path = require('path');
const src = require('fs').readFileSync(path.resolve(__dirname, '../src/ai_service.js'), 'utf8');

const words = [...src.match(/const BANNED_DEMONIC = \[([\s\S]*?)\];/)[1]
    .matchAll(/'([^']+)'/g)].map(m => m[1]);

function blocked(text) {
    const lower = text.toLowerCase();
    return words.some(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower));
}

const cases = [
    // Must be blocked — dark-spiritual language about a person
    ['four_a_reason is a demon with that jumpshot', true],
    ['@four_a_reason is EVIL with the handles', true],
    ['that man is possessed right now', true],
    ['bro a devil on defense', true],
    ['cursed shot selection', true],
    ['he satanic with the crossover', true],
    // Must pass — normal hype and ordinary words
    ['let me demonstrate the play', false],
    ['bro is him, cold blooded', false],
    ['that was nasty, he different', false],
    ['peace and blessings cuhz', false],
    ['GG! good game everybody', false],
    ['welcome to the stream cuhz', false]
];

let failures = 0;
for (const [text, expected] of cases) {
    const got = blocked(text);
    if (got === expected) {
        console.log(`✅ ${got ? 'BLOCK' : 'allow'} — "${text}"`);
    } else {
        console.error(`❌ "${text}": expected blocked=${expected}, got ${got}`);
        failures++;
    }
}
if (words.length < 15) { console.error('❌ BANNED_DEMONIC list looks truncated'); failures++; }
if (failures) { console.error(`\n${failures} safety-filter test(s) FAILED`); process.exit(1); }
console.log('\n✅ All safety-filter tests passed');
