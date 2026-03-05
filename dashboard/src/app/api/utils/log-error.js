import sql from "@/app/api/utils/sql";

// Lightweight error logging utility.
// Safe and additive: creates table/indexes if they don't exist, then inserts a row.
// Usage: await logError({ scope: 'ai_generate', message: err.message, code: 'AI_GENERATE_ERROR', user, metadata: { prompt } });
export default async function logError({
  request = null,
  scope,
  code = null,
  message,
  metadata = null,
  user = null,
}) {
  try {
    if (!scope || !message) {
      return; // require minimum information
    }

    // Ensure table exists (idempotent)
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

    // Helpful indexes for admin queries
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
          const rows =
            await sql`SELECT id, twitch_id FROM users WHERE id = ${id} LIMIT 1`;
          const me = rows[0];
          if (me) {
            userId = me.id;
            userTwitchId = me.twitch_id || null;
          }
        }
      } catch (_) {
        // ignore cookie parse failures
      }
    }

    // Insert log row
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
      String(message).slice(0, 2000), // guard overly long
      metadata ? JSON.stringify(metadata) : null,
    ]);
  } catch (e) {
    // Last resort: avoid throwing while handling an error
    console.error("logError failed", e);
  }
}
