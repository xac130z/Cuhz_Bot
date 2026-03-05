export async function GET(request) {
  const url = new URL(request.url);
  const appUrl = process.env.APP_URL;
  const clientId = process.env.TWITCH_CLIENT_ID;

  if (!appUrl || !clientId) {
    return Response.json(
      { error: "Missing APP_URL or TWITCH_CLIENT_ID" },
      { status: 500 },
    );
  }

  const redirectUri = `${appUrl}/api/auth/twitch/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "user:read:email",
    state: Math.random().toString(36).slice(2),
  });

  const authorizeUrl = `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;

  // If ?format=json → return the URL
  if (url.searchParams.get("format") === "json") {
    return Response.json({ url: authorizeUrl });
  }

  // Normal case: redirect using HTML + Location header (same pattern as callback)
  const html = `<!doctype html><html><body><script>window.location.replace(${JSON.stringify(authorizeUrl)});</script><noscript><a href="${authorizeUrl}">Continue to Twitch</a></noscript></body></html>`;

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    Location: authorizeUrl,
  });

  return new Response(html, { status: 302, headers });
}
