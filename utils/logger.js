const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

// File log harian: logs/bot-2026-06-13.log
const today = new Date().toISOString().slice(0, 10);
const LOG_FILE = path.join(LOG_DIR, `bot-${today}.log`);

const log = (message, type = 'INFO') => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const prefix = type === 'ERROR' ? '❌' : type === 'SUCCESS' ? '✅' : type === 'WARN' ? '⚠️' : 'ℹ️';
    const line = `[${timestamp}] ${prefix} ${message}`;
    console.log(line);
    // Tulis ke file log tanpa emoji (lebih mudah dibaca di editor teks biasa)
    const plainLine = `[${timestamp}] [${type.padEnd(7)}] ${message}\n`;
    try { fs.appendFileSync(LOG_FILE, plainLine); } catch { /* abaikan error write log */ }
};

module.exports = { log, LOG_FILE };