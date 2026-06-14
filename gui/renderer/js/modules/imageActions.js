// js/modules/imageActions.js — Hapus, undo, dan redo operasi gambar (gallery)

import { getState, setState }   from './state.js';
import { getFileName }          from './utils.js';
import { showToast }            from './toastNotification.js';
import { renderGallery }        from './gallery.js';
import { openLightbox, closeLightbox } from './lightbox.js';
import { showConfirmModal }         from './confirmModal.js';

const api = window.botAPI;

// ─── Hapus gambar (soft delete → .trash) ─────────────────────────────────────
export async function deleteImageSilently(filePaths, logToUI, renderGalleryFn) {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    if (paths.length === 0) return;

    let deletedCount = 0;
    const deletedEntries = [];

    for (const filePath of paths) {
        const res = await api.deleteImage(filePath);
        if (res.ok) {
            deletedEntries.push({ originalPath: filePath, trashPath: res.trashPath, type: 'single' });
            deletedCount++;
        }
    }

    if (deletedCount > 0) {
        const deletedHistory = getState('deletedHistory');
        if (paths.length > 1) {
            deletedHistory.push({ type: 'bulk', entries: deletedEntries });
        } else {
            deletedHistory.push(deletedEntries[0]);
        }
        setState('deletedHistory', deletedHistory);
        setState('redoHistory', []);

        const galleryImages = getState('galleryImages').filter(p => !paths.includes(p));
        setState('galleryImages', galleryImages);

        const lightboxPath = getState('lightboxPath');
        if (lightboxPath && paths.includes(lightboxPath)) {
            closeLightbox();
        }

        // Reset selections
        setState('gallerySelectedImages', []);
        setState('gallerySelectedImage', null);

        renderGalleryFn();

        const label = paths.length === 1 ? `Deleted: ${getFileName(paths[0])}` : `Deleted ${deletedCount} images`;
        showToast(label, 'Undo', () => undoLastDelete(logToUI, renderGalleryFn));
        return true;
    }
    return false;
}

// ─── Undo delete ─────────────────────────────────────────────────────────────
export async function undoLastDelete(logToUI, renderGalleryFn) {
    const deletedHistory = getState('deletedHistory');
    if (deletedHistory.length === 0) return;
    const last = deletedHistory.pop();
    setState('deletedHistory', deletedHistory);

    if (last.type === 'bulk') {
        let restoredCount = 0;
        const restoredEntries = [];
        for (const entry of last.entries) {
            const res = await api.undoDelete(entry);
            if (res.ok) {
                const imgs = getState('galleryImages');
                imgs.unshift(entry.originalPath);
                setState('galleryImages', imgs);
                restoredEntries.push(entry);
                restoredCount++;
            }
        }
        if (restoredCount > 0) {
            const redoHistory = getState('redoHistory');
            redoHistory.push({ type: 'bulk', entries: restoredEntries });
            setState('redoHistory', redoHistory);
            renderGalleryFn();
            showToast(`Restored ${restoredCount} images`, 'Redo',
                () => redoLastDelete(logToUI, renderGalleryFn));
        }
    } else {
        const res = await api.undoDelete(last);
        if (res.ok) {
            const imgs = getState('galleryImages');
            imgs.unshift(last.originalPath);
            setState('galleryImages', imgs);
            const redoHistory = getState('redoHistory');
            redoHistory.push(last);
            setState('redoHistory', redoHistory);
            renderGalleryFn();
            showToast(`Restored: ${getFileName(last.originalPath)}`, 'Redo',
                () => redoLastDelete(logToUI, renderGalleryFn));
        } else {
            showToast(`Failed to restore: ${res.error}`);
        }
    }
}

