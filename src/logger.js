function formatTime() {
    return new Date().toISOString();
}

const logger = {
    info: (msg, ...args) => {
        console.log(`[${formatTime()}] [INFO] ${msg}`, ...args);
    },
    error: (msg, ...args) => {
        console.error(`[${formatTime()}] [ERROR] ${msg}`, ...args);
    },
    debug: (msg, ...args) => {
        if (process.env.DEBUG === 'true') {
            console.log(`[${formatTime()}] [DEBUG] ${msg}`, ...args);
        }
    }
};

module.exports = logger;
