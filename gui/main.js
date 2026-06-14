// main.js — Entry point Electron; hanya bootstrap window & delegasi ke handler
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { setupWindowHandlers } = require('./handlers/windowHandlers');
const { setupBotHandlers }    = require('./handlers/botHandlers');
const { setupFileHandlers }   = require('./handlers/fileHandlers');

// ─── State ──────────────────────────────────────────────────────────────────
let mainWindow = null;

// ─── Create Window ──────────────────────────────────────────────────────────
function createWindow() {
    mainWindow = new BrowserWindow({
        width:  1300,
        height: 820,
        minWidth:  780,
        minHeight: 560,
        frame: false,
        titleBarStyle: 'hidden',
        backgroundColor: '#0d0f14',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        icon: path.join(__dirname, 'renderer', 'icon.png'),
        show: false,
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('closed', () => { mainWindow = null; });

    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12') {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });

    // Daftarkan semua handler IPC
    setupWindowHandlers(ipcMain, mainWindow);
    setupBotHandlers(ipcMain, mainWindow);
    setupFileHandlers(ipcMain, mainWindow);
}

// ─── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
