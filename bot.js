// bot.js
// Requires: tmi.js, node-fetch@2
// This bot:
// - Polls created.app for channels (pending + enabled) and joins them
// - Handles !cuhz verify CODE (calls /api/bot/verify)
// - Handles !chain <prompt> and !cuhz <prompt> (calls /api/bot/command)
// - Adds safe/security mod commands (queue, next, cooldown, safe, lockdown, status)
// - Advertises the dashboard in a non-spammy way (on join + rate-limited after success)

const tmi = require("tmi.js");
const fetch = require("node-fetch");

// -------------------- ENV (required) --------------------
const BOT_USERNAME = process.env.BOT_USERNAME; // bot twitch login
const BOT_OAUTH_TOKEN = process.env.BOT_OAUTH_TOKEN; // oauth:xxxx
const API_BASE = process.env.API_BASE; // https://cuhz-bot-dashboard-846.created.app
const BOT_API_SECRET = process.env.BOT_API_SECRET; // shared secret
const WEBHOOK_URL = process.env.WEBHOOK_URL; // https://.../api/bot/command
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN; // shared secret for /api/bot/command

// -------------------- ENV (optional) --------------------
const DASHBOARD_URL = process.env.DASHBOARD_URL || `${API_BASE}/dashboard`;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 60000);
const JOIN_DELAY_MS = Number(process.env.JOIN_DELAY_MS || 650);
const DEFAULT_COOLDOWN_MS = Number(process.env.DEFAULT_COOLDOWN_MS || 30000);
const PROMO_INTERVAL_MS = Number(process.env.PROMO_INTERVAL_MS || 30 * 60 * 1000); // 30m
const MAX_PROMPT_LEN_DEFAULT = Number(process.env.MAX_PROMPT_LEN_DEFAULT || 220);

function requireEnv(name, val) {
  if (!val) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
}
requireEnv("BOT_USERNAME", BOT_USERNAME);
requireEnv("BOT_OAUTH_TOKEN", BOT_OAUTH_TOKEN);
requireEnv("API_BASE", API_BASE);
requireEnv("BOT_API_SECRET", BOT_API_SECRET);
requireEnv("WEBHOOK_URL", WEBHOOK_URL);
requireEnv("WEBHOOK_TOKEN", WEBHOOK_TOKEN);

if (!String(BOT_OAUTH_TOKEN).startsWith("oauth:")) {
  console.error("BOT_OAUTH_TOKEN must start with 'oauth:'");
  process.exit(1);
}

function normChannel(ch) {
  return String(ch || "").trim().toLowerCase().replace(/^#/, "");
}
function authHeaders() {
  return { Authorization: `Bearer ${BOT_API_SECRET}` };
}
async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}
function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.min(max, Math.max(min, Math.floor(x)));
}
function perms(tags) {
  const badges = tags.badges || {};
  const isBroadcaster = badges.broadcaster === "1";
  const isMod = isBroadcaster || !!tags.mod || badges.moderator === "1";
  return { isBroadcaster, isMod };
}

// -------------------- Client --------------------
const client = new tmi.Client({
  identity: { username: BOT_USERNAME, password: BOT_OAUTH_TOKEN },
  channels: [],
  connection: { reconnect: true, secure: true },
  options: { skipMembership: true, skipUpdatingEmotesets: true },
});

// -------------------- State --------------------
const joinedChannels = new Set();
const joinQueue = [];
const joinAnnounced = new Set(); // per boot
const promoLastByChannel = new Map(); // channel -> timestamp
const cooldowns = new Map(); // key: channel:userId -> last timestamp

// Per-channel settings (in-memory). You can persist later if you want.
const channelSettings = new Map();
// Per-channel queue
const channelQueues = new Map();

