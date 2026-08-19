import { s as sql } from "./sql-BK77oGq6.js";
import "@neondatabase/serverless";
function requireBotSecret(request) {
  const botSecret = process.env.BOT_API_SECRET;
  if (!botSecret) {
    return {
      ok: false,
      response: Response.json({
        error: "Missing BOT_API_SECRET"
      }, {
        status: 500
      })
    };
  }
  const authHeader = request.headers.get("authorization") || "";
  if (authHeader !== `Bearer ${botSecret}`) {
    return {
      ok: false,
      response: Response.json({
        error: "Unauthorized"
      }, {
        status: 401
      })
    };
  }
  return {
    ok: true
  };
}
function normalizeChannelLogin(channel) {
  return String(channel || "").trim().toLowerCase().replace(/^#/, "").replace(/[^a-z0-9_]/g, "");
}
async function POST(request) {
  try {
    const gate = requireBotSecret(request);
    if (!gate.ok) return gate.response;
    const body = await request.json().catch(() => ({}));
    const channel = normalizeChannelLogin(body?.channel);
    const code = String(body?.code || "").trim().toUpperCase();
    if (!channel || !code) {
      return Response.json({
        error: "Missing channel or code"
      }, {
        status: 400
      });
    }
    const rows = await sql`
      UPDATE bot_channels
      SET status = 'enabled', verify_code = NULL, verified_at = NOW(), last_seen_at = NOW()
      WHERE channel_login = ${channel}
        AND status = 'pending'
        AND verify_code = ${code}
      RETURNING id, channel_login, status
    `;
    if (rows.length === 0) {
      return Response.json({
        success: false,
        message: "Invalid code, wrong channel, or already verified."
      });
    }
    return Response.json({
      success: true,
      channel: rows[0].channel_login,
      status: rows[0].status,
      message: `Channel ${rows[0].channel_login} verified!`
    });
  } catch (err) {
    console.error("/api/bot/verify POST error", err);
    return Response.json({
      error: "Verification failed"
    }, {
      status: 500
    });
  }
}
export {
  POST
};
