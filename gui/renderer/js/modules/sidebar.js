// js/modules/sidebar.js — Toggle sidebar visibility & responsive layout

import { getState, setState } from './state.js';

// ─── Toggle sidebar ────────────────────────────────────────────────────────────
export function toggleSidebar() {
    const isOpen     = getState('sidebarOpen');
    const sidebar    = document.getElementById('sidebar');
    const iconOpen   = document.getElementById('icon-sidebar-open');
    const iconClosed = document.getElementById('icon-sidebar-closed');

    setState('sidebarOpen', !isOpen);
    sidebar.classList.toggle('collapsed', isOpen);
    iconOpen.classList.toggle('hidden',   isOpen);
    iconClosed.classList.toggle('hidden', !isOpen);
}

// ─── Responsive ResizeObserver ────────────────────────────────────────────────
/**
 * Pasang ResizeObserver di main-area untuk layout responsif.
 * @param {Function} applyGalleryViewMode
 */
export function setupResponsive(applyGalleryViewMode) {
    const mainArea   = document.getElementById('main-area');
    const statGrid   = document.getElementById('stat-grid');

    const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
            const w = entry.contentRect.width;

            if (statGrid) statGrid.classList.toggle('cols-2', w < 560);

            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.toggle('icon-only', w < 420);
            });

            applyGalleryViewMode();

            const mainEl = document.getElementById('main-area');
            if (mainEl) mainEl.classList.toggle('tab-compact', w < 500);

            const tabGallery = document.getElementById('tab-gallery');
            if (tabGallery) tabGallery.classList.toggle('gallery-compact', w < 760);
        }
    });

    if (mainArea) ro.observe(mainArea);
}

// ─── Drag resizer for sidebar ──────────────────────────────────────────────────
export function setupResizer() {
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.getElementById('sidebar');
    if (!resizer || !sidebar) return;

    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isResizing = true;
        document.body.classList.add('sidebar-resizing');

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    });

    function handleMouseMove(e) {
        if (!isResizing) return;
        
        const sidebarRect = sidebar.getBoundingClientRect();
        let newWidth = e.clientX - sidebarRect.left;
        
        // Batasi lebar sidebar (antara 180px dan 480px)
        if (newWidth < 180) newWidth = 180;
        if (newWidth > 480) newWidth = 480;

        // Set CSS Variable di root document
        document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
    }

    function handleMouseUp() {
        if (!isResizing) return;
        isResizing = false;
        document.body.classList.remove('sidebar-resizing');
        
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    }
}