function getSettings(channel) {
  const ch = normChannel(channel);
  if (!channelSettings.has(ch)) {
    channelSettings.set(ch, {
      queueEnabled: false,
      cooldownMs: DEFAULT_COOLDOWN_MS,
      safeMode: true,
      lockdown: false,
      maxPromptLen: MAX_PROMPT_LEN_DEFAULT,
    });
  }
  return channelSettings.get(ch);
}
function setSettings(channel, patch) {
  const ch = normChannel(channel);
  const cur = getSettings(ch);
  const next = { ...cur, ...patch };
  channelSettings.set(ch, next);
  return next;
}
function getQueue(channel) {
  const ch = normChannel(channel);
  if (!channelQueues.has(ch)) channelQueues.set(ch, []);
  return channelQueues.get(ch);
}

// -------------------- created.app API calls --------------------
async function apiGetChannels() {
  const res = await fetch(`${API_BASE}/api/bot/channels`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  const data = await safeJson(res);
  return { ok: res.ok, status: res.status, data };
}

async function apiVerifyChannel(channel, code) {
  const res = await fetch(`${API_BASE}/api/bot/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      channel: normChannel(channel),
      code: String(code || "").trim().toUpperCase(),
    }),
  });
  const data = await safeJson(res);
  return { ok: res.ok, status: res.status, data };
}

async function callCommandWebhook(channel, tags, message) {
  const channelName = normChannel(channel);
  const username = tags.username;
  const userId = tags["user-id"];

  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: WEBHOOK_TOKEN,
      channel: channelName,
      user: { id: userId, name: username },
      text: message,
      flags: getSettings(channelName), // pass settings so server can enforce safe mode if desired
    }),
  });

  const data = await safeJson(res);
  return { ok: res.ok, status: res.status, data };
}

// -------------------- Joining --------------------
function queueJoin(channel) {
  const ch = normChannel(channel);
  if (!ch) return;
  if (joinedChannels.has(ch)) return;
  if (joinQueue.includes(ch)) return;
  joinQueue.push(ch);
}

function startJoinQueue() {
  setInterval(async () => {
    if (joinQueue.length === 0) return;
    const ch = joinQueue.shift();

    try {
      await client.join(ch);
      joinedChannels.add(ch);

      // One-time per boot announcement
      if (!joinAnnounced.has(ch)) {
        joinAnnounced.add(ch);
        try {
          await client.say(`#${ch}`, `CuhzBot online. Manage settings: ${DASHBOARD_URL}`);
        } catch {}
      }

      console.log(`Joined: ${ch}`);
    } catch (e) {
      console.error(`Join error (${ch}):`, e.message);
      const msg = String(e.message || "").toLowerCase();
      if (msg.includes("rate")) setTimeout(() => queueJoin(ch), 15000);
      else setTimeout(() => queueJoin(ch), 5000);
    }
  }, JOIN_DELAY_MS);
}

async function syncChannels() {
  const res = await apiGetChannels();
  if (!res.ok) {
    console.error("Channel sync failed:", res.status, res.data);
    return;
  }

  const wanted = new Set();

  if (Array.isArray(res.data.channelLogins)) {
    res.data.channelLogins.forEach((c) => wanted.add(normChannel(c)));
  } else if (Array.isArray(res.data.channels)) {
    res.data.channels.forEach((row) => wanted.add(normChannel(row.channel_login)));
  }

  // Join wanted channels
  for (const ch of wanted) {
    if (!joinedChannels.has(ch)) queueJoin(ch);
  }

  // Part channels that are no longer wanted
  for (const ch of Array.from(joinedChannels)) {
    if (!wanted.has(ch)) {
      try {
        await client.part(ch);
        joinedChannels.delete(ch);
        console.log(`Left: ${ch}`);
      } catch (e) {
        console.error(`Part error (${ch}):`, e.message);
      }
    }
  }

  console.log(`Sync complete. wanted=${wanted.size} joined=${joinedChannels.size} queued=${joinQueue.length}`);
}

function startPolling() {
  syncChannels();
  setInterval(syncChannels, POLL_INTERVAL_MS);
}

