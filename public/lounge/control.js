/* ─── THE CUHZ LAB · control mode (Lane K3) ─────────────────────────────
   A READ-ONLY POLLER. The bot is the only writer; this page asks
   GET /api/lounge/state every couple of seconds, validates the answer
   against a fixed schema, and applies it through the lab's own functions.

   Nothing from the wire is ever executed, interpolated into markup or CSS,
   or used as a dynamic property key. The one user-controlled string that
   reaches the screen — the setter's login — goes in via textContent after a
   ^[a-z0-9_]{3,25}$ check, and can be killed from chat (!lab badge off).

   Inert unless the URL says ?control=live&channel=<login>. The lab and the
   plain stream mode do not change behaviour at all without that.
   ──────────────────────────────────────────────────────────────────────── */
'use strict';

/* Slugs mirror lab.js `palettes` in index order, and lounge_control.js PALETTES. */
const LOUNGE_PALETTE_INDEX = Object.freeze({
  'pure-white': 0, 'off-white': 1, 'transparent': 2, 'light-gray': 3,
  'charcoal': 4, 'black': 5, 'sky-blue': 6, 'lavender': 7, 'mint': 8, 'peach': 9,
});
const LOUNGE_VIBES = Object.freeze(['chill', 'hype', 'turbo']);
/* Fine controls. Bounds duplicated from the bot's RANGES table, which in turn
   copies lab.js's own slider bounds — the page re-validates independently
   because it must never trust the wire, even from our own bot. */
const LOUNGE_RANGES = Object.freeze({
  depth: [1, 8], thickness: [0, 10], rotation: [-20, 20],
  position: [-20, 20], speed: [5, 100], tilt: [0, 25],
});
const LOGIN_RE = /^[a-z0-9_]{3,25}$/;
const DWELL_MS = 3000;          // page-side floor, enforced independently of the bot

/**
 * validateLoungeState(raw, cardMax) -> { ok:true, state } | { ok:false, reason }
 * Strict and fail-closed: any field missing, mistyped or out of range rejects
 * the whole payload. Never coerces. Pure — safe to unit test in Node.
 */
function validateLoungeState(raw, cardMax = 15) {
  const bad = reason => ({ ok: false, reason });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('not_object');
  if (raw.version !== 1) return bad('version');
  if (typeof raw.bootId !== 'string' || !/^\d{1,16}$/.test(raw.bootId)) return bad('bootId');
  if (!Number.isSafeInteger(raw.seq) || raw.seq < 0) return bad('seq');
  if (!Number.isSafeInteger(raw.updatedAtMs) || raw.updatedAtMs < 0) return bad('updatedAtMs');
  if (typeof raw.vibe !== 'string' || !LOUNGE_VIBES.includes(raw.vibe)) return bad('vibe');
  if (typeof raw.palette !== 'string' || !Object.prototype.hasOwnProperty.call(LOUNGE_PALETTE_INDEX, raw.palette)) return bad('palette');
  if (!Number.isInteger(raw.cardCount) || raw.cardCount < 1 || raw.cardCount > 99) return bad('cardCount');
  const cardCap = Math.min(raw.cardCount, cardMax);
  if (!Number.isInteger(raw.card) || raw.card < 1 || raw.card > cardCap) return bad('card');
  if (typeof raw.zoom !== 'number' || !Number.isFinite(raw.zoom) || raw.zoom < 0.85 || raw.zoom > 1.2) return bad('zoom');
  if (typeof raw.glow !== 'boolean') return bad('glow');
  if (typeof raw.shadow !== 'boolean') return bad('shadow');
  if (typeof raw.frozen !== 'boolean') return bad('frozen');
  if (typeof raw.locked !== 'boolean') return bad('locked');
  /* null is legal and means "follow the vibe preset". Anything else must be an
     integer inside the lab's own slider range — no coercion, no clamping. */
  const fine = {};
  for (const [k, [lo, hi]] of Object.entries(LOUNGE_RANGES)) {
    const v = raw[k];
    if (v === null || v === undefined) { fine[k] = null; continue; }
    if (!Number.isInteger(v) || v < lo || v > hi) return bad(k);
    fine[k] = v;
  }
  if (raw.setByLogin !== null && (typeof raw.setByLogin !== 'string' || !LOGIN_RE.test(raw.setByLogin))) return bad('setByLogin');
  const pollMs = (Number.isInteger(raw.pollMs) && raw.pollMs >= 1000 && raw.pollMs <= 10000) ? raw.pollMs : 2000;
  return { ok: true, state: Object.freeze({
    bootId: raw.bootId, seq: raw.seq, vibe: raw.vibe, palette: raw.palette,
    paletteIndex: LOUNGE_PALETTE_INDEX[raw.palette], card: raw.card, zoom: raw.zoom,
    glow: raw.glow, shadow: raw.shadow, frozen: raw.frozen,
    locked: raw.locked, setByLogin: raw.setByLogin, pollMs, ...fine,
  }) };
}

/* Only an http(s) origin with a hostname and optional port. No path, no query,
   no credentials. Anything else falls back to the local default. */
function parseApiBase(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(https?):\/\/([a-z0-9.-]{1,253})(:\d{2,5})?\/?$/i);
  return m ? `${m[1].toLowerCase()}://${m[2].toLowerCase()}${m[3] || ''}` : null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateLoungeState, parseApiBase, LOUNGE_PALETTE_INDEX, LOUNGE_VIBES, LOUNGE_RANGES, DWELL_MS };
}

