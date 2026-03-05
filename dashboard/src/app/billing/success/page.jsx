"use client";
import { useEffect, useMemo, useState } from "react";

export default function BillingSuccessPage() {
  const [message, setMessage] = useState("Finishing your upgrade...");

  const bgStyle = useMemo(
    () => ({
      background:
        "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)",
    }),
    [],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) {
      setMessage("Missing session. Redirecting to pricing...");
      const t = setTimeout(() => (window.location.href = "/pricing"), 1500);
      return () => clearTimeout(t);
    }
    // Let backend update DB and redirect us to /dashboard
    window.location.href = `/api/billing/checkout-success?session_id=${encodeURIComponent(
      sessionId,
    )}`;
  }, []);

  return (
    <div
      className="min-h-screen text-white flex items-center justify-center"
      style={{ backgroundColor: "#0a0e27" }}
    >
      <div className="absolute inset-0 -z-10" style={bgStyle} />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        <div className="animate-pulse">{message}</div>
      </div>
    </div>
  );
}