// -------------------- Generation helpers --------------------
async function maybePromo(channel) {
  const ch = normChannel(channel);
  const last = promoLastByChannel.get(ch) || 0;
  if (Date.now() - last < PROMO_INTERVAL_MS) return;
  promoLastByChannel.set(ch, Date.now());
  try {
    await client.say(channel, `Manage CuhzBot: ${DASHBOARD_URL}`);
  } catch {}
}

async function processGeneration(channel, tags, message) {
  const username = tags.username;

  const result = await callCommandWebhook(channel, tags, message);

  // Expected success: { handled: true, reply, imageUrl? }
  if (result.ok && result.data && result.data.handled) {
    const reply = result.data.reply || "Done.";
    const url = result.data.imageUrl ? ` ${result.data.imageUrl}` : "";
    await client.say(channel, `@${username} ${reply}${url}`);
    await maybePromo(channel);
    return;
  }

  if (result.status === 429) {
    await client.say(channel, `@${username} Daily limit reached.`);
    return;
  }

  const err = (result.data && (result.data.error || result.data.message)) || `Command failed (${result.status}).`;
  await client.say(channel, `@${username} ${err}`);
}

async function processNextFromQueue(channel) {
  const q = getQueue(channel);
  if (q.length === 0) return false;
  const item = q.shift();
  await processGeneration(item.channel, item.tags, item.message);
  return true;
}

// -------------------- Message handling --------------------
client.on("connected", (addr, port) => {
  console.log(`Connected: ${addr}:${port}`);
  console.log(`Bot user: ${BOT_USERNAME}`);
  startJoinQueue();
  startPolling();
});

