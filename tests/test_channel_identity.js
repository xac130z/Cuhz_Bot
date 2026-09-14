const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeChannel, normalizeChannels } = require('../src/channel_identity');

assert.equal(sanitizeChannel('qweenstormygirlnz89'), '#stormygirlnz89');
assert.equal(sanitizeChannel('  #QWEENSTORMYGIRLNZ89  '), '#stormygirlnz89');
assert.equal(sanitizeChannel('stormygirlnz89'), '#stormygirlnz89');
assert.equal(sanitizeChannel('#PlanetCuhz'), '#planetcuhz');
for (const invalid of [null, undefined, '', '  ', '#', 123]) {
    assert.equal(sanitizeChannel(invalid), null);
}
assert.deepEqual(normalizeChannels([
    'qweenstormygirlnz89', '#stormygirlnz89', 'planetcuhz', 'PLANETCUHZ', null
]), ['#stormygirlnz89', '#planetcuhz']);
// Guard the real startup wiring without booting a bot or touching customer data.
const bot = fs.readFileSync(path.join(__dirname, '../src/bot.js'), 'utf8');
assert.match(bot, /'stormygirlnz89':\s+TIERS\.BASIC/);
assert.doesNotMatch(bot, /'qweenstormygirlnz89':\s+TIERS\./);
assert.match(bot, /normalizeChannels\(response\.data\.channels\.map\(ch => ch\.name\)\)/);
assert.match(bot, /normalizeChannels\(config\.channels\)/);
assert.match(bot, /await client\.join\(target\)/);
console.log('Channel identity regression checks passed');
