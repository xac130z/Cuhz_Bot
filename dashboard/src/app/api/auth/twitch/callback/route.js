import sql from "@/app/api/utils/sql";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  // Prefer APP_URL so it matches the Twitch console; fallback to request origin
  const origin = new URL(request.url).origin;
  const normalizeBase = (u) => (u || "").trim().replace(/\/$/, "");
  const appUrl = normalizeBase(process.env.APP_URL) || normalizeBase(origin);
  const redirectUri = `${appUrl}/api/auth/twitch/callback`;

  if (!code) {
    const fallback = `${appUrl}/?error=no_code`;
    const html = `<!doctype html><html><body><script>window.location.replace(${JSON.stringify(
      fallback,
    )});</script><noscript><a href="${fallback}">Continue</a></noscript></body></html>`;
    const headers = new Headers({
      "Content-Type": "text/html; charset=utf-8",
      Location: fallback,
    });
    return new Response(html, { status: 302, headers });
  }

  // Basic env validation for clearer errors instead of null/blank
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
    const fail = `${appUrl}/?error=missing_twitch_env`;
    const html = `<!doctype html><html><body><script>window.location.replace(${JSON.stringify(
      fail,
    )});</script><noscript><a href="${fail}">Continue</a></noscript></body></html>`;
    const headers = new Headers({
      "Content-Type": "text/html; charset=utf-8",
      Location: fail,
    });
    return new Response(html, { status: 302, headers });
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      console.error(
        "Twitch token exchange failed",
        tokenResponse.status,
        tokenResponse.statusText,
      );
      throw new Error(
        `Failed to exchange code for token: [${tokenResponse.status}] ${tokenResponse.statusText}`,
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Get user info from Twitch
    const userResponse = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": process.env.TWITCH_CLIENT_ID,
      },
    });

    if (!userResponse.ok) {
      console.error(
        "Twitch user fetch failed",
        userResponse.status,
        userResponse.statusText,
      );
      throw new Error(
        `Failed to get user info from Twitch: [${userResponse.status}] ${userResponse.statusText}`,
      );
    }

    const userData = await userResponse.json();
    const twitchUser = userData.data?.[0];

    if (!twitchUser) {
      throw new Error("No user data received from Twitch");
    }

    // Check if user exists in our database
    const existingUsers = await sql`
      SELECT * FROM users WHERE twitch_id = ${twitchUser.id} LIMIT 1
    `;

    let user;
    if (existingUsers.length > 0) {
      // Update existing user
      const updatedUsers = await sql`
        UPDATE users 
        SET username = ${twitchUser.login},
            display_name = ${twitchUser.display_name},
            profile_image_url = ${twitchUser.profile_image_url}
        WHERE twitch_id = ${twitchUser.id}
        RETURNING *
      `;
      user = updatedUsers[0];
    } else {
      // Create new user
      const newUsers = await sql`
        INSERT INTO users (twitch_id, username, display_name, profile_image_url)
        VALUES (${twitchUser.id}, ${twitchUser.login}, ${twitchUser.display_name}, ${twitchUser.profile_image_url})
        RETURNING *
      `;
      user = newUsers[0];
    }

    // Redirect to a finishing page that confirms session then forwards to dashboard
    const finishUrl = new URL(`${appUrl}/auth/finish`);
    finishUrl.searchParams.set("next", "/dashboard");

    const html = `<!doctype html><html><body><script>window.location.replace(${JSON.stringify(
      finishUrl.toString(),
    )});</script><noscript><a href="${finishUrl.toString()}">Continue</a></noscript></body></html>`;

    // Set a simple session cookie
    const cookieBase = `twitch_user_id=${user.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
    const isHttps = appUrl.startsWith("https://");
    const headers = new Headers({
      "Content-Type": "text/html; charset=utf-8",
      Location: finishUrl.toString(),
    });
    headers.set("Set-Cookie", isHttps ? `${cookieBase}; Secure` : cookieBase);

    return new Response(html, { status: 302, headers });
  } catch (error) {
    console.error("Twitch auth error:", error);
    const failUrl = `${appUrl}/?error=auth_failed`;
    const html = `<!doctype html><html><body><script>window.location.replace(${JSON.stringify(
      failUrl,
    )});</script><noscript><a href="${failUrl}">Continue</a></noscript></body></html>`;
    const headers = new Headers({
      "Content-Type": "text/html; charset=utf-8",
      Location: failUrl,
    });
    return new Response(html, { status: 302, headers });
  }
}
