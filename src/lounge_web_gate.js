'use strict';
// ============================================================================
// LOUNGE WEB GATE — website sign-in becomes stream control (2026-10-10).
//
// Owner directive: Phoenix signs in with Twitch ON planetcuhz.com, and only
// then may she steer the lounge from the web. This module turns a website
// session token into a VERIFIED Twitch id, or nothing.
//
// Identity law (research 2026-10-10, applies to every decision below):
//   - The ONLY trustworthy Twitch id is in `identities[]` from Supabase's
//     GET /auth/v1/user, called ONLINE with the user's access token. Supabase
//     writes identities from the OAuth exchange; users cannot edit them.
//   - `user_metadata.*` and `protocol_profiles.twitch_id` are USER-WRITABLE.
//     They must never gate anything. (The site's bot-request flow trusts the
//     profile row today — flagged to the owner as a separate fix.)
//   - This project publishes NO JWKS keys (checked 2026-10-10: {"keys":[]}),
//     so tokens are HS256 under the project secret. Offline verification
//     would require that secret on Railway — rejected. Online check only,
//     which also catches sign-out (session_not_found) within one call.
//
// Authority law:
//   - Web writes are allowed for EXACTLY the two shared controllers:
//     planetcuhz 1293717308 and phoenixpnyc 823707557 (owner-locked
//     2026-10-06). This set is hardcoded and SEPARATE from
//     LOUNGE_OPERATOR_IDS on purpose — that list is env-extensible
//     (LOUNGE_OPERATOR_EXTRA_IDS), and an env var must never be able to
//     widen WEBSITE control of the stream.
//   - The gate only identifies. Every mutation still flows through
//     loungeControl.applyIntent, so rate limits, bounds, lock, mute and the
//     audit log apply to web exactly as they do to chat.
//
// SUPABASE_URL / SUPABASE_ANON_KEY: both are PUBLIC values (the anon key
// ships verbatim in the website's client bundle). Hardcoded defaults keep
// the gate inert-proof without new Railway configuration; env still wins.
// ============================================================================

const WEB_CONTROLLER_IDS = Object.freeze(new Set(['1293717308', '823707557']));

const DEFAULT_SUPABASE_URL = 'https://wjebryxdefcgsxsqomac.supabase.co';
// The site's PUBLISHABLE anon key — shipped verbatim to every browser in the
// website bundle (src/integrations/supabase/client.ts), so hardcoding it here
// discloses nothing and keeps the gate working with zero new Railway config.
const DEFAULT_SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqZWJyeXhkZWZjZ3N4c3FvbWFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAwMTAyMTIsImV4cCI6MjA2NTU4NjIxMn0.o4e8h0oIHqMtVBBhEU3KQMRRvwCc2PpbjSbvqvGm1_o';

const TOKEN_CACHE_TTL_MS = 45 * 1000;   // re-verify at most every 45s per token
const TOKEN_CACHE_MAX = 64;             // two operators; anything more is noise

/**
 * createWebGate({ supabaseUrl, anonKey, httpGet, now }) -> { verify, stats }
 *
 * httpGet(url, headers) must resolve to { status, data } and NEVER throw for
 * HTTP error statuses (axios with validateStatus: null). Injected for tests.
 */
function createWebGate({ supabaseUrl, anonKey, httpGet, now = Date.now } = {}) {
    if (typeof httpGet !== 'function') throw new TypeError('httpGet must be a function');
    const base = String(supabaseUrl || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
    const key = String(anonKey || DEFAULT_SUPABASE_ANON_KEY).trim();
    const cache = new Map(); // sha256(token) -> { until, result }

    function cacheKey(token) {
        return require('node:crypto').createHash('sha256').update(token).digest('hex');
    }

    function prune(t) {
        if (cache.size <= TOKEN_CACHE_MAX) return;
        for (const [k, v] of cache) { if (v.until <= t || cache.size > TOKEN_CACHE_MAX) cache.delete(k); }
    }

    /**
     * verify(authorizationHeader) ->
     *   { ok:true,  twitchId, login }                        — verified controller
     *   { ok:false, reason:'no_token'|'not_signed_in'|'no_twitch_identity'|
     *               'not_a_controller'|'gate_unconfigured'|'auth_unreachable' }
     * Fail closed on everything unexpected.
     */
    async function verify(authorizationHeader) {
        if (!key) return { ok: false, reason: 'gate_unconfigured' };
        const m = /^Bearer\s+([A-Za-z0-9_\-\.]+)$/.exec(String(authorizationHeader || ''));
        if (!m) return { ok: false, reason: 'no_token' };
        const token = m[1];

        const t = now();
        const ck = cacheKey(token);
        const hit = cache.get(ck);
        if (hit && hit.until > t) return hit.result;

        let res;
        try {
            res = await httpGet(`${base}/auth/v1/user`, {
                apikey: key,
                Authorization: `Bearer ${token}`,
            });
        } catch (err) {
            // Network failure: NOT cacheable, and never an approval.
            return { ok: false, reason: 'auth_unreachable' };
        }

        let result;
        if (!res || res.status !== 200 || !res.data || typeof res.data !== 'object') {
            result = { ok: false, reason: 'not_signed_in' };
        } else {
            const identities = Array.isArray(res.data.identities) ? res.data.identities : [];
            const tw = identities.find(i => i && i.provider === 'twitch');
            // Require the two provider-id fields to agree — both come from the
            // OAuth exchange, and a mismatch means something is off. Fail closed.
            const idA = tw && tw.identity_data ? String(tw.identity_data.sub || '') : '';
            const idB = tw ? String(tw.id || '') : '';
            if (!tw || !idA || idA !== idB) {
                result = { ok: false, reason: 'no_twitch_identity' };
            } else if (!WEB_CONTROLLER_IDS.has(idA)) {
                result = { ok: false, reason: 'not_a_controller' };
            } else {
                const login = tw.identity_data && typeof tw.identity_data.preferred_username === 'string'
                    ? tw.identity_data.preferred_username.toLowerCase()
                    : (idA === '823707557' ? 'phoenixpnyc' : 'planetcuhz');
                result = { ok: true, twitchId: idA, login };
            }
        }

        cache.set(ck, { until: t + TOKEN_CACHE_TTL_MS, result });
        prune(t);
        return result;
    }

    return {
        verify,
        stats: () => ({ cached: cache.size, controllers: WEB_CONTROLLER_IDS.size }),
    };
}

module.exports = { createWebGate, WEB_CONTROLLER_IDS, DEFAULT_SUPABASE_URL };
