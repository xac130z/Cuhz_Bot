import { s as sql } from "./sql-BK77oGq6.js";
import crypto from "node:crypto";
async function ensureTwitchBotUserColumns() {
  try {
    await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bot_enabled boolean DEFAULT false`;
    await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bot_webhook_token text`;
  } catch (e) {
  }
}
function generateBotToken() {
  return crypto.randomBytes(32).toString("base64url");
}
export {
  ensureTwitchBotUserColumns as e,
  generateBotToken as g
};
