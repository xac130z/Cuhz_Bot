import { s as sql } from "./sql-BK77oGq6.js";
import "@neondatabase/serverless";
async function GET(request) {
  try {
    const cookies = request.headers.get("cookie") || "";
    const userIdMatch = cookies.match(/twitch_user_id=([^;]+)/);
    if (!userIdMatch) {
      return Response.json({
        user: null
      }, {
        status: 200
      });
    }
    const userId = userIdMatch[1];
    const users = await sql`
      SELECT id, twitch_id, username, display_name, profile_image_url, role, ai_limit_override, created_at,
             plan, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_current_period_end
      FROM users 
      WHERE id = ${userId} 
      LIMIT 1
    `;
    if (users.length === 0) {
      return Response.json({
        user: null
      }, {
        status: 200
      });
    }
    const user = users[0];
    return Response.json({
      user: {
        id: user.id,
        twitch_id: user.twitch_id,
        username: user.username,
        display_name: user.display_name,
        profile_image_url: user.profile_image_url,
        role: user.role,
        ai_limit_override: user.ai_limit_override,
        created_at: user.created_at,
        plan: user.plan,
        stripe_customer_id: user.stripe_customer_id,
        stripe_subscription_id: user.stripe_subscription_id,
        subscription_status: user.subscription_status,
        subscription_current_period_end: user.subscription_current_period_end
      }
    });
  } catch (error) {
    console.error("Error getting user:", error);
    return Response.json({
      error: "Internal server error"
    }, {
      status: 500
    });
  }
}
export {
  GET
};
