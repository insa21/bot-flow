// handlers/fileHandlers.js — IPC handler untuk operasi file sistem (gallery, folder, dialog)
'use strict';

const { dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const { OUTPUT_DIR } = require('./windowHandlers');

// ─── Image extension list ─────────────────────────────────────────────────────
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

// ─── Scan output folder untuk gambar ─────────────────────────────────────────
function scanOutputImages(outputDir) {
    if (!fs.existsSync(outputDir)) return [];
    return fs.readdirSync(outputDir)
        .filter(f => IMAGE_EXTS.includes(path.extname(f).toLowerCase()) && !f.startsWith('_debug'))
        .map(f => path.join(outputDir, f))
        .sort((a, b) => {
            try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; }
            catch { return 0; }
        });
}

// ─── Hapus ke trash ───────────────────────────────────────────────────────────
async function moveToTrash(imgPath) {
    if (!fs.existsSync(imgPath)) return { ok: false, error: 'File does not exist.' };
    const trashDir = path.join(path.dirname(imgPath), '.trash');
    if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
    const filename  = path.basename(imgPath);
    const trashPath = path.join(trashDir, `${Date.now()}_${filename}`);
    fs.renameSync(imgPath, trashPath);
    return { ok: true, trashPath };
}

// Scan trash folder untuk gambar yang sudah dihapus
function scanTrashImages(outputDir) {
    const trashDir = path.join(outputDir, '.trash');
    if (!fs.existsSync(trashDir)) return [];
    return fs.readdirSync(trashDir)
        .filter(f => IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
        .map(f => path.join(trashDir, f))
        .sort((a, b) => {
            try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; }
            catch { return 0; }
        });
}

// Rekonstruksi path asli dari file di folder trash
function getOriginalPathFromTrash(trashPath) {
    const trashDir = path.dirname(trashPath);
    const outputDir = path.dirname(trashDir);
    const basename = path.basename(trashPath);
    
    // Format: timestamp_filename atau timestamp_counter_filename
    const match = basename.match(/^\d+_(?:\d+_)?(.*)$/);
    const originalName = match ? match[1] : basename;
    return path.join(outputDir, originalName);
}

