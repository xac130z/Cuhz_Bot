# Antigravity Agent: Project Context

> [!NOTE]
> This file is the "Memory" of the project. It is intended to be the first file read by any AI assistant to understand the project's state without needing previous conversation history.

## Documentation Links
- [Changelog](file:///Users/DeveloperOps/Desktop/Antigravity%20Agent/CHANGELOG.md): Detailed history of every change made.
- [Walkthrough](file:///Users/DeveloperOps/.gemini/antigravity/brain/ff9b0445-11a1-458b-989b-9b49f8d37192/walkthrough.md): Summary of the most recent work.
- [Brand Analysis](file:///Users/DeveloperOps/.gemini/antigravity/brain/ff9b0445-11a1-458b-989b-9b49f8d37192/brand_analysis.md): Details on Planet Cuhz brand.

## Overview
A Twitch bot built with `tmi.js` and `express`, fully integrated with the Planet CUHZ ecosystem. It serves as a community engagement tool, automated marketing assistant, and bridge to the Anything.com dashboard.

## Key Architectures & Decisions
- **Non-Crypto First**: All crypto/token features have been explicitly removed.
- **Smart Mode (Stream Aware)**: Bot automatically detects if the stream is Live via Twitch API (polling every 60s).
- **Live-Only Timers**: Marketing timers (12m interval) ONLY fire when the channel is live.
- **Dynamic Auth**: Client ID is fetched dynamically from the OAuth token to enable API calls without manual config.

## Current State
- [x] **Smart Features**: `!uptime` shows real stream duration; Timers pause when offline.
- [x] **Non-Crypto Command Suite**: `!cuhz`, `!links`, `!discord`, etc.
- [x] **Moderator Tools**: `!announce`, `!raid`, `!so` (Shoutout).
- [x] **Local Mock API**: Enhanced to simulate Twitch Auth & Helix Streams APIs.

## Known Issues
- **Dashboard API Verification**: `POST /api/bot/verify` returns 400 (investigation needed on server side), but this does not block bot connectivity.

## Future Roadmap
1. **Dynamic Help**: Update `!help` to pull directly from a CMS or external config (optional future enhancement).
