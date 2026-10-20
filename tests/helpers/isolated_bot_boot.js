// Ported from the reviewed local cuhzbot-points candidate on 2026-09-09.
'use strict';

// This tests complete bot.js module evaluation with inert dependencies. It is
// not a real deployment/startup check: no config/database/service module loads,
// listener callbacks, seed implementation, timers, or chat clients are started.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const botPath = path.resolve(__dirname, '../../src/bot.js');
function readBotSource() {
    return fs.readFileSync(botPath, 'utf8');
}

function evaluateBotBoot(source = readBotSource(), fixtures = {}) {
    const evidence = {
        reachedEnd: false,
        routes: [],
        listenRequests: 0,
        seedRequests: 0,
        fileExistenceProbes: 0,
        registeredSignals: [],
        requiredModules: [],
        forbiddenAttempts: [],
    };
    const forbid = operation => () => {
        evidence.forbiddenAttempts.push(operation);
        throw new Error(`Isolated boot forbids ${operation}`);
    };
    const app = {
        locals: fixtures.appLocals || {},
        use() {},
        get(route, ...handlers) { evidence.routes.push({ method: 'GET', route, handlers }); },
        options(route, ...handlers) { evidence.routes.push({ method: 'OPTIONS', route, handlers }); },
        post(route, ...handlers) { evidence.routes.push({ method: 'POST', route, handlers }); },
        listen() {
            evidence.listenRequests++;
            // Deliberately do not invoke the callback: it initializes Twitch.
        },
    };
    const express = () => app;
    express.json = () => () => {};
    // 2026-10-10: the bot serves public/lounge itself; static() is inert here.
    express.static = () => (req, res, next) => (typeof next === 'function' ? next() : undefined);
    const inertServices = new Set([
        './ai_service', './mood_tracker', './context_handler', './user_memory',
        './points_service', './raffle_service', './forge_service', './loyalty',
        './mod_intel', './moderation_service', './stream_intel',
    ]);
    const config = Object.freeze({ port: 0, channels: Object.freeze([]), enableGambling: fixtures.enableGambling === true });
    const logger = Object.freeze({ info() {}, warn() {}, error() {}, debug() {} });
    const processStub = Object.freeze({
        env: Object.freeze(Object.create(null)),
        on(signal) { evidence.registeredSignals.push(signal); },
        exit: forbid('process.exit'),
    });
    const context = {
        module: { exports: {} },
        __dirname: path.dirname(botPath),
        global: Object.create(null),
        process: processStub,
        fetch: forbid('fetch'),
        setTimeout: forbid('setTimeout'),
        setInterval: forbid('setInterval'),
        require(name) {
            evidence.requiredModules.push(name);
            // Runtime tests may provide inert DB/service implementations; file,
            // environment, network and lifecycle capabilities remain forbidden.
            const injectable = new Set(['./database', './points_service', './user_memory', './loyalty', './logger']);
            if (injectable.has(name) && Object.hasOwn(fixtures, name)) return fixtures[name];
            if (name === 'express') return express;
            if (name === 'cors') return () => () => {};
            if (name === './config') return config;
            if (name === './logger') return logger;
            if (name === './points_seed') return {
                seedPoints() { evidence.seedRequests++; return Promise.resolve(); },
            };
            if (name === './database') return Object.freeze({
                prepare: forbid('database.prepare'),
                exec: forbid('database.exec'),
                mutatePoints: forbid('database.mutatePoints'),
            });
            if (name === './duration') return Object.freeze({});
            if (name === './streak_service') return Object.freeze({ createTracker: () => Object.freeze({}) });
            // Pure string helpers (added on main by 7fb95f5): no requires, no I/O,
            // so the real module is safe here and keeps channel normalization faithful.
            if (name === './channel_identity') return require('../../src/channel_identity');
            // Pure in-memory factory (added on main by 2d79d41); no timer or I/O at
            // import, so the real module is also safe here.
            if (name === './shared_chat_guard') return require('../../src/shared_chat_guard');
            if (name === './readiness_service') return fixtures.readinessService || require('../../src/readiness_service');
            // Lane K: the two lounge modules are PURE (zero requires, no I/O, injected
            // clock) and are loaded for real for that reason. tests/test_lounge_wiring.js
            // asserts the zero-require property so this line can never become a hole.
            if (name === './lounge_control') return require('../../src/lounge_control');
            if (name === './lounge_menu') return require('../../src/lounge_menu');
            // Inert factory: the empty env cannot import/start the hosted runtime.
            if (name === './lounge_v2_adapter') return require('../../src/lounge_v2_adapter');
            // 2026-09-26 commerce merge modules (gap found 2026-10-09 — every
            // evaluateBotBoot suite had been failing on main since that merge).
            // These five are PURE (zero I/O requires; stream_content pulls only
            // safety_policy) and bot.js consumes some at module level
            // (createTracker, createListener, COMMERCE_COMMAND_NAMES), so they
            // load for real:
            if (name === './safety_policy') return require('../../src/safety_policy');
            if (name === './stream_content') return require('../../src/stream_content');
            if (name === './commerce_content') return require('../../src/commerce_content');
            if (name === './keyword_listener') return require('../../src/keyword_listener');
            if (name === './streak_service') return require('../../src/streak_service');
            // Pure (lazy node:crypto only); bot.js constructs the gate at module
            // level with an injected axios closure that itself stays unexercised.
            if (name === './lounge_web_gate') return require('../../src/lounge_web_gate');
            // I/O-backed services: inert shapes. Methods the per-message path
            // touches return harmless values; everything network/db-shaped
            // stays forbidden so a test can never hit the outside world.
            if (name === './tier_service') return Object.freeze({
                getChannelPlan: () => 'community',
                getChannelPlanAwait: async () => 'community',
                init() {},
                startPurchaseWatcher: forbid('tier_service.startPurchaseWatcher'),
            });
            if (name === './roster_service') return Object.freeze({
                start: forbid('roster_service.start'),
            });
            if (name === './followage_service') return Object.freeze({
                getFollowage: forbid('followage_service.getFollowage'),
                buildReply: forbid('followage_service.buildReply'),
            });
            if (name === './clips_service') return Object.freeze({
                handleClipCommand: forbid('clips_service.handleClipCommand'),
            });
            if (name === './raider_service') return Object.freeze({
                getRaiderRecommendation: forbid('raider_service.getRaiderRecommendation'),
            });
            if (name === './twitch_edge_service') return Object.freeze({
                getLiveStream: forbid('twitch_edge.getLiveStream'),
                getTopClip: forbid('twitch_edge.getTopClip'),
                getLastVOD: forbid('twitch_edge.getLastVOD'),
                getAccountAge: forbid('twitch_edge.getAccountAge'),
                getFollowerCount: forbid('twitch_edge.getFollowerCount'),
                getSubEmotes: forbid('twitch_edge.getSubEmotes'),
                getCategoryRank: forbid('twitch_edge.getCategoryRank'),
                getChatRules: forbid('twitch_edge.getChatRules'),
                formatUptimeDuration: () => 'offline',
            });
            if (name === 'fs') return Object.freeze({
                existsSync() { evidence.fileExistenceProbes++; return false; },
                readFileSync: forbid('fs.readFileSync'),
                writeFileSync: forbid('fs.writeFileSync'),
            });
            if (name === 'path') return path;
            // Both spellings: the 2026-09-26 commerce merge requires bare 'crypto'
            // (production main had failed this harness since then — found
            // 2026-10-09). timingSafeEqual is pure and deterministic, so the real
            // one passes through; randomUUID stays forbidden (nondeterminism).
            if (name === 'node:crypto' || name === 'crypto') return Object.freeze({
                randomUUID: forbid('randomUUID'),
                timingSafeEqual: require('node:crypto').timingSafeEqual,
                createHash: require('node:crypto').createHash,   // pure + deterministic
            });
            if (name === 'tmi.js') return {
                Client: class { constructor() { forbid('Twitch client construction')(); } },
            };
            if (name === 'axios') return Object.freeze({
                get: forbid('axios.get'), post: forbid('axios.post'),
            });
            if (inertServices.has(name)) return Object.freeze({});
            return forbid(`module import ${name}`)();
        },
    };
    // Append an EOF marker to the complete source; do not extract selected
    // declarations or accept an earlier error as evidence of a successful boot.
    const result = vm.runInNewContext(`${source}\n;({
        reachedEnd: true,
        runtime: {
            handleMessage,
            configure(channel, persona, say) {
                channelConfigs.set(channel, persona);
                client = { say };
                sendMessage = say;
            },
            verifiedFollowerFixture() {
                getTwitchUser = async name => ({ id: 'fixture-' + name });
                getFollowData = async () => ({ followed_at: '2026-01-01T00:00:00Z' });
            },
            gambleFixture(win) {
                Math.random = () => win ? 0 : 1;
            }
        }
    });`, context, {
        filename: botPath,
        timeout: 1000,
    });
    if (evidence.forbiddenAttempts.length) {
        // A bot try/catch must not hide an attempted forbidden operation.
        throw new Error(`Isolated boot forbids: ${evidence.forbiddenAttempts.join(', ')}`);
    }
    if (!result || result.reachedEnd !== true) throw new Error('Bot did not reach end of module');
    evidence.reachedEnd = true;
    evidence.runtime = result.runtime;
    return evidence;
}

module.exports = { evaluateBotBoot, readBotSource };
