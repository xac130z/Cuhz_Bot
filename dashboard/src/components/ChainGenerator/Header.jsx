import { startTwitchLogin } from "@/utils/startTwitchLogin";

export function Header({ authLoading, user, logout }) {
  return (
    <header className="w-full border-b border-white/10">
      <div className="flex items-center justify-between py-4">
        <a href="/" className="flex items-center gap-3">
          <img
            src="https://ucarecdn.com/3afc6131-98f7-42f7-ba95-e117ff1896f9/-/format/auto/"
            alt="Planet Cuhz logo"
            className="h-10 w-auto rounded-sm shadow-[0_0_20px_rgba(178,75,243,0.4)]"
          />
          <span className="text-lg font-semibold tracking-wide">
            PLANET{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00f5ff] via-[#b24bf3] to-[#ff1493]">
              CUHZ
            </span>
          </span>
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm opacity-90">
          <a href="/" className="hover:opacity-100">
            Home
          </a>
          <a
            href="/chain-generator"
            className="text-white font-semibold hover:opacity-100"
          >
            Generator
          </a>
          <a href="/gallery" className="hover:opacity-100">
            Gallery
          </a>
          <a href="/cuhz-bot" className="hover:opacity-100">
            CuhzBot
          </a>
          <a href="/pricing" className="hover:opacity-100">
            Pricing
          </a>
        </nav>

        <div className="flex items-center gap-3">
          {authLoading ? (
            <div className="px-4 py-2 rounded-xl border border-white/15 text-sm backdrop-blur-sm bg-white/5">
              Loading...
            </div>
          ) : user ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {user.profile_image_url && (
                  <img
                    src={user.profile_image_url}
                    alt={user.display_name || user.username}
                    className="w-8 h-8 rounded-full ring-2 ring-[#b24bf3]/40"
                  />
                )}
                <span className="text-sm hidden sm:inline">
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
              <button
                onClick={logout}
                className="px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm backdrop-blur-sm bg-white/5"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              onClick={startTwitchLogin}
              className="px-4 py-2 rounded-xl font-semibold text-black text-sm"
              style={{
                background: "linear-gradient(90deg,#00f5ff,#b24bf3,#ff1493)",
              }}
            >
              Login with Twitch
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
