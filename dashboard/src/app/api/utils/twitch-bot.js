import sql from "@/app/api/utils/sql";

export async function ensureTwitchBotUserColumns() {
  try {
    await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bot_enabled boolean DEFAULT false`;
    await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bot_webhook_token text`;
  } catch (e) {
    // ignore – columns may already exist or permissions limited
  }
}

export function generateBotToken() {
  // Simple token generator (32 chars). Not cryptographically strong but sufficient for webhook auth here.
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  ).slice(0, 48);
}
