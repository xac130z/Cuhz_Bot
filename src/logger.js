const logBuffer = [];
const MAX_LOGS = 50;

function formatTime() {
    return new Date().toISOString();
}

function addLog(level, msg, ...args) {
    const logEntry = {
        timestamp: formatTime(),
        level,
        message: msg + (args.length > 0 ? ' ' + JSON.stringify(args) : '')
    };
    logBuffer.push(logEntry);
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
}

const logger = {
    info: (msg, ...args) => {
        addLog('INFO', msg, ...args);
        console.log(`[${formatTime()}] [INFO] ${msg}`, ...args);
    },
    error: (msg, ...args) => {
        addLog('ERROR', msg, ...args);
        console.error(`[${formatTime()}] [ERROR] ${msg}`, ...args);
    },
    warn: (msg, ...args) => {
        addLog('WARN', msg, ...args);
        console.warn(`[${formatTime()}] [WARN] ${msg}`, ...args);
    },
    debug: (msg, ...args) => {
        if (process.env.DEBUG === 'true') {
            addLog('DEBUG', msg, ...args);
            console.log(`[${formatTime()}] [DEBUG] ${msg}`, ...args);
        }
    },
    getLogs: () => [...logBuffer]
};

module.exports = logger;
