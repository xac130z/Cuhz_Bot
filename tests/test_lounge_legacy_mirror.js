'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual legacy dispatch block with inert ports, even though the
// release keeps it disabled. No Twitch client, credentials, database or timer.
const source = fs.readFileSync(path.join(__dirname, '../src/bot.js'), 'utf8');
const start = source.indexOf('    if (loungeEnabled() &&', source.indexOf('0.7. THE CUHZ LAB'));
const end = source.indexOf('    // 0.8. CUHZ Vibe Commands', start);
assert.ok(start > 0 && end > start);
const block = source.slice(start, end);

test('legacy owner controls ignore shared-chat copies before identity lookup or stage dispatch', async () => {
  for (const sourceRoom of [undefined, '', '175727753', 'different-room']) {
    let lookups = 0, mutations = 0;
    const context = {
      tags: { 'room-id': '175727753', 'source-room-id': sourceRoom },
      msg: '!lounge next', message: '!lounge next', channel: '#cuhz_bot',
      loungeEnabled: () => true,
      LOUNGE_ROOM_IDS: new Set(['175727753']), LOUNGE_INTENT_RE: /^!lounge/,
      loungeActor: () => ({ userId: '1293717308', login: 'planetcuhz' }),
      isWebLinked: async () => { lookups++; return true; },
      _loungeLogins: new Map(), parseLabCommand: () => null,
      handleLoungeIntent: () => { mutations++; return true; },
    };
    await vm.runInNewContext('(async () => {' + block + '})()', context);
    assert.equal(lookups, sourceRoom ? 0 : 1);
    assert.equal(mutations, sourceRoom ? 0 : 1);
  }
});
