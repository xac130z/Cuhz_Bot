import { s as sql } from "./sql-BK77oGq6.js";
import { l as logError } from "./log-error-ChlEKKRV.js";
import "@neondatabase/serverless";
function getStartOfTodayIso() {
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString();
}
async function GET(request) {
  try {
    const url = new URL(request.url);
    const clientId = url.searchParams.get("clientId");
    const cookies = request.headers.get("cookie") || "";
    const userIdMatch = cookies.match(/twitch_user_id=([^;]+)/);
    let user = null;
    let userTwitchId = null;
    if (userIdMatch) {
      const userId = userIdMatch[1];
      const rows = await sql`
        SELECT id, twitch_id, role, ai_limit_override, plan, subscription_status
        FROM users
        WHERE id = ${userId}
        LIMIT 1
      `;
      user = rows[0] || null;
      userTwitchId = user?.twitch_id || null;
    }
    const todayIso = getStartOfTodayIso();
    let dailyLimit = 10;
    let todayCount = 0;
    if (user) {
      const isPro = user.plan === "pro";
      const isActiveSub = ["active", "trialing", "past_due"].includes(user.subscription_status || "");
      if (user.role === "admin" || isPro || isActiveSub) {
        dailyLimit = 0;
      } else if (user.ai_limit_override !== null) {
        dailyLimit = user.ai_limit_override;
      }
      if (dailyLimit > 0) {
        const rows = await sql`
          SELECT COUNT(*) as count
          FROM chain_generations
          WHERE user_twitch_id = ${userTwitchId}
            AND created_at >= ${todayIso}
            AND method = 'ai'
        `;
        todayCount = parseInt(rows[0]?.count || 0);
      }
    } else {
      if (!clientId) {
        return Response.json({
          error: "clientId is required for anonymous usage lookups"
        }, {
          status: 400
        });
      }
      const rows = await sql`
        SELECT COUNT(*) as count
        FROM chain_generations
        WHERE client_id = ${clientId}
          AND created_at >= ${todayIso}
          AND method = 'ai'
          AND user_twitch_id IS NULL
      `;
      todayCount = parseInt(rows[0]?.count || 0);
    }
    const isUnlimited = dailyLimit === 0;
    const remaining = isUnlimited ? null : Math.max(0, Number(dailyLimit) - Number(todayCount));
    return Response.json({
      ok: true,
      isUnlimited,
      dailyLimit,
      todayCount,
      remaining,
      scope: user ? "user" : "anonymous"
    });
  } catch (err) {
    console.error("/api/chain/usage error", err);
    try {
      await logError({
        request,
        scope: "chain_usage",
        code: "UNCAUGHT",
        message: err?.message || "Failed to load usage",
        metadata: {
          stack: err?.stack || null
        }
      });
    } catch (_) {
    }
    return Response.json({
      error: "Failed to load usage"
    }, {
      status: 500
    });
  }
}
export {
  GET
};
