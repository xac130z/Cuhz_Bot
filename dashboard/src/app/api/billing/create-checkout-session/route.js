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

async function ensureStripeCustomer({ user }) {
  // If we have a customer id stored, return it
  if (user.stripe_customer_id) return user.stripe_customer_id;

  // Create a customer in Stripe using REST API
  const body = new URLSearchParams({
    // We don't have an email column; store metadata for linkage
    "metadata[user_id]": String(user.id),
    "metadata[twitch_id]": user.twitch_id || "",
    name: user.display_name || user.username || "Cuhz User",
  });

  const resp = await fetch("https://api.stripe.com/v1/customers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Stripe create customer failed: [${resp.status}] ${txt}`);
  }

  const data = await resp.json();
  const customerId = data.id;

  // Persist on user
  await sql`
    UPDATE users SET stripe_customer_id = ${customerId} WHERE id = ${user.id}
  `;

  return customerId;
}

async function findOrCreateProPrice(interval = "month") {
  const isYearly = interval === "year";
  const lookupKey = isYearly ? "cuhz_pro_yearly" : "cuhz_pro_monthly";
  const unitAmount = isYearly ? 9900 : 999; // $99.00 or $9.99

  // Stripe doesn't have a direct get-by-lookup-key; list filtered
  const listResp = await fetch(
    "https://api.stripe.com/v1/prices?limit=100&expand[]=data.product",
    {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    },
  );
  if (!listResp.ok) {
    const txt = await listResp.text();
    throw new Error(`Stripe list prices failed: [${listResp.status}] ${txt}`);
  }
  const list = await listResp.json();
  const found = (list.data || []).find((p) => p.lookup_key === lookupKey);
  if (found) return found.id;

  // Create product (ensure it exists if we haven't found the price, or reuse if we can find it by name...
  // simplified: just try to find product or create new one.
  // For simplicity in this script, we'll search products or create one.)

  // First, see if we can find the "Cuhz Pro" product from the list of prices we just fetched
  // This is a bit hacky but avoids another API call if possible.
  let productId = (list.data || []).find((p) => p.product.name === "Cuhz Pro")
    ?.product.id;

  if (!productId) {
    // Create product
    const prodResp = await fetch("https://api.stripe.com/v1/products", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ name: "Cuhz Pro" }),
    });
    if (!prodResp.ok) {
      const txt = await prodResp.text();
      throw new Error(
        `Stripe create product failed: [${prodResp.status}] ${txt}`,
      );
    }
    const product = await prodResp.json();
    productId = product.id;
  }

  // Create recurring price
  const priceResp = await fetch("https://api.stripe.com/v1/prices", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      currency: "usd",
      unit_amount: String(unitAmount),
      "recurring[interval]": isYearly ? "year" : "month",
      product: productId,
      lookup_key: lookupKey,
    }),
  });
  if (!priceResp.ok) {
    const txt = await priceResp.text();
    throw new Error(`Stripe create price failed: [${priceResp.status}] ${txt}`);
  }
  const price = await priceResp.json();
  return price.id;
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

    // Parse body for interval
    let interval = "month";
    try {
      const json = await request.json();
      if (json.interval === "year") interval = "year";
    } catch (e) {
      // ignore JSON parse error, default to month
    }

    const cookies = parseCookies(request.headers.get("cookie"));
    const userId = cookies.twitch_user_id;
    if (!userId) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Load user
    const rows = await sql`
      SELECT id, twitch_id, username, display_name, stripe_customer_id FROM users WHERE id = ${userId} LIMIT 1
    `;
    if (!rows.length) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }
    const user = rows[0];

    const customerId = await ensureStripeCustomer({ user });
    const priceId = await findOrCreateProPrice(interval);

    const successUrl = `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appUrl}/pricing?canceled=1`;

    const body = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      customer: customerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: "true",
      client_reference_id: String(user.id),
    });

    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Stripe session create failed:", txt);
      return Response.json(
        { error: "Could not start checkout" },
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
