/**
 * test_onboarding.js — guards the !bot / !getcuhzbot acquisition CTA.
 *
 * This command is how new streamers learn to add CUHZ Bot, so three things
 * must stay true: it exists and is reachable by everyone (not tier-gated),
 * it tells them the ONE step that actually matters (`/mod cuhz_bot` — Twitch
 * checks mod status server-side on every moderation call), and it never asks
 * a streamer for a token/OAuth grant (onboarding needs no credentials).
 */

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../src/bot.js'), 'utf8');

let failures = 0;
const check = (name, cond) => {
    if (cond) console.log(`  ✅ ${name}`);
    else { console.error(`  ❌ ${name}`); failures++; }
};

console.log('test_onboarding:');

// Dispatch exists and covers the aliases.
const block = src.match(/if \(msg === '!bot'[\s\S]{0,900}?\n    \}/);
check('!bot / !getcuhzbot / !addbot dispatch exists', !!block);
const body = block ? block[0] : '';

check('tells the streamer to /mod cuhz_bot', /\/mod cuhz_bot/.test(body));
check('gives a real next step (discord or site)', /discord\.com\/invite|planetcuhz\.com/.test(body));

// Must never send someone to a token/OAuth flow — onboarding needs no credentials.
check('does NOT link a token/OAuth generator',
    !/twitchtokengenerator|oauth2\/authorize|\/request\/|access[_ ]?token/i.test(body));

// The old joke response must not shadow the new handler.
check("stale '!bot' joke removed from USER_COMMANDS",
    !/'!bot':\s*'Just a bot doing bot things/.test(src));

// Visible to everyone: !bot sits on the ungated part of the brand line.
const brand = src.match(/brand:\s*'🌌 Brand: [^']*'/);
check('!bot listed in help for ALL tiers (not behind isPP)',
    !!brand && /!bot/.test(brand[0]));

// It's no longer a crew joke, so it shouldn't be advertised there too.
const crew = src.match(/crew:\s*isPP \? '[^']*'/);
check('!bot removed from the Crew list', !!crew && !/!bot\b/.test(crew[0]));

// Twitch hard-limits a chat message to 500 chars.
const lines = body.match(/sendMessage\(channel, '([^']*)'\)/g) || [];
check('sends at least one line', lines.length > 0);
lines.forEach((l, i) => {
    const text = l.replace(/^sendMessage\(channel, '/, '').replace(/'\)$/, '');
    check(`line ${i + 1} under Twitch's 500-char limit (${text.length})`, text.length <= 500);
});

if (failures) { console.error(`\n❌ test_onboarding: ${failures} check(s) failed`); process.exit(1); }
console.log('✅ test_onboarding: all checks passed');
