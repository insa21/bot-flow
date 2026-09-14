// handlers/sessionHandlers.js — Manajemen multi-sesi paralel (Apple/Google Style)
'use strict';

const path   = require('path');
const fs     = require('fs');
const { spawn }  = require('child_process');
const { dialog } = require('electron');
const { CONFIG_ROOT, APP_PATH } = require('./windowHandlers');
const { readAccounts } = require('./accountHandlers');

// ─── Paths ───────────────────────────────────────────────────────────────────
const SESSIONS_CFG = path.join(CONFIG_ROOT, 'multi_sessions.json');
const TMP_DIR      = path.join(CONFIG_ROOT, 'tmp_sessions');

const CHROME_PATH = process.env.CHROME_EXECUTABLE_PATH
    || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// ─── Runtime state ───────────────────────────────────────────────────────────
// Map<sessionId, { process: ChildProcess }>
const runningMap = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────
function ensureTmp() {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function generateId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
}

function readSessions() {
    try {
        if (fs.existsSync(SESSIONS_CFG))
            return JSON.parse(fs.readFileSync(SESSIONS_CFG, 'utf-8'));
    } catch { /* corrupt */ }
    return { sessions: [] };
}

function writeSessions(data) {
    fs.writeFileSync(SESSIONS_CFG, JSON.stringify(data, null, 2), 'utf-8');
}

function updateSessionField(id, fields) {
    const data = readSessions();
    data.sessions = data.sessions.map(s => {
        if (s.id === id) {
            return { ...s, ...fields };
        }
        return s;
    });
    writeSessions(data);
}

/** Bagi array prompts secara merata ke N bagian */
function splitPromptsEvenly(lines, n) {
    const filtered = lines.filter(l => l.trim() && !l.trim().startsWith('#'));
    const size = Math.ceil(filtered.length / n);
    const parts = [];
    for (let i = 0; i < n; i++) {
        parts.push(filtered.slice(i * size, (i + 1) * size));
    }
    return parts;
}

/** Resolve path bot index.js */
function getBotPath() {
    let p = path.join(APP_PATH, 'index.js');
    if (!fs.existsSync(p)) {
        const p2 = path.join(APP_PATH, '..', 'index.js');
        if (fs.existsSync(p2)) return p2;
    }
    return p;
}

const isPackaged = !process.defaultApp &&
    !/node_modules[\\/]electron[\\/]/.test(process.execPath);

function notify(win, channel, data) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function broadcastSessionUpdate(win) {
    notify(win, 'session:stateUpdate', getFullState());
}

function getFullState() {
    const data = readSessions();
    return data.sessions.map(s => ({
        ...s,
        running: runningMap.has(s.id),
    }));
}

