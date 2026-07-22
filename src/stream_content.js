'use strict';

const { APPROVED_LINKS } = require('./safety_policy');

const RESPONSES = Object.freeze({
    build: `CUHZ Bot helps streamers explore custom chat tools and stream-support workflows. Send a request at ${APPROVED_LINKS.website}; availability, scope, and pricing are confirmed by the team.`,
    shop: `CUHZ Bot checkout is not available in Twitch chat. Use ${APPROVED_LINKS.website} for a verified request.`,
    tools: `The public streamer-tools catalog is not enabled yet. Use ${APPROVED_LINKS.website} to ask the team what is currently available.`,
    audit: `Automated stream audits are not enabled in Twitch chat. Use ${APPROVED_LINKS.website} to request a review.`,
    gamblingDisabled: 'CUHZ Bot points games are unavailable on this channel.',
    // Commerce-enabled variants (used only when the site checkout is live). Prices
    // are NEVER here — the single price registry is commerce_content.js; these just
    // route to the live site surfaces.
    buildCommerce: `🛠️ CUHZ Bot builds custom chat tools, agents & stream workflows for streamers → ${APPROVED_LINKS.website}/solutions`,
    toolsCommerce: `🧰 Streamer tools & CUHZ digital goods live on the Planet → ${APPROVED_LINKS.website}/store`
});

function launchCommandResponse(command, opts = {}) {
    const key = String(command || '').trim().toLowerCase().split(/\s+/)[0];
    const commerce = !!opts.commerceEnabled;
    if (key === '!build' || key === '!services' || key === '!agents') {
        return commerce ? RESPONSES.buildCommerce : RESPONSES.build;
    }
    if (key === '!shop') {
        // Commerce live → defer to the commerce registry (maps !shop → !store).
        return commerce ? null : RESPONSES.shop;
    }
    if (key === '!tools') return commerce ? RESPONSES.toolsCommerce : RESPONSES.tools;
    if (key === '!audit') return RESPONSES.audit;
    return null;
}

function utilityHelp(enableGambling = false) {
    const base = '🛠️ Utility: !lurk !unlurk !points !top !uptime !game !socials !commands !ping !nf !sub !raid';
    return enableGambling ? `${base} !gamble` : base;
}

module.exports = { RESPONSES, launchCommandResponse, utilityHelp };
