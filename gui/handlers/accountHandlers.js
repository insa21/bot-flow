// handlers/accountHandlers.js â€” Manajemen multi-akun Google Flow Bot
'use strict';

const path          = require('path');
const fs            = require('fs');
const { spawn }     = require('child_process');
const { dialog }    = require('electron');
const { CONFIG_ROOT } = require('./windowHandlers');

// â”€â”€â”€ Paths â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ACCOUNTS_FILE = path.join(CONFIG_ROOT, 'accounts.json');
const SESSIONS_DIR  = path.join(CONFIG_ROOT, 'sessions');

// Chrome asli â€” SAMA dengan yang dipakai bot (index.js)
const CHROME_PATH   = process.env.CHROME_EXECUTABLE_PATH
    || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ensureSessionsDir() {
    if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function readAccounts() {
    try {
        if (fs.existsSync(ACCOUNTS_FILE)) {
            return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
        }
    } catch { /* corrupt / belum ada */ }
    return { accounts: [], activeAccountId: null };
}

function writeAccounts(data) {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function generateId() {
    return 'acc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

/** Baca email dari file Preferences Chrome (disimpan setelah login). */
function readEmailFromSession(sessionDir) {
    try {
        // Chrome menyimpan akun di Default/Preferences
        const prefPath = path.join(sessionDir, 'Default', 'Preferences');
        if (!fs.existsSync(prefPath)) return null;
        const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf-8'));

        // account_info = array akun yang sedang login
        const info = prefs?.account_info;
        if (Array.isArray(info) && info.length > 0 && info[0].email) {
            return info[0].email;
        }

        // Fallback: profile name (nama Google Account)
        const name = prefs?.profile?.name;
        if (name && name !== 'Person 1' && !name.startsWith('Pengguna') && !name.startsWith('Profile')) {
            return name;
        }
        return null;
    } catch { return null; }
}

function readAvatarFromSession(sessionDir) {
    try {
        const prefPath = path.join(sessionDir, 'Default', 'Preferences');
        if (!fs.existsSync(prefPath)) return null;
        const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf-8'));
        const info = prefs?.account_info;
        if (Array.isArray(info) && info.length > 0) {
            return info[0]?.picture_url || null;
        }
        return null;
    } catch { return null; }
}

function deleteSessionDir(sessionDir) {
    try {
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
    } catch (e) {
        console.error('[accountHandlers] rmSync error:', e.message);
    }
}

// â”€â”€â”€ State: proses Chrome login yang sedang berjalan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let loginChromeProcess = null;

// â”€â”€â”€ Setup IPC Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function setupAccountHandlers(ipcMain, mainWin) {

    // LIST akun + sinkronkan email dari Preferences Chrome
    ipcMain.handle('account:list', () => {
        const data = readAccounts();
        let changed = false;
        data.accounts = data.accounts.map(acc => {
            if (acc.sessionDir) {
                const email  = readEmailFromSession(acc.sessionDir);
                const avatar = readAvatarFromSession(acc.sessionDir);
                if (email && email !== acc.email) { acc.email = email; changed = true; }
                if (avatar && avatar !== acc.avatar) { acc.avatar = avatar; changed = true; }
                // Perbarui name jika masih generik
                if (email && (acc.name === acc.id || acc.name.startsWith('Akun '))) {
                    acc.name = email; changed = true;
                }
            }
            return acc;
        });
        if (changed) writeAccounts(data);
        return data;
    });

    // GET ACTIVE
    ipcMain.handle('account:getActive', () => {
        const data = readAccounts();
        const active = data.accounts.find(a => a.id === data.activeAccountId) || null;
        return { account: active, activeAccountId: data.activeAccountId };
    });

    // SET ACTIVE
    ipcMain.handle('account:setActive', (_, accountId) => {
        const data = readAccounts();
        if (!data.accounts.some(a => a.id === accountId)) return { ok: false, error: 'Account not found.' };
        data.activeAccountId = accountId;
        data.accounts = data.accounts.map(a =>
            a.id === accountId ? { ...a, lastUsed: new Date().toISOString() } : a
        );
        writeAccounts(data);
        notifyAccountUpdate(mainWin);
        return { ok: true };
    });

    // ADD: Buka Chrome asli dengan user-data-dir baru â†’ user login â†’ Chrome tutup â†’ simpan akun
    ipcMain.handle('account:add', async () => {
        // Cek apakah Chrome tersedia
        if (!fs.existsSync(CHROME_PATH)) {
            return {
                ok: false,
                error: `Chrome tidak ditemukan di:\n${CHROME_PATH}\n\nSet CHROME_EXECUTABLE_PATH di .env jika Chrome ada di lokasi lain.`,
            };
        }

        if (loginChromeProcess) {
            return { ok: false, error: 'Proses login Chrome sudah berjalan. Tutup jendela Chrome login yang sebelumnya.' };
        }

        ensureSessionsDir();
        const id         = generateId();
        const sessionDir = path.join(SESSIONS_DIR, id);
        fs.mkdirSync(sessionDir, { recursive: true });

        // â”€â”€ Tampilkan dialog info kepada user â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        notifyMainWin(mainWin, 'account:login-started', {
            message: 'Jendela Chrome akan terbuka. Login ke akun Google Anda, lalu TUTUP jendela Chrome tersebut setelah masuk ke Flow.',
        });

        return new Promise((resolve) => {
            // â”€â”€ Launch Chrome asli dengan profile baru â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // Google memblokir login di Electron WebView. Chrome asli = tidak diblokir.
            loginChromeProcess = spawn(CHROME_PATH, [
                `--user-data-dir=${sessionDir}`,
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-default-apps',
                'https://labs.google/fx/tools/flow',
            ], {
                detached: false,
                windowsHide: false,
            });

            loginChromeProcess.on('error', (err) => {
                loginChromeProcess = null;
                deleteSessionDir(sessionDir);
                resolve({ ok: false, error: `Gagal membuka Chrome: ${err.message}` });
            });

            // â”€â”€ Saat Chrome ditutup â†’ baca sesi â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            loginChromeProcess.on('close', (code) => {
                loginChromeProcess = null;

                // Tunggu sebentar agar Chrome selesai tulis Preferences ke disk
                setTimeout(() => {
                    const email  = readEmailFromSession(sessionDir);
                    const avatar = readAvatarFromSession(sessionDir);

                    // Cek apakah ada Default/Preferences â†’ artinya Chrome pernah dibuka
                    const prefExists = fs.existsSync(path.join(sessionDir, 'Default', 'Preferences'));

                    if (!prefExists) {
                        // User menutup Chrome sebelum sempat login (atau Chrome crash)
                        deleteSessionDir(sessionDir);
                        return resolve({ ok: false, error: 'Chrome ditutup sebelum login selesai.' });
                    }

                    const data    = readAccounts();
                    const accName = email || `Akun ${data.accounts.length + 1}`;

                    const newAccount = {
                        id,
                        name:       accName,
                        email:      email || null,
                        avatar:     avatar || null,
                        sessionDir: sessionDir,
                        createdAt:  new Date().toISOString(),
                        lastUsed:   new Date().toISOString(),
                    };

                    data.accounts.push(newAccount);
                    // Jadikan aktif jika ini akun pertama
                    if (!data.activeAccountId) data.activeAccountId = id;
                    writeAccounts(data);
                    notifyAccountUpdate(mainWin);

                    resolve({ ok: true, account: newAccount });
                }, 1200);
            });
        });
    });

    // RENAME akun
    ipcMain.handle('account:rename', (_, { accountId, newName }) => {
        if (!newName || !newName.trim()) return { ok: false, error: 'Nama tidak boleh kosong.' };
        const data = readAccounts();
        data.accounts = data.accounts.map(a =>
            a.id === accountId ? { ...a, name: newName.trim() } : a
        );
        writeAccounts(data);
        notifyAccountUpdate(mainWin);
        return { ok: true };
    });

    // DELETE akun + sesi
    ipcMain.handle('account:delete', (_, accountId) => {
        const data = readAccounts();
        const acc  = data.accounts.find(a => a.id === accountId);
        if (!acc) return { ok: false, error: 'Account not found.' };

        if (acc.sessionDir) deleteSessionDir(acc.sessionDir);
        data.accounts = data.accounts.filter(a => a.id !== accountId);

        if (data.activeAccountId === accountId) {
            data.activeAccountId = data.accounts.length > 0 ? data.accounts[0].id : null;
        }
        writeAccounts(data);
        notifyAccountUpdate(mainWin);
        return { ok: true };
    });

    // GET SESSION DIR akun aktif (dipakai botHandlers)
    ipcMain.handle('account:getSessionDir', () => {
        const data = readAccounts();
        if (!data.activeAccountId) return { sessionDir: null };
        const acc = data.accounts.find(a => a.id === data.activeAccountId);
        if (!acc) return { sessionDir: null };
        acc.lastUsed = new Date().toISOString();
        writeAccounts(data);
        return { sessionDir: acc.sessionDir, account: acc };
    });

    // CANCEL LOGIN (jika user ingin membatalkan)
    ipcMain.handle('account:cancelLogin', () => {
        if (loginChromeProcess) {
            try { loginChromeProcess.kill(); } catch { /* already dead */ }
            loginChromeProcess = null;
        }
        return { ok: true };
    });
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function notifyAccountUpdate(win) {
    if (win && !win.isDestroyed()) {
        win.webContents.send('account:update', readAccounts());
    }
}

function notifyMainWin(win, channel, data) {
    if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data);
    }
}

// â”€â”€â”€ Export untuk botHandlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getActiveSessionDir() {
    const data = readAccounts();
    if (!data.activeAccountId) return null;
    const acc = data.accounts.find(a => a.id === data.activeAccountId);
    return acc?.sessionDir || null;
}

function getActiveAccount() {
    const data = readAccounts();
    if (!data.activeAccountId) return null;
    return data.accounts.find(a => a.id === data.activeAccountId) || null;
}

module.exports = { setupAccountHandlers, getActiveSessionDir, getActiveAccount, readAccounts, SESSIONS_DIR };

