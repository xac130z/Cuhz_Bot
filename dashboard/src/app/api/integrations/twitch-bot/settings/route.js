import sql from "@/app/api/utils/sql";
import logError from "@/app/api/utils/log-error";
import {
  ensureTwitchBotUserColumns,
  generateBotToken,
} from "@/app/api/utils/twitch-bot";

async function getCurrentUser(request) {
  const cookies = request.headers.get("cookie") || "";
  const userIdMatch = cookies.match(/twitch_user_id=([^;]+)/);
  if (!userIdMatch) return null;
  const userId = userIdMatch[1];
  const rows = await sql`
    SELECT id, twitch_id, username, display_name, role, plan, subscription_status,
           bot_enabled, bot_webhook_token
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function GET(request) {
  try {
    await ensureTwitchBotUserColumns();
    const user = await getCurrentUser(request);
    if (!user)
      return Response.json({ error: "Not authenticated" }, { status: 401 });

    return Response.json({
      bot_enabled: Boolean(user.bot_enabled),
      bot_webhook_token: user.bot_webhook_token || null,
    });
  } catch (err) {
    console.error("twitch-bot settings GET", err);
    try {
      await logError({
        request,
        scope: "twitch_bot_settings",
        code: "UNCAUGHT",
        message: err?.message || "Failed to load bot settings",
      });
    } catch (_) {}
    return Response.json(
      { error: "Failed to load bot settings" },
      { status: 500 },
    );
  }
}

export async function PATCH(request) {
  try {
    await ensureTwitchBotUserColumns();
    const user = await getCurrentUser(request);
    if (!user)
      return Response.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { enabled, regenerateToken } = body || {};

    let nextEnabled =
      typeof enabled === "boolean" ? enabled : Boolean(user.bot_enabled);
    let nextToken = user.bot_webhook_token || null;

    if (nextEnabled && (!nextToken || regenerateToken)) {
      nextToken = generateBotToken();
    }

    await sql`
      UPDATE users
      SET bot_enabled = ${nextEnabled}, bot_webhook_token = ${nextToken}
      WHERE id = ${user.id}
    `;

    return Response.json({
      ok: true,
      settings: { bot_enabled: nextEnabled, bot_webhook_token: nextToken },
    });
  } catch (err) {
    console.error("twitch-bot settings PATCH", err);
    try {
      await logError({
        request,
        scope: "twitch_bot_settings",
        code: "UNCAUGHT",
        message: err?.message || "Failed to save bot settings",
        metadata: { stack: err?.stack || null },
      });
    } catch (_) {}
    return Response.json(
      { error: "Failed to save bot settings" },
      { status: 500 },
    );
  }
}
