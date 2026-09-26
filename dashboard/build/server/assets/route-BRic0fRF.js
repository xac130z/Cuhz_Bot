import { s as sql } from "./sql-BK77oGq6.js";
import "@neondatabase/serverless";
async function GET(request) {
  try {
    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get("limit") || "25", 10);
    const limit = Math.min(Math.max(limitParam, 1), 50);
    const cursor = url.searchParams.get("cursor");
    const q = url.searchParams.get("q");
    const role = url.searchParams.get("role");
    const plan = url.searchParams.get("plan");
    const subscriptionStatus = url.searchParams.get("subscription_status");
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
    let text = `
      WITH agg AS (
        SELECT user_twitch_id,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today,
               MAX(created_at) AS last_generated_at
        FROM chain_generations
        GROUP BY user_twitch_id
      )
      SELECT u.id,
             u.username,
             u.display_name,
             u.twitch_id,
             u.profile_image_url,
             u.role,
             u.ai_limit_override,
             u.plan,
             u.subscription_status,
             u.subscription_current_period_end,
             COALESCE(a.total, 0) AS total_generations,
             COALESCE(a.today, 0) AS generations_today,
             a.last_generated_at
      FROM users u
      LEFT JOIN agg a ON a.user_twitch_id = u.twitch_id
      WHERE 1=1`;
    const values = [];
    if (q && q.trim() !== "") {
      const like = `%${q.trim()}%`;
      text += ` AND (u.username ILIKE $${values.length + 1} OR u.display_name ILIKE $${values.length + 1} OR u.twitch_id ILIKE $${values.length + 1})`;
      values.push(like);
    }
    if (role && ["user", "streamer", "admin"].includes(role)) {
      text += ` AND u.role = $${values.length + 1}`;
      values.push(role);
    }
    if (plan === "pro") {
      text += ` AND u.plan = 'pro'`;
    } else if (plan === "free") {
      text += ` AND (u.plan IS NULL OR u.plan <> 'pro')`;
    }
    if (subscriptionStatus && subscriptionStatus.trim() !== "") {
      text += ` AND u.subscription_status = $${values.length + 1}`;
      values.push(subscriptionStatus.trim());
    }
    if (cursor) {
      const cursorId = parseInt(cursor, 10);
      if (!isNaN(cursorId)) {
        text += ` AND u.id < $${values.length + 1}`;
        values.push(cursorId);
      }
    }
    text += ` ORDER BY u.id DESC LIMIT $${values.length + 1}`;
    values.push(limit + 1);
    const rows = await sql(text, values);
    let items = rows;
    let nextCursor = null;
    if (rows.length > limit) {
      items = rows.slice(0, limit);
      nextCursor = items[items.length - 1]?.id ?? null;
    }
    return Response.json({
      items: items.map((u) => ({
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        twitch_id: u.twitch_id,
        profile_image_url: u.profile_image_url,
        role: u.role,
        ai_limit_override: u.ai_limit_override,
        plan: u.plan,
        subscription_status: u.subscription_status,
        subscription_current_period_end: u.subscription_current_period_end,
        total_generations: Number(u.total_generations || 0),
        generations_today: Number(u.generations_today || 0),
        last_generated_at: u.last_generated_at || null
      })),
      nextCursor
    });
  } catch (err) {
    console.error("admin/users error", err);
    return Response.json({
      error: err.message || "Failed to load users"
    }, {
      status: 500
    });
  }
}
export {
  GET
};
