'use strict';

// Focused contract for Grouch's personal shoutout. This stays source-level so
// it can guard the production registry without booting Twitch, the database,
// timers, or any network-backed service.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readBotSource } = require('./helpers/isolated_bot_boot');

const source = readBotSource();
const declarationStart = source.indexOf('const GROUCH_QUOTES = [');
const declarationEnd = source.indexOf('\n];', declarationStart);
assert.notEqual(declarationStart, -1, 'GROUCH_QUOTES declaration exists');
assert.notEqual(declarationEnd, -1, 'GROUCH_QUOTES declaration is complete');

const declaration = source.slice(declarationStart, declarationEnd + 3);
const quotes = vm.runInNewContext(`${declaration}\nGROUCH_QUOTES;`, Object.create(null), {
    filename: 'GROUCH_QUOTES fixture',
    timeout: 100,
});

let passed = 0;
function check(name, callback) {
    callback();
    passed++;
    console.log(`PASS ${name}`);
}

check('Grouch has a substantial, unique rotation', () => {
    assert.equal(quotes.length, 12);
    assert.equal(new Set(quotes).size, quotes.length);
});

check('every response names the correct Twitch account', () => {
    for (const quote of quotes) assert.match(quote, /@grouch392\b/i);
});

check('the approved tagline is spelled and punctuated consistently', () => {
    const taglineQuotes = quotes.filter(quote => /Mr\./.test(quote));
    assert.ok(taglineQuotes.length >= 3, 'the tagline should anchor multiple variants');
    for (const quote of taglineQuotes) assert.match(quote, /Mr\. Get To It/);
    for (const quote of quotes) {
        assert.doesNotMatch(quote, /Mr\.? Get Too It/i);
        assert.doesNotMatch(quote, /\bget TOO it\b/i);
    }
});

check('responses are single-line and safely under Twitch chat length', () => {
    for (const quote of quotes) {
        assert.equal(quote.trim(), quote);
        assert.doesNotMatch(quote, /[\r\n]/);
        assert.ok([...quote].length <= 350, `response too long: ${quote}`);
    }
});

check('the public command registry maps !grouch to this rotation', () => {
    const registryStart = source.indexOf('const USER_VARIANT_POOLS = {');
    const registryEnd = source.indexOf('\n};', registryStart);
    const registry = source.slice(registryStart, registryEnd);
    assert.match(registry, /'!grouch':\s+GROUCH_QUOTES,/);
});

check('the command remains available to every channel tier', () => {
    const dispatchStart = source.indexOf('if (USER_VARIANT_POOLS[msg])');
    const dispatchEnd = source.indexOf('// 0.85. Basic User Commands', dispatchStart);
    assert.ok(dispatchStart > -1 && dispatchEnd > dispatchStart);
    const dispatch = source.slice(dispatchStart, dispatchEnd);
    assert.match(dispatch, /pickNoRepeat\(`user:\$\{msg\}:\$\{cleanChannel\}`, pool, 2\)/);
    assert.match(dispatch, /sendMessage\(channel, line\)/);
});

check('Grouch arrival recognition reuses the refreshed rotation', () => {
    const rosterStart = source.indexOf('const CUHZNS = {');
    const rosterEnd = source.indexOf('\n};', rosterStart);
    const roster = source.slice(rosterStart, rosterEnd);
    assert.match(roster, /'557152408':\s+\{ login: 'grouch392',\s+pool: GROUCH_QUOTES,/);
});

console.log(`\n${passed} Grouch-command checks passed.`);
