"use client";
import { useEffect, useMemo, useState } from "react"; // add effect for toast on query params
import { useTwitchAuth } from "@/utils/useTwitchAuth";
import { startTwitchLogin } from "@/utils/startTwitchLogin";
import { toast } from "sonner"; // toast notifications
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function DashboardPage() {
  const { user, loading, logout } = useTwitchAuth();
  const queryClient = useQueryClient();

  const origin = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  // --- NEW: Add-bot self-serve onboarding state ---
  const [channelToAdd, setChannelToAdd] = useState("");
  const [addResult, setAddResult] = useState(null);

  // Show success toasts after actions
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const upgraded = url.searchParams.get("upgrade");
    const twitchLogin = url.searchParams.get("twitch_login");
    if (upgraded === "success") {
      toast.success("You're Pro now! Enjoy unlimited generations.");
      url.searchParams.delete("upgrade");
      window.history.replaceState({}, "", url.toString());
    }
    if (twitchLogin === "success") {
      toast.success("Welcome back! You're signed in.");
      url.searchParams.delete("twitch_login");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  // Discord settings
  const { data: discord, isLoading: discordLoading } = useQuery({
    queryKey: ["discord-settings"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/discord/settings");
      if (!res.ok) throw new Error("Failed to load Discord settings");
      return res.json();
    },
    enabled: !!user,
  });

  const saveDiscord = useMutation({
    mutationFn: async ({ webhookUrl, autoPost, test }) => {
      const res = await fetch("/api/integrations/discord/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl, autoPost, test }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to save Discord settings");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Discord settings saved");
      queryClient.invalidateQueries({ queryKey: ["discord-settings"] });
    },
    onError: (e) => {
      console.error(e);
      toast.error("Could not save Discord settings");
    },
  });

  // --- NEW: Twitch Bot settings ---
  const { data: botSettings, isLoading: botLoading } = useQuery({
    queryKey: ["twitch-bot-settings"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/twitch-bot/settings");
      if (!res.ok) throw new Error("Failed to load bot settings");
      return res.json();
    },
    enabled: !!user,
  });

  const saveBot = useMutation({
    mutationFn: async ({ enabled, regenerateToken }) => {
      const res = await fetch("/api/integrations/twitch-bot/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, regenerateToken }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to save bot settings");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Bot settings saved");
      queryClient.invalidateQueries({ queryKey: ["twitch-bot-settings"] });
    },
    onError: (e) => {
      console.error(e);
      toast.error("Could not save bot settings");
    },
  });

  // --- NEW: Channel onboarding + status list ---
  const { data: myChannels, isLoading: myChannelsLoading } = useQuery({
    queryKey: ["bot-my-channels"],
    queryFn: async () => {
      const res = await fetch("/api/bot/my-channels");
      if (res.status === 401) {
        return { channels: [] };
      }
      if (!res.ok) {
        throw new Error("Failed to load bot channels");
      }
      return res.json();
    },
    enabled: !!user,
  });

  const addChannel = useMutation({
    mutationFn: async (channel) => {
      const res = await fetch("/api/bot/add-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to add channel");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setAddResult(data);
      const msg = data?.message || "Channel saved";
      toast.success(msg);
      queryClient.invalidateQueries({ queryKey: ["bot-my-channels"] });
    },
    onError: (e) => {
      console.error(e);
      toast.error(e?.message || "Could not add channel");
    },
  });

  return (
    <div
      className="min-h-screen text-white"
      style={{ backgroundColor: "#0a0e27" }}
    >
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)",
        }}
      />

      <div className="max-w-[1200px] mx-auto px-6 py-10">
        <header className="flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <img
              src="https://ucarecdn.com/3afc6131-98f7-42f7-ba95-e117ff1896f9/-/format/auto/"
              alt="Planet Cuhz logo"
              className="h-10 w-auto rounded-sm"
            />
            <span className="text-lg font-semibold tracking-wide">
              My Dashboard
            </span>
          </a>

          {loading ? (
            <div className="px-4 py-2 rounded-xl border border-white/15">
              Loading...
            </div>
          ) : user ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {user.profile_image_url && (
                  <img
                    src={user.profile_image_url}
                    alt={user.display_name || user.username}
                    className="w-8 h-8 rounded-full"
                  />
                )}
                <span className="text-sm">
                  {user.display_name || user.username}
                  {user.role === "admin" && (
                    <span className="ml-1 text-xs bg-gradient-to-r from-[#00f5ff] to-[#b24bf3] text-black px-2 py-0.5 rounded-full font-semibold">
                      ADMIN
                    </span>
                  )}
                  {user.plan === "pro" && (
                    <span className="ml-1 text-xs bg-[#ffd700] text-black px-2 py-0.5 rounded-full font-semibold">
                      PRO
                    </span>
                  )}
                </span>
              </div>
              {user.plan === "pro" ? (
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(
                        "/api/billing/create-portal-session",
                        { method: "POST" },
                      );
                      if (!res.ok)
                        throw new Error("Failed to open billing portal");
                      const data = await res.json();
                      if (!data.url) throw new Error("No portal URL returned");
                      const popup = window.open(data.url, "_blank", "popup");
                      if (!popup) window.location.href = data.url;
                    } catch (e) {
                      console.error(e);
                      toast.error("Could not open billing portal.");
                    }
                  }}
                  className="px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm"
                >
                  Manage Billing
                </button>
              ) : (
                <a
                  href="/pricing"
                  className="px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm"
                >
                  Go Pro
                </a>
              )}
              <button
                onClick={logout}
                className="px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              onClick={startTwitchLogin}
              className="px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors"
            >
              Login with Twitch
            </button>
          )}
        </header>

        <section className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            "Commands used today",
            "Messages sent",
            "New chatters welcomed",
          ].map((title, i) => (
            <div
              key={i}
              className="rounded-2xl border border-white/10 bg-white/5 p-5"
            >
              <div className="text-sm text-white/70">{title}</div>
              <div className="text-3xl font-bold mt-2">--</div>
            </div>
          ))}
        </section>

        <section className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold">Bot Settings</h2>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  defaultChecked
                  className="accent-[#b24bf3]"
                />{" "}
                Auto-welcome new chatters
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  defaultChecked
                  className="accent-[#b24bf3]"
                />{" "}
                Marketing messages (30 min)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-[#b24bf3]" /> Queue
                system
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-[#b24bf3]" /> Raid
                messages
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold">Custom Commands</h2>
            <div className="mt-4 text-sm text-white/80">Coming soon</div>
          </div>
        </section>

        {/* NEW: Twitch Bot Integration */}
        {user && (
          <section className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold">Twitch Bot Integration</h2>
            <p className="mt-2 text-sm text-white/80">
              Enable chat commands and connect your bot or a simple webhook to
              Planet Cuhz. Supported commands:{" "}
              <code className="bg-white/10 px-1 py-0.5 rounded">
                !cuhz help
              </code>{" "}
              and{" "}
              <code className="bg-white/10 px-1 py-0.5 rounded">
                !chain &lt;prompt&gt;
              </code>
              .
            </p>
            <form
              className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                const enabled = Boolean(
                  e.currentTarget.elements.namedItem("botEnabled").checked,
                );
                saveBot.mutate({ enabled });
              }}
            >
              <label className="flex items-center gap-2 md:col-span-1 rounded-xl border border-white/15 px-3 py-2">
                <input
                  type="checkbox"
                  name="botEnabled"
                  defaultChecked={Boolean(botSettings?.bot_enabled)}
                  className="accent-[#b24bf3]"
                  disabled={botLoading}
                />
                Enable bot
              </label>
              <div className="md:col-span-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="col-span-2 flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2">
                  <span className="shrink-0 text-white/70">Webhook</span>
                  <input
                    readOnly
                    value={
                      origin ? `${origin}/api/bot/command` : "/api/bot/command"
                    }
                    className="w-full bg-transparent outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const v = origin
                        ? `${origin}/api/bot/command`
                        : "/api/bot/command";
                      navigator.clipboard
                        .writeText(v)
                        .then(() => toast.success("Webhook URL copied"));
                    }}
                    className="px-2 py-1 rounded border border-white/15 hover:border-white/30"
                  >
                    Copy
                  </button>
                </div>
                <div className="col-span-1 flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2">
                  <span className="shrink-0 text-white/70">Token</span>
                  <input
                    readOnly
                    value={
                      botSettings?.bot_webhook_token || "(enable to generate)"
                    }
                    className="w-full bg-transparent outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!botSettings?.bot_webhook_token) return;
                      navigator.clipboard
                        .writeText(botSettings.bot_webhook_token)
                        .then(() => toast.success("Token copied"));
                    }}
                    className="px-2 py-1 rounded border border-white/15 hover:border-white/30"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <div className="md:col-span-5 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={saveBot.isLoading}
                  className="px-3 py-2 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-50"
                >
                  {saveBot.isLoading ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    saveBot.mutate({ enabled: true, regenerateToken: true })
                  }
                  className="px-3 py-2 rounded-xl border border-white/15 hover:border-white/30"
                >
                  Regenerate Token
                </button>
              </div>
            </form>

            {/* --- NEW: self-serve onboarding form --- */}
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <div className="font-semibold">
                    Add CuhzBot to your channel
                  </div>
                  <div className="text-xs text-white/70 mt-1">
                    This creates a verify code. The bot will join your channel
                    (pending) and you verify it in chat.
                  </div>
                </div>
                <form
                  className="flex flex-col sm:flex-row gap-2 w-full md:w-auto"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const next = channelToAdd.trim();
                    if (!next) return;
                    addChannel.mutate(next);
                  }}
                >
                  <input
                    value={channelToAdd}
                    onChange={(e) => setChannelToAdd(e.target.value)}
                    placeholder="yourtwitchchannel"
                    className="rounded-xl border border-white/15 bg-transparent px-3 py-2 text-sm w-full sm:w-[260px]"
                  />
                  <button
                    type="submit"
                    disabled={addChannel.isLoading || !channelToAdd.trim()}
                    className="px-3 py-2 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-50 text-sm"
                  >
                    {addChannel.isLoading ? "Adding…" : "Add Channel"}
                  </button>
                </form>
              </div>

              {addResult?.success && (
                <div className="mt-4 rounded-xl border border-[#b24bf3]/30 bg-[#b24bf3]/10 p-4">
                  <div className="text-sm font-semibold">
                    Channel: {addResult.channel}
                  </div>
                  {addResult.status === "pending" ? (
                    <div className="mt-2 text-sm text-white/80">
                      <div className="mt-2">Do this in your Twitch chat:</div>
                      <ol className="mt-2 list-decimal list-inside space-y-1">
                        <li>
                          <span className="text-white/70">Mod the bot:</span>{" "}
                          <code className="bg-black/30 px-2 py-0.5 rounded">
                            /mod CuhzBot
                          </code>
                        </li>
                        <li>
                          <span className="text-white/70">Verify:</span>{" "}
                          <code className="bg-black/30 px-2 py-0.5 rounded">
                            !cuhz verify {addResult.verifyCode}
                          </code>
                        </li>
                        <li>
                          <span className="text-white/70">Wait:</span> 30–60s
                          for the bot to sync + join
                        </li>
                        <li>
                          <span className="text-white/70">Test:</span>{" "}
                          <code className="bg-black/30 px-2 py-0.5 rounded">
                            !chain hello
                          </code>
                        </li>
                      </ol>
                      <div className="mt-3 text-xs text-white/70">
                        Your verify code
                      </div>
                      <div className="mt-1 font-mono text-lg text-[#00f5ff]">
                        {addResult.verifyCode}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-white/80">
                      ✅ Verified. Try{" "}
                      <code className="bg-black/30 px-2 py-0.5 rounded">
                        !chain hello
                      </code>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4">
                <div className="text-sm font-semibold">Your channels</div>
                <div className="mt-2 rounded-xl border border-white/10 overflow-hidden">
                  <div className="grid grid-cols-3 bg-white/5 px-3 py-2 text-xs text-white/70">
                    <div>Channel</div>
                    <div>Status</div>
                    <div>Verify</div>
                  </div>
                  <div className="divide-y divide-white/10">
                    {myChannelsLoading ? (
                      <div className="px-3 py-3 text-sm text-white/70">
                        Loading…
                      </div>
                    ) : (myChannels?.channels || []).length === 0 ? (
                      <div className="px-3 py-3 text-sm text-white/70">
                        No channels yet. Add one above.
                      </div>
                    ) : (
                      (myChannels?.channels || []).map((c) => {
                        const verifyText =
                          c.status === "pending"
                            ? `!cuhz verify ${c.verify_code || ""}`
                            : "—";
                        return (
                          <div
                            key={c.id}
                            className="grid grid-cols-3 px-3 py-2 text-sm"
                          >
                            <div className="font-mono">{c.channel_login}</div>
                            <div>
                              <span className="inline-flex items-center rounded-full bg-white/10 px-2 py-0.5 text-xs">
                                {c.status}
                              </span>
                            </div>
                            <div className="text-xs text-white/70 font-mono break-all">
                              {verifyText}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 text-xs text-white/70 space-y-1">
              <div>How to use (example):</div>
              <pre className="whitespace-pre-wrap break-all bg-black/30 rounded p-3">{`POST ${origin}/api/bot/command\nContent-Type: application/json\n\n{\n  \"token\": \"${botSettings?.bot_webhook_token || "<your-token>"}\",\n  \"channel\": \"yourchannel\",\n  \"user\": { \"id\": \"viewer123\", \"name\": \"viewer\" },\n  \"text\": \"!chain astronaut with CUHZ chain\"\n}`}</pre>
            </div>
          </section>
        )}

        {/* Discord Integration */}
        {user && (
          <section className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold">Discord Integration</h2>
            <p className="mt-2 text-sm text-white/80">
              Add a Discord webhook to share your new creations automatically or
              on demand. Create a webhook in your Discord channel → Edit Channel
              → Integrations → Webhooks.
            </p>
            <form
              className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                const webhookUrl = e.currentTarget.webhook.value.trim();
                const autoPost = e.currentTarget.autoPost.checked;
                saveDiscord.mutate({ webhookUrl, autoPost });
              }}
            >
              <input
                name="webhook"
                defaultValue={discord?.discord_webhook_url || ""}
                placeholder="https://discord.com/api/webhooks/..."
                className="md:col-span-3 rounded-xl border border-white/15 bg-transparent px-3 py-2"
                disabled={discordLoading}
              />
              <label className="flex items-center gap-2 md:col-span-1 rounded-xl border border-white/15 px-3 py-2">
                <input
                  type="checkbox"
                  name="autoPost"
                  defaultChecked={Boolean(discord?.discord_auto_post)}
                  className="accent-[#b24bf3]"
                  disabled={discordLoading}
                />
                Auto-post new creations
              </label>
              <div className="flex items-center gap-2 md:col-span-1">
                <button
                  type="submit"
                  disabled={saveDiscord.isLoading}
                  className="px-3 py-2 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-50"
                >
                  {saveDiscord.isLoading ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const webhookUrl = (
                      document.querySelector('input[name="webhook"]')?.value ||
                      ""
                    ).trim();
                    const autoPost = Boolean(
                      document.querySelector('input[name="autoPost"]')?.checked,
                    );
                    saveDiscord.mutate(
                      { webhookUrl, autoPost, test: true },
                      {
                        onSuccess: () => toast.success("Test sent to Discord"),
                      },
                    );
                  }}
                  className="px-3 py-2 rounded-xl border border-white/15 hover:border-white/30"
                >
                  Test
                </button>
              </div>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
