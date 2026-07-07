/**
 * Test personality integration with AI responses
 */

const moodTracker = require('../src/mood_tracker');
const aiService = require('../src/ai_service');

async function testPersonalityIntegration() {
    console.log('🧪 Testing Personality Integration\n');

    const channel = '#testchannel';

    // Test different personalities
    const testCases = [
        {
            personality: 'hype',
            sentiment: { mood: 'hype', energy: 85, toxicity: 5 },
            question: 'what is planet cuhz?'
        },
        {
            personality: 'chill',
            sentiment: { mood: 'positive', energy: 25, toxicity: 0 },
            question: 'what is planet cuhz?'
        },
        {
            personality: 'supportive',
            sentiment: { mood: 'negative', energy: 40, toxicity: 10 },
            question: 'how do i join?'
        }
    ];

    for (const testCase of testCases) {
        console.log(`\n--- Testing ${testCase.personality.toUpperCase()} personality ---`);

        // Initialize and set mood
        moodTracker.initChannel(channel);
        moodTracker.updateMood(channel, testCase.sentiment);

        const currentPersonality = moodTracker.getCurrentPersonality(channel);
        const personalityConfig = moodTracker.getPersonalityConfig(currentPersonality);

        console.log(`Current Personality: ${currentPersonality}`);
        console.log(`Config:`, personalityConfig);

        // Test AI response with personality
        try {
            const response = await aiService.generateContextAwareResponse(
                testCase.question,
                ['user1: hey!', 'user2: whats up'],
                currentPersonality,
                {
                    '!cuhz': '🚀 https://planetcuhz.com',
                    '!discord': '💬 https://discord.gg/wt6Zc7Sgjx'
                },
                personalityConfig
            );

            console.log(`Question: "${testCase.question}"`);
            console.log(`AI Response: "${response}"`);
            console.log(`✅ Response generated with ${currentPersonality} personality`);

        } catch (error) {
            console.error(`❌ Error: ${error.message}`);
        }

        // Wait a bit between tests to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    console.log('\n✅ Personality integration test complete!\n');
}

// Run the test
testPersonalityIntegration().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
