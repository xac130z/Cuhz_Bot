const tmi = require("tmi.js");
const fetch = require("node-fetch");

const BOT_USERNAME = (process.env.BOT_USERNAME || "").toLowerCase();
const BOT_OAUTH_TOKEN = process.env.BOT_OAUTH_TOKEN; // oauth:xxxx
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN;

if (!BOT_USERNAME || !BOT_OAUTH_TOKEN || !WEBHOOK_URL || !WEBHOOK_TOKEN) {
  console.error(
    "Missing env vars. Required: BOT_USERNAME, BOT_OAUTH_TOKEN, WEBHOOK_URL, WEBHOOK_TOKEN"
  );
  process.exit(1);
}

// Optional: BOT_CHANNELS=channel1,channel2
const channelsEnv = (process.env.BOT_CHANNELS || "").trim();
const channels = channelsEnv
  ? channelsEnv
      .split(",")
      .map((c) => c.trim().replace(/^#/, "").toLowerCase())
      .filter(Boolean)
  : [];

const client = new tmi.Client({
  identity: {
    username: BOT_USERNAME,
    password: BOT_OAUTH_TOKEN,
  },
  channels,
  connection: {
    reconnect: true,
    secure: true,
  },
});

const cooldowns = new Map();
const COOLDOWN_MS = 30000;

client.connect().catch((err) => console.error("Connect error:", err));

client.on("connected", (addr, port) => {
  console.log(`✅ Connected to ${addr}:${port}`);
  console.log(`🤖 Logged in as: ${BOT_USERNAME}`);
  console.log(`📺 Channels: ${channels.length ? channels.join(", ") : "(none set)"} `);
});

client.on("message", async (channel, tags, message, self) => {
  if (self) return;

  const username = tags.username;
  const userId = tags["user-id"];
  const channelName = channel.replace("#", "");
  const lower = message.trim().toLowerCase();

  if (!lower.startsWith("!chain ") && !lower.startsWith("!cuhz ")) return;

  const prompt = message.trim().split(" ").slice(1).join(" ").trim();

  if (!prompt || prompt.toLowerCase() === "help") {
    client.say(
      channel,
      `@${username} Usage: !chain <prompt> | Example: !chain astronaut with CUHZ chain`
    );
    return;
  }

  // cooldown per user per channel
  const key = `${channelName}:${userId}`;
  const now = Date.now();
  const last = cooldowns.get(key) || 0;

  if (now - last < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
    client.say(channel, `@${username} Cooldown active! Try again in ${remaining}s.`);
    return;
  }
  cooldowns.set(key, now);

  try {
    client.say(channel, `@${username} Generating...`);

    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: WEBHOOK_TOKEN,
        channel: channelName,
        user: { id: userId, name: username },
        text: message,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data.handled) {
      const reply = data.reply || "Done!";
      const url = data.imageUrl ? ` ${data.imageUrl}` : "";
      client.say(channel, `@${username} ${reply}${url}`);
    } else {
      client.say(channel, `@${username} ${data.error || `Error (${res.status})`}`);
    }
  } catch (err) {
    console.error("Webhook error:", err);
    client.say(channel, `@${username} Bot error. Try again later.`);
  }
});

client.on("disconnected", (reason) => {
  console.log("❌ Disconnected:", reason);
});

process.on("SIGINT", () => {
  console.log("Shutting down...");
  client.disconnect();
  process.exit(0);
});
