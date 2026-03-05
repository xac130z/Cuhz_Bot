"use client";
import { useEffect, useMemo, useState } from "react";

export default function AuthFinishPage() {
  const [error, setError] = useState(null);
  const [countdown, setCountdown] = useState(3);

  const bgStyle = useMemo(
    () => ({
      background:
        "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)",
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const url = new URL(window.location.href);
    const next = url.searchParams.get("next") || "/dashboard";

    async function pollSessionAndRedirect() {
      try {
        // Confirm the server sees our session
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to verify session");
        const data = await res.json();

        if (data?.user) {
          window.location.replace(next);
          return;
        }

        // If not ready yet, try again shortly
        setTimeout(pollSessionAndRedirect, 400);
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setError(e.message || "Could not finish sign in");
      }
    }

    pollSessionAndRedirect();

    // Friendly countdown for the user in case of slow networks
    const timer = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div
      className="min-h-screen text-white"
      style={{ backgroundColor: "#0a0e27" }}
    >
      <div className="absolute inset-0 -z-10" style={bgStyle} />
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <h1 className="text-2xl font-semibold">You're back from Twitch</h1>
          <p className="mt-2 text-white/80">Finishing sign-in…</p>

          <div className="mt-6 flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-[#00f5ff] border-t-transparent rounded-full animate-spin" />
          </div>

          <p className="mt-4 text-sm text-white/60">
            This should take just a moment. Redirecting in ~{countdown}s…
          </p>

          {error && (
            <div className="mt-6 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
