import { s as sql } from "./sql-BK77oGq6.js";
import "@neondatabase/serverless";
async function GET(request) {
  try {
    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get("limit") || "20", 10);
    const cursorParam = url.searchParams.get("cursor");
    const limit = Math.min(Math.max(limitParam, 1), 50);
    const methodParam = (url.searchParams.get("method") || "").trim();
    const styleParam = (url.searchParams.get("style") || "").trim();
    const allowedMethods = ["ai", "upload"];
    const methodFilter = allowedMethods.includes(methodParam) ? methodParam : null;
    const styleFilter = styleParam ? styleParam : null;
    const cookieHeader = request.headers.get("cookie") || "";
    const match = cookieHeader.match(/twitch_user_id=([^;]+)/);
    if (!match) {
      return Response.json({
        error: "Not authenticated",
        user: null,
        items: []
      }, {
        status: 401
      });
    }
    const userId = match[1];
    const users = await sql`
      SELECT id, twitch_id
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;
    const user = users[0];
    if (!user) {
      return Response.json({
        error: "User not found",
        user: null,
        items: []
      }, {
        status: 404
      });
    }
    const twitchId = user.twitch_id;
    let text = "SELECT id, client_id, user_twitch_id, method, prompt, image_url, created_at, style FROM chain_generations WHERE user_twitch_id = $1";
    const values = [twitchId];
    if (methodFilter) {
      text += ` AND method = $${values.length + 1}`;
      values.push(methodFilter);
    }
    if (styleFilter) {
      text += ` AND (style = $${values.length + 1}`;
      values.push(styleFilter);
      text += ` OR (method = 'upload' AND prompt ILIKE $${values.length + 1}))`;
      values.push(`%upload(style:${styleFilter})%`);
    }
    if (cursorParam) {
      text += ` AND id < $${values.length + 1}`;
      values.push(parseInt(cursorParam, 10));
    }
    const limitWithExtra = limit + 1;
    text += " ORDER BY id DESC LIMIT $" + (values.length + 1);
    values.push(limitWithExtra);
    const rows = await sql(text, values);
    let items = rows;
    let nextCursor = null;
    if (rows.length > limit) {
      items = rows.slice(0, limit);
      nextCursor = items[items.length - 1]?.id || null;
    }
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
        style: deriveStyle(r.method, r.style, r.prompt)
      })),
      nextCursor
    });
  } catch (err) {
    console.error(err);
    return Response.json({
      error: err.message || "Failed to load generations"
    }, {
      status: 500
    });
  }
}
export {
  GET
};
