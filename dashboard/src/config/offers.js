export const CANONICAL_PRICING_URL = "https://planetcuhz.com/pricing";

export const OFFER_SECTIONS = [
  {
    id: "membership",
    eyebrow: "Membership",
    title: "Planet CUHZ Membership",
    scope: "Site-wide; nothing here is a chat-bot feature.",
    description:
      "Choose the site experience that fits you, from free creation tools to a complete squad workspace.",
    offers: [
      {
        id: "free",
        name: "FREE",
        price: "$0 forever",
        features: [
          "Chain Studio — full access, right in your browser",
          "Browse squads, streams, and Cuhzunity events",
          "Request CUHZ Bot for your Twitch chat — free",
          "Starter AI tools with monthly limits",
        ],
        cta: {
          label: "Start Free",
          href: "https://planetcuhz.com/auth",
        },
      },
      {
        id: "pro",
        name: "PRO",
        price: "$9.99/month",
        features: [
          "Everything in Free",
          "Unlimited AI tools and emote generations",
          "Front of the line when you request CUHZ Bot for your channel",
          "Full creator feature set, day one",
          "Pro badge across the Cuhzunity",
        ],
        featured: true,
        cta: {
          label: "Go Pro",
          href: CANONICAL_PRICING_URL,
          checkout: true,
        },
      },
      {
        id: "team",
        name: "TEAM",
        price: "$24.99/month",
        features: [
          "Everything in Pro — for your whole squad",
          "Squad tools: roster, scrims, and run scheduling",
          "Coaching perks with community coaches",
          "Team spotlight across the Cuhzunity",
        ],
        cta: {
          label: "Build Your Squad",
          href: CANONICAL_PRICING_URL,
          checkout: true,
        },
      },
    ],
  },
  {
    id: "bot",
    eyebrow: "Bot plans",
    title: "CUHZ Bot for Twitch Channels",
    scope: "One plan per Twitch channel, not per viewer.",
    description:
      "Give the entire chat moderation, community tools, and the level of AI support your channel needs.",
    offers: [
      {
        id: "community",
        name: "COMMUNITY",
        price: "Free forever",
        features: [
          "CUHZ Bot live in your chat — free forever",
          "Moderation and spam control, plus the full command set",
          "The CUHZ points economy — !points, !top, !rewards",
          "!shoutouts directory, hype, and links commands",
        ],
        cta: {
          label: "Add It Free",
          href: "https://planetcuhz.com/bot",
        },
      },
      {
        id: "silver",
        name: "SILVER",
        price: "$4.99/month",
        features: [
          "Everything in Community",
          "Automated socials rotation — your links posted on a timer",
          "Extra engagement and hype commands unlocked for the channel",
          "One plan covers the whole chat, not one viewer",
        ],
        cta: {
          label: "Go Silver",
          href: CANONICAL_PRICING_URL,
          checkout: true,
        },
      },
      {
        id: "gold",
        name: "GOLD",
        price: "$14.99/month",
        features: [
          "Everything in Silver",
          "Unlimited AI in chat — Gemini and Claude, fair use",
          "Includes site Pro membership — one sub covers chat and site",
          "Priority when the chat is moving fast",
        ],
        featured: true,
        cta: {
          label: "Go Gold",
          href: CANONICAL_PRICING_URL,
          checkout: true,
        },
      },
      {
        id: "partner",
        name: "PARTNER",
        price: "$49.99/month",
        features: [
          "Your own branded bot — your name, avatar, and personality",
          "We host it and run it, so there is nothing for you to maintain",
          "Everything in Gold, on your channel",
          "A monthly service touch from a real human — powered by VQNC Labs",
          "Launching with 5 founding slots — every seat gets real service time",
        ],
        cta: {
          label: "Claim a Founding Slot",
          href: CANONICAL_PRICING_URL,
          checkout: true,
        },
      },
      {
        id: "architect",
        name: "ARCHITECT CUSTOM BUILD",
        price: "Custom/contact for quote",
        features: [
          "Custom branding — your name, avatar, and backstory",
          "Private AI trained on your game, lore, and rules",
          "Dedicated high-speed private instance",
          "Full ownership — you keep the build, Discord bridge included",
        ],
        cta: {
          label: "Get a Quote",
          href: "https://planetcuhz.com/solutions#start",
        },
      },
    ],
  },
  {
    id: "one-time",
    eyebrow: "One-time",
    title: "One-Time Offers",
    scope: "One-time purchases and bookable services — no recurring plan required.",
    description: "Back the community or get focused coaching when you need it.",
    offers: [
      {
        id: "founders",
        name: "FOUNDERS",
        price: "$99 one-time",
        description:
          "Back the planet early. Rep the Founders badge and lock in your Pro perks as an OG cuhz.",
        features: [],
        cta: {
          label: "Claim Founders",
          href: CANONICAL_PRICING_URL,
          checkout: true,
        },
      },
      {
        id: "coaching-sprint",
        name: "COACHING SPRINT",
        price: "$25/session",
        description:
          "A one-on-one film and gameplay session with a Cuhzunity coach. Book it when you need it.",
        features: [],
        cta: {
          label: "Book a Session",
          href: CANONICAL_PRICING_URL,
          checkout: true,
        },
      },
    ],
  },
];