/* ─── browser bootstrap ─────────────────────────────────────────────── */
if (typeof window !== 'undefined' && typeof location !== 'undefined') (function () {
  const params = new URLSearchParams(location.search);
  if (params.get('control') !== 'live') return;
  const channel = String(params.get('channel') || '').toLowerCase();
  if (!LOGIN_RE.test(channel)) { console.warn('[lab] control=live needs &channel=<login>'); return; }
  const api = parseApiBase(params.get('api')) || parseApiBase(window.CUHZ_DEFAULT_API) || 'http://127.0.0.1:3000';
  const LAB = window.CUHZ_LAB;
  if (!LAB) { console.warn('[lab] window.CUHZ_LAB missing — lab.js must load first'); return; }
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motionPreference.matches;
  motionPreference.addEventListener?.('change', e => { reduced = e.matches; if(reduced) LAB.update('paused', true); });

  /* on-screen presentation (§10): badge bottom-left, signpost bottom-right.
     Created here so the plain lab DOM is untouched outside control mode. */
  const badge = document.createElement('div'); badge.id = 'lab-badge'; badge.hidden = true;
  const sign  = document.createElement('div'); sign.id  = 'lab-signpost';
  document.body.append(badge, sign);
  const connection = document.createElement('p'); connection.id = 'lab-connection';
  connection.setAttribute?.('role', 'status'); connection.textContent = 'Connecting to live Lounge…';
  document.querySelector?.('.toolbar')?.append(connection);
  function reportConnection(text) { if(connection.textContent !== text) connection.textContent = text; }

  let last = { bootId: null, seq: -1 };
  let pending = null, lastAppliedAt = 0, pollMs = 2000, failures = 0;
  const retiredBoots = new Set();

  function present(st) {
    const vibe = st.vibe.toUpperCase();
    sign.textContent = `${st.locked ? 'HOUSE' : vibe} · ${st.palette.replace('-', ' ').toUpperCase()}`;
    if (!st.locked && st.setByLogin) {
      badge.textContent = `SET BY @${st.setByLogin} · ${vibe}`;   // textContent only, never markup
      badge.hidden = false;
    } else {
      badge.hidden = true;                                          // locked reads as absence, not alarm
    }
    if (!reduced) {
      sign.classList.add('is-fresh'); badge.classList.add('is-fresh');
      setTimeout(() => { sign.classList.remove('is-fresh'); badge.classList.remove('is-fresh'); }, 2500);
    }
  }

  function apply(st) {
    /* Order matters: the preset writes speed/depth/zoom/tilt, so it goes FIRST and
       the explicit fine controls overwrite it afterwards. A null fine control is
       simply not written, which leaves the preset's own value in place. */
    const change = () => {
    LAB.applyPreset(st.vibe);                                   // sets preset physics + glow=true
    LAB.update('zoom', +(LAB.PRESETS[st.vibe].zoom * st.zoom).toFixed(3));
    LAB.update('glow', st.glow);
    LAB.update('shadow', st.shadow);
    LAB.update('background', st.paletteIndex);
    if (st.depth     !== null) LAB.update('depth', st.depth);
    LAB.update('thickness', st.thickness ?? LAB.fineDefaults?.thickness ?? 0);
    LAB.update('rotation', st.rotation ?? 0);
    if (st.tilt      !== null) LAB.update('tiltAmplitude', st.tilt);
    LAB.update('position', st.position === null ? 0 : st.position / 100);   // percent -> lab's -0.2..0.2
    if (st.speed     !== null) LAB.update('speed', st.speed / 100);         // percent -> lab's 0.05..1
    LAB.update('paused', st.frozen || reduced);                 // freeze and reduced-motion pause win
    LAB.select(Math.min(st.card, LAB.cardCount) - 1);
    };
    if(LAB.withLiveUpdate) LAB.withLiveUpdate(change); else change();
    present(st);
    lastAppliedAt = performance.now();
    last = { bootId: st.bootId, seq: st.seq };
  }

  function consider(st) {
    // Replay / stale-cache defence: strictly increasing seq per bootId.
    if(retiredBoots.has(st.bootId)) return;
    if (st.bootId === last.bootId && st.seq <= last.seq) return;
    if (pending && st.bootId === pending.bootId && st.seq <= pending.seq) return;
    const currentBoot=pending?.bootId || last.bootId;
    if(currentBoot && currentBoot !== st.bootId) {
      retiredBoots.add(currentBoot);
      if(retiredBoots.size>32) retiredBoots.delete(retiredBoots.values().next().value);
    }
    pending = st;
    const wait = Math.max(0, DWELL_MS - (performance.now() - lastAppliedAt));
    if (wait === 0) { const p = pending; pending = null; apply(p); }
    else setTimeout(() => { if (pending) { const p = pending; pending = null; apply(p); } }, wait);
  }

  async function poll() {
    const ctl = new AbortController();
    const kill = setTimeout(() => ctl.abort(), 1500);
    try {
      const res = await fetch(`${api}/api/lounge/state?channel=${encodeURIComponent(channel)}`,
                              { cache: 'no-store', signal: ctl.signal, credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const v = validateLoungeState(await res.json(), LAB.cardCount);
      if (!v.ok) throw new Error(`rejected payload: ${v.reason}`);
      failures = 0; pollMs = v.state.pollMs;
      reportConnection(`Following #${channel} · ${v.state.locked?'house look':'Twitch chat control'} · this page is read-only`);
      consider(v.state);
    } catch (err) {
      failures += 1;
      reportConnection('Live control unavailable · keeping the last look · retrying');
      if (failures === 1 || failures % 30 === 0) console.warn('[lab] poll failed:', err.message);
      pollMs = Math.min(10000, 2000 * Math.min(5, failures));   // back off, keep the last look
    } finally {
      clearTimeout(kill);
      setTimeout(poll, pollMs);
    }
  }
  poll();
})();
