// js/modules/lightbox.js — Buka, tutup, navigasi, dan zoom lightbox image viewer

import { LIGHTBOX_TRANSITION_MS } from './constants.js';
import { getState, setState }     from './state.js';
import { getFileName }            from './utils.js';

// ─── Buka lightbox ────────────────────────────────────────────────────────────
export function openLightbox(filePath, name) {
    setState('lightboxPath',  filePath);
    setState('lightboxIndex', getState('currentFilteredImages').indexOf(filePath));

    const img  = document.getElementById('lightbox-img');
    const wrap = document.getElementById('lightbox-img-wrap');
    img.src = `file://${filePath.replace(/\\/g, '/')}`;
    img.classList.remove('zoomed');
    if (wrap) wrap.classList.remove('zoomed');

    document.getElementById('lightbox-name').textContent       = name;
    document.getElementById('lightbox-resolution').textContent = 'Loading dimensions...';

    const filtered  = getState('currentFilteredImages');
    const prevBtn   = document.getElementById('lightbox-prev');
    const nextBtn   = document.getElementById('lightbox-next');
    const hideNavs  = filtered.length <= 1;
    if (prevBtn) prevBtn.classList.toggle('hidden', hideNavs);
    if (nextBtn) nextBtn.classList.toggle('hidden', hideNavs);

    const showTrash = getState('showTrashActive');
    const lbRestore = document.getElementById('lightbox-restore');
    const lbDelete  = document.getElementById('lightbox-delete');
    
    if (lbRestore) {
        lbRestore.classList.toggle('hidden', !showTrash);
    }
    if (lbDelete) {
        if (showTrash) {
            lbDelete.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="11" height="11">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2 2v2" />
                </svg>
                Delete Permanently
            `;
            lbDelete.classList.add('hover:bg-red-600', 'text-red-400', 'hover:text-white', 'hover:border-red-600');
        } else {
            lbDelete.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="11" height="11">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2 2v2" />
                </svg>
                Delete Image
            `;
            lbDelete.className = "lightbox-action-btn lightbox-action-delete";
        }
    }

    document.getElementById('lightbox').classList.remove('hidden');
}

// ─── Tutup lightbox ───────────────────────────────────────────────────────────
export function closeLightbox() {
    document.getElementById('lightbox').classList.add('hidden');
    const img  = document.getElementById('lightbox-img');
    const wrap = document.getElementById('lightbox-img-wrap');
    if (img)  { img.src = ''; img.classList.remove('zoomed'); }
    if (wrap)   wrap.classList.remove('zoomed');
    setState('lightboxPath',  null);
    setState('lightboxIndex', -1);
}

// ─── Navigasi prev/next ───────────────────────────────────────────────────────
export function navigateLightbox(direction) {
    const filtered = getState('currentFilteredImages');
    const index    = getState('lightboxIndex');
    if (filtered.length === 0 || index === -1) return;

    let newIndex = index + direction;
    if (newIndex < 0)               newIndex = filtered.length - 1;
    else if (newIndex >= filtered.length) newIndex = 0;

    const newPath = filtered[newIndex];
    const newName = getFileName(newPath);

    const img = document.getElementById('lightbox-img');
    img.style.opacity   = '0';
    img.style.transform = 'scale(0.97)';

    setTimeout(() => {
        openLightbox(newPath, newName);
        img.style.opacity   = '1';
        img.style.transform = '';
    }, LIGHTBOX_TRANSITION_MS);
}
