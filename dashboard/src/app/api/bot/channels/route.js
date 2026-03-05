import sql from "@/app/api/utils/sql";

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

export async function GET(request) {
  try {
    const gate = requireBotSecret(request);
    if (!gate.ok) return gate.response;

    const rows = await sql`
      SELECT bc.channel_login, bc.status
      FROM bot_channels bc
      LEFT JOIN users u ON u.id = bc.user_id
      WHERE bc.status = 'pending'
         OR (
           bc.status = 'enabled'
           AND (bc.user_id IS NULL OR u.bot_enabled = true)
         )
      ORDER BY bc.channel_login ASC
    `;

    const channels = rows.map((r) => ({
      channel_login: r.channel_login,
      status: r.status,
    }));

    // Backwards-compatible convenience
    const channelLogins = rows.map((r) => r.channel_login);

    return Response.json({ channels, channelLogins });
  } catch (err) {
    console.error("/api/bot/channels GET error", err);
    return Response.json(
      { error: "Failed to fetch channels" },
      { status: 500 },
    );
  }
}
