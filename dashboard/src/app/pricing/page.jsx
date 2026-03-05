"use client";
import { useMemo } from "react";

function buildPrefillUrl({ details, requestType }) {
  const params = new URLSearchParams();
  if (requestType) params.set("requestType", requestType);
  if (details) params.set("details", details);
  const qs = params.toString();
  // Note: query string must come before the hash fragment
  return `/cuhz-bot${qs ? `?${qs}` : ""}#ai`;
}

function PlanCard({ title, price, subtitle, bullets, accent = false, cta }) {
  return (
    <div
      className={
        accent
          ? "rounded-2xl border border-[#b24bf3]/40 bg-white/5 p-6 shadow-[0_0_24px_rgba(178,75,243,0.25)]"
          : "rounded-2xl border border-white/10 bg-white/5 p-6"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          {subtitle ? (
            <div className="mt-1 text-sm text-white/70">{subtitle}</div>
          ) : null}
        </div>
        {price ? (
          <div className="text-right">
            <div className="text-3xl font-extrabold">{price}</div>
          </div>
        ) : null}
      </div>

      <ul className="mt-5 space-y-2 text-white/80 text-sm">
        {bullets.map((b, idx) => (
          <li key={idx}>• {b}</li>
        ))}
      </ul>

      {cta ? <div className="mt-6">{cta}</div> : null}
    </div>
  );
}

export default function PricingPage() {
  const bgStyle = useMemo(
    () => ({
      background:
        "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)",
    }),
    [],
  );

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
            <span className="text-lg font-semibold tracking-wide">
              Cuhz_Bot Pricing & Plans
            </span>
          </a>
          <a
            href="/dashboard"
            className="px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors"
          >
            Dashboard
          </a>
        </header>

        {/* Intro + CTAs */}
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h1 className="text-3xl md:text-4xl font-extrabold">
            Level up your Twitch community
          </h1>
          <p className="mt-3 text-white/80 max-w-[70ch]">
            Whether you're a viewer looking for more power or a streamer wanting
            a custom-built companion, Planet CUHZ has a plan for you.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <a
              href="/cuhz-bot"
              className="px-6 py-3 rounded-xl font-semibold text-black text-center"
              style={{
                background:
                  "linear-gradient(90deg,#00f5ff,#b24bf3,#ff1493,#ffd700)",
              }}
            >
              Request CuhzBot (Free)
            </a>
            <a
              href={buildPrefillUrl({
                requestType: "ai_dev_team",
                details:
                  "I want a quote for a custom AI build (home assistant or AI dev team).",
              })}
              className="px-6 py-3 rounded-xl font-semibold border border-white/20 hover:border-white/40 transition-colors text-center"
            >
              Get a quote for custom AI
            </a>
          </div>
          <div className="mt-4 text-xs text-white/60">
            Note: requesting CuhzBot saves your Twitch username so we can add
            the bot. We'll add it in less than 48 hours for free.
          </div>
        </div>

        {/* Viewer plans */}
        <section className="mt-10">
          <h2 className="text-2xl font-bold">Choose Your Tier</h2>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-6">
            <PlanCard
              title="Community"
              subtitle="FREE"
              price="$0"
              bullets={[
                "Earn 1 point per chat message",
                "Base AI: !ask (Gemini) for 10 points per request",
                "Directory Access: !shoutouts to see community VIPs",
                "Standard commands: links, hype, and gambling",
              ]}
              cta={
                <a
                  href="/cuhz-bot"
                  className="inline-block px-5 py-3 rounded-xl font-semibold border border-white/20 hover:border-white/40 transition-colors"
                >
                  Request CuhzBot
                </a>
              }
            />
            <PlanCard
              title="Silver Supporter"
              subtitle="$4.99 / mo"
              price="$4.99"
              bullets={[
                "Unlimited base AI: !ask (no points)",
                "Claude AI (!ask -brain) cost reduced by 80%",
                "Verified Cuhz icon when the bot talks to you",
                "1,000 bonus points monthly",
              ]}
              cta={
                <a
                  href={buildPrefillUrl({
                    requestType: "ai_dev_team",
                    details:
                      "I want Silver Supporter ($4.99/mo). Please send payment + setup instructions.",
                  })}
                  className="inline-block px-5 py-3 rounded-xl font-semibold border border-white/20 hover:border-white/40 transition-colors"
                >
                  Get Silver (instructions)
                </a>
              }
            />
            <PlanCard
              title="Gold Executive"
              subtitle="$14.99 / mo"
              price="$14.99"
              accent
              bullets={[
                "Absolute unlimited AI: ZERO point cost for all brains",
                "Priority brain: skip the line during high-traffic moments",
                "Custom arrival: the bot greets you when you join",
                "5,000 bonus points monthly",
              ]}
              cta={
                <a
                  href={buildPrefillUrl({
                    requestType: "ai_dev_team",
                    details:
                      "I want Gold Executive ($14.99/mo). Please send payment + setup instructions.",
                  })}
                  className="inline-block px-5 py-3 rounded-xl font-semibold text-black"
                  style={{
                    background:
                      "linear-gradient(90deg,#00f5ff,#b24bf3,#ff1493,#ffd700)",
                  }}
                >
                  Get Gold (instructions)
                </a>
              }
            />
          </div>
        </section>

        {/* Streamer plans */}
        <section className="mt-12">
          <h2 className="text-2xl font-bold">
            Streamer & Enterprise Solutions
          </h2>
          <p className="mt-2 text-white/80 max-w-[80ch]">
            Want the full Cuhz_Bot experience in your own channel? Pick a pack
            below and we’ll email instructions + a quote if needed.
          </p>

          <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PlanCard
              title="The Affiliate Pack"
              subtitle="$49.99 / mo"
              price="$49.99"
              bullets={[
                "Branding: bot name stays Cuhz_Bot + your links and socials",
                "Moderation intelligence: !chatreport and !mood for mods",
                "Automated marketing: your socials on a timer rotation",
              ]}
              cta={
                <a
                  href={buildPrefillUrl({
                    requestType: "ai_dev_team",
                    details:
                      "I want The Affiliate Pack ($49.99/mo). Please send payment + onboarding steps for my channel.",
                  })}
                  className="inline-block px-5 py-3 rounded-xl font-semibold border border-white/20 hover:border-white/40 transition-colors"
                >
                  Request Affiliate Pack
                </a>
              }
            />

            <PlanCard
              title='The "Architect" Custom Build'
              subtitle="Contact for Quote"
              price={null}
              accent
              bullets={[
                "Custom branding: name, avatar, and backstory",
                "Private intelligence: trained on your rules, lore, and knowledge",
                "Dedicated server: private instance",
                "Full ownership + integrations (Home Assistant + Discord)",
              ]}
              cta={
                <a
                  href={buildPrefillUrl({
                    requestType: "ai_dev_team",
                    details:
                      "I want an Architect Custom Build. Please email instructions and a quote.",
                  })}
                  className="inline-block px-5 py-3 rounded-xl font-semibold text-black"
                  style={{
                    background:
                      "linear-gradient(90deg,#00f5ff,#b24bf3,#ff1493,#ffd700)",
                  }}
                >
                  Contact for Quote
                </a>
              }
            />
          </div>
        </section>

        {/* FAQ + contact */}
        <section className="mt-12 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-2xl font-bold">Frequently Asked Questions</h2>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-white/80">
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <div className="font-semibold text-white">How do I pay?</div>
              <div className="mt-2">
                We’ll email you payment + setup instructions when you request a
                plan.
              </div>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <div className="font-semibold text-white">Do points expire?</div>
              <div className="mt-2">
                No. Once you earn or buy CUHZ points, they stay on your account.
              </div>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <div className="font-semibold text-white">
                Can I upgrade / downgrade?
              </div>
              <div className="mt-2">
                Yep. You can change your tier anytime — just request the new
                plan and we’ll handle the switch.
              </div>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <div className="font-semibold text-white">
                How do I get started?
              </div>
              <div className="mt-2">
                Contact @fourareason4 in Discord or email
                SUPPORT@PLANETCUHZ.COM.
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <a
              href="/cuhz-bot"
              className="px-6 py-3 rounded-xl font-semibold border border-white/20 hover:border-white/40 transition-colors text-center"
            >
              Request CuhzBot
            </a>
            <a
              href={buildPrefillUrl({
                requestType: "ai_dev_team",
                details:
                  "Please email me instructions and a quote for Cuhz_Bot services.",
              })}
              className="px-6 py-3 rounded-xl font-semibold text-black text-center"
              style={{
                background:
                  "linear-gradient(90deg,#00f5ff,#b24bf3,#ff1493,#ffd700)",
              }}
            >
              Request quote by email
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
