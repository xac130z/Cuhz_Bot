const tmi = require('tmi.js');
const config = require('./config');

const client = new tmi.Client({
    options: { debug: true },
    identity: {
        username: config.username,
        password: config.oauthToken
    },
    channels: config.channels
});

client.connect().catch(console.error);

client.on('connected', (addr, port) => {
    console.log(`* Connected to ${addr}:${port}`);
});

client.on('message', (channel, tags, message, self) => {
    // Ignore echoed messages.
    if (self) return;

    // Command handling
    if (message.toLowerCase() === '!ping') {
        client.say(channel, `@${tags.username}, Pong!`);
    } else if (message.toLowerCase() === '!hello') {
        client.say(channel, `@${tags.username}, Hello there!`);
    }
});
