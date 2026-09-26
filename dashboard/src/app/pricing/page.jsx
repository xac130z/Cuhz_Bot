"use client";

import { OFFER_SECTIONS } from "../../config/offers";

const gradient =
  "linear-gradient(90deg,#00f5ff,#b24bf3,#ff1493,#ffd700)";

function OfferCard({ offer }) {
  return (
    <article
      className={
        offer.featured
          ? "flex h-full flex-col rounded-2xl border border-[#b24bf3]/50 bg-white/[0.08] p-6 shadow-[0_0_28px_rgba(178,75,243,0.22)]"
          : "flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.05] p-6"
      }
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-xl font-bold tracking-wide">{offer.name}</h3>
        {offer.featured ? (
          <span className="rounded-full bg-[#b24bf3]/20 px-2.5 py-1 text-xs font-semibold text-[#e4b8ff]">
            Popular
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-extrabold text-white">{offer.price}</p>

      {offer.description ? (
        <p className="mt-4 text-sm leading-6 text-white/75">
          {offer.description}
        </p>
      ) : null}

      {offer.features.length > 0 ? (
        <ul className="mt-5 flex-1 space-y-3 text-sm leading-6 text-white/80">
          {offer.features.map((feature) => (
            <li key={feature} className="flex gap-2">
              <span aria-hidden="true" className="mt-0.5 text-[#00f5ff]">
                ✓
              </span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex-1" />
      )}

      <div className="mt-6">
        <a
          href={offer.cta.href}
          target="_blank"
          rel="noreferrer"
          className={
            offer.featured
              ? "block rounded-xl px-5 py-3 text-center font-semibold text-black transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#00f5ff] focus:ring-offset-2 focus:ring-offset-[#0a0e27]"
              : "block rounded-xl border border-white/20 px-5 py-3 text-center font-semibold transition-colors hover:border-white/50 focus:outline-none focus:ring-2 focus:ring-[#00f5ff] focus:ring-offset-2 focus:ring-offset-[#0a0e27]"
          }
          style={offer.featured ? { background: gradient } : undefined}
        >
          {offer.cta.label}
          <span className="sr-only"> (opens on PlanetCuhz.com)</span>
        </a>
        {offer.cta.checkout ? (
          <p className="mt-2 text-center text-xs text-white/55">
            Secure checkout happens on PlanetCuhz.com.
          </p>
        ) : null}
      </div>
    </article>
  );
}

export default function PricingPage() {
  return (
    <main
      className="min-h-screen overflow-hidden text-white"
      style={{
        backgroundColor: "#0a0e27",
        backgroundImage:
          "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)",
      }}
    >
      <div className="mx-auto max-w-[1280px] px-6 py-10">
        <header className="flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-3">
            <img
              src="https://ucarecdn.com/3afc6131-98f7-42f7-ba95-e117ff1896f9/-/format/auto/"
              alt="Planet CUHZ"
              className="h-10 w-auto rounded-sm"
            />
            <span className="text-lg font-semibold tracking-wide">
              Pricing & Plans
            </span>
          </a>
          <a
            href="/dashboard"
            className="rounded-xl border border-white/15 px-4 py-2 transition-colors hover:border-white/40 focus:outline-none focus:ring-2 focus:ring-[#00f5ff]"
          >
            Dashboard
          </a>
        </header>

        <div className="py-16 text-center">
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#00f5ff]">
            One planet. Clear choices.
          </p>
          <h1 className="mx-auto mt-4 max-w-4xl text-4xl font-extrabold leading-tight md:text-6xl">
            Build, stream, and grow with Planet CUHZ
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-white/75 md:text-lg">
            Pick a site membership, equip an entire Twitch channel, or choose a
            one-time offer. Every plan has a clear scope and destination.
          </p>
        </div>

        <div className="space-y-12">
          {OFFER_SECTIONS.map((section) => (
            <section
              key={section.id}
              aria-labelledby={`${section.id}-title`}
              className="rounded-3xl border border-white/10 bg-black/20 p-6 md:p-8"
            >
              <div className="max-w-3xl">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#e4b8ff]">
                  {section.eyebrow}
                </p>
                <h2
                  id={`${section.id}-title`}
                  className="mt-2 text-3xl font-extrabold"
                >
                  {section.title}
                </h2>
                <p className="mt-3 inline-flex rounded-full border border-[#00f5ff]/30 bg-[#00f5ff]/10 px-3 py-1.5 text-sm font-semibold text-[#9afaff]">
                  Scope: {section.scope}
                </p>
                <p className="mt-4 leading-7 text-white/70">
                  {section.description}
                </p>
              </div>

              <div
                className={`mt-7 grid grid-cols-1 gap-5 ${
                  section.id === "bot"
                    ? "md:grid-cols-2 xl:grid-cols-3"
                    : "md:grid-cols-2 lg:grid-cols-3"
                }`}
              >
                {section.offers.map((offer) => (
                  <OfferCard key={offer.id} offer={offer} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="py-10 text-center text-sm text-white/55">
          Paid purchase links open the canonical Planet CUHZ pricing page for
          authenticated checkout. This dashboard does not process those
          purchases locally.
        </footer>
      </div>
    </main>
  );
}
