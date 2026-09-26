import sql from "@/app/api/utils/sql";
import crypto from "node:crypto";

export async function ensureTwitchBotUserColumns() {
  try {
    await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bot_enabled boolean DEFAULT false`;
    await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bot_webhook_token text`;
  } catch (e) {
    // ignore – columns may already exist or permissions limited
  }
}

export function generateBotToken() {
  return crypto.randomBytes(32).toString("base64url");
}
