import sql from "@/app/api/utils/sql";
import logError from "@/app/api/utils/log-error";
import {
  ensureDiscordUserColumns,
  sendDiscordWebhook,
} from "@/app/api/utils/discord";

async function getCurrentUser(request) {
  const cookies = request.headers.get("cookie") || "";
  const userIdMatch = cookies.match(/twitch_user_id=([^;]+)/);
  if (!userIdMatch) return null;
  const userId = userIdMatch[1];
  const rows = await sql`
    SELECT id, twitch_id, username, display_name, role, plan, subscription_status,
           discord_webhook_url, discord_auto_post
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function GET(request) {
  try {
    await ensureDiscordUserColumns();
    const user = await getCurrentUser(request);
    if (!user)
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    return Response.json({
      discord_webhook_url: user.discord_webhook_url || null,
      discord_auto_post: Boolean(user.discord_auto_post),
    });
  } catch (err) {
    console.error("discord settings GET", err);
    try {
      await logError({
        request,
        scope: "discord_settings",
        code: "UNCAUGHT",
        message: err?.message || "Failed to load settings",
      });
    } catch (_) {}
    return Response.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    await ensureDiscordUserColumns();
    const user = await getCurrentUser(request);
    if (!user)
      return Response.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { webhookUrl, autoPost, test } = body || {};

    // Normalize values
    const nextUrl =
      webhookUrl === "" ? null : webhookUrl || user.discord_webhook_url || null;
    const nextAuto =
      typeof autoPost === "boolean"
        ? autoPost
        : Boolean(user.discord_auto_post);

    await sql`
      UPDATE users
      SET discord_webhook_url = ${nextUrl}, discord_auto_post = ${nextAuto}
      WHERE id = ${user.id}
    `;

    // Optional test send
    if (test && nextUrl) {
      const res = await sendDiscordWebhook({
        webhookUrl: nextUrl,
        content: `🔔 Test from Planet Cuhz — Hi ${user.display_name || user.username || "there"}!`,
      });
      if (!res.ok) {
        return Response.json(
          {
            ok: false,
            tested: false,
            error: res.error || "Webhook test failed",
          },
          { status: 400 },
        );
      }
    }

    return Response.json({
      ok: true,
      settings: { discord_webhook_url: nextUrl, discord_auto_post: nextAuto },
    });
  } catch (err) {
    console.error("discord settings PATCH", err);
    try {
      await logError({
        request,
        scope: "discord_settings",
        code: "UNCAUGHT",
        message: err?.message || "Failed to save settings",
        metadata: { stack: err?.stack || null },
      });
    } catch (_) {}
    return Response.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
