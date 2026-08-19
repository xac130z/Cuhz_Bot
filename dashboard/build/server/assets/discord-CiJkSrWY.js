import { s as sql } from "./sql-BK77oGq6.js";
async function ensureDiscordUserColumns() {
  try {
    await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS discord_webhook_url text`;
    await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS discord_auto_post boolean DEFAULT false`;
  } catch (e) {
  }
}
async function sendDiscordWebhook({
  webhookUrl,
  content,
  imageUrl,
  title,
  description
}) {
  if (!webhookUrl) {
    return {
      ok: false,
      status: 400,
      error: "Missing webhookUrl"
    };
  }
  const payload = {
    content: content || "",
    allowed_mentions: {
      parse: []
    }
  };
  if (imageUrl) {
    payload.embeds = [{
      title: title || void 0,
      description: description || void 0,
      image: {
        url: imageUrl
      }
    }];
  }
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: text || res.statusText
    };
  }
  return {
    ok: true
  };
}
export {
  ensureDiscordUserColumns as e,
  sendDiscordWebhook as s
};
