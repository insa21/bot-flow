// handlers/windowHandlers.js — IPC handler untuk kontrol window & config/prompts
'use strict';

const { dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

const ROOT         = path.join(__dirname, '..', '..');
const ENV_FILE     = path.join(ROOT, '.env');
const PROMPTS_FILE = path.join(ROOT, 'prompts.txt');
const OUTPUT_DIR   = path.join(ROOT, 'output');

// ─── .env helpers ────────────────────────────────────────────────────────────
function readEnv() {
    const defaults = {
        HEADLESS: 'false', IMAGE_SIZE: '2k', TIMEOUT_MS: '120000',
        MAX_RETRIES: '3', CONTEXT_MENU_TIMEOUT_MS: '15000',
        DOWNLOAD_TIMEOUT_MS: '300000', USER_DATA_DIR: './browser_session',
        OUTPUT_DIR,
    };
    try {
        const raw = fs.readFileSync(ENV_FILE, 'utf-8');
        raw.split('\n').forEach(line => {
            const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
            if (m) defaults[m[1].trim()] = m[2].trim();
        });
    } catch { /* use defaults */ }
    return defaults;
}

function writeEnv(config) {
    const lines = Object.entries(config).map(([k, v]) => `${k}=${v}`).join('\n');
    fs.writeFileSync(ENV_FILE, lines + '\n', 'utf-8');
}

function readPrompts() {
    try { return fs.readFileSync(PROMPTS_FILE, 'utf-8'); } catch { return ''; }
}

function writePrompts(text) { fs.writeFileSync(PROMPTS_FILE, text, 'utf-8'); }

// ─── Setup handlers ──────────────────────────────────────────────────────────
function setupWindowHandlers(ipcMain, win) {
    // Window controls
    ipcMain.on('win-minimize', () => win?.minimize());
    ipcMain.on('win-maximize', () => {
        if (win?.isMaximized()) win.unmaximize(); else win?.maximize();
    });
    ipcMain.on('win-close', () => win?.close());

    // Config & prompts
    ipcMain.handle('read-config',  () => readEnv());
    ipcMain.handle('read-prompts', () => readPrompts());

    // Export log
    ipcMain.handle('export-log', async (_, logText) => {
        const result = await dialog.showSaveDialog(win, {
            title: 'Export Log',
            defaultPath: `bot-log-${new Date().toISOString().slice(0, 10)}.txt`,
            filters: [{ name: 'Text Files', extensions: ['txt'] }],
        });
        if (result.canceled) return { ok: false };
        try { fs.writeFileSync(result.filePath, logText, 'utf-8'); return { ok: true }; }
        catch (err) { return { ok: false, error: err.message }; }
    });
}

module.exports = { setupWindowHandlers, readEnv, writeEnv, readPrompts, writePrompts, OUTPUT_DIR, ROOT };
