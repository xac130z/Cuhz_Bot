import { s as sql } from "./sql-BK77oGq6.js";
import "@neondatabase/serverless";
async function GET(request) {
  try {
    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get("limit") || "25", 10);
    const limit = Math.min(Math.max(limitParam, 1), 50);
    const cursor = url.searchParams.get("cursor");
    const q = url.searchParams.get("q");
    const scope = url.searchParams.get("scope");
    const code = url.searchParams.get("code");
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
    const meId = idMatch[1];
    const meRows = await sql`SELECT id, role FROM users WHERE id = ${meId} LIMIT 1`;
    const me = meRows[0];
    if (!me || me.role !== "admin") {
      return Response.json({
        error: "Forbidden"
      }, {
        status: 403
      });
    }
    await sql`
      CREATE TABLE IF NOT EXISTS public.error_logs (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
        scope TEXT NOT NULL,
        user_id INTEGER NULL,
        user_twitch_id TEXT NULL,
        code TEXT NULL,
        message TEXT NOT NULL,
        metadata JSONB NULL
      )
    `;
    let text = `
      SELECT e.id,
             e.created_at,
             e.scope,
             e.code,
             e.message,
             e.metadata,
             e.user_id,
             e.user_twitch_id,
             u.username,
             u.display_name
      FROM public.error_logs e
      LEFT JOIN public.users u ON u.id = e.user_id
      WHERE 1=1`;
    const values = [];
    if (q && q.trim() !== "") {
      const like = `%${q.trim()}%`;
      text += ` AND (e.message ILIKE $${values.length + 1} OR e.code ILIKE $${values.length + 1} OR e.scope ILIKE $${values.length + 1})`;
      values.push(like);
    }
    if (scope && scope.trim() !== "") {
      text += ` AND e.scope = $${values.length + 1}`;
      values.push(scope.trim());
    }
    if (code && code.trim() !== "") {
      text += ` AND e.code = $${values.length + 1}`;
      values.push(code.trim());
    }
    if (dateFrom && dateFrom.trim() !== "") {
      text += ` AND e.created_at >= $${values.length + 1}`;
      values.push((/* @__PURE__ */ new Date(`${dateFrom}T00:00:00Z`)).toISOString());
    }
    if (dateTo && dateTo.trim() !== "") {
      text += ` AND e.created_at <= $${values.length + 1}`;
      values.push((/* @__PURE__ */ new Date(`${dateTo}T23:59:59Z`)).toISOString());
    }
    if (cursor) {
      const cursorId = parseInt(cursor, 10);
      if (!isNaN(cursorId)) {
        text += ` AND e.id < $${values.length + 1}`;
        values.push(cursorId);
      }
    }
    text += ` ORDER BY e.id DESC LIMIT $${values.length + 1}`;
    values.push(limit + 1);
    const rows = await sql(text, values);
    let items = rows;
    let nextCursor = null;
    if (rows.length > limit) {
      items = rows.slice(0, limit);
      nextCursor = items[items.length - 1]?.id ?? null;
    }
    return Response.json({
      items: items.map((e) => ({
        id: e.id,
        created_at: e.created_at,
        scope: e.scope,
        code: e.code,
        message: e.message,
        metadata: e.metadata,
        user_id: e.user_id,
        user_twitch_id: e.user_twitch_id,
        username: e.username,
        display_name: e.display_name
      })),
      nextCursor
    });
  } catch (err) {
    console.error("admin/errors error", err);
    return Response.json({
      error: err.message || "Failed to load error logs"
    }, {
      status: 500
    });
  }
}
export {
  GET
};
