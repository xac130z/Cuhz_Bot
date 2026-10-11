'use strict';
// The lounge overlay is served by the bot itself (public/lounge) as of
// 2026-10-10. Before that it lived on a laptop-local server that had to be
// running for the lounge to exist on stream — it wasn't, and the OBS source
// sat dead. These checks pin everything that made that failure possible:
// the files ship with the bot, the page defaults its API to the SAME origin,
// the dashboard CORS allowlist cannot shadow the lounge surfaces, and the
// manifest's integrity hashes match the real artwork bytes.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

let passed = 0;
const check = (n, f) => { f(); passed++; console.log(`PASS ${n}`); };

const ROOT = path.join(__dirname, '..');
const LOUNGE = path.join(ROOT, 'public', 'lounge');
const botSrc = fs.readFileSync(path.join(ROOT, 'src', 'bot.js'), 'utf8');

check('the lounge page ships inside the bot (no laptop server required)', () => {
    for (const f of ['index.html', 'lab.js', 'lab.css', 'control.js', 'art-manifest.js', 'art-manifest.json']) {
        assert.ok(fs.existsSync(path.join(LOUNGE, f)), `${f} must exist in public/lounge`);
    }
});

check('bot.js serves public/lounge at /lounge via express.static', () => {
    assert.match(botSrc, /app\.use\('\/lounge', express\.static\(path\.join\(__dirname, '\.\.', 'public', 'lounge'\)/);
});

check('the dashboard CORS allowlist skips /lounge and /api/lounge (the 2026-10-09 "Failed to fetch" cause)', () => {
    assert.match(botSrc, /req\.path\.startsWith\('\/api\/lounge'\) \|\| req\.path\.startsWith\('\/lounge'\)/);
    // and the skip must appear BEFORE the lounge state route uses its own CORS
    const skipAt = botSrc.indexOf("req.path.startsWith('/api/lounge')");
    const routeAt = botSrc.indexOf("app.get('/api/lounge/state'");
    assert.ok(skipAt > -1 && routeAt > skipAt, 'skip middleware must be registered before the state route');
});

check('the served page defaults its API to the SAME origin (?api= still overrides)', () => {
    const html = fs.readFileSync(path.join(LOUNGE, 'index.html'), 'utf8');
    assert.match(html, /window\.CUHZ_DEFAULT_API = location\.origin/);
    assert.match(html, /noindex/);
    const control = fs.readFileSync(path.join(LOUNGE, 'control.js'), 'utf8');
    assert.match(control, /parseApiBase\(params\.get\('api'\)\) \|\| parseApiBase\(window\.CUHZ_DEFAULT_API\)/,
        'explicit ?api= must win over the same-origin default');
});

check('every manifest artwork file exists and its sha256 matches the shipped bytes', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(LOUNGE, 'art-manifest.json'), 'utf8'));
    assert.equal(manifest.artworks.length, manifest.artworkCount);
    for (const art of manifest.artworks) {
        for (const key of ['alpha', 'white']) {
            const p = path.join(LOUNGE, art[key]);
            assert.ok(fs.existsSync(p), `${art[key]} must ship`);
        }
        const digest = crypto.createHash('sha256')
            .update(fs.readFileSync(path.join(LOUNGE, art.alpha))).digest('hex');
        assert.equal(digest, art.sha256, `${art.alpha} bytes must match the manifest hash`);
    }
});

check('/lounge and /lounge/ both serve the page directly, and the page pins its base path (proxy-safe)', () => {
    assert.match(botSrc, /app\.get\(\['\/lounge', '\/lounge\/'\]/, 'explicit handler for both slash forms');
    assert.match(botSrc, /redirect: false/, 'express.static must not 301 the slash-less form (the site proxy loops on it)');
    const html = fs.readFileSync(path.join(LOUNGE, 'index.html'), 'utf8');
    assert.match(html, /<base href="\/lounge\/">/);
});

check('PNG caching is bounded and HTML revalidates (deploys land on the next OBS refresh)', () => {
    assert.match(botSrc, /max-age=86400/);
    assert.match(botSrc, /'no-cache'/);
});

check('Phoenix is a BASE operator by her locked id — and the wrong id is nowhere', () => {
    assert.match(botSrc, /LOUNGE_OPERATOR_BASE_IDS = Object\.freeze\(\['1293717308', '823707557'\]\)/);
    // The wrong id may appear in explanatory comments, never in code.
    const codeOnly = botSrc.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    assert.ok(!codeOnly.includes('757210754'), 'the wrong Phoenix id must never appear outside comments');
});

console.log(`\n${passed} lounge-hosting checks passed.`);
