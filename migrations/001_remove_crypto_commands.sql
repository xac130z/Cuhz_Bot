-- Migration: Remove Crypto Commands & Update Help
-- Description: Removes all crypto/token related commands and updates the help command for the Non-Crypto V1 release.

-- 1. Remove specific crypto commands
DELETE FROM commands 
WHERE name IN (
    'token', 
    'contract', 
    'ca', 
    'chart', 
    'price', 
    'buy', 
    'holders', 
    'lp', 
    'burn'
);

-- 2. Remove any commands containing crypto keywords in response (Safety Net)
DELETE FROM commands 
WHERE response ILIKE '%pump.fun%' 
   OR response ILIKE '%solana%' 
   OR response ILIKE '%wallet%';

-- 3. Update the 'help' command with the new non-crypto list
INSERT INTO commands (name, aliases, response, permission, cooldown_seconds, enabled) 
VALUES (
    'help',
    ARRAY['commands'],
    '🌌 Planet CUHZ Commands: !cuhz !links !discord !whatiscuhz !whitepaper !roadmap !rules !privacy !cuhzchain !store !schedule !giveaway !gm !gn !hype !uptime | Mods: !announce !so !raid',
    'everyone',
    20,
    true
)
ON CONFLICT (name) DO UPDATE 
SET response = EXCLUDED.response,
    aliases = EXCLUDED.aliases,
    permission = EXCLUDED.permission,
    cooldown_seconds = EXCLUDED.cooldown_seconds,
    enabled = EXCLUDED.enabled;

-- 4. Remove crypto-related timers (if stored in DB)
DELETE FROM timers 
WHERE message ILIKE '%pump.fun%' 
   OR message ILIKE '%token%' 
   OR name ILIKE '%crypto%';