// ─── Start one session ──────────────────────────────────────────────────────
function startSession(win, session, globalConfig) {
    if (runningMap.has(session.id)) return { ok: false, error: 'Already running.' };

    if (!session.promptsFile || !fs.existsSync(session.promptsFile)) {
        return { ok: false, error: `File prompts untuk sesi "${session.name}" belum dipilih atau tidak ditemukan.\nGunakan tombol "Choose File" pada kartu ini.` };
    }

    // Jika folder output belum dipilih, buat otomatis di folder file prompt
    let outputDir = session.outputDir;
    if (!outputDir) {
        if (session.promptsSourcePath && fs.existsSync(session.promptsSourcePath)) {
            const promptDir = path.dirname(session.promptsSourcePath);
            outputDir = path.join(promptDir, 'output');
        } else {
            outputDir = path.join(CONFIG_ROOT, 'output', session.name || session.id);
        }
        // Simpan outputDir ke session config agar konsisten & terupdate di UI
        updateSessionField(session.id, { outputDir });
    }

    // Jika belum ada akun dipilih, gunakan browser_session default (fallback)
    const userDataDir = session.accountSessionDir
        ? session.accountSessionDir
        : path.join(CONFIG_ROOT, 'browser_session');

    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const logsDir = path.join(CONFIG_ROOT, 'logs');
    const dlsDir  = path.join(TMP_DIR, session.id + '_dl');
    if (!fs.existsSync(dlsDir)) fs.mkdirSync(dlsDir, { recursive: true });

    // Gunakan config spesifik sesi, atau fallback ke global
    const config = session.config || {};
    const headless  = config.headless !== undefined ? config.headless : globalConfig?.headless;
    const imageSize = config.imageSize || globalConfig?.imageSize || '2k';
    const timeoutMs = config.timeoutMs !== undefined ? config.timeoutMs : (globalConfig?.timeoutMs || 120000);
    const maxRetries = config.maxRetries !== undefined ? config.maxRetries : (globalConfig?.maxRetries || 3);
    const ctxTimeout = config.ctxTimeout !== undefined ? config.ctxTimeout : (globalConfig?.ctxTimeout || 15000);
    const dlTimeout  = config.dlTimeout !== undefined ? config.dlTimeout : (globalConfig?.dlTimeout || 300000);
    const resume      = config.resume !== undefined ? config.resume : false;
    const typingSpeed = config.typingSpeed || 'normal';

    // Hapus file progress jika resume dinonaktifkan
    if (!resume) {
        const progressFile = path.join(outputDir, `.progress_${session.id}.json`);
        const legacyFile   = path.join(outputDir, '.progress.json');
        try { fs.unlinkSync(progressFile); } catch (e) { /* ok */ }
        try { fs.unlinkSync(legacyFile); } catch (e) { /* ok */ }
    }

    const env = {
        ...process.env,
        // Config bot
        HEADLESS:                headless ? 'true' : 'false',
        IMAGE_SIZE:              imageSize,
        TIMEOUT_MS:              String(timeoutMs),
        MAX_RETRIES:             String(maxRetries),
        CONTEXT_MENU_TIMEOUT_MS: String(ctxTimeout),
        DOWNLOAD_TIMEOUT_MS:     String(dlTimeout),
        TYPING_SPEED:            typingSpeed,
        // Per-session
        USER_DATA_DIR:      userDataDir,
        OUTPUT_DIR:        outputDir,
        PROMPTS_PATH:      session.promptsFile,
        LOG_DIR:           logsDir,
        DOWNLOADS_TEMP_DIR: dlsDir,
        DOTENV_CONFIG_PATH: '/dev/null',
        CHROME_EXECUTABLE_PATH: CHROME_PATH,
        SESSION_ID: session.id,
    };

    const botPath = getBotPath();
    let proc;
    if (isPackaged) {
        proc = spawn(process.execPath, [botPath], {
            cwd: CONFIG_ROOT, env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
            windowsHide: true,
        });
    } else {
        proc = spawn('node', [botPath], { cwd: CONFIG_ROOT, env, windowsHide: true });
    }

    updateSessionField(session.id, { status: 'running', progress: { current: 0, total: 0 } });

    // Stream log stdout dari sub-proses bot
    let buffer = '';
    proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        let lines = buffer.split('\n');
        buffer = lines.pop(); // simpan sisa
        for (const line of lines) {
            const clean = line.trim();
            if (!clean) continue;
            // Kirim ke UI log stream
            notify(win, 'session:log', { sessionId: session.id, line: clean });

            // Deteksi progress status dari log bot, misal: "[2/10] Sukses..."
            const match = clean.match(/\[(\d+)\/(\d+)\]/);
            if (match) {
                const current = parseInt(match[1]);
                const total   = parseInt(match[2]);
                updateSessionField(session.id, { progress: { current, total } });
                broadcastSessionUpdate(win);
            }
        }
    });

    proc.on('close', (code) => {
        runningMap.delete(session.id);
        const st = (code === 0) ? 'completed' : 'error';
        updateSessionField(session.id, { status: st });
        broadcastSessionUpdate(win);
        notify(win, 'session:log', { sessionId: session.id, line: `[System] Category session ended (code: ${code})` });
    });

    proc.on('error', (err) => {
        runningMap.delete(session.id);
        updateSessionField(session.id, { status: 'error' });
        broadcastSessionUpdate(win);
        notify(win, 'session:log', { sessionId: session.id, line: `[System Error] ❌ Error: ${err.message}` });
    });

    runningMap.set(session.id, { process: proc });
    return { ok: true };
}

