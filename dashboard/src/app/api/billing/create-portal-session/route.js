import sql from "@/app/api/utils/sql";

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

export async function POST(request) {
  try {
    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    if (!process.env.STRIPE_SECRET_KEY || !appUrl) {
      return Response.json(
        { error: "Missing STRIPE_SECRET_KEY or APP_URL" },
        { status: 500 },
      );
    }

    const cookies = parseCookies(request.headers.get("cookie"));
    const userId = cookies.twitch_user_id;
    if (!userId) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const rows = await sql`
      SELECT stripe_customer_id FROM users WHERE id = ${userId} LIMIT 1
    `;
    if (!rows.length || !rows[0].stripe_customer_id) {
      return Response.json(
        { error: "No billing profile yet. Please start a subscription first." },
        { status: 400 },
      );
    }

    const body = new URLSearchParams({
      customer: rows[0].stripe_customer_id,
      return_url: `${appUrl}/dashboard`,
    });

    const resp = await fetch(
      "https://api.stripe.com/v1/billing_portal/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Stripe portal create failed:", txt);
      return Response.json(
        { error: "Could not open billing portal" },
        { status: 500 },
      );
    }

    const session = await resp.json();
    return Response.json({ url: session.url });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