// ─── Setup handlers ──────────────────────────────────────────────────────────
function setupFileHandlers(ipcMain, win) {
    // Choose folder dialog
    ipcMain.handle('choose-folder', async () => {
        const result = await dialog.showOpenDialog(win, {
            title: 'Select Output Folder',
            properties: ['openDirectory', 'createDirectory'],
        });
        return result.canceled ? null : result.filePaths[0];
    });

    // Choose prompts file dialog (supports txt, csv, json)
    ipcMain.handle('choose-prompts-file', async () => {
        const result = await dialog.showOpenDialog(win, {
            title: 'Upload Prompts File',
            filters: [
                { name: 'Supported Formats (*.txt, *.csv, *.json)', extensions: ['txt', 'csv', 'json'] },
                { name: 'Text Files (*.txt)', extensions: ['txt'] },
                { name: 'CSV Files (*.csv)', extensions: ['csv'] },
                { name: 'JSON Files (*.json)', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] }
            ],
            properties: ['openFile'],
        });
        if (result.canceled) return null;
        try {
            const filePath = result.filePaths[0];
            const content = fs.readFileSync(filePath, 'utf-8');
            const ext = path.extname(filePath).toLowerCase();
            return { content, ext };
        } catch {
            return null;
        }
    });

    // Shell actions
    ipcMain.on('open-output-folder', (_, folderPath) => shell.openPath(folderPath || OUTPUT_DIR));
    ipcMain.on('open-image', (_, imgPath) => shell.openPath(imgPath));
    ipcMain.on('reveal-image', (_, imgPath) => {
        try {
            if (fs.existsSync(imgPath)) {
                shell.showItemInFolder(imgPath);
            }
        } catch { /* ignore */ }
    });

    // Scan images
    ipcMain.handle('scan-images', (_, folderPath) => scanOutputImages(folderPath || OUTPUT_DIR));

    // Get file mtime
    ipcMain.handle('get-file-date', (_, imgPath) => {
        try { if (fs.existsSync(imgPath)) return fs.statSync(imgPath).mtimeMs; }
        catch { /* ignore */ }
        return Date.now();
    });

    // Get file stats (size, dates)
    ipcMain.handle('get-file-stats', (_, imgPath) => {
        try {
            if (fs.existsSync(imgPath)) {
                const stat = fs.statSync(imgPath);
                return {
                    size: stat.size,
                    mtimeMs: stat.mtimeMs,
                    birthtimeMs: stat.birthtimeMs || stat.mtimeMs,
                };
            }
        } catch { /* ignore */ }
        return null;
    });

    // Delete single image
    ipcMain.handle('delete-image', async (_, imgPath) => {
        try { return await moveToTrash(imgPath); }
        catch (err) { return { ok: false, error: err.message }; }
    });

    // Rename image
    ipcMain.handle('rename-image', async (_, { oldPath, newPath }) => {
        try {
            if (!fs.existsSync(oldPath)) return { ok: false, error: 'Source file does not exist.' };
            if (fs.existsSync(newPath)) return { ok: false, error: 'Target file already exists.' };
            fs.renameSync(oldPath, newPath);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });

    // Undo delete
    ipcMain.handle('undo-delete', async (_, { originalPath, trashPath }) => {
        try {
            if (!fs.existsSync(trashPath)) return { ok: false, error: 'Trash file does not exist.' };
            const dir = path.dirname(originalPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.renameSync(trashPath, originalPath);
            return { ok: true };
        } catch (err) { return { ok: false, error: err.message }; }
    });

    // Clear gallery (semua gambar → trash)
    ipcMain.handle('clear-gallery', async (_, folderPath) => {
        try {
            const outDir   = folderPath || OUTPUT_DIR;
            if (!fs.existsSync(outDir)) return { ok: true, deletedEntries: [] };
            const trashDir = path.join(outDir, '.trash');
            if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
            const files = fs.readdirSync(outDir);
            const deletedEntries = [];
            let counter = 0;
            const baseTs = Date.now();
            for (const file of files) {
                if (!IMAGE_EXTS.includes(path.extname(file).toLowerCase())) continue;
                const originalPath = path.join(outDir, file);
                const trashPath    = path.join(trashDir, `${baseTs}_${counter++}_${file}`);
                fs.renameSync(originalPath, trashPath);
                deletedEntries.push({ originalPath, trashPath });
            }
            return { ok: true, deletedEntries };
        } catch (err) { return { ok: false, error: err.message }; }
    });

    // Scan trash folder
    ipcMain.handle('scan-trash-images', (_, folderPath) => {
        try {
            return scanTrashImages(folderPath || OUTPUT_DIR);
        } catch (err) {
            return [];
        }
    });

    // Restore trash image (safely, resolving collisions)
    ipcMain.handle('restore-trash-image', async (_, trashPath) => {
        try {
            if (!fs.existsSync(trashPath)) return { ok: false, error: 'Trash file does not exist.' };
            const originalPath = getOriginalPathFromTrash(trashPath);
            const dir = path.dirname(originalPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            
            let finalPath = originalPath;
            if (fs.existsSync(originalPath)) {
                const ext = path.extname(originalPath);
                const base = path.basename(originalPath, ext);
                let counter = 1;
                while (fs.existsSync(path.join(dir, `${base}_${counter}${ext}`))) {
                    counter++;
                }
                finalPath = path.join(dir, `${base}_${counter}${ext}`);
            }
            
            fs.renameSync(trashPath, finalPath);
            return { ok: true, restoredPath: finalPath };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });

    // Delete trash image permanently
    ipcMain.handle('delete-trash-image-permanently', async (_, trashPath) => {
        try {
            if (!fs.existsSync(trashPath)) return { ok: false, error: 'Trash file does not exist.' };
            fs.unlinkSync(trashPath);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });

    // Empty trash (delete all images in trash)
    ipcMain.handle('empty-trash', async (_, folderPath) => {
        try {
            const outDir = folderPath || OUTPUT_DIR;
            const trashDir = path.join(outDir, '.trash');
            if (fs.existsSync(trashDir)) {
                const files = fs.readdirSync(trashDir);
                for (const file of files) {
                    if (IMAGE_EXTS.includes(path.extname(file).toLowerCase())) {
                        fs.unlinkSync(path.join(trashDir, file));
                    }
                }
            }
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });
}

module.exports = { setupFileHandlers };
