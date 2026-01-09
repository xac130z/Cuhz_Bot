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

*Built for the CUHZ community. 🌌*
