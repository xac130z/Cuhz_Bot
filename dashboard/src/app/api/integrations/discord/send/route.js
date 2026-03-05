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
    SELECT id, twitch_id, username, display_name, discord_webhook_url
    FROM users WHERE id = ${userId} LIMIT 1
  `;
  return rows[0] || null;
}

export async function POST(request) {
  try {
    await ensureDiscordUserColumns();
    const user = await getCurrentUser(request);
    if (!user)
      return Response.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { generationId, imageUrl, prompt, method, style } = body || {};

    let img = imageUrl;
    let meta = {
      prompt: prompt || null,
      method: method || null,
      style: style || null,
    };

    if (generationId) {
      const rows = await sql`
        SELECT id, image_url, prompt, method, style, user_twitch_id
        FROM chain_generations WHERE id = ${generationId} LIMIT 1
      `;
      const row = rows[0];
      if (!row)
        return Response.json(
          { error: "Generation not found" },
          { status: 404 },
        );

      // Only allow posting own images
      const twitchIdRows =
        await sql`SELECT twitch_id FROM users WHERE id = ${user.id} LIMIT 1`;
      const twitchId = twitchIdRows[0]?.twitch_id || null;
      if (row.user_twitch_id && twitchId && row.user_twitch_id !== twitchId) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      img = row.image_url;
      meta = { prompt: row.prompt, method: row.method, style: row.style };
    }

    if (!img) return Response.json({ error: "Missing image" }, { status: 400 });

    const webhookUrl = user.discord_webhook_url;
    if (!webhookUrl) {
      return Response.json(
        { error: "Discord webhook not configured" },
        { status: 400 },
      );
    }

    const title = meta.method ? `CUHZ ${meta.method.toUpperCase()}` : "CUHZ";
    const description = [
      meta.style ? `Style: ${meta.style}` : null,
      meta.prompt ? `Prompt: ${meta.prompt}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const res = await sendDiscordWebhook({
      webhookUrl,
      content: `📣 New creation from ${user.display_name || user.username || "a user"}`,
      imageUrl: img,
      title,
      description,
    });

    if (!res.ok) {
      await logError({
        request,
        scope: "discord_send",
        code: "WEBHOOK_FAILED",
        message: res.error || "Webhook request failed",
      });
      return Response.json(
        { error: res.error || "Failed to send to Discord" },
        { status: 502 },
      );
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("discord send POST", err);
    try {
      await logError({
        request,
        scope: "discord_send",
        code: "UNCAUGHT",
        message: err?.message || "Failed",
        metadata: { stack: err?.stack || null },
      });
    } catch (_) {}
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
