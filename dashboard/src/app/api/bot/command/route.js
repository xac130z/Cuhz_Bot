import sql from "@/app/api/utils/sql";
import logError from "@/app/api/utils/log-error";
import { ensureTwitchBotUserColumns } from "@/app/api/utils/twitch-bot";

function parseCommand(text = "") {
  const t = (text || "").trim();
  const lower = t.toLowerCase();
  if (
    lower === "!cuhz" ||
    lower === "!cuhz help" ||
    lower === "!chain" ||
    lower === "!chain help"
  ) {
    return { cmd: "help" };
  }
  if (lower.startsWith("!cuhz ") || lower.startsWith("!chain ")) {
    const prompt = t.replace(/^!(cuhz|chain)\s*/i, "").trim();
    return { cmd: "generate", prompt };
  }
  return { cmd: "unknown" };
}

// NEW: used for bot-auth mode
function requireBotSecret(request) {
  const botSecret = process.env.BOT_API_SECRET;
  if (!botSecret) {
    return {
      ok: false,
      response: Response.json(
        { error: "Missing BOT_API_SECRET" },
        { status: 500 },
      ),
    };
  }

  const authHeader = request.headers.get("authorization") || "";
  if (authHeader !== `Bearer ${botSecret}`) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true };
}

function normalizeChannelLogin(channel) {
  return String(channel || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z0-9_]/g, "");
}

export async function POST(request) {
  try {
    await ensureTwitchBotUserColumns();

    const body = await request.json().catch(() => ({}));
    const { token, channel, user, text, style } = body || {};

    // NEW: accept bot-auth via Authorization header
    const authHeader = request.headers.get("authorization") || "";
    const isBotAuthAttempt = Boolean(authHeader);
    const botGate = isBotAuthAttempt ? requireBotSecret(request) : null;
    const isBotAuthed = Boolean(botGate && botGate.ok);

    if (!text) {
      return Response.json({ error: "Missing text" }, { status: 400 });
    }

    let owner = null;
    let authMode = "token";

    if (isBotAuthed) {
      authMode = "bot";
      const channelLogin = normalizeChannelLogin(channel);
      if (!channelLogin) {
        return Response.json(
          { handled: true, reply: "Missing channel" },
          { status: 400 },
        );
      }

      // Identify owner via enabled bot_channels record
      const rows = await sql`
        SELECT u.id, u.twitch_id, u.username, u.bot_enabled
        FROM bot_channels bc
        JOIN users u ON u.id = bc.user_id
        WHERE bc.channel_login = ${channelLogin}
          AND bc.status = 'enabled'
        LIMIT 1
      `;

      owner = rows[0] || null;
      if (!owner) {
        return Response.json(
          {
            handled: true,
            reply:
              "Bot is not enabled for this channel yet. Add it on the dashboard first.",
          },
          { status: 403 },
        );
      }

      // Safety check: respect user's bot_enabled flag
      if (!owner.bot_enabled) {
        return Response.json(
          { handled: true, reply: "Bot is disabled for this channel." },
          { status: 403 },
        );
      }
    } else {
      // Existing per-user token mode (keep working)
      if (!token) {
        // If Authorization header was present but wrong, return the correct error
        if (botGate && !botGate.ok) return botGate.response;
        return Response.json({ error: "Missing token" }, { status: 400 });
      }

      const rows = await sql`
        SELECT id, twitch_id, username, bot_enabled
        FROM users
        WHERE bot_webhook_token = ${token}
        LIMIT 1
      `;

      owner = rows[0] || null;
      if (!owner || !owner.bot_enabled) {
        return Response.json(
          { error: "Invalid token or bot disabled" },
          { status: 401 },
        );
      }
    }

    const parsed = parseCommand(text);

    if (parsed.cmd === "help") {
      return Response.json({
        handled: true,
        reply:
          "Commands: !cuhz help · !chain <prompt>. Examples: !chain astronaut with CUHZ chain",
      });
    }

    if (parsed.cmd === "generate") {
      const prompt = (parsed.prompt || "").trim();
      if (!prompt) {
        return Response.json({
          handled: true,
          reply: "Please provide a prompt: !chain <prompt>",
        });
      }

      // Treat viewer as anonymous client for daily limits; include channel to reduce collisions
      const viewerId = user?.id || user?.twitch_id || user?.name || "viewer";
      const clientId = `twitch:${viewerId}:${channel || ""}`.slice(0, 128);

      // Call internal AI generation endpoint (enforces daily limits for anonymous users)
      const res = await fetch("/api/chain/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, style: style || null, clientId }),
      });

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        const todayCount = data?.todayCount ?? "";
        const dailyLimit = data?.dailyLimit ?? "10";
        return Response.json({
          handled: true,
          reply: `Daily limit reached (${todayCount}/${dailyLimit}). Try again tomorrow or log in for higher limits: ${process.env.APP_URL || ""}`,
        });
      }

      if (!res.ok) {
        const textErr = await res.text().catch(() => "");
        await logError({
          request,
          scope: "twitch_bot",
          code: `GEN_FAIL_${res.status}`,
          message: textErr || "AI generation failed",
          metadata: {
            channel,
            viewerId,
            ownerId: owner?.id || null,
            prompt,
            authMode,
          },
        });
        return Response.json(
          { handled: true, reply: "Sorry, I couldn't make that right now." },
          { status: 200 },
        );
      }

      const data = await res.json().catch(() => ({}));
      const imageUrl = data?.imageUrl || null;
      const reply = imageUrl
        ? `Here you go → ${imageUrl}`
        : "Done. Check the gallery soon.";
      return Response.json({ handled: true, reply, imageUrl }, { status: 200 });
    }

    // Unknown or not for us
    return Response.json({ handled: false });
  } catch (err) {
    console.error("/api/bot/command error", err);
    try {
      await logError({
        request,
        scope: "twitch_bot",
        code: "UNCAUGHT",
        message: err?.message || "Bot command failed",
        metadata: { stack: err?.stack || null },
      });
    } catch (_) {}
    return Response.json({ error: "Bot command failed" }, { status: 500 });
  }
}
