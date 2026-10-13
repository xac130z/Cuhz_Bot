'use strict';

// Lazy factory: no imports, probes, timers, or I/O at module load/creation.
// A deadline bounds callers, not an unabortable adapter query. Keep that one
// physical probe in flight until it settles, even after the public deadline,
// so a hung database cannot accumulate replacement queries from polling.
const DEFAULT_DEADLINE_MS = 2000;
const DEFAULT_CACHE_MS = 5000;

function createReadinessService({
    getClient, probeDatabase, now = Date.now,
    setTimer = setTimeout, clearTimer = clearTimeout,
    deadlineMs = DEFAULT_DEADLINE_MS, cacheMs = DEFAULT_CACHE_MS
} = {}) {
    if (typeof getClient !== 'function' || typeof probeDatabase !== 'function') {
        throw new TypeError('Readiness needs lazy client and database probes');
    }
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 5000 ||
        !Number.isSafeInteger(cacheMs) || cacheMs < 1 || cacheMs > 30000) {
        throw new TypeError('Readiness deadline/cache must be bounded');
    }
    let cached = null;
    let active = null;

    function ircOpen() {
        try {
            const client = getClient();
            return !!client && typeof client.readyState === 'function' && client.readyState() === 'OPEN';
        } catch { return false; }
    }

    function startProbe() {
        const startedAt = now();
        let resolvePublic;
        const flight = { expired: false, settled: false, timer: null,
            result: new Promise(resolve => { resolvePublic = resolve; }) };
        active = flight;

        function publish(databaseReady) {
            if (flight.settled) return;
            flight.settled = true;
            try { if (flight.timer !== null) clearTimer(flight.timer); } catch { /* fail closed below */ }
            cached = { databaseReady, until: now() + cacheMs };
            resolvePublic(databaseReady && ircOpen());
        }

        try {
            flight.timer = setTimer(() => {
                flight.expired = true;
                publish(false);
            }, deadlineMs);
        } catch {
            active = null;
            publish(false);
            return flight.result;
        }

        Promise.resolve().then(probeDatabase).then(value => {
            // A delayed timer must not let an over-deadline result claim ready.
            if (now() - startedAt >= deadlineMs) flight.expired = true;
            if (!flight.expired) publish(value === true);
            else publish(false);
        }, () => publish(false)).finally(() => {
            // Late success never refreshes a timed-out probe as healthy. Once
            // it settles, a later request may make one fresh probe after cache expiry.
            if (active === flight) active = null;
        });
        return flight.result;
    }

    async function check() {
        // Always check current IRC state, even during a healthy DB cache window.
        if (!ircOpen()) return false;
        if (cached && now() < cached.until) return cached.databaseReady;
        const ready = active ? (active.expired ? false : await active.result) : await startProbe();
        // Each waiter verifies its current client after the shared result too.
        return ready && ircOpen();
    }

    return Object.freeze({ check });
}

module.exports = { createReadinessService, DEFAULT_DEADLINE_MS, DEFAULT_CACHE_MS };
