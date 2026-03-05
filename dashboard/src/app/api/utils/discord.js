import sql from "@/app/api/utils/sql";

// Ensure additive user columns exist for Discord integration
export async function ensureDiscordUserColumns() {
  try {
    await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS discord_webhook_url text`;
    await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS discord_auto_post boolean DEFAULT false`;
  } catch (e) {
    // ignore if lacking permissions or already exists; future selects may still work
    // console.error("ensureDiscordUserColumns error", e);
  }
}

// Send a message with optional image to a Discord webhook
export async function sendDiscordWebhook({
  webhookUrl,
  content,
  imageUrl,
  title,
  description,
}) {
  if (!webhookUrl) {
    return { ok: false, status: 400, error: "Missing webhookUrl" };
  }

  const payload = {
    content: content || "",
    allowed_mentions: { parse: [] },
  };

  if (imageUrl) {
    payload.embeds = [
      {
        title: title || undefined,
        description: description || undefined,
        image: { url: imageUrl },
      },
    ];
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: text || res.statusText };
  }
  return { ok: true };
}
