/**
 * Test script for context-aware responses
 * Run with: node tests/test_context.js
 */

const contextHandler = require('../src/context_handler');
const db = require('../src/database');

// Sample commands
const sampleCommands = {
    '!discord': '💬 https://discord.com/invite/wt6Zc7Sgjx',
    '!cuhz': '🚀 https://planetcuhz.com',
    '!uptime': 'Stream uptime command',
    '!points': 'Check your points'
};

async function runTests() {
    console.log('🧪 Testing Context-Aware Responses\\n');

    const channel = '#testchannel';
    contextHandler.initChannel(channel);

    // Add some context
    contextHandler.addToContext(channel, 'user1', 'hey everyone!');
    contextHandler.addToContext(channel, 'user2', 'this stream is cool');
    contextHandler.addToContext(channel, 'user3', 'how are you?');

    try {
        // Test 1: Question about discord
        console.log('Test 1: "how do I join the discord?"');
        const match1 = contextHandler.matchExistingCommand('how do I join the discord?', sampleCommands);
        console.log('Matched command response:', match1);
        console.log('✅ Should match discord command\\n');

        // Test 2: Question about Planet CUHZ
        console.log('Test 2: "what is planet cuhz?"');
        const match2 = contextHandler.matchExistingCommand('what is planet cuhz?', sampleCommands);
        console.log('Matched command response:', match2);
        console.log('✅ Should match cuhz command\\n');

        // Test 3: Is question detection
        console.log('Test 3: Question detection');
        console.log('Is "how do i?" a question?', contextHandler.isQuestionOrRequest('how do i join?'));
        console.log('Is "LFG!!!" a question?', contextHandler.isQuestionOrRequest('LFG!!!'));
        console.log('Is "can you help me?" a question?', contextHandler.isQuestionOrRequest('can you help me?'));
        console.log('');

        // Test 4: Cache stats
        console.log('Test 4: Cache statistics');
        const stats = contextHandler.getCacheStats();
        console.log('Cache stats:', stats);
        console.log('');

        // Test 5: Context retrieval
        console.log('Test 5: Context retrieval');
        const context = contextHandler.getContext(channel);
        console.log('Context buffer:', context);
        console.log('');

        console.log('✅ All context tests completed!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    }
}

runTests();
