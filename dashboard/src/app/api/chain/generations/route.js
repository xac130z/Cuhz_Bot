import sql from "@/app/api/utils/sql";

// GET /api/chain/generations?limit=20&cursor=123&method=ai|upload&style=rainbow
// Returns the current user's generations (AI and uploads) in reverse-chronological order
// Pagination: pass the last seen id as `cursor`; we return nextCursor if more
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get("limit") || "20", 10);
    const cursorParam = url.searchParams.get("cursor");
    const limit = Math.min(Math.max(limitParam, 1), 50); // 1..50

    // ADD: optional filters
    const methodParam = (url.searchParams.get("method") || "").trim();
    const styleParam = (url.searchParams.get("style") || "").trim();
    const allowedMethods = ["ai", "upload"];
    const methodFilter = allowedMethods.includes(methodParam)
      ? methodParam
      : null;
    const styleFilter = styleParam ? styleParam : null;

    // Read signed-in user from cookies (set during Twitch callback)
    const cookieHeader = request.headers.get("cookie") || "";
    const match = cookieHeader.match(/twitch_user_id=([^;]+)/);
    if (!match) {
      return Response.json(
        { error: "Not authenticated", user: null, items: [] },
        { status: 401 },
      );
    }
    const userId = match[1];

    // Look up the user's Twitch ID (chain_generations stores user_twitch_id)
    const users = await sql`
      SELECT id, twitch_id
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;

    const user = users[0];
    if (!user) {
      return Response.json(
        { error: "User not found", user: null, items: [] },
        { status: 404 },
      );
    }

    const twitchId = user.twitch_id;

    // Build dynamic query safely (function form)
    let text =
      "SELECT id, client_id, user_twitch_id, method, prompt, image_url, created_at, style FROM chain_generations WHERE user_twitch_id = $1";
    const values = [twitchId];

    // ADD: method filter
    if (methodFilter) {
      text += ` AND method = $${values.length + 1}`;
      values.push(methodFilter);
    }

    // ADD: style filter
    if (styleFilter) {
      // Try the dedicated style column first, and fall back to old upload prompt metadata.
      text += ` AND (style = $${values.length + 1}`;
      values.push(styleFilter);

      text += ` OR (method = 'upload' AND prompt ILIKE $${values.length + 1}))`;
      values.push(`%upload(style:${styleFilter})%`);
    }

    if (cursorParam) {
      text += ` AND id < $${values.length + 1}`;
      values.push(parseInt(cursorParam, 10));
    }

    // Fetch one extra to determine if there is a next page
    const limitWithExtra = limit + 1;
    text += " ORDER BY id DESC LIMIT $" + (values.length + 1);
    values.push(limitWithExtra);

    const rows = await sql(text, values);

    let items = rows;
    let nextCursor = null;

    if (rows.length > limit) {
      // we have more; pop the extra and set nextCursor to last id
      items = rows.slice(0, limit);
      nextCursor = items[items.length - 1]?.id || null;
    }

    // Backwards-compatible style derivation if style is null but prompt contained style metadata
    const deriveStyle = (method, style, prompt) => {
      if (style) return style;
      if (method === "upload" && typeof prompt === "string") {
        const m = prompt.match(/upload\(style:([^\)]+)\)/i);
        if (m && m[1]) return m[1];
      }
      return null;
    };

    return Response.json({
      items: items.map((r) => ({
        id: r.id,
        method: r.method,
        prompt: r.prompt,
        image_url: r.image_url,
        created_at: r.created_at,
        style: deriveStyle(r.method, r.style, r.prompt),
      })),
      nextCursor,
    });
  } catch (err) {
    console.error(err);
    return Response.json(
      { error: err.message || "Failed to load generations" },
      { status: 500 },
    );
  }
}
