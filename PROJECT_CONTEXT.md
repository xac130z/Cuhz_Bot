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
- **Non-Crypto First**: All crypto/token features have been explicitly removed. Focus is on Brand, Creator Tools, and Community.
- **In-Memory Logic**: Core commands and timers are currently handled in `src/bot.js` for reliability.
- **Rotational Timers**: Messages cycle every 12 minutes to avoid spam (Website -> Links -> Discord -> Whitepaper -> Chain Gen).
- **Dashboard Integration**: Polling enabled for channel management, with local fallback configs.

## Current State
- [x] **Non-Crypto Command Suite**: Implemented `!cuhz`, `!links`, `!discord`, `!uptime`, `!credits`, `!help` etc.
- [x] **Moderator Tools**: `!announce`, `!raid`, `!so` (Shoutout).
- [x] **Timers**: 12-minute rotational engagement messages.
- [x] **Local Mock API**: Available for testing via `USE_MOCK_API=true`.

## Known Issues
- **Dashboard API Verification**: `POST /api/bot/verify` returns 400 (investigation needed on server side), but this does not block bot connectivity.

## Future Roadmap
1. **Deploy to Railway**: Push latest Non-Crypto V1 to production.
2. **Dynamic Help**: Update `!help` to pull directly from a CMS or external config (optional future enhancement).
