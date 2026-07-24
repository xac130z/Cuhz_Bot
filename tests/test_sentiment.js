/**
 * Test script for AI sentiment analysis
 * Run with: node tests/test_sentiment.js
 */

const assert = require('assert');
const aiService = require('../src/ai_service');

// ─── Knowledge-base accuracy (deterministic, runs even with no API keys) ───
// The AI brains are briefed with the real planetcuhz.com surfaces from the
// SITE TRUTH PACK — never the retired created.app chain generator — and the
// honesty rules (Architect quote-only, store items buyable, never "instant").
const kb = aiService.CUHZ_KNOWLEDGE;
assert.ok(!kb.includes('created.app'), 'CUHZ_KNOWLEDGE must not reference created.app');
assert.match(kb, /https:\/\/planetcuhz\.com\/chain/);
assert.match(kb, /ten finishes/i);
assert.match(kb, /https:\/\/planetcuhz\.com\/bot/);
assert.match(kb, /https:\/\/planetcuhz\.com\/store/);
assert.match(kb, /https:\/\/planetcuhz\.com\/solutions/);
assert.match(kb, /Silver Supporter \$4\.99\/mo/);
assert.match(kb, /Gold Executive \$14\.99\/mo/);
assert.match(kb, /Affiliate Pack \$49\.99\/mo/);
assert.match(kb, /Pro \$9\.99\/mo, Team \$24\.99\/mo/);
assert.match(kb, /Chain Full Pack \$9, Emote Pack Vol\. 1 \$7, Orbit Overlay Kit \$15/);
assert.match(kb, /NEVER state a number for Architect/);
assert.match(kb, /never promise instant delivery/i);
assert.match(kb, /NEVER quote a price in chat/i);
console.log('✅ CUHZ knowledge-base accuracy checks passed');

// Sample chat messages for testing
const testMessages = [
    {
        username: 'viewer1',
        message: 'LET\'S GO! HYPE HYPE HYPE!!!'
    },
    {
        username: 'viewer2',
        message: 'W stream!! 🔥🔥🔥'
    },
    {
        username: 'viewer3',
        message: 'poggers'
    },
    {
        username: 'viewer4',
        message: 'This is amazing content!'
    },
    {
        username: 'viewer5',
        message: 'Love this community 💎'
    }
];

const negativeMessages = [
    {
        username: 'viewer1',
        message: 'this is boring'
    },
    {
        username: 'viewer2',
        message: 'not feeling this'
    },
    {
        username: 'viewer3',
        message: 'meh'
    }
];

const toxicMessages = [
    {
        username: 'viewer1',
        message: 'this streamer is trash'
    },
    {
        username: 'viewer2',
        message: 'you suck at this game'
    }
];

async function runTests() {
    console.log('🧪 Testing AI Sentiment Analysis\\n');

    try {
        // Test 1: Positive/Hype messages
        console.log('Test 1: Analyzing positive/hype messages...');
        const result1 = await aiService.analyzeSentiment(testMessages);
        console.log('Result:', result1);
        console.log('✅ Expected: hype or positive mood\\n');

        // Test 2: Negative messages
        console.log('Test 2: Analyzing negative messages...');
        const result2 = await aiService.analyzeSentiment(negativeMessages);
        console.log('Result:', result2);
        console.log('✅ Expected: negative mood\\n');

        // Test 3: Toxic messages
        console.log('Test 3: Analyzing toxic messages...');
        const result3 = await aiService.analyzeSentiment(toxicMessages);
        console.log('Result:', result3);
        console.log('✅ Expected: toxic mood with high toxicity score\\n');

        // Test 4: AI Stats
        console.log('Test 4: Checking AI stats...');
        const stats = aiService.getStats();
        console.log('Stats:', stats);
        console.log('');

        console.log('✅ All sentiment tests completed!');
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    }
}

runTests();
