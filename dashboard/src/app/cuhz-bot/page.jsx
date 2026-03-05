"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTwitchAuth } from "@/utils/useTwitchAuth";
import { startTwitchLogin } from "@/utils/startTwitchLogin";

function normalizeChannelLogin(channel) {
  return String(channel || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/[^a-z0-9_]/g, "");
}

export default function CuhzBotRequestPage() {
  const { user, loading, logout } = useTwitchAuth();

  const bgStyle = useMemo(
    () => ({
      background:
        "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)",
    }),
    [],
  );

  // --- CuhzBot request ---
  const [channel, setChannel] = useState("");
  const [botSuccess, setBotSuccess] = useState(null);

  const requestBotMutation = useMutation({
    mutationFn: async (channelLogin) => {
      const res = await fetch("/api/bot/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channelLogin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data?.error ||
          `When fetching /api/bot/request, the response was [${res.status}] ${res.statusText}`;
        throw new Error(msg);
      }
      return data;
    },
    onSuccess: (data) => {
      setBotSuccess(data);
      const msg = data?.message || "Request saved";
      toast.success(msg);
    },
    onError: (e) => {
      console.error(e);
      toast.error(e?.message || "Could not save request");
    },
  });

  const submitBotRequest = useCallback(
    (e) => {
      e.preventDefault();
      const cleaned = normalizeChannelLogin(channel);
      if (!cleaned) {
        toast.error("Please enter a Twitch username");
        return;
      }
      setBotSuccess(null);
      requestBotMutation.mutate(cleaned);
    },
    [channel, requestBotMutation],
  );

  // --- Services request ---
  const [email, setEmail] = useState("");
  const [requestType, setRequestType] = useState("ai_home_assistant");
  const [details, setDetails] = useState("");
  const [serviceSuccess, setServiceSuccess] = useState(null);

  // Prefill service request form from URL params (used by pricing page CTAs)
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const url = new URL(window.location.href);
      const qsEmail = url.searchParams.get("email");
      const qsType = url.searchParams.get("requestType");
      const qsDetails = url.searchParams.get("details");

      if (qsEmail && email.trim() === "") {
        setEmail(qsEmail);
      }

      const allowedTypes = new Set(["ai_home_assistant", "ai_dev_team"]);
      if (qsType && allowedTypes.has(qsType) && qsType !== requestType) {
        setRequestType(qsType);
      }

      if (qsDetails && details.trim() === "") {
        setDetails(qsDetails);
      }
    } catch (e) {
      // non-blocking
      console.error(e);
    }
    // Only want to prefill on first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestServiceMutation = useMutation({
    mutationFn: async ({ email, requestType, details }) => {
      const res = await fetch("/api/services/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, requestType, details }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data?.error ||
          `When fetching /api/services/request, the response was [${res.status}] ${res.statusText}`;
        throw new Error(msg);
      }
      return data;
    },
    onSuccess: (data) => {
      setServiceSuccess(data);
      toast.success(data?.message || "Request sent");
    },
    onError: (e) => {
      console.error(e);
      toast.error(e?.message || "Could not submit request");
    },
  });

  const submitServiceRequest = useCallback(
    (e) => {
      e.preventDefault();
      setServiceSuccess(null);
      requestServiceMutation.mutate({
        email: email.trim(),
        requestType,
        details: details.trim(),
      });
    },
    [email, requestType, details, requestServiceMutation],
  );

  const botBlurb =
    "Enter your Twitch username and we’ll add CuhzBot to your channel in less than 48 hours — for free.";

  return (
    <div
      className="min-h-screen text-white"
      style={{ backgroundColor: "#0a0e27" }}
    >
      <div className="absolute inset-0 -z-10" style={bgStyle} />

      <div className="max-w-[1200px] mx-auto px-6 py-10">
        <header className="flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <img
              src="https://ucarecdn.com/3afc6131-98f7-42f7-ba95-e117ff1896f9/-/format/auto/"
              alt="Planet Cuhz logo"
              className="h-10 w-auto rounded-sm"
            />
            <span className="text-lg font-semibold tracking-wide">CuhzBot</span>
          </a>

          {loading ? (
            <div className="px-4 py-2 rounded-xl border border-white/15">
              Loading...
            </div>
          ) : user ? (
            <div className="flex items-center gap-3">
              <a
                href="/dashboard"
                className="px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm"
              >
                Dashboard
              </a>
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

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Request CuhzBot */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h1 className="text-2xl font-bold">Request CuhzBot</h1>
            <p className="mt-3 text-white/80 text-sm">{botBlurb}</p>

            <form
              className="mt-5 flex flex-col sm:flex-row gap-3"
              onSubmit={submitBotRequest}
            >
              <input
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                placeholder="yourtwitchusername"
                className="flex-1 rounded-xl border border-white/15 bg-transparent px-4 py-3 text-sm outline-none focus:border-white/35"
              />
              <button
                type="submit"
                disabled={requestBotMutation.isLoading}
                className="px-6 py-3 rounded-xl font-semibold text-black disabled:opacity-50"
                style={{
                  background:
                    "linear-gradient(90deg,#00f5ff,#b24bf3,#ff1493,#ffd700)",
                }}
              >
                {requestBotMutation.isLoading ? "Saving…" : "Request Bot"}
              </button>
            </form>

            <div className="mt-4 text-xs text-white/60">
              Tip: your Twitch username is the part after twitch.tv/ (no
              spaces).
            </div>

            {botSuccess?.ok && (
              <div className="mt-5 rounded-xl border border-[#00f5ff]/20 bg-[#00f5ff]/10 p-4">
                <div className="font-semibold">Request received</div>
                <div className="mt-1 text-sm text-white/85">
                  {botSuccess?.message}
                </div>
              </div>
            )}
          </section>

          {/* Services */}
          <section
            id="ai"
            className="rounded-2xl border border-white/10 bg-white/5 p-6"
          >
            <h2 className="text-2xl font-bold">Want your own AI?</h2>
            <p className="mt-3 text-white/80 text-sm">
              If you want your own AI home assistant or an AI development team,
              request a quote here and we’ll email you instructions + pricing.
            </p>

            <form
              className="mt-5 grid grid-cols-1 gap-3"
              onSubmit={submitServiceRequest}
            >
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="rounded-xl border border-white/15 bg-transparent px-4 py-3 text-sm outline-none focus:border-white/35"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="rounded-xl border border-white/15 px-4 py-3 text-sm">
                  <div className="text-white/70 text-xs">Request type</div>
                  <select
                    value={requestType}
                    onChange={(e) => setRequestType(e.target.value)}
                    className="mt-1 w-full bg-transparent outline-none"
                  >
                    <option value="ai_home_assistant">AI Home Assistant</option>
                    <option value="ai_dev_team">AI Development Team</option>
                  </select>
                </label>

                <button
                  type="submit"
                  disabled={requestServiceMutation.isLoading}
                  className="px-6 py-3 rounded-xl font-semibold border border-white/15 hover:border-white/30 disabled:opacity-50"
                >
                  {requestServiceMutation.isLoading
                    ? "Sending…"
                    : "Request Quote"}
                </button>
              </div>

              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={4}
                placeholder="Tell us what you’re trying to build (optional)…"
                className="rounded-xl border border-white/15 bg-transparent px-4 py-3 text-sm outline-none focus:border-white/35"
              />

              {serviceSuccess?.ok && (
                <div className="rounded-xl border border-[#b24bf3]/25 bg-[#b24bf3]/10 p-4">
                  <div className="font-semibold">Request sent</div>
                  <div className="mt-1 text-sm text-white/85">
                    {serviceSuccess?.message}
                  </div>
                </div>
              )}
            </form>
          </section>
        </div>

        <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="text-sm text-white/80">
            Want to make chain art too? Try the{" "}
            <a className="underline" href="/chain-generator">
              Chain Generator
            </a>
            .
          </div>
        </div>
      </div>
    </div>
  );
}