// ─── Redo delete ─────────────────────────────────────────────────────────────
export async function redoLastDelete(logToUI, renderGalleryFn) {
    const redoHistory = getState('redoHistory');
    if (redoHistory.length === 0) return;
    const lastUndone = redoHistory.pop();
    setState('redoHistory', redoHistory);

    if (lastUndone.type === 'bulk') {
        const deletedEntries = [];
        for (const entry of lastUndone.entries) {
            const res = await api.deleteImage(entry.originalPath);
            if (res.ok) {
                deletedEntries.push({ originalPath: entry.originalPath, trashPath: res.trashPath, type: 'single' });
                setState('galleryImages', getState('galleryImages').filter(p => p !== entry.originalPath));
            }
        }
        if (deletedEntries.length > 0) {
            const hist = getState('deletedHistory');
            hist.push({ type: 'bulk', entries: deletedEntries });
            setState('deletedHistory', hist);
            if (getState('lightboxPath') && !getState('galleryImages').includes(getState('lightboxPath'))) {
                closeLightbox();
            }
            renderGalleryFn();
            showToast(`Re-deleted ${deletedEntries.length} images`, 'Undo',
                () => undoLastDelete(logToUI, renderGalleryFn));
        } else {
            redoHistory.push(lastUndone);
            setState('redoHistory', redoHistory);
            showToast('Nothing to redo (files may be missing)');
        }
    } else {
        const res = await api.deleteImage(lastUndone.originalPath);
        if (res.ok) {
            const hist = getState('deletedHistory');
            hist.push({ originalPath: lastUndone.originalPath, trashPath: res.trashPath, type: 'single' });
            setState('deletedHistory', hist);
            setState('galleryImages', getState('galleryImages').filter(p => p !== lastUndone.originalPath));

            const lightboxPath = getState('lightboxPath');
            if (lightboxPath === lastUndone.originalPath) {
                const oldIndex = getState('currentFilteredImages').indexOf(lastUndone.originalPath);
                renderGalleryFn();
                const filtered = getState('currentFilteredImages');
                if (filtered.length > 0) {
                    const nextPath = filtered[Math.min(oldIndex, filtered.length - 1)];
                    openLightbox(nextPath, getFileName(nextPath));
                } else {
                    closeLightbox();
                }
            } else {
                renderGalleryFn();
            }
            showToast(`Re-deleted: ${getFileName(lastUndone.originalPath)}`, 'Undo',
                () => undoLastDelete(logToUI, renderGalleryFn));
        } else {
            redoHistory.push(lastUndone);
            setState('redoHistory', redoHistory);
            showToast(`Failed to redo: ${res.error}`);
        }
    }
}

// ─── Restore dari trash ──────────────────────────────────────────────────────
export async function restoreImageFromTrash(filePaths, logToUI, renderGalleryFn) {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    if (paths.length === 0) return;

    let restoredCount = 0;
    for (const filePath of paths) {
        const res = await api.restoreTrashImage(filePath);
        if (res.ok) {
            restoredCount++;
            const galleryImages = getState('galleryImages').filter(p => p !== filePath);
            setState('galleryImages', galleryImages);
        }
    }

    const lightboxPath = getState('lightboxPath');
    if (lightboxPath && paths.includes(lightboxPath)) {
        closeLightbox();
    }

    // Reset selections
    setState('gallerySelectedImages', []);
    setState('gallerySelectedImage', null);

    renderGalleryFn();
    showToast(paths.length === 1 ? `Restored: ${getFileName(paths[0])}` : `Restored ${restoredCount} images`);
    if (logToUI) logToUI(`[GUI] 🔄 Restored ${restoredCount} images`, 'SUCCESS');
}

// ─── Hapus permanen dari trash ────────────────────────────────────────────────
export async function deleteImagePermanently(filePaths, logToUI, renderGalleryFn) {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    if (paths.length === 0) return false;

    const label = paths.length === 1 ? `"${getFileName(paths[0])}"` : `${paths.length} selected images`;
    const confirmed = await showConfirmModal({
        title: 'Delete Images Permanently',
        message: `Are you sure you want to permanently delete ${label}?`,
        details: 'This action cannot be undone and files will be permanently erased.',
        confirmText: paths.length === 1 ? 'Delete Permanently' : `Delete Permanently (${paths.length})`,
        type: 'delete',
        prefKey: 'delete_permanently'
    });
    if (!confirmed) {
        return false;
    }

    let deletedCount = 0;
    for (const filePath of paths) {
        const res = await api.deleteTrashImagePermanently(filePath);
        if (res.ok) {
            deletedCount++;
            const galleryImages = getState('galleryImages').filter(p => p !== filePath);
            setState('galleryImages', galleryImages);
        }
    }

    const lightboxPath = getState('lightboxPath');
    if (lightboxPath && paths.includes(lightboxPath)) {
        closeLightbox();
    }

    // Reset selections
    setState('gallerySelectedImages', []);
    setState('gallerySelectedImage', null);

    renderGalleryFn();
    showToast(paths.length === 1 ? `Permanently deleted: ${getFileName(paths[0])}` : `Permanently deleted ${deletedCount} images`);
    if (logToUI) logToUI(`[GUI] 🗑️ Permanently deleted ${deletedCount} images`, 'INFO');
    return true;
}

// ─── Kosongkan trash ─────────────────────────────────────────────────────────
export async function emptyAllTrash(logToUI, renderGalleryFn) {
    const confirmed = await showConfirmModal({
        title: 'Empty Trash Bin',
        message: 'Are you sure you want to permanently delete ALL images in the trash?',
        details: 'This action cannot be undone and all files will be permanently lost.',
        confirmText: 'Empty Trash',
        type: 'delete',
        prefKey: 'empty_trash'
    });
    if (!confirmed) {
        return;
    }
    const dir = getState('currentOutputDir');
    const res = await api.emptyTrash(dir || undefined);
    if (!res.ok) { showToast(`Failed to empty trash: ${res.error}`); return; }

    setState('galleryImages', []);
    setState('gallerySelectedImage', null);
    
    closeLightbox();
    renderGalleryFn();
    showToast('Trash emptied');
    if (logToUI) logToUI('[GUI] 🗑️ Trash emptied permanently.', 'INFO');
}
