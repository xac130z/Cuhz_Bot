import { s as sql } from "./sql-BK77oGq6.js";
import "@neondatabase/serverless";
async function GET(request) {
  try {
    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get("limit") || "25", 10);
    const limit = Math.min(Math.max(limitParam, 1), 50);
    const cursor = url.searchParams.get("cursor");
    const q = url.searchParams.get("q");
    const method = url.searchParams.get("method");
    const style = url.searchParams.get("style");
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");
    const cookieHeader = request.headers.get("cookie") || "";
    const idMatch = cookieHeader.match(/twitch_user_id=([^;]+)/);
    if (!idMatch) {
      return Response.json({
        error: "Not authenticated"
      }, {
        status: 401
      });
    }
    const userId = idMatch[1];
    const meRows = await sql`
      SELECT id, role FROM users WHERE id = ${userId} LIMIT 1
    `;
    const me = meRows[0];
    if (!me || me.role !== "admin") {
      return Response.json({
        error: "Forbidden"
      }, {
        status: 403
      });
    }
    let text = "SELECT g.id, g.method, g.prompt, g.image_url, g.created_at, g.style, g.user_twitch_id, u.username, u.display_name FROM chain_generations g LEFT JOIN users u ON u.twitch_id = g.user_twitch_id WHERE 1=1";
    const values = [];
    if (q && q.trim() !== "") {
      const like = `%${q.trim()}%`;
      text += ` AND (u.username ILIKE $${values.length + 1} OR u.display_name ILIKE $${values.length + 1} OR g.user_twitch_id = $${values.length + 2})`;
      values.push(like, q.trim());
    }
    if (method === "ai" || method === "upload") {
      text += ` AND g.method = $${values.length + 1}`;
      values.push(method);
    }
    if (style && style.trim() !== "") {
      text += ` AND LOWER(g.style) = LOWER($${values.length + 1})`;
      values.push(style.trim());
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (!isNaN(from.getTime())) {
        text += ` AND g.created_at >= $${values.length + 1}`;
        values.push(from.toISOString());
      }
    }
    if (dateTo) {
      const to = new Date(dateTo);
      if (!isNaN(to.getTime())) {
        text += ` AND g.created_at < $${values.length + 1}`;
        values.push(to.toISOString());
      }
    }
    if (cursor) {
      const cursorId = parseInt(cursor, 10);
      if (!isNaN(cursorId)) {
        text += ` AND g.id < $${values.length + 1}`;
        values.push(cursorId);
      }
    }
    text += ` ORDER BY g.id DESC LIMIT $${values.length + 1}`;
    values.push(limit + 1);
    const rows = await sql(text, values);
    let items = rows;
    let nextCursor = null;
    if (rows.length > limit) {
      items = rows.slice(0, limit);
      nextCursor = items[items.length - 1]?.id ?? null;
    }
    return Response.json({
      items: items.map((r) => ({
        id: r.id,
        method: r.method,
        prompt: r.prompt,
        image_url: r.image_url,
        created_at: r.created_at,
        style: r.style,
        user_twitch_id: r.user_twitch_id,
        username: r.username || null,
        display_name: r.display_name || null
      })),
      nextCursor
    });
  } catch (err) {
    console.error("admin/generations error", err);
    return Response.json({
      error: err.message || "Failed to load"
    }, {
      status: 500
    });
  }
}
export {
  GET
};
