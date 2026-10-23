# Antigravity Agent (Cuhz Bot)

> **The Official Twitch Engagement Bot for Planet CUHZ**  
> Built with `tmi.js`, `express`, and `better-sqlite3`

📌 **Quick Navigation:**
- 🎯 **[STATUS.md](file:///Users/DeveloperOps/Desktop/Antigravity%20Agent/STATUS.md)** - What's done, what's next
- 📚 **[DOCUMENTATION.md](file:///Users/DeveloperOps/Desktop/Antigravity%20Agent/DOCUMENTATION.md)** - Documentation index

---

## 📖 Overview

The **Antigravity Agent** is a Twitch bot fully integrated with the Planet CUHZ ecosystem. It serves as a community engagement tool, automated marketing assistant, and bridge to the Anything.com dashboard.

### Core Mission
To provide a welcoming, high-energy, and creator-focused experience embodying the "Cosmic Family" aesthetic ("From 'cousin' to 'cuhz'").

### Key Architecture & Design Decisions
- **Non-Crypto First**: All crypto/token features have been explicitly removed.
- **Smart Mode (Stream Aware)**: Bot automatically detects if the stream is Live via Twitch API (polling every 60s).
- **Live-Only Timers**: Marketing timers ONLY fire when the channel is live.
- **Dynamic Auth**: Client ID is fetched dynamically from the OAuth token to enable API calls without manual config.
- **Multi-Channel Support**: Can join multiple channels and manage separate configs for each.

---

## 🚀 Features

### Core Capabilities
- ✅ **Smart Mode**: Automatically detects stream status and only sends marketing timers when live.
- ✅ **Dynamic Persona**: Fetches commands and timers from a dashboard API (local or remote).
- ✅ **Non-Crypto Command Suite**: Full suite of brand-safe commands (`!cuhz`, `!links`, `!discord`, etc.).
- ✅ **Moderation Tools**: Complete mod suite including `!ban`, `!unban`, `!timeout`, `!untimeout`, `!clear`, `!slow`, `!announce`, `!raid`, `!so`.

### Engagement Features
- ✅ **CUHZ Points**: `!points` command to track user engagement (💎 CUHZ points).
- ✅ **Welcome Messages**: Automated greeting for returning users (>24h since last seen).

### AI Features (NEW! 🤖)
- ✅ **Mood Detection**: Real-time sentiment analysis of chat messages (positive, negative, neutral, hype, toxic).
- ✅ **Context-Aware Responses**: Understands natural language questions without exact command syntax.
- ✅ **Personality Adjustment**: Bot tone automatically changes based on chat energy and mood.
- ✅ **Auto-Hype Injection**: Triggered automatically when chat energy is low.
- ✅ **Toxicity Detection**: Alerts moderators when chat toxicity levels are high.
- ✅ **Smart Caching**: Reduces AI API calls through intelligent response caching.

### Auto-Shoutout System (NEW! 🎬)
- ✅ **Automatic Shoutouts**: Auto-shoutout fellow streamers when they join your chat.
- ✅ **24-Hour Cooldown**: Prevents spam by only shouting out each streamer once per day.
- ✅ **Whitelist Management**: Mods can add/remove streamers from the auto-shoutout list.
- ✅ **Shoutout Tracking**: Counts total shoutouts given to each streamer.

### Infrastructure
- ✅ **Database**: SQLite with `better-sqlite3` (`data/bot.db`).
- ✅ **API Routes**: Express endpoints for dashboard communication.
- ✅ **Mock API**: Local testing environment to simulate Twitch Auth & Helix Streams APIs.
- ✅ **Error Handling**: Global exception handlers.
- ✅ **Logging**: Structured logging system.
- ✅ **Health Checks**: `/health` endpoint for monitoring.

### Dashboard Integration
- ✅ SQLite database implemented (`data/bot.db`).
- ✅ Dynamic API routes for channels, commands, and timers.
- ✅ Bot successfully fetches channel-specific personas and **intervals** from API.
- ✅ `#fourareason4` interval set to **45 minutes** with brand-specific social links (Instagram, TikTok, X).
- ✅ Other channels set to **1 hour (60 minutes)**.

---

## 🛠 Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
Copy `.env.example` to `.env` and fill in your credentials:
- `BOT_OAUTH_TOKEN`: Your Twitch Bot OAuth token.
- `BOT_USERNAME`: The Twitch username of the bot.
- `TWITCH_CHANNEL_NAME`: Comma-separated list of channels to join (e.g., `fourareason4,planetcuhz`).
- `API_BASE`: URL of the dashboard API (e.g., `https://cuhz-bot-dashboard-846.created.app`).
- `BOT_API_SECRET`: Shared secret for API authentication.
- `USE_MOCK_API`: Set to `true` for local testing, `false` for production.

**AI Features (Optional):**
- `GEMINI_API_KEY`: Get your free API key at [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
- `ENABLE_MOOD_DETECTION`: Set to `true` to enable mood tracking (default: true)
- `ENABLE_CONTEXT_AWARE`: Set to `true` to enable context-aware responses (default: true)
- `MOOD_ANALYSIS_INTERVAL`: Seconds between mood analyses (default: 120)

> **Note**: AI features work without a Gemini API key using fallback sentiment analysis, but context-aware responses require the API key.

### 3. Initialize Database
```bash
node src/database.js
```

### 4. Run Local Mock API (Optional)
```bash
npm run dev:mock
```

### 5. Start the Bot
```bash
npm start
```

---

## 📜 Commands

### Public Commands
| Command | Description |
| --- | --- |
| `!cuhz` | Main link to Planet CUHZ |
| `!links` | Linktree for the ecosystem |
| `!discord` | Official Discord invite |
| `!dashboard` | Link to add CUHZ Bot to your channel |
| `!uptime` | Show how long the stream has been live |
| `!hype` | Random hype message |
| `!help` | List available commands |
| `!followage` | Check how long you've been following the channel |
| `!ping` | Connectivity check |
| `!points` | Check your CUHZ points balance |

### AI Commands (NEW! 🤖)
| Command | Description | Access |
| --- | --- | --- |
| Natural questions | Ask questions naturally (e.g., "how do I join discord?") | Everyone |
| `!mood` | Shows current chat sentiment analysis | Mods |
| `!personality [mode]` | Manually set bot personality (hype, chill, supportive, neutral, moderated) | Mods |
| `!aistats` | View AI usage statistics | Owner |

### Moderator Commands
| Command | Description |
| --- | --- |
| `!announce [msg]` | Sends a beautiful announcement |
| `!so [user]` | Gives a shoutout to the specified user |
| `!title [text]` | Changes the stream title |
| `!game [name]` | Changes the stream category/game |
| `!botcheck` | Verifies bot status and token permissions |
| `!refresh` | Forces a reload of persona data from the dashboard |
| `!addstreamer` | Add user to auto-shoutout whitelist |
| `!removestreamer`| Remove user from auto-shoutout whitelist |
| `!liststreamers`| List all whitelisted auto-shoutout streamers |
| `!raid [user]` | Initiates a raid to another channel |
| `!ban [user]` | Bans a user from chat |
| `!unban [user]` | Unbans a user |
| `!timeout [user] [sec]`| Times out a user (default 600s) |
| `!untimeout [user]` | Removes a timeout |
| `!clear` | Clears the chat history |
| `!slow [sec]` | Enables slow mode |
| `!slowoff` | Disables slow mode |

### Auto-Shoutout Commands (NEW! 🎬)
| Command | Description | Access |
| --- | --- | --- |
| `!addstreamer [user]` | Add a streamer to auto-shoutout list | Mods |
| `!removestreamer [user]` | Remove a streamer from auto-shoutout list | Mods |
| `!liststreamers` | View all streamers on auto-shoutout list with counts | Mods |

### Owner Commands
| Command | Description |
| --- | --- |
| `!status` | Checks bot status and stream detect state |

---

## ⏱ Timer Configuration

The bot uses a rotational timer to send marketing and engagement messages. Intervals are managed as follows:

- **Global Default**: The bot respects per-timer intervals from the database (Default is 60 minutes if not specified).
- **Custom Intervals**: Individual timer intervals can be customized in the `timers` table of the SQLite database.
- **Bulk Updates**: Use `node update_timers.js` to quickly set specific intervals for all channels.
- **Smart Mode**: Regardless of the interval, timers **only** fire when the stream is detected as Live (polled every 60s).

### Current Timer Intervals (Staggered Flow)

**`#fourareason4`** (Social Media Links):
- Instagram: 60 minutes
- TikTok: 45 minutes  
- X/Twitter: 75 minutes

**`#planetcuhz`** (Brand Links):
- Planet CUHZ website: 60 minutes
- Linktree: 60 minutes

**`#rico_santanax`** (Brand Links):
- Planet CUHZ website: 60 minutes
- Linktree: 60 minutes

**Flow Pattern:** The staggered intervals (60min → 45min → 75min) create a natural rhythm that keeps chat engaged without overwhelming viewers.

---

## 🌐 Dashboard Integration

The bot integrates with Anything.com via a REST API:
- `GET /api/bot/channels`: Returns a list of channels to join.
- `GET /api/bot/commands/:channel`: Returns custom commands for a channel.
- `GET /api/bot/timers/:channel`: Returns rotational timers for a channel.
- `GET /api/bot/settings/:channel`: Returns channel settings (auto_welcome, auto_marketing).
- `POST /api/bot/verify`: Verifies the bot has successfully joined a channel.

---

## 🚢 Deployment Guide

### Railway Deployment

1. **Upload Code**: Push this repository to your preferred Git provider (GitHub recommended).

2. **Environment Config**: Set all variables from `.env.example` in your Railway project settings:
   - `BOT_OAUTH_TOKEN`: `oauth:your_real_token`
   - `BOT_USERNAME`: `your_bot_username`
   - `TWITCH_CHANNEL_NAME`: `fourareason4,planetcuhz,rico_santanax`
   - `API_BASE`: `https://cuhz-bot-dashboard-846.created.app`
   - `BOT_API_SECRET`: (Contact admin for the production secret)
   - `USE_MOCK_API`: `false`

3. **Persistent Volume**: 
   - In Railway, add a **Volume** and mount it to `/data`.
   - This ensures your SQLite database (`bot.db`) persists across deployments.

4. **Health Check**: 
   - Once deployed, visit `https://your-railway-url/health` to confirm the bot is connected and joining channels.

5. **Dashboard Sync**: 
   - Log in to `https://cuhz-bot-dashboard-846.created.app/admin` and verify that the marketing intervals are reflected in the global settings.

For detailed deployment steps, see [`.agent/workflows/deploy.md`](file:///Users/DeveloperOps/Desktop/Antigravity%20Agent/.agent/workflows/deploy.md).

---

## 🔧 Known Issues

- **Dashboard API Verification**: `POST /api/bot/verify` returns success in local mock, but requires testing on production anything.com server.

---

## 💎 Stream Commerce & Tier Sync (Wave 6)

Bridges CUHZ Bot to the Planet Cuhz site's Stripe-backed entitlements so paid
viewers get their promised in-chat perks — and, optionally, so verified purchases
can get a thank-you. **Everything here is default-OFF behind flags and fails open
to `community` on any error.** Honest states only: an unknown viewer is always
`community`, prices come only from the code-owned `commerce_content.js` registry
(never the AI), and the bot never claims a payment state from chat. NO crypto.

### Two ladders, never touching
- **CUHZ Bot tiers** (viewers): Community FREE · Silver $4.99/mo · Gold $14.99/mo,
  plus the streamer Affiliate Pack $49.99/mo and quote-only Architect build.
- **Site membership** (separate): Free · Pro $9.99/mo · Team $24.99/mo.

Buying one never changes the other — bot tiers are their own DB entitlements
(`bot_silver`/`bot_gold`/`bot_affiliate`) and deliberately don't touch site
membership. `!mytier` reports only the bot ladder.

### How it works
- `src/tier_service.js` resolves a viewer's tier from the site's `bot-worker-sync`
  edge function (batched, 10-min cache, 3s timeout, fail-open). Contract shapes
  mirror that function exactly: `{ event:'entitlements', logins:[...] }` →
  `{ viewers: { login: { products, bot_tier } } }`.
- Perks (gated by tier resolution): Silver/Gold get free/discounted AI brains, a
  `💎✅` Verified Cuhz badge, monthly point stipends (Silver +1,000 / Gold +5,000,
  idempotent per month via `pointsService.claimBonus`), and Gold gets a custom
  arrival + bounded priority on the AI limiter.
- `src/commerce_content.js` owns the `!plans !silver !gold !affiliate !architect
  !mytier !site !store !pro` command copy and the promo / thank-you line pools.
- The purchase watcher polls `{ event:'entitlements_recent', since }` every 60s
  (home channels, live-only, ≤1 shout-out per 5 min) and dedupes by
  `entitlement_id` in the `announced_purchases` SQLite table so a restart never
  double-announces.

### CUHZ points — the model (Wave 6 points fix)

Loyalty points for the community — never currency, never crypto, no cash value.
The full model is documented in the `src/points_service.js` header; the short
version:

- **One global balance** per Twitch username across every channel the bot is in.
  Each ledger row records the channel it happened in (`points_ledger.channel`,
  added by a boot-time migration-in-code) purely for auditability.
- **Earn (real configured rates, single source `pointsService.EARN`):** +1 per
  chat message · +10 activity bonus at most once per 10 minutes while you keep
  chatting · +300 one-time `!claim` follow bonus · monthly Silver +1,000 / Gold
  +5,000 stipends (idempotent per calendar month via `claimBonus`).
- **Spend (`pointsService.COSTS`):** `!ask` 10 · `!ask -brain` 50 · `!code` 25,
  with the published tier perks (Silver: base `!ask` free, brain 80% off → 10;
  Gold: all free) applied in `bot.js`. `deductPoints` is atomic — the balance
  check lives inside the UPDATE, so spends can never overdraw.
- **Persistence:** `users.points` is the balance cache, `points_ledger` the
  append-only source of truth; both survive restarts and every query is
  dialect-safe on sqlite AND Postgres. Points never expire and never reset.
- **What was broken before this fix:** the "passive paycheck" parsed UTC DB
  timestamps as local time and never fired (and only paid users who went silent
  10–30 min); `!top` used SQLite-only `datetime()` and was dead on Railway
  Postgres; `!pointsinfo` advertised rates that didn't match the code; deduct
  and claim had check-then-write races. `!points` / `!pointsinfo` copy is now
  built from the `EARN`/`COSTS` constants so displayed rates can't drift again.

### New environment variables
`SITE_API_*` are a **different trust domain** from the created.app dashboard's
`BOT_API_SECRET`/`API_BASE` — never reuse or confuse them.

| Var | Meaning |
| --- | --- |
| `SITE_API_URL` | Supabase functions base, e.g. `https://<project-ref>.functions.supabase.co` |
| `SITE_API_SECRET` | The **value** of the site's `bot-worker-sync` `BOT_API_SECRET` secret |
| `ENABLE_TIER_SYNC` | `false` — resolve viewer tiers + grant perks/stipends |
| `ENABLE_COMMERCE_COMMANDS` | `false` — the `!plans` command family + promo rotation line (Premium only) |
| `ENABLE_PURCHASE_SHOUTOUTS` | `false` — consent-gated purchase thank-yous in home channels |
| `ENABLE_GOLD_POINTS_2X` | `false` — reserved; do NOT enable until the perk is published on the ladder |
| `ENABLE_KEYWORD_REPLIES` | `false` — one short, code-owned keyword-intent reply on non-command chat (home surfaces, live-only, hard-cooldowned) |
| `ENABLE_ROSTER_SYNC` | `false` — self-serve join: auto-join channels streamers approve on the site, part revoked ones (see below) |

### Owner go-live order (do this by hand — nothing auto-deploys)
1. In Supabase, confirm the Stripe bot-tier price ids are configured (checkout
   stops returning `PRICE_NOT_CONFIGURED`), then `supabase functions deploy
   bot-worker-sync` (it now serves the two read-only tier events; no new secret).
2. In **Railway**, set `SITE_API_URL` and `SITE_API_SECRET` on the bot.
3. Flip `ENABLE_TIER_SYNC=true`, redeploy, and soak — verify `!mytier` and that
   Silver/Gold perks resolve. Any site hiccup silently falls back to community.
4. Flip `ENABLE_COMMERCE_COMMANDS=true`, redeploy, and soak — verify `!plans`,
   the promo rotation line (Premium only), and the site-pointed `!store`/`!build`.
5. Decide the consent posture, then optionally flip `ENABLE_PURCHASE_SHOUTOUTS=true`
   and redeploy. Leave `ENABLE_GOLD_POINTS_2X=false` until that perk is published.

Each flag is independent and secure-off; a Railway redeploy is always the owner's
hand on the button.

### Putting CUHZ Bot in its own channel's chat

The bot chooses which chats to join from the **`TWITCH_CHANNEL_NAME`** env var
(`src/config.js` → `config.channels`, consumed in `src/bot.js` at client init).
**To put CUHZ Bot in its own channel's chat, set `TWITCH_CHANNEL_NAME=<channel-login>`
on Railway** (the channel login is the bare name, no `#` — the config adds it).

**Multi-channel join IS supported.** `TWITCH_CHANNEL_NAME` is comma-separated, so
`TWITCH_CHANNEL_NAME=cuhzbot,planetcuhz,somestreamer` joins all three (each entry
is trimmed, lowercased, and `#`-prefixed automatically). Two other sources are
merged on top of this at startup: any channels returned by the dashboard API, and
every channel in the code's `CHANNEL_TIERS` map (force-joined even if not in the
dashboard). If nothing is configured anywhere, the bot logs `No channels
configured to join!` and sits idle. A Railway redeploy applies the change.

### Self-serve roster-sync (`ENABLE_ROSTER_SYNC`, default-OFF)

`src/roster_service.js` makes the **planetcuhz.com self-serve flow real**: a
streamer requests CUHZ Bot on the site → the site records an `approved`
`bot_request` → the bot **auto-joins that channel** (and **parts** it when the
streamer revokes). It reconciles the site's desired-state against the channels
the bot is actually in, so no human has to edit env vars per streamer.

- **Contract (`bot-worker-sync`, exact field names).** It polls `GET
  /bot-worker-sync` (Bearer `SITE_API_SECRET`) for the desired list:
  `{ channels: [ { id, twitch_user_id, twitch_login, status, is_mod,
  channel_bot_granted, can_send, blocked_reason, last_seen_at } ] }` (status in
  `approved` | `active`). It reports lifecycle back with the same shapes the
  edge function accepts: `{ id, event:'joined', twitch_login, is_mod, can_send }`,
  `{ id, event:'parted' }`, `{ id, event:'error', message }`, and a batch
  `{ event:'heartbeat', ids:[...] }` (≤500) every ~60s.
- **Reconcile loop.** Every ~30s (jittered): desired-but-not-joined → **join**
  (+ report `joined`); joined-but-`approved` → confirm `joined` so the site flips
  it `active`; in-our-roster-but-no-longer-desired → **part** (+ report `parted`).
- **Join pacing.** JOINs are held under Twitch's limit (**≤15 JOINs / 10s**,
  ≤10 per cycle, spaced) with a per-channel exponential backoff on failure (a
  failed join reports `error` and does **not** enter the roster).
- **PROTECTED env channels.** Every channel in `TWITCH_CHANNEL_NAME` is
  **never parted** by roster-sync, even if it is absent from desired-state.
  Roster-sync only ever parts channels it *itself* joined via the site.
- **Fail-open.** If the site is unreachable/misconfigured, the bot **keeps its
  current roster**, never crashes chat, and retries with exponential backoff. A
  site outage never joins or parts anything.
- **Persisted roster.** The last-known roster (login + the site's request `id`)
  lives in the SQLite/Postgres `roster_channels` table, so a Railway restart can
  still emit an honest `parted` for a channel revoked while the bot was down.
  Env channels are never stored here.

**Channel-tier note (important):** channels joined via roster-sync default to the
**Basic / free experience**. Roster-sync **never** adds a channel to
`CHANNEL_TIERS`, and the message path already falls through to `TIERS.BASIC` for
any unlisted channel (`CHANNEL_TIERS[channel] || TIERS.BASIC`). So a self-serve
channel gets **no Pro/Premium surfaces** — no marketing rotation, no `!plans`
commerce family (Premium-gated), no premium-only behaviors — unless it is
explicitly promoted in `CHANNEL_TIERS`, or a viewer's own paid entitlement lifts
*that viewer* via `tier_service.js`. Pro surfaces are never auto-granted to a
channel just because the bot joined it.

### Keyword-intent replies (`ENABLE_KEYWORD_REPLIES`, default-OFF)

`src/keyword_listener.js` adds an optional, code-owned reply on **non-command**
chat. It runs last in the message path (after every command handler and webhook
forwarding), only on **home/selling surfaces** (Pro/Premium — never Basic, which
are other streamers' chats), and only when the flag is on.

- **Intents** (word-boundary regexes, first match wins): `price` (`price`, `cost`,
  `how much`, `subscribe`, `sub tier`), `help` (`help`, `how do i`, `how does`),
  `what_question` (message starts with `what` **and** has a `?` or mentions the
  bot), `bot_mention` (mentions the bot **and** has a `?`).
- **Replies** come from a fixed registry in `keyword_listener.js` — short cuhz-voice
  lines pointing only at `!plans` / `!mytier` / `!help` / `planetcuhz.com`. They
  carry **no prices** (prices live only in `commerce_content.js`) and every line
  passes `safety_policy.validateOutbound` (re-applied by `sendMessage`).
- **Hard rails:** ≥45s cooldown per intent, ≥5min per user, ≤1 keyword reply per
  60s overall, never replies to other bots/self (`KNOWN_BOTS` + the bot's own
  names), never fires on a `!command`, and live-only (mirrors the marketing
  rotation's live-gate; `USE_MOCK_API` stands in for live locally). A blocked
  attempt never burns a cooldown.

### Reviewing chat logs (Railway logs vs the DB)

Two independent surfaces, for two different jobs:

- **Railway logs = live ops.** `node fetch_chat_history.js` shells out to
  `npx railway logs --limit 15000 --service "Twitch Bot"`, writes the raw stream to
  `railway_logs_dump.txt`, and parses `PRIVMSG #<channel>` lines into a unique-chatter
  list. Run `npx railway login` first (the script checks `npx railway status` and
  exits if you're not authed). This shows the bot's recent **operational** stream —
  connects, sends, errors, and whatever chat lines are still in the buffer — not a
  durable, queryable history. (The `PROJECT_ID` / `ENV_ID` / `CHANNEL` / date
  constants near the top of the script are hard-coded and edited by hand per pull.)
- **DB (`chat_log`) = "Cuhz language" study.** When `STORE_CHAT_CONTENT=true`,
  `userMemory.recordMessage` (`src/user_memory.js`) inserts each message into the
  **`chat_log`** table (`channel, username, message, is_command, created_at`;
  indexes `idx_chat_log_channel_time`, `idx_chat_log_username`). Raw storage is
  **opt-in and pruned** to `CHAT_RETENTION_DAYS` (1–30, default 7). Related tables:
  **`user_profiles`** (per-user totals, `last_seen`, follower/sub flags) and
  **`mood_history`**. Query it with the DB adapter (`src/database.js`): SQLite at
  `data/bot.db` locally, or the Railway Postgres `DATABASE_URL` in prod — e.g.
  `SELECT username, message, created_at FROM chat_log WHERE channel = '#planetcuhz'
  AND is_command = 0 ORDER BY created_at DESC LIMIT 200;`.

**Recommended flow:** use **Railway logs for live ops** (is the bot up, is it
sending, what errored right now), and use the **DB / `fetch_chat_history` path for
"Cuhz language" study** (how the community actually talks, for tuning replies) —
but only while `STORE_CHAT_CONTENT` is intentionally on, and mind the retention
window.

---

## 🧭 Future Roadmap

1. **Dynamic Help**: Update `!help` to pull directly from a CMS or external config.
2. **Point Leaderboard**: `!leaderboard` command to show top CUHZ point earners.
3. **Stream Milestones**: Automated announcements for follower/sub goals.
4. **Advanced Analytics**: Dashboard for viewing user engagement metrics.
5. **Metaverse Integration**: Expansion of the CUHZ ecosystem into virtual spaces.

---

## 📚 Additional Documentation

- **[STATUS.md](file:///Users/DeveloperOps/Desktop/Antigravity%20Agent/STATUS.md)** - Current status, what's done, what's next
- **[DOCUMENTATION.md](file:///Users/DeveloperOps/Desktop/Antigravity%20Agent/DOCUMENTATION.md)** - Complete documentation index
- **[CHANGELOG.md](file:///Users/DeveloperOps/Desktop/Antigravity%20Agent/CHANGELOG.md)** - Version history
- **[BRAND_AND_CAPABILITIES.md](file:///Users/DeveloperOps/Desktop/Antigravity%20Agent/BRAND_AND_CAPABILITIES.md)** - Planet CUHZ brand guide

---

## 🧭 Canon

`docs/CANON.mirror.json` is a **read-only, version-stamped mirror** of the single source of truth for Planet CUHZ prices, tiers, links, and brand — `SITE/canon/canon.json` (site repo: `vqnc-labs-website`, path `Planet Cuhz/Planet Cuhz Website/canon/canon.json`). Do not hand-edit the mirror; a product fact (price, tier, link, spelling, mark) is born and changed only in the site's `canon.json`, then propagated here on the next sync wave. If this bot's links/prices ever disagree with the canon, that's a bug in the bot, never in the canon. Canonical Discord invite: `https://discord.gg/eNxDKkxQdN`.

---

*Built for the CUHZ community. 🌌*


## Authenticated Lounge command runtime — October 20, 2026

The existing Express process can now mount the reviewed Lounge server package from `vendor/cuhz-lounge`. `src/lounge_v2_adapter.js` loads it only on explicit startup, preserves raw signed EventSub requests, cookies and SSE, and never converts IRC badges into trusted control events. IRC `!lounge` provides safe guidance; the signed home-channel webhook performs authorized actions. Results are available in the signed-in private inbox at `/api/lounge/v2/chat/inbox`.

All new activation flags default off. When V2 is enabled, old command aliases and the legacy website writer cannot control the old stage, including during a V2 failure. Explicit legacy mode is owner-only and starts locked. The owner-only first-test policy below supersedes earlier member rollout plans. Existing `/lounge` and `/lounge/` OBS pages and static assets continue to return HTTP 200. New `/stage` is a separate source; source migration is attended.

### Deploy configuration and preflight

Inject values privately at deploy; never commit credentials. Use the existing Supabase project and Twitch OAuth application. No migration, role, EventSub subscription, provider request or flag is created on import.

- `LOUNGE_V2_ENABLED`: exact `true` to mount; absent/false stays inert.
- `LOUNGE_PUBLIC_ORIGIN`: canonical HTTPS website origin. `LOUNGE_INGRESS_HOST` may explicitly name the Railway host used by the same-origin proxy. Forwarded host headers grant no trust.
- `LOUNGE_DATABASE_URL`: existing Lounge/Supabase SQL database, not the bot Points database. Verified TLS is mandatory; weakening URL options are rejected. Pool size is two.
- `LOUNGE_SUPABASE_URL`, `LOUNGE_SUPABASE_PUBLISHABLE_KEY`: existing auth upstream.
- `LOUNGE_AUTH_SEALING_KEY`: server-only 32-byte key, canonical 43-character base64url.
- `LOUNGE_EVENTSUB_SECRET`: separate 32–100 character random ASCII secret for the reviewed webhook; optional `LOUNGE_EVENTSUB_SUBSCRIPTION_ID` pins that exact subscription. Callback is `/api/lounge/v2/stage/chat`. Signed challenges and durable revocations are supported; no subscription is registered automatically.
- `LOUNGE_RULES_VERSION`: exact accepted policy version.
- `LOUNGE_OBS_RESERVED_ENABLED=true` enables two protected read-only OBS stream slots, separate from the20 public slots. It requires `LOUNGE_OBS_SIGNING_KEY`, a separate32-byte base64url key (43characters), distinct from the auth sealing key. No token is issued on startup; private coordinator helper `createObsStreamAccess({key,origin}).mint()` returns an audience-bound capability, default14hours/max16hours. Pass it only in the trusted source fragment `/stage/obs#token=<capability>`. The renderer sends it to the dedicated same-origin stream; redact that query in ingress/access logs. Rotate the dedicated key to invalidate capabilities, and issue a fresh capability deliberately for a later show; no automatic renewal. It cannot control the stage, read member data or start generation.
- `LOUNGE_STAGE_ENABLED`, `LOUNGE_PILOT_ENABLED`, `LOUNGE_PILOT_MANAGEMENT_ENABLED`, `LOUNGE_STAGE_BRIDGE_ENABLED`: explicit booleans, with independent durable SQL flags and actor permissions. Pilot mode does not create a grant, start the two-week pilot, publish an opening or issue a booking.
- Private artwork serving/import also requires `LOUNGE_STORAGE_BUCKET` and server-only `LOUNGE_STORAGE_SERVICE_KEY`. No public bucket is created.

This host supports reviewed owner/finite-pilot stage wiring. `LOUNGE_GENERATION_CHAT_ENABLED=true` is refused until funded dollar admission/moderation is connected. `LOUNGE_SUBSCRIPTION_ENABLED=true` is refused until the existing P1 broadcaster monitor is explicitly integrated. A deployment must not turn those unfinished paths into an unlimited entitlement. No spoken voice provider is selected or started.

Startup verifies the required schema/RPCs and service authority before serving authenticated traffic. Apply reviewed additive schema separately from the website repository, including `20261020010000_lounge_chat_inbox.sql` and `20261020020000_lounge_eventsub_transport.sql`, after all their predecessors. Do not point new code at an older schema. New migrations enable no roles or flags.

### Verification and release gate

Run `npm run test:lounge-v2` for the HTTP adapter. The existing isolated boot, Lounge control/web/wiring/hosting, readiness, Points and shared-chat suites cover the surrounding bot. `npm run check:lounge-bundle` verifies every manifest-listed source/asset file against the canonical website checkout. To regenerate, use `npm run sync:lounge -- /absolute/path/to/website/application`; outside the shared workspace supply that reviewed source checkout explicitly. The bundle includes worker-thread decoder assets and pins `pngjs`7.0.0. It starts no second cloud service.

Live acceptance remains separate: review the exact source/schema release; route website auth/API paths to this process while sending OBS SSE directly to Railway; bind the owner's freshly verified website identity to the approved owner role; verify signed chat, private results, stage changes, reconnect and emergency hold. Enable and rehearse the separate signed OBS lane before public exposure;20 public connections cannot consume its two slots. Pending admissions share one read, and stop/restart cannot publish an old epoch. Verify ingress query redaction and actual OBS/resource behavior. Keep funded generation off until the reset/window, $8 currency ceiling, moderation and real private-output/reconciliation checks pass. Roll back by disabling V2 and redeploying the previous reviewed image; retain additive data and explicitly review whether legacy mode should resume.


2026-10-20 cutover hardening: valid owner bookmarks/reloads now reach both operator consoles through exact read-only HTML bootstrap. Neighboring APIs, assets and mutations retain Origin/CSRF checks. Combined website suite444/444, bot adapter15/15 and local HTTP/SQL/SSE/private-inbox rehearsal pass. Hosted read-only preflight still reports required V2 tables/RPCs absent; no production activation has occurred.


## Owner-only recovery release — October 23, 2026

The first live test permits only the owner's freshly verified Planet CUHZ Twitch identity. Previous Phoenix/member/team pilot permissions are suspended until explicit new approval. This release introduces an additional single-identity denial gate shared by web controls, signed chat, emergency controls, stage review/activity and booking check-in. Existing server authentication, SQL roles, consent, leases, revisions and replay rules still apply; the setting does not grant a role.

- `LOUNGE_OWNER_CONTROL_ENABLED=true` and `LOUNGE_OWNER_TWITCH_ID=<freshly verified numeric ID>` are required for control. Missing/false binding denies control. Malformed IDs fail startup; names, CSV lists, badges and broadcaster role cannot substitute. Historical source identifies `planetcuhz` as `1293717308`; verify the current signed identity before configuring it. `175727753` is the CUHZ Bot home channel, not the owner.
- `LOUNGE_PILOT_ENABLED=true` and `LOUNGE_PILOT_MANAGEMENT_ENABLED=true` are rejected during this release. There is no switch to open team control. Keep booking, pilot, stage bridge, delivery, subscriptions and paid generation disabled unless their exact owner-only acceptance step is deliberately configured.
- The canonical `/stage` presentation now includes bundled existing world/host artwork. `/stage/obs` retains the reserved signed read-only transport. Canonical website proxies `/stage` and `/stage/*` to the same bot; legacy `/lounge` paths remain. No OBS scene has been changed by source integration.
- `npm run sync:lounge` copies the exact transitive runtime closure plus two fixed WebP scene assets and the single pinned owner catalog PNG; `npm run check:lounge-bundle` verifies source bytes and manifest. This is a local source package until deployment and real-account/OBS evidence are recorded in the ecosystem recovery report.

For the initial stage-only rehearsal, signed owner commands `!lounge hold`, `!lounge resume`, and `!lounge next` use the existing operator role. `!lounge show <item>` still requires ordinary eligibility and a current booked lease. Reveal requires an existing consented, published, verified public library derivative and configured storage ports; the bundled brand background does not create a library approval. The exact `/lounge/delivery` page is routed to V2 while legacy `/lounge` sources remain intact; delivery stays disabled.

### Preparing the first owner artwork

`LOUNGE_OWNER_CURATED_ENABLED` defaults to false. Enabling it requires the exact
owner binding, `LOUNGE_STAGE_BRIDGE_ENABLED`, existing private storage, and the
separately reviewed additive migration
`20261023050000_lounge_owner_curated_artwork.sql`. Startup checks the new tables
and RPCs, then verifies that the configured existing storage bucket is private
before starting timers. The durable `library.curated.enabled` and `library.review.enabled`
flags also remain independently required. The feature grants no role or consent.

The protected `/api/lounge/v2/stage-bridge/curated/ops` page prepares one pinned
existing Planet CUHZ logo. Import preserves the original privately, verifies
the decoded PNG, strips metadata from the presentation derivative, and checks
both stored hashes. It creates no generated job, quota usage, membership, lease,
Points transaction or provider request. The server requires stage hold for a
fresh import, review submission and approval. Keep it held until the attended
reveal; recovering a completed receipt does not repeat publication.

The freshly authenticated owner needs the scoped durable `review:decide`
permission as well as the immutable owner binding. Image-specific adult,
rights and publication consent are explicit; import and consent do not approve
or display the image. Approval is a separate action in the existing review queue.
The public credit says “Owner-curated artwork” and “Presented by”, without
claiming the logo was generated in the Lounge or made in Chain Studio.

If a response is lost, use the saved request ID to recover the same operation.
The console preserves an unresolved receipt across same-owner sign-in and does
not submit automatically. A historical receipt does not restore revoked
publication. After approval, the attended owner can resume/select the image
through the existing signed Twitch controls. To withdraw, hold the stage first,
then use the native owner console's withdrawal button to revoke publication
and verify that the public feed and
asset are removed before disabling bridge, auth or owner controls. Disabling
the curated workflow flag does not withdraw already-approved artwork. No live
image or permission is provisioned by copying this source package.

Authentication bootstrap also requires the website build gates
`VITE_LOUNGE_AUTH_BROKER_ENABLED=true` and `VITE_LOUNGE_ELIGIBILITY_ENABLED=true`,
with durable `auth.broker_enabled`; stage control separately needs durable
`stage.enabled`. These switches do not enable pilot or subscription access.
The freshly signed-in owner must explicitly accept the same rules version used
by the host and durable stage policy. The hosted read-only preflight on October
23 verified `lounge-v2` and the private `lounge-assets` bucket; recheck both at
cutover. A rules-connected owner may correctly see `ELIGIBILITY_DISABLED` while
member access stays closed. Role changes revoke existing sessions and require
a fresh sign-in. Keep reserved OBS disabled during bootstrap unless its distinct
signing key is already configured, and verify the real signed EventSub chat
subscription before the attended rehearsal; startup creates neither.


### Terminal Twitch command receipts

Stage activation now requires the separately reviewed website migration
`20261023060000_lounge_stage_chat_terminal.sql`. Authentication-only bootstrap
still supports the existing eleven-migration schema. Apply only the selected
reviewed migration, with stage held and old stage processes disabled; then deploy
the matching package before enabling stage. The migration deliberately retires
legacy split command preparation and separately sent stage acknowledgements,
including old calls already executing during cutover. It grants no authority.

Each admitted signed stage command has one atomic result, stage effect and private
receipt. A command refused for missing website sign-in stays refused after login;
send a new command in CUHZ Bot chat. A lost response recovers the original result.
Inbox capacity can delay its delivery without re-executing the command. Invalid,
stale, rate-limited or capacity-refused requests are not durable admissions.

Identifiable results expire after30days. Disconnect synchronously deletes their
recipient associations. Bounded maintenance purges expired rows and retries only
saved private delivery, including while the hosted stage process flag is off.
A complete hosting outage delays physical cleanup until maintenance resumes.
Only unlinked security digests remain, with a hard1,000,000-key cap; no user,
command, result or timestamp columns remain in that set. At capacity, unseen
commands fail closed. Never delete or rotate those digests to restore capacity.

Rollback: hold first, then disable stage/owner/OBS process gates and preserve
additive schema plus replay protection. Rolling back to an older package does
not restore its retired chat protocol. Never restore legacy prepare or erase
security digests as a compatibility workaround. Verify hosted denial, fresh
command, duplicate, disconnect and attended Twitch-to-OBS outcomes separately.
