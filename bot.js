const tmi = require("tmi.js");
const fetch = require("node-fetch");

// ---- Required env vars ----
const REQUIRED = [
  "BOT_USERNAME",
  "BOT_OAUTH_TOKEN",
  "BOT_CHANNELS",
  "WEBHOOK_URL",
  "WEBHOOK_TOKEN",
];

for (const k of REQUIRED) {
  if (!process.env[k] || String(process.env[k]).trim() === "") {
    throw new Error(`Missing env var: ${k}`);
  }
}

const BOT_USERNAME = process.env.BOT_USERNAME.trim();
const BOT_OAUTH_TOKEN = process.env.BOT_OAUTH_TOKEN.trim(); // must be "oauth:xxxx"
const WEBHOOK_URL = process.env.WEBHOOK_URL.trim();
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN.trim();

const CHANNELS = process.env.BOT_CHANNELS.split(",")
  .map((c) => c.trim().replace(/^#/, "").toLowerCase())
  .filter(Boolean);

// ---- Twitch client ----
const client = new tmi.Client({
  identity: {
    username: BOT_USERNAME,
    password: BOT_OAUTH_TOKEN,
  },
  channels: CHANNELS,
  connection: {
    secure: true,
    reconnect: true,
  },
});

// ---- Cooldowns ----
const cooldowns = new Map();
const COOLDOWN_MS = 30_000; // 30 seconds per user per channel

// ---- Send queue (prevents rate-limit drops) ----
const sendQueue = [];
let sending = false;

async function sayQueued(channel, text) {
  // keep messages short-ish (Twitch max message length)
  const msg = String(text).slice(0, 450);

  sendQueue.push([channel, msg]);
  if (sending) return;

  sending = true;
  while (sendQueue.length) {
    const [ch, m] = sendQueue.shift();
    try {
      await client.say(ch, m);
    } catch (e) {
      console.error("client.say error:", e?.message || e);
    }
    // ~1 msg/sec global throttle
    await new Promise((r) => setTimeout(r, 1100));
  }
  sending = false;
}

// ---- Connect ----
client.connect().catch((err) => {
  console.error("Con
