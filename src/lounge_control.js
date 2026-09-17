'use strict';

// THE CUHZ LAB — chat-controlled lounge state.
//
// PURE MODULE: zero requires, zero I/O, zero timers, injected clock. That is
// deliberate and load-bearing — it makes the "this never touches points" claim
// provable by grep rather than by promise, and it lets the whole thing be tested
// without booting the bot. Do not add a require() here. Ever.
//
// Ownership: chat is the ONLY writer, through applyIntent(). The HTTP layer gets
// readState() and nothing else, so there is no write path over HTTP.
//
// Access ladder (owner decision 2026-09-16):
//   operator    Phoenix / four_a_reason / William — full range, lock, house, mute
//   subscriber  vibe color zoom card glow reset — one turn per 10s
//   moderator   lock / unlock / reset only (a brake, not a paintbrush)
//   everyone    read-only status
//
// Identity is ALWAYS the immutable numeric Twitch user id, never a login.
// Precedent: qweenstormygirlnz89 -> stormygirlnz89. Twitch releases abandoned
// logins after ~6 months, so a login gate fails OPEN to an impostor.

const VERSION = 1;

// Frozen, null-prototype lookup tables. Null-prototype so a crafted argument
// like "__proto__" or "constructor" cannot resolve to an inherited member.
function table(pairs) {
    const t = Object.create(null);
    for (const [k, v] of pairs) t[k] = v;
    return Object.freeze(t);
}
const has = (t, k) => Object.prototype.hasOwnProperty.call(t, k);

// Palette slugs mirror lab.js `palettes` exactly, in index order.
const PALETTES = table([
    ['pure-white', 0], ['off-white', 1], ['transparent', 2], ['light-gray', 3],
    ['charcoal', 4], ['black', 5], ['sky-blue', 6], ['lavender', 7],
    ['mint', 8], ['peach', 9],
]);
// Transparent is operator-only: on a window capture it renders white, and only
// the operator can see what sits behind an alpha browser source.
const SUB_PALETTES = Object.freeze(Object.keys(PALETTES).filter(p => p !== 'transparent'));

// turbo is operator-only. Measured from the shipped presets, turbo at depth 7
// lands near the 3-5Hz band associated with photosensitive seizures. Subscribers
// get chill and hype; the page clamps the physics regardless of what we send.
const VIBES = Object.freeze(['chill', 'hype']);
const OPERATOR_VIBES = Object.freeze(['chill', 'hype', 'turbo']);
const ZOOMS = table([['in', 1], ['out', -1], ['reset', 0]]);
const SWITCHES = table([['on', true], ['off', false]]);

const ZOOM_MIN = 0.85, ZOOM_MAX = 1.20, ZOOM_STEP = 0.05, ZOOM_HOME = 1.0;

const LIMITS = Object.freeze({
    userCooldownMs: 10000,      // one turn per viewer
    channelFloorMs: 3000,       // screen never changes faster than this
    glowFloorMs: 10000,         // glow is the cheapest thing to strobe with
    burstWindowMs: 60000,
    burstMax: 20,               // then the channel cools off
    coolingMs: 60000,
    idleRevertMs: 90000,        // back to the house look
    coSignWindowMs: 5000,       // asking for what is already live is free
    turboMaxMs: 60000,          // turbo decays to hype
    replyCooldownMs: 60000,     // at most one rejection line per user
    auditMax: 20,
});

const HOUSE = Object.freeze({
    vibe: 'chill', palette: 'black', card: 1,
    zoom: ZOOM_HOME, glow: false,
});

function clampZoom(v) {
    const stepped = Math.round(v / ZOOM_STEP) * ZOOM_STEP;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(stepped.toFixed(2))));
}

// ---- argument validation -------------------------------------------------
// Five gates, all fail-closed, applied in this order. Rejection is total: an
// intent is applied whole or not at all, never partially.
const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;
const WORD = /^[a-z]{1,16}$/;
const NUMBER = /^[0-9]{1,3}$/;
const DENY = Object.freeze(['__proto__', 'constructor', 'prototype', 'tostring', 'valueof']);

function cleanToken(raw) {
    if (typeof raw !== 'string') return null;
    // Byte gate BEFORE any case folding: homoglyphs, RTL marks and zero-width
    // joiners die here, with no normalize-to-collision window to exploit.
    if (!ASCII_PRINTABLE.test(raw)) return null;
    const t = raw.trim().toLowerCase();
    if (!t || DENY.includes(t)) return null;
    return t;
}

/**
 * parseCommand(message) -> {intent, value} | {error} | null
 * null means "not a lounge command" — the caller falls through untouched.
 */
