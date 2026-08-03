/**
 * Duration math tests — ground-truth vectors from production Helix
 * followed_at timestamps captured in the 07/28-07/29 log window, where the
 * old fixed 365/30 decomposition returned wrong day components.
 * Run with: node tests/test_duration.js
 */
const { calendarDiff, formatDuration, formatMinutes } = require('../src/duration');

let failures = 0;
function check(name, actual, expected) {
    if (actual === expected) {
        console.log(`✅ ${name}: "${actual}"`);
    } else {
        console.error(`❌ ${name}: got "${actual}", expected "${expected}"`);
        failures++;
    }
}

// ── Production ground-truth vectors (frozen "now" = actual query times) ──

// V1: phoenixpnyc — old code happened to be right (<1 month follow)
check('V1 phoenixpnyc',
    formatDuration(calendarDiff(new Date('2026-07-06T05:05:51Z'), new Date('2026-07-28T20:33:43Z'))),
    '22d');

// V2: edward1chuckk — old code said "1y 10m 10d" (+8 days wrong)
check('V2 edward1chuckk',
    formatDuration(calendarDiff(new Date('2024-09-25T20:44:00Z'), new Date('2026-07-28T20:34:33Z'))),
    '1y 10m 2d');

// V3: imkxddy — old code said "2y 4m 4d" (−18 days wrong)
check('V3 imkxddy',
    formatDuration(calendarDiff(new Date('2024-03-06T14:20:26Z'), new Date('2026-07-28T20:58:25Z'))),
    '2y 4m 22d');

// ── Edge cases ──

// Followed today, under 24h -> hours
check('followed <24h ago',
    formatDuration(calendarDiff(new Date('2026-07-28T10:00:00Z'), new Date('2026-07-28T15:30:00Z'))),
    '5h');

// Followed minutes ago -> minutes, never empty string
check('followed minutes ago',
    formatDuration(calendarDiff(new Date('2026-07-28T15:28:00Z'), new Date('2026-07-28T15:30:00Z'))),
    '2m');

// Month-end anchor: Jan 31 -> Mar 1 is 1 month (Jan31+1m clamps to Feb28) + 1d
check('month-end clamp Jan31->Mar1',
    formatDuration(calendarDiff(new Date('2026-01-31T00:00:00Z'), new Date('2026-03-01T00:00:00Z'))),
    '1m 1d');

// Leap year Feb 29 anchor
check('leap Feb29 -> Mar29 = 1 month',
    formatDuration(calendarDiff(new Date('2024-02-29T12:00:00Z'), new Date('2024-03-29T12:00:00Z'))),
    '1m');

// Exactly one year
check('exactly 1 year',
    formatDuration(calendarDiff(new Date('2025-07-28T00:00:00Z'), new Date('2026-07-28T00:00:00Z'))),
    '1y');

// Watchtime formatting
check('formatMinutes 135', formatMinutes(135), '2h 15m');
check('formatMinutes 45', formatMinutes(45), '45m');

if (failures > 0) {
    console.error(`\n${failures} duration test(s) FAILED`);
    process.exit(1);
}
console.log('\n✅ All duration tests passed');
