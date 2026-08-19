import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import PricingPage from "./page";
import {
  CANONICAL_PRICING_URL,
  OFFER_SECTIONS,
} from "../../config/offers";

const expectedCatalog = [
  {
    id: "membership",
    scope: "Site-wide; nothing here is a chat-bot feature.",
    offers: [
      ["FREE", "$0 forever"],
      ["PRO", "$9.99/month"],
      ["TEAM", "$24.99/month"],
    ],
  },
  {
    id: "bot",
    scope: "One plan per Twitch channel, not per viewer.",
    offers: [
      ["COMMUNITY", "Free forever"],
      ["SILVER", "$4.99/month"],
      ["GOLD", "$14.99/month"],
      ["PARTNER", "$49.99/month"],
      ["ARCHITECT CUSTOM BUILD", "Custom/contact for quote"],
    ],
  },
  {
    id: "one-time",
    scope:
      "One-time purchases and bookable services — no recurring plan required.",
    offers: [
      ["FOUNDERS", "$99 one-time"],
      ["COACHING SPRINT", "$25/session"],
    ],
  },
];

const expectedCtas = [
  ["Start Free", "https://planetcuhz.com/auth"],
  ["Go Pro", CANONICAL_PRICING_URL],
  ["Build Your Squad", CANONICAL_PRICING_URL],
  ["Add It Free", "https://planetcuhz.com/bot"],
  ["Go Silver", CANONICAL_PRICING_URL],
  ["Go Gold", CANONICAL_PRICING_URL],
  ["Claim a Founding Slot", CANONICAL_PRICING_URL],
  ["Get a Quote", "https://planetcuhz.com/solutions#start"],
  ["Claim Founders", CANONICAL_PRICING_URL],
  ["Book a Session", CANONICAL_PRICING_URL],
];

const expectedOfferCopy = [
  {
    id: "free",
    description: null,
    features: [
      "Chain Studio — full access, right in your browser",
      "Browse squads, streams, and Cuhzunity events",
      "Request CUHZ Bot for your Twitch chat — free",
      "Starter AI tools with monthly limits",
    ],
  },
  {
    id: "pro",
    description: null,
    features: [
      "Everything in Free",
      "Unlimited AI tools and emote generations",
      "Front of the line when you request CUHZ Bot for your channel",
      "Full creator feature set, day one",
      "Pro badge across the Cuhzunity",
    ],
  },
  {
    id: "team",
    description: null,
    features: [
      "Everything in Pro — for your whole squad",
      "Squad tools: roster, scrims, and run scheduling",
      "Coaching perks with community coaches",
      "Team spotlight across the Cuhzunity",
    ],
  },
  {
    id: "community",
    description: null,
    features: [
      "CUHZ Bot live in your chat — free forever",
      "Moderation and spam control, plus the full command set",
      "The CUHZ points economy — !points, !top, !rewards",
      "!shoutouts directory, hype, and links commands",
    ],
  },
  {
    id: "silver",
    description: null,
    features: [
      "Everything in Community",
      "Automated socials rotation — your links posted on a timer",
      "Extra engagement and hype commands unlocked for the channel",
      "One plan covers the whole chat, not one viewer",
    ],
  },
  {
    id: "gold",
    description: null,
    features: [
      "Everything in Silver",
      "Unlimited AI in chat — Gemini and Claude, fair use",
      "Includes site Pro membership — one sub covers chat and site",
      "Priority when the chat is moving fast",
    ],
  },
  {
    id: "partner",
    description: null,
    features: [
      "Your own branded bot — your name, avatar, and personality",
      "We host it and run it, so there is nothing for you to maintain",
      "Everything in Gold, on your channel",
      "A monthly service touch from a real human — powered by VQNC Labs",
      "Launching with 5 founding slots — every seat gets real service time",
    ],
  },
  {
    id: "architect",
    description: null,
    features: [
      "Custom branding — your name, avatar, and backstory",
      "Private AI trained on your game, lore, and rules",
      "Dedicated high-speed private instance",
      "Full ownership — you keep the build, Discord bridge included",
    ],
  },
  {
    id: "founders",
    description:
      "Back the planet early. Rep the Founders badge and lock in your Pro perks as an OG cuhz.",
    features: [],
  },
  {
    id: "coaching-sprint",
    description:
      "A one-on-one film and gameplay session with a Cuhzunity coach. Book it when you need it.",
    features: [],
  },
];