function parseCommand(message) {
    if (typeof message !== 'string' || message.length > 200) return null;
    if (!ASCII_PRINTABLE.test(message)) return null;
    const parts = message.trim().split(/\s+/).slice(0, 3);
    const head = cleanToken(parts[0]);
    if (!head) return null;

    let intent = null, rawValue = parts[1];
    if (head === '!lounge') {
        const sub = cleanToken(parts[1]);
        if (!sub) return { intent: 'status' };
        if (sub === 'colors') return { intent: 'colors' };
        if (sub === 'reset') return { intent: 'reset' };
        if (sub === 'lock') return { intent: 'lock' };
        if (sub === 'unlock') return { intent: 'unlock' };
        intent = sub; rawValue = parts[2];
    } else if (has(ALIASES, head)) {
        intent = ALIASES[head];
        // Bare "!vibe" is an existing command in bot.js and must not be taken
        // over; only the argument form belongs to the lounge.
        if (rawValue === undefined) return null;
    } else {
        return null;
    }

    const value = cleanToken(rawValue);
    if (!has(INTENTS, intent)) return { error: 'unknown_intent' };
    if (value === null) return { error: 'missing_value', intent };
    return INTENTS[intent](value, intent);
}

const ALIASES = table([
    ['!vibe', 'vibe'], ['!color', 'color'], ['!zoom', 'zoom'],
    ['!card', 'card'], ['!glow', 'glow'],
]);

const INTENTS = table([
    ['vibe', v => (WORD.test(v) && OPERATOR_VIBES.includes(v))
        ? { intent: 'vibe', value: v } : { error: 'bad_vibe', intent: 'vibe' }],
    ['color', v => (WORD.test(v.replace(/-/g, 'a')) && has(PALETTES, v))
        ? { intent: 'color', value: v } : { error: 'bad_color', intent: 'color' }],
    ['zoom', v => (WORD.test(v) && has(ZOOMS, v))
        ? { intent: 'zoom', value: v } : { error: 'bad_zoom', intent: 'zoom' }],
    ['glow', v => (WORD.test(v) && has(SWITCHES, v))
        ? { intent: 'glow', value: v } : { error: 'bad_glow', intent: 'glow' }],
    ['card', v => {
        if (!NUMBER.test(v)) return { error: 'bad_card', intent: 'card' };
        const n = Number(v);
        return Number.isInteger(n) && n >= 1
            ? { intent: 'card', value: n } : { error: 'bad_card', intent: 'card' };
    }],
]);

/**
 * createLoungeControl({ now, operatorIds, cardCount, limits })
 *
 * State lives in memory, keyed by numeric room id. Losing it on restart is the
 * safe default for VISUALS — but a lock must survive, so restart re-locks.
 */
