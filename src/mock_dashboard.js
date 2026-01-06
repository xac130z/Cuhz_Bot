const express = require('express');
const app = express();
const port = 3001;

app.use(express.json());

// Mock Data
const mockChannels = [
    { name: '#local_test_channel' },
    { name: '#mock_cuhz' }
];

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
    // Always return success to fix the 400 error blocking issues
    res.json({ status: 'active', verified: true });
});

// POST command
app.post('/api/bot/command', (req, res) => {
    console.log('[MOCK] POST /api/bot/command called with:', req.body);
    res.json({
        reply: `[MOCK] Handled command: ${req.body.command}`
    });
});

app.listen(port, () => {
    console.log(`Mock Dashboard API running at http://localhost:${port}`);
});
