import sql from "@/app/api/utils/sql";
import { upload } from "@/app/api/utils/upload";
import logError from "@/app/api/utils/log-error";
import {
  ensureDiscordUserColumns,
  sendDiscordWebhook,
} from "@/app/api/utils/discord";

// Persist a composed image (canvas) as a generation row
// POST /api/chain/save-upload
// body: { image: dataURL(base64 png), style?: string, clientId?: string }
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { image, style, clientId } = body || {};

    if (!image || typeof image !== "string" || !image.startsWith("data:")) {
      return Response.json(
        { error: "Missing or invalid image data" },
        { status: 400 },
      );
    }

    // Read current user from cookie (set by Twitch callback)
    const cookies = request.headers.get("cookie") || "";
    const userIdMatch = cookies.match(/twitch_user_id=([^;]+)/);

    let user = null;
    let userTwitchId = null;

    if (userIdMatch) {
      const userId = userIdMatch[1];
      await ensureDiscordUserColumns();
      const rows = await sql`
        SELECT id, twitch_id, username, discord_webhook_url, discord_auto_post FROM users WHERE id = ${userId} LIMIT 1
      `;
      user = rows[0] || null;
      userTwitchId = user?.twitch_id || null;
    }

    // Upload the base64 data URL to our upload service to get a persistent URL
    const { url: imageUrl, mimeType } = await upload({ base64: image });

    if (!imageUrl) {
      await logError({
        request,
        scope: "save_upload",
        code: "UPLOAD_NO_URL",
        message: "Upload service did not return a URL",
        user,
        metadata: { style, clientId },
      });
      throw new Error("Upload service did not return a URL");
    }

    // Persist generation. Keep prompt metadata for backwards compatibility and persist style in dedicated column
    const promptMeta = style ? `upload(style:${style})` : "upload";

    await sql`
      INSERT INTO chain_generations (client_id, user_twitch_id, method, prompt, image_url, style)
      VALUES (${clientId || "anonymous"}, ${userTwitchId}, 'upload', ${promptMeta}, ${imageUrl}, ${style || null})
    `;

    // Auto-post to Discord if enabled (non-blocking)
    if (user && user.discord_webhook_url && user.discord_auto_post) {
      try {
        await sendDiscordWebhook({
          webhookUrl: user.discord_webhook_url,
          content: `🖼️ New upload from ${user.username || "a user"}`,
          imageUrl,
          title: "CUHZ Upload",
          description: style ? `Style: ${style}` : undefined,
        });
      } catch (e) {
        try {
          await logError({
            request,
            scope: "discord_send",
            code: "UNCAUGHT",
            message: e?.message || "Discord auto-post failed",
          });
        } catch (_) {}
      }
    }

    return Response.json(
      {
        ok: true,
        imageUrl,
        method: "upload",
        prompt: promptMeta,
        style: style || null,
        user: user ? { id: user.id, username: user.username } : null,
        mimeType: mimeType || null,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("save-upload error", err);
    try {
      await logError({
        request,
        scope: "save_upload",
        code: "UNCAUGHT",
        message: err?.message || "Failed to save image",
        metadata: { stack: err?.stack || null },
      });
    } catch (_) {}
    return Response.json(
      { error: err.message || "Failed to save image" },
      { status: 500 },
    );
  }
}