client.on("message", async (channel, tags, message, self) => {
  if (self) return;

  const ch = normChannel(channel);
  const userId = tags["user-id"];
  const username = tags.username;
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  const { isMod } = perms(tags);

  // Public help
  if (lower === "!cuhz help") {
    await client.say(
      channel,
      `@${username} Use: !chain <prompt> | Verify: !cuhz verify <CODE> | Dashboard: ${DASHBOARD_URL} | Mods: !cuhz status, !cuhz queue on|off, !cuhz next, !cuhz cooldown <sec>, !cuhz safe on|off, !cuhz lockdown on|off`
    );
    return;
  }

  // Verify command (public, but server protected)
  if (lower.startsWith("!cuhz verify")) {
    const parts = text.split(/\s+/);
    const code = parts[2];
    if (!code) {
      await client.say(channel, `@${username} Usage: !cuhz verify <CODE>`);
      return;
    }

    const res = await apiVerifyChannel(ch, code);
    if (res.ok && res.data && res.data.success) {
      await client.say(channel, `@${username} ${res.data.message || "Verified."}`);
      // refresh quickly so the channel stays joined consistently
      syncChannels();
    } else {
      const msg = (res.data && (res.data.message || res.data.error)) || "Verification failed.";
      await client.say(channel, `@${username} ${msg}`);
    }
    return;
  }

  // Mod-only: status
  if (lower === "!cuhz status") {
    if (!isMod) return;
    const s = getSettings(ch);
    const q = getQueue(ch);
    await client.say(
      channel,
      `Status: queue=${s.queueEnabled ? "on" : "off"} cooldown=${Math.round(s.cooldownMs / 1000)}s safe=${s.safeMode ? "on" : "off"} lockdown=${s.lockdown ? "on" : "off"} queued=${q.length}`
    );
    return;
  }

  // Mod-only: queue on/off
  if (lower.startsWith("!cuhz queue")) {
    if (!isMod) return;
    const parts = text.split(/\s+/);
    const onOff = String(parts[2] || "").toLowerCase();
    if (onOff !== "on" && onOff !== "off") {
      await client.say(channel, `@${username} Usage: !cuhz queue on|off`);
      return;
    }
    const next = setSettings(ch, { queueEnabled: onOff === "on" });
    await client.say(channel, `Queue mode is now ${next.queueEnabled ? "on" : "off"}.`);
    return;
  }

  // Mod-only: next
  if (lower === "!cuhz next") {
    if (!isMod) return;
    const ok = await processNextFromQueue(channel);
    if (!ok) await client.say(channel, `Queue is empty.`);
    return;
  }

  // Mod-only: cooldown
  if (lower.startsWith("!cuhz cooldown")) {
    if (!isMod) return;
    const parts = text.split(/\s+/);
    const sec = clampInt(parts[2], 5, 600);
    if (sec === null) {
      await client.say(channel, `@${username} Usage: !cuhz cooldown <seconds> (5-600)`);
      return;
    }
    setSettings(ch, { cooldownMs: sec * 1000 });
    await client.say(channel, `Cooldown set to ${sec}s.`);
    return;
  }

  // Mod-only: safe on/off
  if (lower.startsWith("!cuhz safe")) {
    if (!isMod) return;
    const parts = text.split(/\s+/);
    const onOff = String(parts[2] || "").toLowerCase();
    if (onOff !== "on" && onOff !== "off") {
      await client.say(channel, `@${username} Usage: !cuhz safe on|off`);
      return;
    }
    const next = setSettings(ch, { safeMode: onOff === "on" });
    await client.say(channel, `Safe mode is now ${next.safeMode ? "on" : "off"}.`);
    return;
  }

  // Mod-only: lockdown on/off (restrict gens to mods only)
  if (lower.startsWith("!cuhz lockdown")) {
    if (!isMod) return;
    const parts = text.split(/\s+/);
    const onOff = String(parts[2] || "").toLowerCase();
    if (onOff !== "on" && onOff !== "off") {
      await client.say(channel, `@${username} Usage: !cuhz lockdown on|off`);
      return;
    }
    const next = setSettings(ch, { lockdown: onOff === "on" });
    await client.say(channel, `Lockdown is now ${next.lockdown ? "on" : "off"}.`);
    return;
  }

  // Generation commands: !chain <prompt> OR !cuhz <prompt>
  const isGen = lower.startsWith("!chain ") || lower.startsWith("!cuhz ");
  if (!isGen) return;

  const s = getSettings(ch);

  // Lockdown: only mods can run generations
  if (s.lockdown && !isMod) {
    await client.say(channel, `@${username} Commands are currently restricted to mods.`);
    return;
  }

  // Extract prompt
  const parts = text.split(/\s+/);
  const prompt = parts.slice(1).join(" ").trim();

  if (!prompt || prompt.toLowerCase() === "help") {
    await client.say(channel, `@${username} Usage: !chain <prompt> | Dashboard: ${DASHBOARD_URL}`);
    return;
  }

  if (prompt.length > s.maxPromptLen) {
    await client.say(channel, `@${username} Prompt too long. Limit is ${s.maxPromptLen} characters.`);
    return;
  }

  // Cooldown (per user per channel)
  const cooldownKey = `${ch}:${userId}`;
  const now = Date.now();
  const last = cooldowns.get(cooldownKey) || 0;
  if (now - last < s.cooldownMs) {
    const remaining = Math.ceil((s.cooldownMs - (now - last)) / 1000);
    await client.say(channel, `@${username} Cooldown active. Try again in ${remaining}s.`);
    return;
  }
  cooldowns.set(cooldownKey, now);

  // Queue mode: queue viewers; mods bypass and run immediately
  if (s.queueEnabled && !isMod) {
    const q = getQueue(ch);
    q.push({ channel, tags, message: text, ts: Date.now() });
    await client.say(channel, `@${username} Added to queue. Position: ${q.length}.`);
    return;
  }

  // Run immediately
  await processGeneration(channel, tags, text);
});

client.on("disconnected", (reason) => {
  console.log("Disconnected:", reason);
});

process.on("SIGINT", () => {
  console.log("Shutting down...");
  client.disconnect();
  process.exit(0);
});

client.connect().catch((e) => {
  console.error("Connect error:", e.message);
  process.exit(1);
});
