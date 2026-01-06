# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-01-05
### Added
- **Smart Mode (Stream Awareness)**: Bot now polls Twitch API every 60s to check stream status.
- **Dynamic Authentication**: Automatically fetches `Client-ID` from OAuth token validation (no config changes needed).
- **Live-Only Timers**: Rotational timers (12m) now ONLY fire if the stream is live (prevents offline spam).
- **Real Uptime**: `!uptime` now calculates duration since the *actual stream start time*, not bot boot time.

## [1.1.0] - 2026-01-05
### Changed
- **Major**: Pivot to **Non-Crypto** bot. All token, contract, and coin-related commands have been removed.
- **Timers**: Implemented a 12-minute rotational timer cycling through Brand -> Links -> Discord -> Whitepaper -> Chain Gen.
- **Commands**: 
    - Added Planet CUHZ suite: `!cuhz`, `!links`, `!discord`, `!whitepaper`, etc.
    - Added Moderator tools: `!announce`, `!raid`.
    - Updated `!help` to reflect new command list.
- **Architecture**: Core logic (commands/timers) moved to in-memory handling in `src/bot.js` for immediate reliability.

### Removed
- Removed `!token`, `!contract`, `!ca`, `!price`.
- Removed crypto-based promotional timers.

## [1.0.2] - 2026-01-05
### Added
- **Shoutout Command (`!so`)**: Users can now type `!so username` to automatically generate a shoutout with a Twitch link.
- **Reason Command (`!reason`)**: Custom command acknowledging the channel owner fourareason4.
- **Mock API**: Created `src/mock_dashboard.js` for local testing.
- **Logging**: Integrated structured logger in `src/logger.js`.
