/**
 * Test script for mood tracker
 * Run with: node tests/test_mood_tracker.js
 */

const moodTracker = require('../src/mood_tracker');

async function runTests() {
    console.log('🧪 Testing Mood Tracker\\n');

    const channel = '#testchannel';
    moodTracker.initChannel(channel);

    try {
        // Test 1: Add messages
        console.log('Test 1: Adding messages to buffer...');
        moodTracker.addMessage(channel, 'user1', 'LET\'S GO!!!');
        moodTracker.addMessage(channel, 'user2', 'HYPE HYPE');
        moodTracker.addMessage(channel, 'user3', 'W stream');
        moodTracker.addMessage(channel, 'user4', '🔥🔥🔥');
        moodTracker.addMessage(channel, 'user5', 'poggers');
        console.log('✅ 5 messages added\\n');

        // Test 2: Get mood state
        console.log('Test 2: Initial mood state');
        let state = moodTracker.getMoodState(channel);
        console.log('Mood state:', {
            mood: state.currentMood,
            personality: state.currentPersonality,
            energy: state.energy,
            toxicity: state.toxicity,
            bufferSize: state.messageBuffer.length
        });
        console.log('');

        // Test 3: Update mood with sentiment
        console.log('Test 3: Updating mood with hype sentiment...');
        moodTracker.updateMood(channel, {
            mood: 'hype',
            energy: 85,
            toxicity: 5,
            summary: 'Very energetic and positive chat'
        });
        state = moodTracker.getMoodState(channel);
        console.log('Updated state:', {
            mood: state.currentMood,
            personality: state.currentPersonality,
            energy: state.energy,
            toxicity: state.toxicity
        });
        console.log('✅ Personality should be "hype"\\n');

        // Test 4: Toxic mood
        console.log('Test 4: Updating with toxic sentiment...');
        moodTracker.updateMood(channel, {
            mood: 'toxic',
            energy: 60,
            toxicity: 75,
            summary: 'High toxicity detected'
        });
        state = moodTracker.getMoodState(channel);
        console.log('Updated state:', {
            mood: state.currentMood,
            personality: state.currentPersonality,
            toxicity: state.toxicity
        });
        console.log('✅ Personality should be "moderated"\\n');

        // Test 5: Manual personality override
        console.log('Test 5: Manual personality override...');
        const success = moodTracker.setPersonality(channel, 'chill');
        console.log('Override success:', success);
        state = moodTracker.getMoodState(channel);
        console.log('Current personality:', state.currentPersonality);
        console.log('✅ Should be "chill"\\n');

        // Test 6: Personality config
        console.log('Test 6: Getting personality config...');
        const config = moodTracker.getPersonalityConfig('hype');
        console.log('Hype personality:', config);
        console.log('');

        // Test 7: Check if hype injection needed
        console.log('Test 7: Low energy detection...');
        // Simulate low energy over time
        for (let i = 0; i < 5; i++) {
            moodTracker.updateMood(channel, {
                mood: 'neutral',
                energy: 30,
                toxicity: 0,
                summary: 'Low energy'
            });
        }
        const needsHype = moodTracker.needsHypeInjection(channel);
        console.log('Needs hype injection:', needsHype);
        console.log('✅ Should be true (energy < 40)\\n');

        console.log('✅ All mood tracker tests completed!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    }
}

runTests();
