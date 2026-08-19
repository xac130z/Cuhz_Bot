import { s as sql } from "./sql-BK77oGq6.js";
import "@neondatabase/serverless";
function normalizeChannelLogin(channel) {
  return String(channel || "").trim().toLowerCase().replace(/^#/, "").replace(/[^a-z0-9_]/g, "");
}
function generateVerifyCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
async function getCurrentTwitchUser(request) {
  const cookies = request.headers.get("cookie") || "";
  const match = cookies.match(/twitch_user_id=([^;]+)/);
  if (!match) return null;
  const userId = match[1];
  const rows = await sql`
    SELECT id, twitch_id, username, display_name
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;
  return rows[0] || null;
}
async function POST(request) {
  try {
    const user = await getCurrentTwitchUser(request);
    if (!user) {
      return Response.json({
        error: "Not authenticated"
      }, {
        status: 401
      });
    }
    const body = await request.json().catch(() => ({}));
    const channel = normalizeChannelLogin(body?.channel);
    if (!channel) {
      return Response.json({
        error: "Channel is required"
      }, {
        status: 400
      });
    }
    const existing = await sql`
      SELECT id, channel_login, status, verify_code
      FROM bot_channels
      WHERE channel_login = ${channel}
      LIMIT 1
    `;
    if (existing.length > 0) {
      const row = existing[0];
      if (row.status === "enabled") {
        return Response.json({
          success: true,
          channel: row.channel_login,
          status: "enabled",
          verifyCode: null,
          message: "Channel already verified. Bot should already be in your chat."
        });
      }
      if (row.status === "pending" && row.verify_code) {
        await sql`
          UPDATE bot_channels
          SET user_id = ${user.id}
          WHERE id = ${row.id}
        `;
        return Response.json({
          success: true,
          channel: row.channel_login,
          status: "pending",
          verifyCode: row.verify_code,
          message: "Channel already pending. Use the existing verify code."
        });
      }
      const nextCode = generateVerifyCode();
      await sql`
        UPDATE bot_channels
        SET status = 'pending', verify_code = ${nextCode}, user_id = ${user.id}, verified_at = NULL
        WHERE id = ${row.id}
      `;
      return Response.json({
        success: true,
        channel: row.channel_login,
        status: "pending",
        verifyCode: nextCode,
        message: "Channel set to pending. Verify in chat to enable."
      });
    }
    const verifyCode = generateVerifyCode();
    await sql`
      INSERT INTO bot_channels (channel_login, status, verify_code, user_id)
      VALUES (${channel}, 'pending', ${verifyCode}, ${user.id})
    `;
    return Response.json({
      success: true,
      channel,
      status: "pending",
      verifyCode,
      message: "Channel added. Verify in chat to enable."
    });
  } catch (err) {
    console.error("/api/bot/add-channel POST error", err);
    return Response.json({
      error: "Failed to add channel"
    }, {
      status: 500
    });
  }
}
export {
  POST
};
