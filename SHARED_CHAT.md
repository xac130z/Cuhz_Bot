# Shared-chat response safety

CUHZ Bot processes a shared-chat message only in its originating channel.
Twitch relays the resulting IRC response across the shared chat; the bot does
not generate a second response in each receiving channel.

- `source-room-id != room-id`: ignore the mirrored delivery before context,
  memory, awards, commands, welcomes, or AI processing.
- Claim `source-id` (or ordinary `id`) synchronously before asynchronous work.
  The in-process replay cache holds at most 20,000 IDs for 10 minutes. It is not
  a durable exactly-once ledger and does not survive restarts.
- Ignore the configured bot account by login or validated Twitch user ID, even
  when a mirrored echo has `self=false`.
- Reserve in-flight AI requests per user before the first await, retaining the
  existing successful-response 60-second cooldown and releasing on failure.
- Normalize repeated leading recipient tags. Other mentions are preserved.
- Do not add auto-welcomes or auto-shoutouts to direct questions/commands. Known
  bot accounts do not trigger context-aware replies or auto-shoutouts.
- AI replies use the existing spaced outbound queue.

This intentionally does not execute requests originating in a channel the bot
has not joined: mirrored moderator badges and the destination channel's paid
tier must not authorize operations in a different source channel. It does not
change other scheduled timers or Twitch event announcement handlers.

## Verification

`npm run test:shared-chat` runs isolated assertions, including the actual bot
message handler with I/O spies: one original + mirrored copies + replay + bot
echo produces one reply, one memory entry and one ordinary chat award. Tests
also cover reverse delivery order, concurrent AI requests, error recovery,
cache bounds/expiry, commands, and recipient formatting.

Authenticated `/health/full` includes aggregate `sharedChatGuard` counters;
no message content or user identifiers are added to these counters.

Reference: https://dev.twitch.tv/docs/chat/irc/#shared-chat
