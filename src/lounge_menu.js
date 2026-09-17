'use strict';

// THE CUHZ LAB — operator menu (`!lab`).
//
// PURE MODULE: zero requires, zero I/O. Same rule as lounge_control.js and for
// the same reason: the isolated boot harness loads these two files for real,
// and it may only do that because there is nothing in them to forbid.
//
// Everything here is text-in, text-out. It never touches state; it turns an
// operator's shorthand into the exact `!lounge …` sentence the validator
// already understands, so there is ONE grammar and ONE validator. A menu
// entry cannot reach a value the grammar would refuse.

// Number -> the full command it stands for. Both forms parse identically
// (`!lab 3` === `!lab vibe turbo` === `!lounge vibe turbo`).
const ENTRIES = Object.freeze([
    Object.freeze({ n: 1,  words: 'vibe chill',  cmd: '!lounge vibe chill',  page: 1, label: 'chill' }),
    Object.freeze({ n: 2,  words: 'vibe hype',   cmd: '!lounge vibe hype',   page: 1, label: 'hype' }),
    Object.freeze({ n: 3,  words: 'vibe turbo',  cmd: '!lounge vibe turbo',  page: 1, label: 'turbo (60s max)' }),
    Object.freeze({ n: 4,  words: 'zoom in',     cmd: '!lounge zoom in',     page: 1, label: 'zoom in' }),
    Object.freeze({ n: 5,  words: 'zoom out',    cmd: '!lounge zoom out',    page: 1, label: 'zoom out' }),
    Object.freeze({ n: 6,  words: 'zoom reset',  cmd: '!lounge zoom reset',  page: 1, label: 'zoom reset' }),
    Object.freeze({ n: 7,  words: 'glow on',     cmd: '!lounge glow on',     page: 1, label: 'glow on' }),
    Object.freeze({ n: 8,  words: 'glow off',    cmd: '!lounge glow off',    page: 1, label: 'glow off' }),
    Object.freeze({ n: 9,  words: 'reset',       cmd: '!lounge reset',       page: 1, label: 'house look' }),
    Object.freeze({ n: 10, words: 'lock',        cmd: '!lounge lock',        page: 2, label: 'lock chat control' }),
    Object.freeze({ n: 11, words: 'unlock',      cmd: '!lounge unlock',      page: 2, label: 'unlock' }),
    Object.freeze({ n: 12, words: 'badge on',    cmd: null, action: 'badge_on',  page: 2, label: 'badge on' }),
    Object.freeze({ n: 13, words: 'badge off',   cmd: null, action: 'badge_off', page: 2, label: 'badge off' }),
    Object.freeze({ n: 14, words: 'house set',   cmd: null, action: 'house_set', page: 2, label: 'house set (confirm)' }),
    Object.freeze({ n: 15, words: 'q',           cmd: null, action: 'queue',     page: 2, label: 'last requests' }),
]);

// The fine artwork controls. All take a value, so a number shortcut would not
// help -- they are word-form only and forward straight to the validator.
// vibe/zoom/glow are NOT here: they already have numbered menu entries, and
// shadowing them would strip the entry object off the word form so that
// `!lab 2` and `!lab vibe hype` stopped being identical.
const VALUE_INTENTS = Object.freeze([
    'depth', 'thickness', 'rotation', 'position', 'speed', 'tilt', 'shadow', 'freeze',
]);

const BY_NUMBER = Object.freeze(Object.fromEntries(ENTRIES.map(e => [String(e.n), e])));
const BY_WORDS  = Object.freeze(Object.fromEntries(ENTRIES.map(e => [e.words, e])));

const ASCII = /^[\x20-\x7e]*$/;

/**
 * parseLab(message) -> one of
 *   null                                   not a !lab message at all
 *   { kind: 'menu', page: 1|2 }            bare !lab, !lab menu, !lab more
 *   { kind: 'command', cmd, entry }        forwards to the lounge validator
 *   { kind: 'action', action, entry, arg } bot-level action (badge / house / q / mute / color / card)
 *   { kind: 'unknown' }                    !lab something-we-don't-know
 */
function parseLab(message) {
    if (typeof message !== 'string' || message.length > 200 || !ASCII.test(message)) return null;
    const parts = message.trim().toLowerCase().split(/\s+/).slice(0, 4);
    if (parts[0] !== '!lab') return null;

    const a = parts[1], b = parts[2], c = parts[3];
    // Menu pages are words, never numbers: every number 1..15 is an entry,
    // so `!lab 2` is "vibe hype" exactly as the menu prints it.
    if (!a || (a === 'menu' && (!b || b === '1'))) return { kind: 'menu', page: 1 };
    if (a === 'more' || (a === 'menu' && b === '2')) return { kind: 'menu', page: 2 };
    if (a === 'art' || (a === 'menu' && b === '3')) return { kind: 'menu', page: 3 };

    // Numbered form. Numbers are 1..15; anything else is unknown, not a fallthrough.
    if (/^\d{1,2}$/.test(a)) {
        const e = BY_NUMBER[a];
        if (!e) return { kind: 'unknown' };
        return e.cmd ? { kind: 'command', cmd: e.cmd, entry: e }
                     : { kind: 'action', action: e.action, entry: e, arg: b || null };
    }

    // Word forms with a value. These forward verbatim to the lounge validator, so
    // the menu can never reach a value the validator would refuse -- one grammar.
    if (a === 'color' && b) return { kind: 'command', cmd: `!lounge color ${b}`, entry: null };
    if (a === 'card'  && b) return { kind: 'command', cmd: `!lounge card ${b}`,  entry: null };
    if (VALUE_INTENTS.includes(a) && b) return { kind: 'command', cmd: `!lounge ${a} ${b}`, entry: null };
    if (a === 'ops') return { kind: 'action', action: 'ops', entry: null, arg: null };
    if (a === 'mute'  && b) return { kind: 'action', action: 'mute',   entry: null, arg: b };
    if (a === 'unmute' && b) return { kind: 'action', action: 'unmute', entry: null, arg: b };
    if (a === 'house') {
        if (b === 'set')  return { kind: 'action', action: 'house_set', entry: BY_WORDS['house set'], arg: c || null };
        if (b === 'show') return { kind: 'action', action: 'house_show', entry: null, arg: null };
        return { kind: 'unknown' };
    }

    const key = b ? `${a} ${b}` : a;
    const e = BY_WORDS[key];
    if (!e) return { kind: 'unknown' };
    return e.cmd ? { kind: 'command', cmd: e.cmd, entry: e }
                 : { kind: 'action', action: e.action, entry: e, arg: c || null };
}

/** The two menu pages as chat lines. Short on purpose: Twitch is 500 chars. */
function renderMenu(page) {
    if (page === 3) {
        return '🧪 LAB 3/3 ART — !lab depth 1-8 · thickness 0-10 · rotation -20..20 · position -20..20 · '
             + 'speed 5-100 · tilt 0-25 · shadow on|off · freeze on|off. Any of them: "auto" = back to the vibe.';
    }
    if (page === 2) {
        return '🧪 LAB 2/3 — 10 lock · 11 unlock · 12 badge on · 13 badge off · 14 house set · 15 q · '
             + 'also: !lab color <name> · !lab card <n> · !lab mute <login> · !lab ops · !lab art for the sliders';
    }
    return '🧪 LAB 1/3 — 1 chill · 2 hype · 3 turbo · 4 zoom in · 5 zoom out · 6 zoom reset · '
         + '7 glow on · 8 glow off · 9 house look · !lab more · !lab art';
}

module.exports = Object.freeze({ parseLab, renderMenu, ENTRIES, VALUE_INTENTS });
