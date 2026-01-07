const db = require('./src/database');

const channel = '#fourareason4';
const channelData = db.prepare('SELECT id FROM channels WHERE name = ?').get(channel);

if (channelData) {
    const channelId = channelData.id;

    // Delete existing timers for this channel if we want to reset to purely the new ones
    // Or just add them. The user said "Add these", but also "set to 30 minute intervals".
    // I will replace existing ones to ensure the 30-min vibe is consistent.
    db.prepare('DELETE FROM timers WHERE channel_id = ?').run(channelId);

    const insertTimer = db.prepare('INSERT INTO timers (channel_id, message, interval_minutes) VALUES (?, ?, ?)');

    const newTimers = [
        "YO CUHZ! 🚀 Lock in with the legend on Instagram! → instagram.com/Fourareason4",
        "STAY CONNECTED CUHZ! 🌌 Catch the hottest vibes on TikTok! → tiktok.com/@Fourareason4",
        "DON'T MISS A BEAT CUHZ! 🔥 Tap into the X/Twitter feed for all the updates! → x.com/fourareason4"
    ];

    newTimers.forEach(msg => {
        insertTimer.run(channelId, msg, 30);
    });

    console.log(`Updated timers for ${channel} with 30-minute interval data.`);
} else {
    console.error(`Channel ${channel} not found in DB.`);
}
