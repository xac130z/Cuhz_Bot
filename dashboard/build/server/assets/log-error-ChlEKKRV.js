import { s as sql } from "./sql-BK77oGq6.js";
async function logError({
  request = null,
  scope,
  code = null,
  message,
  metadata = null,
  user = null
}) {
  try {
    if (!scope || !message) {
      return;
    }
    await sql`
      CREATE TABLE IF NOT EXISTS public.error_logs (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
        scope TEXT NOT NULL,
        user_id INTEGER NULL,
        user_twitch_id TEXT NULL,
        code TEXT NULL,
        message TEXT NOT NULL,
        metadata JSONB NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON public.error_logs (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_error_logs_scope ON public.error_logs (scope)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_error_logs_user_id ON public.error_logs (user_id)`;
    let userId = null;
    let userTwitchId = null;
    if (user && (user.id || user.twitch_id)) {
      userId = user.id ?? null;
      userTwitchId = user.twitch_id ?? null;
    } else if (request) {
      try {
        const cookies = request.headers.get("cookie") || "";
        const userIdMatch = cookies.match(/twitch_user_id=([^;]+)/);
        if (userIdMatch) {
          const id = userIdMatch[1];
          const rows = await sql`SELECT id, twitch_id FROM users WHERE id = ${id} LIMIT 1`;
          const me = rows[0];
          if (me) {
            userId = me.id;
            userTwitchId = me.twitch_id || null;
          }
        }
      } catch (_) {
      }
    }
    const text = `
      INSERT INTO public.error_logs (scope, user_id, user_twitch_id, code, message, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;
    await sql(text, [
      String(scope),
      userId,
      userTwitchId,
      code ? String(code) : null,
      String(message).slice(0, 2e3),
      // guard overly long
      metadata ? JSON.stringify(metadata) : null
    ]);
  } catch (e) {
    console.error("logError failed", e);
  }
}
export {
  logError as l
};
