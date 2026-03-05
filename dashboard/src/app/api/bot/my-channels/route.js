import sql from "@/app/api/utils/sql";

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

export async function GET(request) {
  try {
    const user = await getCurrentTwitchUser(request);
    if (!user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const rows = await sql`
      SELECT id, channel_login, status, verify_code, created_at, verified_at
      FROM bot_channels
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 50
    `;

    return Response.json({ channels: rows });
  } catch (err) {
    console.error("/api/bot/my-channels GET error", err);
    return Response.json({ error: "Failed to load channels" }, { status: 500 });
  }
}
