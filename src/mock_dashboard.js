const express = require('express');
const app = express();
const port = 3001;

app.use(express.json());

// Mock Data
const mockChannels = [
    { name: '#local_test_channel' },
    { name: '#mock_cuhz' },
    { name: '#fourareason4' }
];

// --- Mock Dashboard API ---

// GET channels
app.get('/api/bot/channels', (req, res) => {
    console.log('[MOCK] GET /api/bot/channels called');
    res.json({
        channels: mockChannels,
        channelLogins: mockChannels.map(c => c.name.replace('#', ''))
    });
});

// POST verify
app.post('/api/bot/verify', (req, res) => {
    console.log('[MOCK] POST /api/bot/verify called with:', req.body);
    res.json({ status: 'active', verified: true });
});

// POST command
app.post('/api/bot/command', (req, res) => {
    console.log('[MOCK] POST /api/bot/command called with:', req.body);
    res.json({
        reply: `[MOCK] Handled command: ${req.body.command}`
    });
});

// --- Mock Twitch API ---

// Mock OAuth Validation
app.get('/auth/validate', (req, res) => {
    console.log('[MOCK] GET /auth/validate called');
    // Simulate valid token
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

    // Simulate "fourareason4" is LIVE, others offline
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
                started_at: new Date(Date.now() - 3600000).toISOString(), // Started 1 hour ago
                language: "en",
                thumbnail_url: "https://example.com/thumbnail.jpg"
            }]
        });
    } else {
        // Offline
        res.json({ data: [] });
    }
});

app.listen(port, () => {
    console.log(`Mock Dashboard API & Twitch API running at http://localhost:${port}`);
});
