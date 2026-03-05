"use client";
import { useEffect, useState } from "react";

export default function TwitchAuthRedirectPage() {
  const [error, setError] = useState(null);
  const [authUrl, setAuthUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function go() {
      try {
        const res = await fetch("/api/auth/twitch?format=json", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(
            `Auth init failed: [${res.status}] ${res.statusText}`,
          );
        }
        const data = await res.json();
        if (!data?.url) {
          throw new Error("No auth URL returned");
        }
        if (cancelled) return;
        setAuthUrl(data.url);
        // navigate to Twitch
        window.location.replace(data.url);
      } catch (e) {
        console.error(e);
        if (cancelled) return;
        setError(e.message || "Could not start Twitch sign in");
      }
    }

    go();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0e27] px-6">
      <div className="max-w-md w-full text-center text-white">
        <h1 className="text-2xl font-semibold">Connecting to Twitch…</h1>
        <p className="mt-2 text-white/70">
          Please wait while we redirect you to Twitch to sign in.
        </p>

        <div className="mt-6 flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-[#00f5ff] border-t-transparent rounded-full animate-spin" />
        </div>

        {authUrl && (
          <p className="mt-4 text-sm text-white/60">
            If you’re not redirected,{" "}
            <a href={authUrl} className="text-[#00f5ff] underline">
              click here
            </a>
            .
          </p>
        )}

        {error && (
          <div className="mt-6 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
