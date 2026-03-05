export async function POST(request) {
  try {
    const origin = new URL(request.url).origin;
    const headers = new Headers({ "Content-Type": "application/json" });

    // Clear the session cookie
    const cookieBase =
      "twitch_user_id=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
    const isHttps = origin.startsWith("https://");
    headers.set("Set-Cookie", isHttps ? `${cookieBase}; Secure` : cookieBase);

    return new Response(JSON.stringify({ success: true }), { headers });
  } catch (error) {
    console.error("Error logging out:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function GET(request) {
  try {
    const origin = new URL(request.url).origin;

    const html = `<!doctype html><html><body><script>window.location.replace(${JSON.stringify(
      origin,
    )});</script><noscript><a href="${origin}">Continue</a></noscript></body></html>`;

    // Clear the session cookie
    const cookieBase =
      "twitch_user_id=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
    const isHttps = origin.startsWith("https://");
    const headers = new Headers({
      "Content-Type": "text/html; charset=utf-8",
      Location: origin,
    });
    headers.set("Set-Cookie", isHttps ? `${cookieBase}; Secure` : cookieBase);

    return new Response(html, { status: 302, headers });
  } catch (error) {
    console.error("Error logging out:", error);
    const origin = new URL(request.url).origin;
    const failUrl = `${origin}/?error=logout_failed`;
    const html = `<!doctype html><html><body><script>window.location.replace(${JSON.stringify(
      failUrl,
    )});</script><noscript><a href="${failUrl}">Continue</a></noscript></body></html>`;
    return new Response(html, {
      status: 302,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        Location: failUrl,
      },
    });
  }
}
