# Antigravity Agent (Cuhz Bot)

The official Twitch engagement bot for the Planet CUHZ ecosystem. Built with `tmi.js`, `express`, and `better-sqlite3`.

## 🚀 Features

- **Smart Mode**: Automatically detects stream status and only sends marketing timers when live.
- **Dynamic Persona**: Fetches commands and timers from a dashboard API (local or remote).
- **Moderation Tools**: Streamlined commands for announcements, raids, and shoutouts.
- **Multi-Channel Support**: Can join multiple channels and manage separate configs for each.

## 🛠 Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Variables**:
   Copy `.env.example` to `.env` and fill in your credentials:
   - `BOT_OAUTH_TOKEN`: Your Twitch Bot OAuth token.
   - `BOT_USERNAME`: The Twitch username of the bot.
   - `API_BASE`: URL of the dashboard API.
   - `BOT_API_SECRET`: Shared secret for API authentication.

3. **Initialize Database**:
   ```bash
   node src/database.js
   ```

4. **Run Local Mock API (Optional)**:
   ```bash
   npm run dev:mock
   ```

5. **Start the Bot**:
   ```bash
   npm start
   ```

## 📜 Commands

### Public Commands
| Command | Description |
| --- | --- |
| `!cuhz` | Main link to Planet CUHZ |
| `!links` | Linktree for the ecosystem |
| `!discord` | Official Discord invite |
| `!uptime` | Show how long the stream has been live |
| `!hype` | Random hype message |
| `!help` | List available commands |
| `!ping` | Connectivity check |
| `!points` | Check your CUHZ points balance |

### Moderator Commands
| Command | Description |
| --- | --- |
| `!announce [msg]` | Sends a beautiful announcement |
| `!so [user]` | Gives a shoutout to the specified user |
| `!raid [user]` | Initiates a raid to another channel |
| `!ban [user]` | Bans a user from chat |
| `!timeout [user] [sec]`| Times out a user (default 600s) |
| `!clear` | Clears the chat history |
| `!slow [sec]` | Enables slow mode |
| `!slowoff` | Disables slow mode |

### Owner Commands
| Command | Description |
| --- | --- |
| `!status` | Checks bot status and stream detect state |

## 🌐 Dashboard Integration

The bot integrates with Anything.com via a REST API:
- `GET /api/bot/channels`: Returns a list of channels to join.
- `GET /api/bot/commands/:channel`: Returns custom commands for a channel.
- `GET /api/bot/timers/:channel`: Returns rotational timers for a channel.
- `POST /api/bot/verify`: Verifies the bot has successfully joined a channel.

## 🚢 Deployment Guide (Anything.com)

1. **Upload Code**: Push this repository to your preferred Git provider.
2. **Environment Config**: Set all variables from `.env.example` in your deployment platform (e.g., Railway).
3. **Database**: The bot uses SQLite by default. Ensure your environment has a persistent volume for `/data` if using SQLite, or migrate to PostgreSQL.
4. **Health Check**: Use the `/health` endpoint to monitor bot connectivity.

---
*Built for the CUHZ community.*
