import sql from "@/app/api/utils/sql";
import logError from "@/app/api/utils/log-error";
import { upload } from "@/app/api/utils/upload";
import {
  ensureDiscordUserColumns,
  sendDiscordWebhook,
} from "@/app/api/utils/discord";

export async function POST(request) {
  try {
    const body = await request.json();
    const { prompt, style, clientId } = body || {};

    if (!prompt) {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }

    // Get user from cookie
    const cookies = request.headers.get("cookie") || "";
    const userIdMatch = cookies.match(/twitch_user_id=([^;]+)/);
    let user = null;
    let userTwitchId = null;

    if (userIdMatch) {
      const userId = userIdMatch[1];
      // Ensure discord columns exist before selecting
      await ensureDiscordUserColumns();
      const users = await sql`
        SELECT id, twitch_id, username, role, ai_limit_override, plan, subscription_status, discord_webhook_url, discord_auto_post
        FROM users 
        WHERE id = ${userId} 
        LIMIT 1
      `;
      user = users[0] || null;
      userTwitchId = user?.twitch_id || null;
    }

    // Check daily limits
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dailyLimit = 10; // Default limit
    let todayCount = 0;

    if (user) {
      // Unlimited for Pro or active subscription
      const isPro = user.plan === "pro";
      const isActiveSub = ["active", "trialing", "past_due"].includes(
        user.subscription_status || "",
      );

      if (user.role === "admin" || isPro || isActiveSub) {
        dailyLimit = 0; // Unlimited
      } else if (user.ai_limit_override !== null) {
        dailyLimit = user.ai_limit_override; // Custom limit override
      }

      if (dailyLimit > 0) {
        // Check user's daily usage
        const todayGenerations = await sql`
          SELECT COUNT(*) as count
          FROM chain_generations 
          WHERE user_twitch_id = ${userTwitchId}
          AND created_at >= ${today.toISOString()}
          AND method = 'ai'
        `;

        todayCount = parseInt(todayGenerations[0]?.count || 0);

        if (todayCount >= dailyLimit) {
          return Response.json(
            {
              error: `Daily limit reached. You can generate ${dailyLimit} images per day.`,
              dailyLimit,
              todayCount,
            },
            { status: 429 },
          );
        }
      }
    } else {
      // Anonymous user - use client_id for tracking
      if (!clientId) {
        return Response.json(
          { error: "Client ID is required for anonymous users" },
          { status: 400 },
        );
      }

      const todayGenerations = await sql`
        SELECT COUNT(*) as count
        FROM chain_generations 
        WHERE client_id = ${clientId}
        AND created_at >= ${today.toISOString()}
        AND method = 'ai'
        AND user_twitch_id IS NULL
      `;

      todayCount = parseInt(todayGenerations[0]?.count || 0);

      if (todayCount >= dailyLimit) {
        return Response.json(
          {
            error: `Daily limit reached. Anonymous users can generate ${dailyLimit} images per day. Sign in with Twitch for your personal limit.`,
            dailyLimit,
            todayCount,
          },
          { status: 429 },
        );
      }
    }

    // Call Stable Diffusion V3 integration
    const params = new URLSearchParams({
      prompt: prompt,
      width: "1024",
      height: "1024",
    });

    // ADD: timebox the integration call so requests can't hang forever
    const controller = new AbortController();
    const timeoutMs = 25_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(
        `/integrations/stable-diffusion-v-3/?${params.toString()}`,
        {
          method: "GET",
          signal: controller.signal,
        },
      );
    } catch (e) {
      const aborted =
        e?.name === "AbortError" ||
        String(e?.message || "")
          .toLowerCase()
          .includes("abort");

      await logError({
        request,
        scope: "ai_generate",
        code: aborted ? "SD_TIMEOUT" : "SD_FETCH_FAILED",
        message: aborted
          ? `Stable Diffusion timed out after ${timeoutMs}ms`
          : e?.message || "Stable Diffusion fetch failed",
        user,
        metadata: { prompt, style, clientId },
      });

      return Response.json(
        {
          configured: true,
          error:
            "AI image generation is taking too long right now. Please try again in a moment.",
        },
        { status: 504 },
      );
    } finally {
      clearTimeout(timeout);
    }

    // If the integration isn't configured, Anything typically returns a 404.
    if (response.status === 404) {
      await logError({
        request,
        scope: "ai_generate",
        code: "SD_NOT_CONFIGURED",
        message: "Stable Diffusion V3 integration not found (404)",
        user,
        metadata: { prompt, style, clientId },
      });
      return Response.json(
        {
          configured: false,
          error:
            "AI image generation is not set up yet. Please enable the Stable Diffusion V3 integration in Anything → Integrations.",
        },
        { status: 503 },
      );
    }

    if (!response.ok) {
      await logError({
        request,
        scope: "ai_generate",
        code: `SD_API_${response.status}`,
        message: `Stable Diffusion API error: ${response.status}`,
        user,
        metadata: { prompt, style, clientId },
      });
      throw new Error(`Stable Diffusion API error: ${response.status}`);
    }

    const data = await response.json();
    const imageUrlRaw = data?.data?.[0];

    if (!imageUrlRaw) {
      await logError({
        request,
        scope: "ai_generate",
        code: "NO_IMAGE_URL",
        message: "No image URL returned from Stable Diffusion",
        user,
        metadata: { prompt, style, clientId, response: data },
      });
      throw new Error("No image URL returned from Stable Diffusion");
    }

    // ADD: re-host the generated image via Anything's upload service so it can be drawn to canvas + downloaded reliably
    // (many third-party image hosts don't send the CORS headers needed for canvas.toDataURL)
    let imageUrl = imageUrlRaw;
    try {
      const uploaded = await upload({ url: imageUrlRaw });
      if (uploaded?.url) {
        imageUrl = uploaded.url;
      }
    } catch (e) {
      // Don't fail generation just because re-hosting failed
      try {
        await logError({
          request,
          scope: "ai_generate",
          code: "REHOST_FAILED",
          message: e?.message || "Failed to re-host AI image",
          user,
          metadata: { imageUrlRaw },
        });
      } catch (_) {}
    }

    // Save generation to database (persist optional style if provided)
    await sql`
      INSERT INTO chain_generations (client_id, user_twitch_id, method, prompt, image_url, style)
      VALUES (${clientId || "anonymous"}, ${userTwitchId}, 'ai', ${prompt}, ${imageUrl}, ${style || null})
    `;

    const todayCountAfter = dailyLimit > 0 ? todayCount + 1 : null;

    // Auto-post to Discord if user has enabled it (non-blocking)
    if (user && user.discord_webhook_url && user.discord_auto_post) {
      try {
        await sendDiscordWebhook({
          webhookUrl: user.discord_webhook_url,
          content: `✨ New AI creation from ${user.username || "a user"}`,
          imageUrl,
          title: "CUHZ AI",
          description: [
            style ? `Style: ${style}` : null,
            prompt ? `Prompt: ${prompt}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
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
        configured: true,
        imageUrl: imageUrl,
        echo: { prompt, style },
        usage:
          dailyLimit === 0
            ? { isUnlimited: true }
            : { isUnlimited: false, dailyLimit, todayCount: todayCountAfter },
        user: user ? { username: user.username, role: user.role } : null,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error(err);
    try {
      await logError({
        request,
        scope: "ai_generate",
        code: "UNCAUGHT",
        message: err?.message || "Failed to generate image",
        metadata: {
          stack: err?.stack || null,
        },
      });
    } catch (_) {}
    return Response.json(
      {
        error: err.message || "Failed to generate image",
      },
      { status: 500 },
    );
  }
}
