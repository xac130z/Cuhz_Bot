/**
 * Test script for AI sentiment analysis
 * Run with: node tests/test_sentiment.js
 */

const aiService = require('../src/ai_service');

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
