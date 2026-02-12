# Cuhz Bot: Technical Overview & Implementation Summary

*For integration with Cuhz Dashboard*

## 🚀 Core Architecture: The "Tri-Brain" System
We have implemented a sophisticated AI routing system (`ai_service.js` & `context_handler.js`) that uses three distinct "brains":
1.  **EYES (Gemini Flash)**: Fast, low-latency responses for general questions and !ask commands.
2.  **BRAIN (Claude 3.5 Sonnet)**: High-intelligence reasoning for complex queries (accessed via `!ask -brain`).
3.  **HANDS (Qwen 2.5 Coder)**: Specialized code generation for the `!code` command.

## 💎 Cuhz Economy (Points System)
A robust SQLite-backed economy (`points_service.js`):
- **Earning**: Users earn points passively by chatting.
- **Spending**: AI commands have variable costs (10-50 points) based on the "Brain" used.
- **Incentives**: Follower bonuses (`!claim`) and gambling (`!gamble`).
- **Persistence**: Detailed ledger tracking every transaction for transparency.

## 🛡️ Mod Intelligence & Health
Advanced monitoring for stream health (`mod_intel.js` & `mood_tracker.js`):
- **Chat Health**: Real-time analysis of Mood, Energy, and Toxicity levels.
- **Reporting**: Automated `!chatreport` for mods to see current stream vibes.
- **Dynamic Personality**: Bot can switch between Hype, Chill, and Moderated modes.

## 👑 Master User Commands
A dedicated system for community regulars:
- **Directory**: `!shoutouts` lists all community VIP commands.
- **Support-First**: Automatic detection of users asking "how to get a command" or "how to change my message," directing them to official support email.
- **Silent Fallbacks**: The bot remains silent on unknown commands to prevent spam.

## 🕐 Smart Optimization
- **Live-Only Timers**: Automated messages only fire when the stream is actually LIVE (verified via Twitch Helix API).
- **Proactive AI**: The bot has a "CUHZ Keyword Boost," jumping into conversations more naturally when community keywords are mentioned.
- **Smart Throttling**: 45-second per-user cooldown to prevent AI spam.

## 🔗 Key API Integrations
- **Twitch Helix API**: Fully updated with the latest Follower API requirements (requires `moderator_id`).
- **Custom Backend**: Ready for synchronization with the central Planet CUHZ API for cross-platform point tracking.
