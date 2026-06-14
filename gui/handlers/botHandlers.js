// handlers/botHandlers.js — IPC handler untuk spawn/stop bot process & output watcher
'use strict';

const path   = require('path');
const fs     = require('fs');
const { spawn } = require('child_process');
const { writeEnv, writePrompts, OUTPUT_DIR, ROOT } = require('./windowHandlers');

// ─── State ───────────────────────────────────────────────────────────────────
let botProcess   = null;
let outputWatcher = null;

// ─── Send helpers ─────────────────────────────────────────────────────────────
function sendLog(win, line) {
    if (win && !win.isDestroyed()) win.webContents.send('log-line', line);
}

function sendStatus(win, status) {
    if (win && !win.isDestroyed()) win.webContents.send('bot-status', status);
}

function sendProgress(win, data) {
    if (win && !win.isDestroyed()) win.webContents.send('bot-progress', data);
}

// ─── Parse progress dari log line ────────────────────────────────────────────
function parseProgress(line) {
    const m = line.match(/\[(\d+)\/(\d+)\]/);
    if (m) return { current: parseInt(m[1]), total: parseInt(m[2]) };
    return null;
}

// ─── Stop bot process ─────────────────────────────────────────────────────────
function stopBot() {
    if (!botProcess) return;
    try {
        botProcess.kill('SIGTERM');
        setTimeout(() => {
            if (botProcess) { try { botProcess.kill('SIGKILL'); } catch { /* dead */ } }
        }, 3000);
    } catch { /* already gone */ }
}

// ─── Output directory watcher ─────────────────────────────────────────────────
function startOutputWatcher(win, outputDir) {
    if (outputWatcher) { outputWatcher.close(); outputWatcher = null; }
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
    outputWatcher = fs.watch(outputDir, (event, filename) => {
        if (!filename) return;
        if (!IMAGE_EXTS.includes(path.extname(filename).toLowerCase())) return;
        const fullPath = path.join(outputDir, filename);
        if (event === 'rename' && fs.existsSync(fullPath)) {
            if (win && !win.isDestroyed()) win.webContents.send('new-image', fullPath);
        }
    });
}

// ─── Cleanup trash on startup ─────────────────────────────────────────────────
function cleanTrashOnStartup() {
    const trashDir = path.join(OUTPUT_DIR, '.trash');
    try {
        if (fs.existsSync(trashDir)) {
            for (const file of fs.readdirSync(trashDir)) {
                fs.unlinkSync(path.join(trashDir, file));
            }
        }
    } catch { /* ignore */ }
}

cleanTrashOnStartup();

// ─── Setup handlers ──────────────────────────────────────────────────────────
function setupBotHandlers(ipcMain, win) {
    ipcMain.handle('start-bot', (_, { config, prompts, outputDir }) => {
        if (botProcess) return { ok: false, error: 'Bot is already running.' };
        try {
            const outDir = outputDir || OUTPUT_DIR;
            if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

            const envConfig = {
                HEADLESS: config.headless ? 'true' : 'false',
                IMAGE_SIZE: config.imageSize || '2k',
                TIMEOUT_MS: config.timeoutMs || '120000',
                MAX_RETRIES: config.maxRetries || '3',
                CONTEXT_MENU_TIMEOUT_MS: config.ctxTimeout || '15000',
                DOWNLOAD_TIMEOUT_MS: config.dlTimeout || '300000',
                USER_DATA_DIR: './browser_session',
                OUTPUT_DIR: outDir,
            };
            writeEnv(envConfig);
            writePrompts(prompts);

            const progressFile = path.join(outDir, '.progress.json');
            if (!config.resume) { try { fs.unlinkSync(progressFile); } catch { /* ok */ } }

            startOutputWatcher(win, outDir);

            botProcess = spawn('node', ['index.js'], {
                cwd: ROOT, env: { ...process.env, OUTPUT_DIR: outDir }, windowsHide: true,
            });

            sendStatus(win, 'running');
            sendLog(win, '[GUI] ✅ Bot started.');

            botProcess.stdout.on('data', data => {
                data.toString().split('\n').forEach(line => {
                    if (!line.trim()) return;
                    sendLog(win, line);
                    const prog = parseProgress(line);
                    if (prog) sendProgress(win, prog);
                });
            });

            botProcess.stderr.on('data', data => {
                data.toString().split('\n').forEach(line => {
                    if (line.trim()) sendLog(win, '[STDERR] ' + line);
                });
            });

            botProcess.on('close', code => {
                sendLog(win, `[GUI] Bot process exited (code ${code}).`);
                sendStatus(win, code === 0 ? 'completed' : 'idle');
                botProcess = null;
            });

            botProcess.on('error', err => {
                sendLog(win, `[GUI] ❌ Failed to start bot: ${err.message}`);
                sendStatus(win, 'error');
                botProcess = null;
            });

            return { ok: true };
        } catch (err) { return { ok: false, error: err.message }; }
    });

    ipcMain.handle('stop-bot', () => {
        if (!botProcess) return { ok: false, error: 'Bot is not running.' };
        sendLog(win, '[GUI] 🛑 Stopping bot...');
        sendStatus(win, 'stopping');
        stopBot();
        return { ok: true };
    });
}

module.exports = { setupBotHandlers };
