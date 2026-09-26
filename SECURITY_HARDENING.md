# CUHZ Bot stream-security hardening

## Secure defaults

- Viewer text is treated as untrusted data before it reaches an AI model.
- Model responses pass deterministic output validation before Twitch egress.
- Public links and public facts come from `src/safety_policy.js`.
- Proactive AI, CUHZ voice, chat-triggered payments, points gambling, and raw chat retention are disabled by default.
- Raw chat storage is opt-in and retention is bounded to 1–30 days (7 by default).
- The dashboard cannot send IRC slash commands through `/send-message`.
- Dashboard control endpoints require a configured bearer secret, bounded JSON, exact channel syntax, and an approved origin.
- The public health response does not expose channel names, stream state, or logs.

## Production enablement gates

Do not enable `ENABLE_CUHZ_VOICE` until an operator-only speech queue exists with preview, maximum duration, queue limits, output moderation, and an emergency stop. Viewer chat must never flow directly to text-to-speech.

Do not enable `ENABLE_CHAT_PAYMENTS` until checkout uses a fixed allowlisted HTTPS destination and server-verified payment webhooks. CUHZ Bot must never collect payment credentials, wallet secrets, passwords, or account tokens in Twitch chat. AI-generated prices and payment instructions are blocked.

Keep `ENABLE_GAMBLING=false` for production unless the owner completes a separate policy review. The command is hidden from help and returns an unavailable status while disabled.

`!build` and `!services` are request-only. `!shop`, `!tools`, and `!audit` report conservative unavailable states and make no price, availability, or delivery promises.

Do not enable `STORE_CHAT_CONTENT` without publishing a retention notice and confirming that stored content is necessary. Profile counts continue to work without raw message retention.

## Required deployment work

1. Review the approved facts and links in `src/safety_policy.js` with the owner.
2. Configure strong unique Railway secrets; do not paste them into the repository.
3. Rotate existing bot/dashboard webhook tokens because legacy tokens were generated with `Math.random()`.
4. Keep the new feature flags false for the first rehearsal.
5. Run `npm test` and `npm audit --omit=dev` in the deploy build.
6. Rehearse in a private/test channel before updating the live Railway service.

No deployment or secret rotation was performed by this hardening change.