function createLoungeControl({ now = Date.now, operatorIds = [], cardCount = 5, limits = {} } = {}) {
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    const L = Object.freeze({ ...LIMITS, ...limits });
    const operators = new Set(
        (Array.isArray(operatorIds) ? operatorIds : [])
            .map(id => String(id).trim())
            .filter(id => /^\d{1,12}$/.test(id))   // numeric ids only, fail closed
    );
    const cards = Number.isInteger(cardCount) && cardCount >= 1 ? cardCount : 1;
    const rooms = new Map();
    const bootId = String(now());

    function room(roomId) {
        let r = rooms.get(roomId);
        if (!r) {
            r = {
                seq: 0, state: { ...HOUSE }, setBy: null, setAtMs: 0,
                // Restart implies locked: losing a lock would re-open control
                // during the exact incident it was closed for.
                locked: true, lockedBy: null,
                lastApplyMs: 0, lastGlowMs: 0, lastTurboMs: 0,
                burst: [], coolingUntilMs: 0, badge: true,
                users: new Map(), muted: new Set(), audit: [],
            };
            rooms.set(roomId, r);
        }
        return r;
    }

    const roleOf = actor => {
        const id = String(actor && actor.userId || '').trim();
        if (!/^\d{1,12}$/.test(id)) return 'unknown';
        if (operators.has(id)) return 'operator';
        if (actor.broadcaster) return 'operator';
        if (actor.moderator) return 'moderator';
        if (actor.subscriber) return 'subscriber';
        return 'viewer';
    };

    function record(r, entry) {
        r.audit.push(entry);
        if (r.audit.length > L.auditMax) r.audit.shift();
        return entry;
    }

    function apply(r, roomId, actor, role, parsed, t) {
        const s = r.state;
        let changed = true;
        switch (parsed.intent) {
            case 'vibe':
                if (s.vibe === parsed.value) changed = false;
                s.vibe = parsed.value;
                if (parsed.value === 'turbo') r.lastTurboMs = t;
                break;
            case 'color':
                if (s.palette === parsed.value) changed = false;
                s.palette = parsed.value; break;
            case 'glow': {
                const next = SWITCHES[parsed.value];
                if (s.glow === next) changed = false;
                s.glow = next; r.lastGlowMs = t; break;
            }
            case 'card': {
                const n = Math.min(cards, parsed.value);
                if (s.card === n) changed = false;
                s.card = n; break;
            }
            case 'zoom': {
                const dir = ZOOMS[parsed.value];
                const next = dir === 0 ? ZOOM_HOME : clampZoom(s.zoom + dir * ZOOM_STEP);
                if (s.zoom === next) changed = false;
                s.zoom = next; break;
            }
            case 'reset':
                Object.assign(s, HOUSE); break;
            default:
                return { status: 'rejected', reason: 'unknown_intent' };
        }
        r.seq += 1;
        r.setBy = actor.login || null;
        r.setAtMs = t;
        r.lastApplyMs = t;
        r.burst.push(t);
        const u = r.users.get(actor.userId) || {};
        u.lastApplyMs = t;
        r.users.set(actor.userId, u);
        record(r, { t, actor: actor.userId, login: actor.login || null, role,
            intent: parsed.intent, value: parsed.value, decision: 'applied', seq: r.seq });
        return { status: 'applied', changed, intent: parsed.intent, value: parsed.value,
            seq: r.seq, state: readState(roomId) };
    }

    /** The one write path. Chat only. */
    function applyIntent(roomId, actor, message) {
        const t = now();
        const key = String(roomId || '').trim();
        if (!/^\d{1,12}$/.test(key)) return { status: 'ignored', reason: 'no_room' };
        const parsed = parseCommand(message);
        if (!parsed) return null;                       // not ours; fall through
        const r = room(key);
        const role = roleOf(actor);
        if (role === 'unknown') return { status: 'ignored', reason: 'no_identity' };

        // read-only intents, open to everyone
        if (parsed.intent === 'status') return { status: 'status', state: readState(key), role };
        if (parsed.intent === 'colors') {
            return { status: 'colors', role,
                palettes: role === 'operator' ? Object.keys(PALETTES) : SUB_PALETTES.slice() };
        }

        const isOperator = role === 'operator';
        const isMod = isOperator || role === 'moderator';

        if (parsed.intent === 'lock' || parsed.intent === 'unlock') {
            if (!isMod) return { status: 'silent', reason: 'not_moderator' };
            r.locked = parsed.intent === 'lock';
            r.lockedBy = actor.login || null;
            r.seq += 1;
            record(r, { t, actor: actor.userId, login: actor.login || null, role,
                intent: parsed.intent, value: null, decision: 'applied', seq: r.seq });
            return { status: 'applied', intent: parsed.intent, seq: r.seq, state: readState(key) };
        }

        if (parsed.error) {
            record(r, { t, actor: actor.userId, login: actor.login || null, role,
                intent: parsed.intent || null, value: null, decision: 'rejected', reason: parsed.error });
            return { status: 'rejected', reason: parsed.error, intent: parsed.intent || null,
                quiet: !throttleReply(r, actor.userId, t) };
        }

        // Subscription gate. Read live from tags every time — a lapsed sub loses
        // control on their next message with no cleanup job.
        if (!isOperator && role !== 'subscriber') {
            return { status: 'rejected', reason: 'subscribers_only',
                quiet: !throttleReply(r, actor.userId, t) };
        }
        if (r.muted.has(String(actor.userId))) {
            return { status: 'rejected', reason: 'muted', quiet: !throttleReply(r, actor.userId, t) };
        }
        if (r.locked && !isMod) {
            return { status: 'rejected', reason: 'locked', quiet: !throttleReply(r, actor.userId, t) };
        }
        // Operator-only values
        if (!isOperator) {
            if (parsed.intent === 'vibe' && !VIBES.includes(parsed.value)) {
                return { status: 'rejected', reason: 'vibe_operator_only', intent: 'vibe',
                    quiet: !throttleReply(r, actor.userId, t) };
            }
            if (parsed.intent === 'color' && !SUB_PALETTES.includes(parsed.value)) {
                return { status: 'rejected', reason: 'color_operator_only', intent: 'color',
                    quiet: !throttleReply(r, actor.userId, t) };
            }
        }

        // Co-sign: asking for what is already live costs nothing and says nothing.
        // This is the commonest spam shape — everyone typing the same thing at
        // once — converted into a crowd signal instead of a wall of rejections.
        if (isLive(r.state, parsed) && t - r.setAtMs <= L.coSignWindowMs) {
            record(r, { t, actor: actor.userId, login: actor.login || null, role,
                intent: parsed.intent, value: parsed.value, decision: 'cosigned' });
            return { status: 'cosigned', intent: parsed.intent, value: parsed.value };
        }

        if (!isOperator) {
            const gate = limiter(r, actor.userId, parsed, t, L);
            if (gate) {
                record(r, { t, actor: actor.userId, login: actor.login || null, role,
                    intent: parsed.intent, value: parsed.value, decision: 'rejected', reason: gate.reason });
                return { ...gate, quiet: !throttleReply(r, actor.userId, t) };
            }
        }
        return apply(r, key, actor, role, parsed, t);
    }

    function isLive(s, parsed) {
        if (parsed.intent === 'vibe') return s.vibe === parsed.value;
        if (parsed.intent === 'color') return s.palette === parsed.value;
        if (parsed.intent === 'glow') return s.glow === SWITCHES[parsed.value];
        if (parsed.intent === 'card') return s.card === Math.min(cards, parsed.value);
        return false;
    }

    function limiter(r, userId, parsed, t, L) {
        if (t < r.coolingUntilMs) return { status: 'rejected', reason: 'cooling' };
        r.burst = r.burst.filter(ms => t - ms < L.burstWindowMs);
        if (r.burst.length >= L.burstMax) {
            r.coolingUntilMs = t + L.coolingMs;
            return { status: 'rejected', reason: 'cooling' };
        }
        const u = r.users.get(String(userId)) || r.users.get(userId) || {};
        if (u.lastApplyMs && t - u.lastApplyMs < L.userCooldownMs) {
            return { status: 'rejected', reason: 'your_turn_soon',
                retryInMs: L.userCooldownMs - (t - u.lastApplyMs) };
        }
        if (t - r.lastApplyMs < L.channelFloorMs) {
            return { status: 'rejected', reason: 'channel_floor' };
        }
        if (parsed.intent === 'glow' && t - r.lastGlowMs < L.glowFloorMs) {
            return { status: 'rejected', reason: 'glow_floor' };
        }
        return null;
    }

    function throttleReply(r, userId, t) {
        const id = String(userId);
        const u = r.users.get(id) || {};
        if (u.lastReplyMs && t - u.lastReplyMs < L.replyCooldownMs) return false;
        u.lastReplyMs = t;
        r.users.set(id, u);
        return true;
    }

    /** Operator-only: take the remote from one person, nothing else. */
    function mute(roomId, actor, targetUserId, on = true) {
        if (roleOf(actor) !== 'operator') return { status: 'silent', reason: 'not_operator' };
        const r = room(String(roomId));
        const id = String(targetUserId).trim();
        if (!/^\d{1,12}$/.test(id)) return { status: 'rejected', reason: 'bad_target' };
        if (on) r.muted.add(id); else r.muted.delete(id);
        return { status: 'applied', muted: on, target: id };
    }

    /** Operator-only: this look becomes where the lounge comes home to. */
    function setHouse(roomId, actor) {
        if (roleOf(actor) !== 'operator') return { status: 'silent', reason: 'not_operator' };
        const r = room(String(roomId));
        r.house = { ...r.state };
        return { status: 'applied', house: { ...r.house } };
    }

    /** Called on a timer by the caller — the module owns no timers itself. */
    function tick(roomId) {
        const t = now();
        const r = room(String(roomId));
        let reverted = false;
        if (r.state.vibe === 'turbo' && r.lastTurboMs && t - r.lastTurboMs >= L.turboMaxMs) {
            r.state.vibe = 'hype'; r.seq += 1; reverted = 'turbo_decay';
        }
        if (r.lastApplyMs && t - r.lastApplyMs >= L.idleRevertMs) {
            const home = r.house || HOUSE;
            if (JSON.stringify(r.state) !== JSON.stringify(home)) {
                Object.assign(r.state, home);
                r.setBy = null; r.seq += 1; reverted = 'idle';
            }
            r.lastApplyMs = t;
        }
        return reverted ? { status: 'reverted', reason: reverted, seq: r.seq } : null;
    }

    /** The only thing the HTTP layer may call. No writes reachable from here. */
    function readState(roomId) {
        const r = room(String(roomId));
        return Object.freeze({
            version: VERSION, bootId, seq: r.seq, updatedAtMs: r.setAtMs,
            vibe: r.state.vibe, palette: r.state.palette, card: r.state.card,
            zoom: r.state.zoom, glow: r.state.glow,
            locked: r.locked, cardCount: cards,
            setByLogin: r.badge ? r.setBy : null,
            pollMs: 2000,
        });
    }

    const auditOf = roomId => room(String(roomId)).audit.slice(-L.auditMax);
    const setBadge = (roomId, on) => { room(String(roomId)).badge = !!on; };

    return Object.freeze({
        applyIntent, readState, tick, mute, setHouse, auditOf, setBadge,
        roleOf, parseCommand,
        stats: () => ({ rooms: rooms.size, operators: operators.size, cardCount: cards }),
    });
}

module.exports = {
    createLoungeControl, parseCommand,
    PALETTES, SUB_PALETTES, VIBES, OPERATOR_VIBES, HOUSE, LIMITS, VERSION,
};
