import { s as sql } from "./sql-BK77oGq6.js";
import "@neondatabase/serverless";
function parseCookies(header) {
  const cookie = header || "";
  const out = {};
  cookie.split(/;\s*/).forEach((p) => {
    const idx = p.indexOf("=");
    if (idx > -1) {
      const k = p.slice(0, idx);
      const v = p.slice(idx + 1);
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}
async function GET(request) {
  try {
    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    const {
      searchParams
    } = new URL(request.url);
    const sessionId = searchParams.get("session_id");
    if (!process.env.STRIPE_SECRET_KEY || !appUrl) {
      return Response.json({
        error: "Missing STRIPE_SECRET_KEY or APP_URL"
      }, {
        status: 500
      });
    }
    const cookies = parseCookies(request.headers.get("cookie"));
    const userId = cookies.twitch_user_id;
    if (!userId) {
      const dest2 = `${appUrl}/pricing?upgrade_error=not_authenticated`;
      return Response.redirect(dest2, 302);
    }
    if (!sessionId) {
      const dest2 = `${appUrl}/pricing?upgrade_error=missing_session`;
      return Response.redirect(dest2, 302);
    }
    const sessResp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`
      }
    });
    if (!sessResp.ok) {
      const txt = await sessResp.text();
      console.error("Stripe get session failed:", txt);
      const dest2 = `${appUrl}/pricing?upgrade_error=session_lookup_failed`;
      return Response.redirect(dest2, 302);
    }
    const session = await sessResp.json();
    const subscriptionId = session.subscription;
    const customerId = session.customer;
    let status = null;
    let currentPeriodEnd = null;
    if (subscriptionId) {
      const subResp = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`
        }
      });
      if (subResp.ok) {
        const sub = await subResp.json();
        status = sub.status;
        if (sub.current_period_end) {
          currentPeriodEnd = new Date(sub.current_period_end * 1e3).toISOString();
        }
      }
    }
    await sql`
      UPDATE users
      SET plan = ${"pro"},
          stripe_customer_id = ${customerId || null},
          stripe_subscription_id = ${subscriptionId || null},
          subscription_status = ${status || "active"},
          subscription_current_period_end = ${currentPeriodEnd}
      WHERE id = ${userId}
    `;
    const dest = `${appUrl}/dashboard?upgrade=success`;
    return Response.redirect(dest, 302);
  } catch (err) {
    console.error(err);
    return Response.json({
      error: "Server error"
    }, {
      status: 500
    });
  }
}
export {
  GET
};
