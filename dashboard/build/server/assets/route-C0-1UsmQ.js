import { s as sql } from "./sql-BK77oGq6.js";
import "@neondatabase/serverless";
function isProbablyEmail(email) {
  const v = String(email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body?.email || "").trim();
    const requestType = String(body?.requestType || "").trim();
    const details = String(body?.details || "").trim();
    if (!isProbablyEmail(email)) {
      return Response.json({
        error: "A valid email is required"
      }, {
        status: 400
      });
    }
    const allowed = ["ai_home_assistant", "ai_dev_team"];
    if (!allowed.includes(requestType)) {
      return Response.json({
        error: "Please pick a request type"
      }, {
        status: 400
      });
    }
    await sql`
      INSERT INTO service_requests (email, request_type, details)
      VALUES (${email}, ${requestType}, ${details || null})
    `;
    const label = requestType === "ai_home_assistant" ? "AI Home Assistant" : "AI Development Team";
    return Response.json({
      ok: true,
      message: `✅ Got it — we’ll email you instructions and a quote for ${label} soon.`
    });
  } catch (err) {
    console.error("/api/services/request POST error", err);
    return Response.json({
      error: "Failed to submit request"
    }, {
      status: 500
    });
  }
}
export {
  POST
};