// ─── Setup handlers ───────────────────────────────────────────────────────────
function setupSessionHandlers(ipcMain, win) {
    // Startup recovery: Reset any leftover stuck "running" status to "stopped"
    try {
        const data = readSessions();
        let changed = false;
        data.sessions = data.sessions.map(s => {
            if (s.status === 'running') {
                s.status = 'stopped';
                changed = true;
            }
            return s;
        });
        if (changed) writeSessions(data);
    } catch (e) {
        console.error('Failed to run startup session recovery:', e);
    }

    // LIST sessions (dengan runtime status)
    ipcMain.handle('session:list', () => getFullState());

    // CREATE session baru
    ipcMain.handle('session:create', (_, { name } = {}) => {
        const data = readSessions();
        const idx  = data.sessions.length + 1;
        const id   = generateId();
        const newSession = {
            id,
            name:             name || `Category ${idx}`,
            accountId:        null,
            accountSessionDir:null,
            promptsFile:      null,
            promptCount:      0,
            outputDir:        null,
            status:           'idle',
            progress:         { current: 0, total: 0 },
            createdAt:        new Date().toISOString(),
            config: {
                headless:    false,
                imageSize:   '2k',
                timeoutMs:   120000,
                maxRetries:  3,
                ctxTimeout:  15000,
                dlTimeout:   300000,
                resume:      false,
            }
        };
        data.sessions.push(newSession);
        writeSessions(data);
        broadcastSessionUpdate(win);
        return { ok: true, session: newSession };
    });

    // DELETE session
    ipcMain.handle('session:delete', (_, id) => {
        if (runningMap.has(id)) {
            try { runningMap.get(id).process.kill('SIGTERM'); } catch {}
            runningMap.delete(id);
        }
        const data = readSessions();
        const sess = data.sessions.find(s => s.id === id);
        if (sess?.promptsFile && sess.promptsFile.startsWith(TMP_DIR)) {
            try { fs.unlinkSync(sess.promptsFile); } catch {}
        }
        data.sessions = data.sessions.filter(s => s.id !== id);
        writeSessions(data);
        broadcastSessionUpdate(win);
        return { ok: true };
    });

    // UPDATE field sesi (name, accountId, dll.)
    ipcMain.handle('session:update', (_, { id, fields }) => {
        const data = readSessions();
        const sess = data.sessions.find(s => s.id === id);
        if (!sess) return { ok: false, error: 'Session not found.' };

        if (fields.accountId !== undefined && fields.accountId !== sess.accountId) {
            const accounts = readAccounts();
            const acc = accounts.accounts.find(a => a.id === fields.accountId);
            fields.accountSessionDir = acc?.sessionDir || null;
        }

        Object.assign(sess, fields);
        writeSessions(data);
        broadcastSessionUpdate(win);
        return { ok: true };
    });

    // CHOOSE output dir
    ipcMain.handle('session:chooseDir', async (_, id) => {
        const result = await dialog.showOpenDialog(win, {
            title:      'Select Output Folder for This Category',
            properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled || !result.filePaths[0]) return { ok: false };
        const dir = result.filePaths[0];
        updateSessionField(id, { outputDir: dir });
        broadcastSessionUpdate(win);
        return { ok: true, dir };
    });

    // CHOOSE prompts file
    ipcMain.handle('session:choosePromptsFile', async (_, id) => {
        const result = await dialog.showOpenDialog(win, {
            title:   'Select Prompts File for This Category',
            filters: [
                { name: 'Text Files', extensions: ['txt'] },
                { name: 'All Files',  extensions: ['*'] },
            ],
            properties: ['openFile'],
        });
        if (result.canceled || !result.filePaths[0]) return { ok: false };
        const srcFile = result.filePaths[0];
        ensureTmp();
        const destFile = path.join(TMP_DIR, `${id}_prompts.txt`);
        fs.copyFileSync(srcFile, destFile);
        const lines = fs.readFileSync(destFile, 'utf-8')
            .split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
        const promptCount = lines.length;
        updateSessionField(id, { promptsFile: destFile, promptsSourcePath: srcFile, promptCount });
        broadcastSessionUpdate(win);
        return { ok: true, file: srcFile, promptCount };
    });

    // SPLIT prompts
    ipcMain.handle('session:splitPrompts', (_, { promptsText }) => {
        const data = readSessions();
        if (data.sessions.length === 0) return { ok: false, error: 'Please add at least one category first.' };

        ensureTmp();
        const lines = promptsText.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
        const parts = splitPromptsEvenly(lines, data.sessions.length);

        data.sessions = data.sessions.map((sess, i) => {
            const part  = parts[i] || [];
            const fpath = path.join(TMP_DIR, `${sess.id}_prompts.txt`);
            fs.writeFileSync(fpath, part.join('\n') + '\n', 'utf-8');
            return { ...sess, promptsFile: fpath, promptCount: part.length };
        });

        writeSessions(data);
        broadcastSessionUpdate(win);
        return { ok: true, counts: data.sessions.map(s => s.promptCount) };
    });

    // GET global config
    function readGlobalConfig() {
        const { readEnv } = require('./windowHandlers');
        const env = readEnv();
        return {
            headless:    env.HEADLESS === 'true',
            imageSize:   env.IMAGE_SIZE || '2k',
            timeoutMs:   parseInt(env.TIMEOUT_MS) || 120000,
            maxRetries:  parseInt(env.MAX_RETRIES) || 3,
            ctxTimeout:  parseInt(env.CONTEXT_MENU_TIMEOUT_MS) || 15000,
            dlTimeout:   parseInt(env.DOWNLOAD_TIMEOUT_MS) || 300000,
        };
    }

    // START
    ipcMain.handle('session:start', (_, id) => {
        const data = readSessions();
        const sess = data.sessions.find(s => s.id === id);
        if (!sess) return { ok: false, error: 'Session not found.' };
        return startSession(win, sess, readGlobalConfig());
    });

    // STOP (dengan force-stop override)
    ipcMain.handle('session:stop', (_, id) => {
        if (runningMap.has(id)) {
            try {
                const { process: proc } = runningMap.get(id);
                proc.kill('SIGTERM');
                setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 3000);
            } catch {}
            runningMap.delete(id);
        }
        updateSessionField(id, { status: 'stopped' });
        broadcastSessionUpdate(win);
        return { ok: true };
    });

    // START ALL
    ipcMain.handle('session:startAll', () => {
        const data   = readSessions();
        const config = readGlobalConfig();
        const errors = [];
        for (const sess of data.sessions) {
            if (!runningMap.has(sess.id)) {
                const r = startSession(win, sess, config);
                if (!r.ok) errors.push(`${sess.name}: ${r.error}`);
            }
        }
        return errors.length > 0
            ? { ok: false, errors }
            : { ok: true };
    });

    // STOP ALL
    ipcMain.handle('session:stopAll', () => {
        for (const [id, { process: proc }] of runningMap.entries()) {
            try { proc.kill('SIGTERM'); } catch {}
            runningMap.delete(id);
            updateSessionField(id, { status: 'stopped' });
        }
        broadcastSessionUpdate(win);
        return { ok: true };
    });

    // RESET
    ipcMain.handle('session:reset', (_, id) => {
        if (runningMap.has(id)) return { ok: false, error: 'Session still running.' };
        updateSessionField(id, { status: 'idle', progress: { current: 0, total: 0 } });
        broadcastSessionUpdate(win);
        return { ok: true };
    });
}

module.exports = { setupSessionHandlers };
