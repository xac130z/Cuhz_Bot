import { s as sql } from "./sql-BK77oGq6.js";
import "@neondatabase/serverless";
function normalizeChannelLogin(channel) {
  return String(channel || "").trim().toLowerCase().replace(/^#/, "").replace(/[^a-z0-9_]/g, "");
}
async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const channel = normalizeChannelLogin(body?.channel);
    if (!channel) {
      return Response.json({
        error: "Twitch username is required"
      }, {
        status: 400
      });
    }
    const existing = await sql`
      SELECT id, channel_login, status, created_at
      FROM bot_requests
      WHERE channel_login = ${channel}
      LIMIT 1
    `;
    if (existing.length > 0) {
      const row = existing[0];
      const alreadyFulfilled = row.status === "fulfilled";
      const msg = alreadyFulfilled ? `CuhzBot has already been added to ${row.channel_login}.` : `✅ Request received! CuhzBot will be added to ${row.channel_login} in less than 48 hours for free.`;
      return Response.json({
        ok: true,
        channel: row.channel_login,
        status: row.status,
        message: msg
      });
    }
    await sql`
      INSERT INTO bot_requests (channel_login, status)
      VALUES (${channel}, 'requested')
    `;
    return Response.json({
      ok: true,
      channel,
      status: "requested",
      message: `✅ Request received! CuhzBot will be added to ${channel} in less than 48 hours for free.`
    });
  } catch (err) {
    console.error("/api/bot/request POST error", err);
    return Response.json({
      error: "Failed to save request"
    }, {
      status: 500
    });
  }
}
export {
  POST
};
