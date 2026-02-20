const db = require('./src/database');

console.log('🎯 Setting up staggered timer intervals for smooth flow...\n');

// Define staggered intervals for each timer to avoid overwhelming chat
const timerConfig = [
    {
        channel: '#xac130z',
        timers: [
            { message: "YO CUHZ! 🚀 Lock in with the legend on Instagram! → instagram.com/xac130z", interval: 60 },
            { message: "STAY CONNECTED CUHZ! 🌌 Catch the hottest vibes on TikTok! → tiktok.com/@xac130z", interval: 45 },
            { message: "DON'T MISS A BEAT CUHZ! 🔥 Tap into the X/Twitter feed for all the updates! → x.com/xac130z", interval: 75 }
        ]
    },
    {
        channel: '#planetcuhz',
        timers: [
            { message: "🌌 Planet CUHZ → https://planetcuhz.com", interval: 60 },
            { message: "🔗 All links → https://linktr.ee/PlanetCUHZ", interval: 60 }
        ]
    },
    {
        channel: '#rico_santanax',
        timers: [
            { message: "🌌 Planet CUHZ → https://planetcuhz.com", interval: 60 },
            { message: "🔗 All links → https://linktr.ee/PlanetCUHZ", interval: 60 }
        ]
    }
];

timerConfig.forEach(config => {
    const channelData = db.prepare('SELECT id FROM channels WHERE name = ?').get(config.channel);

    if (channelData) {
        const channelId = channelData.id;

        // Clear existing timers for this channel
        db.prepare('DELETE FROM timers WHERE channel_id = ?').run(channelId);

        const insertTimer = db.prepare('INSERT INTO timers (channel_id, message, interval_minutes) VALUES (?, ?, ?)');

        console.log(`📝 ${config.channel}:`);
        config.timers.forEach(timer => {
            insertTimer.run(channelId, timer.message, timer.interval);
            console.log(`   ✓ ${timer.interval}min - ${timer.message.substring(0, 50)}...`);
        });
        console.log('');
    } else {
        console.error(`❌ Channel ${config.channel} not found in database.`);
    }
});

console.log('✅ Timer intervals updated successfully!');
console.log('\n📊 Flow Pattern:');
console.log('   #xac130z: 60min → 45min → 75min (staggered)');
console.log('   #planetcuhz: 60min → 60min (consistent)');
console.log('   #rico_santanax: 60min → 60min (consistent)');
console.log('\n💡 This creates a natural rhythm without overwhelming viewers.');
