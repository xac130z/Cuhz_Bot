const express = require('express');
const db = require('./database');
const app = express();
const port = 3001;

app.use(express.json());

// Helper to verify token (optional but good for consistency)
const BOT_API_SECRET = process.env.BOT_API_SECRET || 'cuhz_secret_123';

function verifySecret(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${BOT_API_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// --- Dashboard API ---

// GET channels
app.get('/api/bot/channels', verifySecret, (req, res) => {
    console.log('[API] GET /api/bot/channels called');
    try {
        const channels = db.prepare("SELECT name, auto_welcome, auto_marketing FROM channels WHERE status = 'active'").all();
        res.json({
            channels: channels,
            channelLogins: channels.map(c => c.name.replace('#', ''))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET settings for a channel
app.get('/api/bot/settings/:channel', verifySecret, (req, res) => {
    const channelName = req.params.channel.startsWith('#') ? req.params.channel : `#${req.params.channel}`;
    console.log(`[API] GET /api/bot/settings for ${channelName}`);
    try {
        const settings = db.prepare('SELECT auto_welcome, auto_marketing FROM channels WHERE name = ?').get(channelName);
        res.json(settings || { auto_welcome: 1, auto_marketing: 1 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET commands for a channel
app.get('/api/bot/commands/:channel', verifySecret, (req, res) => {
    const channelName = req.params.channel.startsWith('#') ? req.params.channel : `#${req.params.channel}`;
    console.log(`[API] GET /api/bot/commands for ${channelName}`);
    try {
        const commands = db.prepare(`
            SELECT c.trigger, c.response 
            FROM commands c 
            JOIN channels ch ON c.channel_id = ch.id 
            WHERE ch.name = ? AND c.is_active = 1
        `).all(channelName);

        const commandMap = {};
        commands.forEach(cmd => {
            commandMap[cmd.trigger] = cmd.response;
        });

        res.json({ commands: commandMap });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET timers for a channel
app.get('/api/bot/timers/:channel', verifySecret, (req, res) => {
    const channelName = req.params.channel.startsWith('#') ? req.params.channel : `#${req.params.channel}`;
    console.log(`[API] GET /api/bot/timers for ${channelName}`);
    try {
        const timers = db.prepare(`
            SELECT t.message, t.interval_minutes 
            FROM timers t 
            JOIN channels ch ON t.channel_id = ch.id 
            WHERE ch.name = ? AND t.is_active = 1
        `).all(channelName);

        // Use the interval from the first timer found, or default to 60
        const interval = (timers.length > 0 && timers[0].interval_minutes) ? timers[0].interval_minutes : 60;

        res.json({
            timers: timers.map(t => t.message),
            interval: interval
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST verify
app.post('/api/bot/verify', verifySecret, (req, res) => {
    console.log('[API] POST /api/bot/verify called with:', req.body);
    res.json({ status: 'active', verified: true });
});

// --- Mock Twitch API (Kept for local testing) ---

// Mock OAuth Validation
app.get('/auth/validate', (req, res) => {
    console.log('[MOCK] GET /auth/validate called');
    res.json({
        client_id: "mock_client_id_12345",
        login: "cuhz_bot",
        scopes: ["chat:read", "chat:edit"],
        user_id: "999999"
    });
});

// Mock Helix Streams
app.get('/helix/streams', (req, res) => {
    const userLogin = req.query.user_login;
    console.log(`[MOCK] GET /helix/streams called for: ${userLogin}`);

    if (userLogin === 'fourareason4') {
        res.json({
            data: [{
                id: "123456789",
                user_id: "123",
                user_login: "fourareason4",
                game_name: "Just Chatting",
                type: "live",
                title: "Mock Stream Title",
                viewer_count: 420,
                started_at: new Date(Date.now() - 3600000).toISOString(),
                language: "en",
                thumbnail_url: "https://example.com/thumbnail.jpg"
            }]
        });
    } else {
        res.json({ data: [] });
    }
});

app.listen(port, () => {
    console.log(`Dashboard API & Mock Twitch API running at http://localhost:${port}`);
});
