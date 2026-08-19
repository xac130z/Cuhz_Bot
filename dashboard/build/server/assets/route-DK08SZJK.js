import { s as sql } from "./sql-BK77oGq6.js";
import "@neondatabase/serverless";
async function PATCH(request, {
  params
}) {
  try {
    const urlId = params?.id;
    const userId = parseInt(urlId, 10);
    if (!userId || isNaN(userId)) {
      return Response.json({
        error: "Invalid id"
      }, {
        status: 400
      });
    }
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
    const body = await request.json();
    const setClauses = [];
    const values = [];
    if (Object.prototype.hasOwnProperty.call(body, "role")) {
      const role = body.role;
      if (!["user", "streamer", "admin"].includes(role)) {
        return Response.json({
          error: "Invalid role"
        }, {
          status: 400
        });
      }
      setClauses.push(`role = $${values.length + 1}`);
      values.push(role);
    }
    if (Object.prototype.hasOwnProperty.call(body, "ai_limit_override")) {
      const lim = body.ai_limit_override;
      if (lim === null || lim === void 0 || lim === "") {
        setClauses.push(`ai_limit_override = NULL`);
      } else {
        const parsed = parseInt(lim, 10);
        if (isNaN(parsed) || parsed < 0) {
          return Response.json({
            error: "Invalid ai_limit_override"
          }, {
            status: 400
          });
        }
        setClauses.push(`ai_limit_override = $${values.length + 1}`);
        values.push(parsed);
      }
    }
    if (setClauses.length === 0) {
      return Response.json({
        error: "No changes provided"
      }, {
        status: 400
      });
    }
    let text = `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${values.length + 1} RETURNING id, username, display_name, twitch_id, profile_image_url, role, ai_limit_override, plan, subscription_status, subscription_current_period_end`;
    values.push(userId);
    const rows = await sql(text, values);
    const updated = rows[0];
    return Response.json({
      user: updated
    });
  } catch (err) {
    console.error("admin/users/[id] PATCH error", err);
    return Response.json({
      error: err.message || "Failed to update user"
    }, {
      status: 500
    });
  }
}
export {
  PATCH
};
