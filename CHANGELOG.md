# Changelog

All notable changes to this project will be documented in this file.

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
- Dashboard exploration: Investigated Anything.com dashboard structure and API integration points.
- **Mock API**: Created `src/mock_dashboard.js` for local testing.
- **Logging**: Integrated structured logger in `src/logger.js`.

### Fixed
- Fixed a syntax error in `src/bot.js` that occurred during bot initialization.
- Improved `src/bot.js` logic to correctly fall back to `.env` channels if the dashboard API returns an empty list.

## [1.0.1] - 2026-01-04
### Added
- Created `PROJECT_CONTEXT.md` to maintain persistent project state between AI sessions.
- Added **Multi-Channel Support**: Use a comma-separated list in `TWITCH_CHANNEL_NAME` within the `.env` file.
- Added `CHANGELOG.md` (this file) to track project history.

## [1.0.0] - Initial State
- Basic Twitch bot setup using `tmi.js` and `express`.
- Dashboard integration structure.
- Docker configuration.