function renderDocument() {
  return new JSDOM(renderToStaticMarkup(<PricingPage />)).window.document;
}

describe("pricing offer catalog", () => {
  it("defines the exact offer names, prices, and section scopes", () => {
    expect(
      OFFER_SECTIONS.map((section) => ({
        id: section.id,
        scope: section.scope,
        offers: section.offers.map(({ name, price }) => [name, price]),
      })),
    ).toEqual(expectedCatalog);
  });

  it("defines every CTA destination explicitly", () => {
    expect(
      OFFER_SECTIONS.flatMap((section) =>
        section.offers.map((offer) => [offer.cta.label, offer.cta.href]),
      ),
    ).toEqual(expectedCtas);
  });

  it("defines every live feature array and offer description verbatim", () => {
    expect(
      OFFER_SECTIONS.flatMap((section) =>
        section.offers.map(({ id, description, features }) => ({
          id,
          description: description ?? null,
          features,
        })),
      ),
    ).toEqual(expectedOfferCopy);
  });
});

describe("PricingPage", () => {
  it("renders three separated, labelled catalog sections", () => {
    const document = renderDocument();
    const sections = [...document.querySelectorAll("main section")];
    expect(sections).toHaveLength(3);

    for (const expected of expectedCatalog) {
      const section = document.querySelector(
        `section[aria-labelledby="${expected.id}-title"]`,
      );
      expect(section).not.toBeNull();
      expect(section.textContent).toContain(`Scope: ${expected.scope}`);

      const headings = [...section.querySelectorAll("h3")].map(
        (heading) => heading.textContent,
      );
      for (const [name, price] of expected.offers) {
        expect(headings).toContain(name);
        expect(section.textContent).toContain(price);
      }
    }
  });

  it("renders CTAs as truthful external destinations", () => {
    const document = renderDocument();
    const links = [...document.querySelectorAll("a")];

    for (const [label, href] of expectedCtas) {
      const link = links.find((candidate) =>
        candidate.textContent.trim().startsWith(label),
      );
      expect(link, `missing CTA: ${label}`).toBeDefined();
      expect(link.getAttribute("href")).toBe(href);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noreferrer");
    }

    expect(
      [...document.querySelectorAll("p")].filter(
        (node) =>
          node.textContent === "Secure checkout happens on PlanetCuhz.com.",
      ),
    ).toHaveLength(7);
    expect(document.body.textContent).toContain(
      "This dashboard does not process those purchases locally.",
    );
  });

  it("renders every feature array and description without copy drift", () => {
    const document = renderDocument();
    const cards = [...document.querySelectorAll("article")];

    expect(cards).toHaveLength(expectedOfferCopy.length);
    expectedOfferCopy.forEach((expected, index) => {
      const card = cards[index];
      const features = [...card.querySelectorAll("li")].map((feature) =>
        feature.textContent.replace(/^✓/, "").trim(),
      );

      expect(features, `feature copy for ${expected.id}`).toEqual(
        expected.features,
      );
      if (expected.description) {
        expect(card.textContent).toContain(expected.description);
      }
    });
  });

  it("does not render stale plans, viewer tiers, or instruction-request copy", () => {
    const document = renderDocument();
    const copy = document.body.textContent;
    const markup = document.body.innerHTML;

    for (const staleTerm of [
      "Silver Supporter",
      "Gold Executive",
      "Affiliate Pack",
      "Choose Your Tier",
      "viewer looking for more power",
      "payment + setup instructions",
      "Get Silver (instructions)",
      "Get Gold (instructions)",
    ]) {
      expect(copy).not.toContain(staleTerm);
    }
    expect(markup).not.toContain("ai_dev_team");
    expect(markup).not.toContain("/api/");
  });
});
