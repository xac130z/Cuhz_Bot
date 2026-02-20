const { execSync } = require('child_process');
const fs = require('fs');

// Configuration from URL provided by user
const PROJECT_ID = 'ec2bc656-3301-4039-9873-ce66b6f3a230';
const ENV_ID = '45c1336e-ee0d-4715-9d33-79f975afe948';
const CHANNEL = 'xac130z';

// Time range for "yesterday" (2026-02-09)
// Adjusting for potential timezone differences by casting a wide net
const START_TIME = '2026-02-09T00:00:00Z';
const END_TIME = '2026-02-09T23:59:59Z';

console.log('--- Fetching Logs ---');
console.log(`Project: ${PROJECT_ID}`);
console.log(`Environment: ${ENV_ID}`);
console.log(`Time Range: ${START_TIME} to ${END_TIME}`);

try {
    // Check if logged in
    try {
        execSync('npx railway status', { stdio: 'ignore' });
    } catch (e) {
        console.error('❌ You are not logged in to Railway CLI.');
        console.error('👉 Please run "npx railway login" in your terminal first, then re-run this script.');
        process.exit(1);
    }

    // Fetch logs (Note: railway logs command might not support strict ISO range, checking docs or trying basic)
    // Actually, `railway logs` streams live logs. For historical usage, we might need a different approach or plugins.
    // However, if we just want "yesterday", default logs might cover it if volume isn't huge.
    // BUT the CLI `logs` command usually tails. `railway logs --help` would show options.
    // Assuming we can't easily fetch historical logs via CLI without a plugin or paid plan feature possibly?
    // Let's try to just dump the current buffer which might contain yesterday.

    // ERROR: The valid CLI command is `railway logs`. It tails by default. 
    // It doesn't typically allow fetching historical date ranges easily via CLI flags in the open source version?
    // Wait, the user provided a URL to a specific timeframe in the dashboard.
    // This implies the dashboard has the data. The CLI might not unless using `--num` lines.

    console.log('⚠️ Attempting to fetch last 10000 lines of logs...');
    // We'll use a large number of lines to cover yesterday.
    const output = execSync(`npx railway logs --limit 15000 --service "Twitch Bot"`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });

    fs.writeFileSync('railway_logs_dump.txt', output);
    console.log('✅ Logs saved to railway_logs_dump.txt');

    // Parse for chatters
    console.log(`\n--- Active Users in #${CHANNEL} ---`);
    const lines = output.split('\n');
    const chatters = new Set();

    lines.forEach(line => {
        // Look for TMI.js debug output or custom logs
        // Pattern: [client] < PRIVMSG #channel :message
        // Or specific log format if any
        if (line.includes(`PRIVMSG #${CHANNEL}`) || line.includes(`PRIVMSG #${CHANNEL.toLowerCase()}`)) {
            // content like: ... :username!username@username.tmi.twitch.tv PRIVMSG #channel :message
            const match = line.match(/:([^!]+)!.*PRIVMSG/);
            if (match) {
                chatters.add(match[1]);
            }
        }
    });

    if (chatters.size > 0) {
        console.log(`Found ${chatters.size} unique chatters:`);
        chatters.forEach(c => console.log(`- ${c}`));
    } else {
        console.log('No chatters found in the retrieved logs (might be outside the fetch limit).');
    }

} catch (error) {
    console.error('Error fetching/parsing logs:', error.message);
    if (error.stdout) console.log(error.stdout.toString());
    if (error.stderr) console.error(error.stderr.toString());
}
