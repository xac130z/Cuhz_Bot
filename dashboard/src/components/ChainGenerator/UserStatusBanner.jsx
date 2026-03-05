import { Sparkles, Zap, User } from "lucide-react";

export function UserStatusBanner({ authLoading, user, usageLine }) {
  if (authLoading) return null;

  const usageContent =
    usageLine ||
    (user?.role === "admin"
      ? "Unlimited generations"
      : "10 AI generations per day");

  if (user) {
    return (
      <div
        className="mt-4 rounded-2xl border border-[#b24bf3]/30 backdrop-blur-md p-4 flex items-center gap-3"
        style={{ background: "rgba(178,75,243,0.08)" }}
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-[#00f5ff] to-[#b24bf3]">
          <Zap size={16} className="text-black" />
        </div>
        <div className="text-sm text-white/90">
          Welcome back,{" "}
          <span className="font-bold text-white">
            {user.display_name || user.username}
          </span>
          <span className="ml-2 text-white/60">•</span>
          <span className="ml-2 text-[#00f5ff]">{usageContent}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-4 rounded-2xl border border-white/10 backdrop-blur-md p-4 flex items-center gap-3"
      style={{ background: "rgba(15,23,42,0.8)" }}
    >
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10">
        <User size={16} className="text-white/60" />
      </div>
      <div className="text-sm text-white/80">
        Anonymous mode
        <span className="ml-2 text-white/60">•</span>
        <span className="ml-2 text-white/60">{usageContent}</span>
        <span className="ml-2 text-white/60">•</span>
        <a
          href="/auth/twitch"
          className="ml-2 text-transparent bg-clip-text bg-gradient-to-r from-[#00f5ff] to-[#b24bf3] font-semibold hover:underline"
        >
          Sign in with Twitch
        </a>{" "}
        to save creations
      </div>
    </div>
  );
}
