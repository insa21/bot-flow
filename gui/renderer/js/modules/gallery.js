// js/modules/gallery.js — macOS Finder-style Gallery Logic with Tailwind CSS

import { NEW_BADGE_DURATION_MS } from './constants.js';
import { getState, setState }    from './state.js';
import { getFileName }           from './utils.js';
import { updateProgressStats }   from './progressPanel.js';
import { showToast }             from './toastNotification.js';

const api = window.botAPI;

// ─── Track selection state locally ───────────────────────────────────────────
let selectedImagePath = null;
let selectionAnchor = null;
let listSortKey = 'date'; // 'name' | 'date'
let listSortDir = 'desc'; // 'asc' | 'desc'
let keyboardListenerAdded = false;

// ─── Callbacks for other functions ───────────────────────────────────────────
let openLightboxFn = null;
let deleteImageSilentlyFn = null;
let restoreImageFn = null;
let logToUIFn = null;

// ─── Format Bytes (Format File Size) ──────────────────────────────────────────
function formatBytes(bytes) {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '—';
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ─── Update Select Mode UI and checkbox visibility ───────────────────────────
export function updateSelectModeUI(active) {
    setState('gallerySelectModeActive', active);
    
    const btnSelect = document.getElementById('btn-toggle-select');
    const textToggle = document.getElementById('text-select-toggle');
    const iconOff = document.getElementById('icon-select-mode-off');
    const iconOn = document.getElementById('icon-select-mode-on');

    if (btnSelect) {
        if (active) {
            btnSelect.classList.add('bg-accent/15', 'text-accent', 'border-accent/30');
            if (textToggle) textToggle.textContent = 'Cancel';
            btnSelect.title = 'Exit Select Mode';
            if (iconOff) iconOff.classList.add('hidden');
            if (iconOn) iconOn.classList.remove('hidden');
        } else {
            btnSelect.classList.remove('bg-accent/15', 'text-accent', 'border-accent/30');
            if (textToggle) textToggle.textContent = 'Select';
            btnSelect.title = 'Enter Select Mode';
            if (iconOff) iconOff.classList.remove('hidden');
            if (iconOn) iconOn.classList.add('hidden');
        }
    }

    // Update List View Header Spacer based on Select Mode
    const spacer = document.getElementById('list-header-spacer');
    if (spacer) {
        if (active) {
            spacer.className = 'w-14 flex-shrink-0 transition-all duration-150';
        } else {
            spacer.className = 'w-8 flex-shrink-0 transition-all duration-150';
        }
    }

    // Toggle checkbox visibility in all thumbnails
    document.querySelectorAll('.thumb-checkbox-wrapper').forEach(wrapper => {
        wrapper.classList.toggle('hidden', !active);
    });
}

// ─── Select an Image and Update Preview/Inspector ─────────────────────────────
export function selectImage(filePath, event) {
    let selectedImages = getState('gallerySelectedImages') || [];
    const filtered = getState('currentFilteredImages') || [];

    if (!filePath) {
        selectedImagePath = null;
        selectionAnchor = null;
        setState('gallerySelectedImage', null);
        setState('gallerySelectedImages', []);
        setState('galleryLastSelectedImage', null);
        selectedImages = [];
        updateSelectModeUI(false);
    } else {
        let isCtrl = event && (event.ctrlKey || event.metaKey);
        let isShift = event && event.shiftKey;

        if (isCtrl) {
            // Ctrl/Cmd + click: toggle individual selection
            if (event && event.dontToggle) {
                if (!selectedImages.includes(filePath)) {
                    selectedImages.push(filePath);
                }
            } else {
                if (selectedImages.includes(filePath)) {
                    selectedImages = selectedImages.filter(p => p !== filePath);
                } else {
                    selectedImages.push(filePath);
                }
            }
            selectedImagePath = filePath;
            selectionAnchor = filePath;
            setState('gallerySelectedImage', filePath);
            setState('galleryLastSelectedImage', filePath);
        } else if (isShift) {
            // Shift + click: range selection
            if (!selectionAnchor || !filtered.includes(selectionAnchor)) {
                selectionAnchor = filePath;
            }
            const idx1 = filtered.indexOf(selectionAnchor);
            const idx2 = filtered.indexOf(filePath);
            const start = Math.min(idx1, idx2);
            const end = Math.max(idx1, idx2);
            const range = filtered.slice(start, end + 1);
            
            if (event && (event.ctrlKey || event.metaKey)) {
                range.forEach(p => {
                    if (!selectedImages.includes(p)) selectedImages.push(p);
                });
            } else {
                selectedImages = [...range];
            }
            selectedImagePath = filePath;
            setState('gallerySelectedImage', filePath);
            setState('galleryLastSelectedImage', filePath);
        } else if (event) {
            // Standard click: select only this file
            selectedImagePath = filePath;
            selectionAnchor = filePath;
            setState('gallerySelectedImage', filePath);
            setState('galleryLastSelectedImage', filePath);
            selectedImages = [filePath];
            
            updateSelectModeUI(false);
        } else {
            // Programmatic call (no event): preserve selection if it contains filePath, else select only filePath
            if (!selectedImages.includes(filePath)) {
                selectedImages = [filePath];
                selectionAnchor = filePath;
                updateSelectModeUI(false);
            }
            selectedImagePath = filePath;
            setState('gallerySelectedImage', filePath);
        }

        setState('gallerySelectedImages', selectedImages);

        // Auto-activate Select Mode if multiple items are selected
        if (selectedImages.length > 1) {
            updateSelectModeUI(true);
        }
    }

    const viewMode = getState('galleryViewMode') || 'grid';

    // Update active class and checkboxes on thumbnails
    document.querySelectorAll('.gallery-thumb').forEach(el => {
        const path = el.dataset.path;
        const isSelected = selectedImages.includes(path);
        el.classList.toggle('selected', isSelected);

        const checkbox = el.querySelector('.thumb-checkbox');
        const checkIcon = el.querySelector('.thumb-checkbox .check-icon');
        const wrapper = el.querySelector('.thumb-checkbox-wrapper');

        if (checkbox) {
            if (isSelected) {
                checkbox.classList.add('bg-[#007aff]', 'border-transparent');
                checkbox.classList.remove('bg-black/60', 'border-white/20');
                if (checkIcon) checkIcon.classList.remove('hidden');
                if (wrapper) wrapper.classList.add('opacity-100');
            } else {
                checkbox.classList.remove('bg-[#007aff]', 'border-transparent');
                checkbox.classList.add('bg-black/60', 'border-white/20');
                if (checkIcon) checkIcon.classList.add('hidden');
                if (wrapper) wrapper.classList.remove('opacity-100');
            }
        }

        if (viewMode === 'list') {
            el.classList.toggle('bg-[#007aff]', isSelected);
            el.classList.toggle('text-white', isSelected);

            const nameEl = el.querySelector('.gallery-thumb-name');
            if (nameEl) {
                nameEl.classList.toggle('text-white', isSelected);
                if (!isSelected) {
                    const showTrash = getState('showTrashActive');
                    nameEl.className = `gallery-thumb-name flex-[2] min-w-[200px] text-xs font-mono truncate transition-colors ${showTrash ? 'line-through text-text-muted opacity-50' : 'text-text-d'}`;
                }
            }
            el.querySelectorAll('.meta-date, .meta-resolution, .meta-size-col').forEach(meta => {
                meta.classList.toggle('text-white/80', isSelected);
                meta.classList.toggle('text-text-dim', !isSelected);
            });
        } else if (viewMode === 'gallery') {
            el.classList.toggle('ring-2', isSelected);
            el.classList.toggle('ring-[#007aff]', isSelected);
            el.classList.toggle('bg-[#007aff]/15', isSelected);
            el.classList.toggle('border-transparent', isSelected);
        } else {
            const imgBox = el.querySelector('.image-container-box');
            if (imgBox) {
                imgBox.classList.toggle('ring-2', isSelected);
                imgBox.classList.toggle('ring-[#007aff]', isSelected);
                imgBox.classList.toggle('bg-[#007aff]/15', isSelected);
                imgBox.classList.toggle('border-transparent', isSelected);
            }

            const nameEl = el.querySelector('.gallery-thumb-name');
            if (nameEl) {
                nameEl.classList.toggle('bg-[#007aff]', isSelected);
                nameEl.classList.toggle('text-white', isSelected);
                nameEl.classList.toggle('text-text-dim', !isSelected);
            }
        }
    });

    const previewImg = document.getElementById('gallery-preview-img');
    const previewTitle = document.getElementById('gallery-preview-title');
    const inspector = document.getElementById('gallery-inspector');

    if (selectedImages.length === 0) {
        if (previewImg) {
            previewImg.src = '';
            previewImg.classList.add('hidden');
        }
        if (previewTitle) previewTitle.textContent = 'No Image Selected';
        clearInspector();
        return;
    }

    const previewPath = filePath || selectedImages[selectedImages.length - 1];
    const name = getFileName(previewPath);

    if (previewImg) {
        previewImg.src = `file://${previewPath.replace(/\\/g, '/')}`;
        previewImg.classList.remove('hidden');
        previewImg.classList.remove('opacity-100');
        previewImg.onload = () => previewImg.classList.add('opacity-100');
    }
    if (previewTitle) {
        previewTitle.textContent = name;
    }

    updateInspector(previewPath);
}

// ─── Clear Inspector Sidebar ──────────────────────────────────────────────────
function clearInspector() {
    const thumbEl = document.getElementById('inspector-thumb');
    const placeholderEl = document.getElementById('inspector-thumb-placeholder');
    if (thumbEl) {
        thumbEl.src = '';
        thumbEl.classList.add('hidden');
    }
    if (placeholderEl) {
        placeholderEl.classList.remove('hidden');
    }
    document.getElementById('inspector-filename').textContent = 'No selection';
    document.getElementById('inspector-filekind').textContent = '—';
    document.getElementById('inspector-val-size').textContent = '—';
    document.getElementById('inspector-val-dimensions').textContent = '—';
    document.getElementById('inspector-val-created').textContent = '—';
    document.getElementById('inspector-val-modified').textContent = '—';
    document.getElementById('inspector-val-where').textContent = '—';
}

// ─── Update Inspector Sidebar with File Stats ─────────────────────────────────
async function updateInspector(filePath) {
    const selectedImages = getState('gallerySelectedImages') || [];
    const showTrash = getState('showTrashActive');
    const btnRename = document.getElementById('inspector-action-rename');
    const btnDelete = document.getElementById('inspector-action-delete');
    const btnRestore = document.getElementById('inspector-action-restore');
    const btnOpen = document.getElementById('inspector-action-open');
    const btnReveal = document.getElementById('inspector-action-reveal');

    if (selectedImages.length > 1) {
        document.getElementById('inspector-filename').textContent = `${selectedImages.length} images selected`;
        document.getElementById('inspector-filename').title = `${selectedImages.length} images selected`;
        document.getElementById('inspector-filekind').textContent = 'Multiple Items';
        
        document.getElementById('inspector-val-size').textContent = 'Loading size...';
        document.getElementById('inspector-val-dimensions').textContent = '—';
        document.getElementById('inspector-val-created').textContent = '—';
        document.getElementById('inspector-val-modified').textContent = '—';
        
        const whereEl = document.getElementById('inspector-val-where');
        whereEl.textContent = 'Multiple paths...';
        whereEl.title = '';

        const thumbEl = document.getElementById('inspector-thumb');
        const placeholderEl = document.getElementById('inspector-thumb-placeholder');
        if (thumbEl && selectedImages[0]) {
            thumbEl.src = `file://${selectedImages[0].replace(/\\/g, '/')}`;
            thumbEl.classList.remove('hidden');
            if (placeholderEl) placeholderEl.classList.add('hidden');
        }

        // Compute total size asynchronously
        let totalSize = 0;
        try {
            for (const path of selectedImages) {
                const stats = await api.getFileStats(path);
                if (stats) totalSize += stats.size;
            }
            document.getElementById('inspector-val-size').textContent = formatBytes(totalSize);
        } catch {
            document.getElementById('inspector-val-size').textContent = '—';
        }

        if (btnRename) btnRename.classList.add('hidden');
        if (btnRestore) btnRestore.classList.toggle('hidden', !showTrash);
        
        if (btnDelete) {
            btnDelete.querySelector('span').textContent = showTrash ? 'Delete Permanently' : 'Delete';
            btnDelete.title = showTrash ? 'Delete selected images permanently' : 'Move selected images to trash';
        }
        if (btnOpen) {
            btnOpen.querySelector('span').textContent = 'Open All';
            btnOpen.title = 'Open all selected images';
        }
        if (btnReveal) {
            btnReveal.querySelector('span').textContent = 'Reveal First';
            btnReveal.title = 'Reveal first selected image in File Explorer';
        }
        return;
    }

    const name = getFileName(filePath);
    const ext = name.split('.').pop().toUpperCase();
    
    document.getElementById('inspector-filename').textContent = name;
    document.getElementById('inspector-filename').title = name;
    document.getElementById('inspector-filekind').textContent = `${ext} Image`;
    
    const thumbEl = document.getElementById('inspector-thumb');
    const placeholderEl = document.getElementById('inspector-thumb-placeholder');
    if (thumbEl) {
        thumbEl.src = `file://${filePath.replace(/\\/g, '/')}`;
        thumbEl.classList.remove('hidden');
    }
    if (placeholderEl) {
        placeholderEl.classList.add('hidden');
    }
    
    const whereEl = document.getElementById('inspector-val-where');
    whereEl.textContent = filePath;
    whereEl.title = 'Click to copy path';
    
    document.getElementById('inspector-val-dimensions').textContent = 'Loading...';

    // Fetch dimensions offscreen
    const tempImg = new Image();
    tempImg.onload = () => {
        const dimEl = document.getElementById('inspector-val-dimensions');
        if (dimEl) dimEl.textContent = `${tempImg.naturalWidth} × ${tempImg.naturalHeight} px`;
    };
    tempImg.onerror = () => {
        const dimEl = document.getElementById('inspector-val-dimensions');
        if (dimEl) dimEl.textContent = '—';
    };
    tempImg.src = `file://${filePath.replace(/\\/g, '/')}`;

    // Get async stats (size, dates)
    try {
        const stats = await api.getFileStats(filePath);
        if (stats) {
            document.getElementById('inspector-val-size').textContent = formatBytes(stats.size);
            
            const formatDate = (ms) => new Date(ms).toLocaleDateString('id-ID', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });

            document.getElementById('inspector-val-created').textContent = formatDate(stats.birthtimeMs);
            document.getElementById('inspector-val-modified').textContent = formatDate(stats.mtimeMs);
        } else {
            document.getElementById('inspector-val-size').textContent = '—';
            document.getElementById('inspector-val-created').textContent = '—';
            document.getElementById('inspector-val-modified').textContent = '—';
        }
    } catch {
        document.getElementById('inspector-val-size').textContent = '—';
        document.getElementById('inspector-val-created').textContent = '—';
        document.getElementById('inspector-val-modified').textContent = '—';
    }

    // Update inspector action buttons based on whether trash is active
    if (showTrash) {
        if (btnRename) btnRename.classList.add('hidden');
        if (btnRestore) btnRestore.classList.remove('hidden');
        if (btnDelete) {
            btnDelete.querySelector('span').textContent = 'Delete Permanently';
            btnDelete.title = 'Delete image permanently';
        }
    } else {
        if (btnRename) btnRename.classList.remove('hidden');
        if (btnRestore) btnRestore.classList.add('hidden');
        if (btnDelete) {
            btnDelete.querySelector('span').textContent = 'Delete';
            btnDelete.title = 'Delete image';
        }
    }

    if (btnOpen) {
        btnOpen.querySelector('span').textContent = 'Open';
        btnOpen.title = 'Open image in default viewer';
    }
    if (btnReveal) {
        btnReveal.querySelector('span').textContent = 'Reveal';
        btnReveal.title = 'Show image in File Explorer';
    }
}

// ─── Update Sort Header Arrows in List View ────────────────────────────────────
function updateSortHeaderArrows() {
    const listHeader = document.getElementById('gallery-list-header');
    if (!listHeader) return;
    listHeader.querySelectorAll('.sort-direction').forEach(arr => arr.textContent = '');
    const activeCell = listHeader.querySelector(`.sortable[data-sort="${listSortKey}"]`);
    if (activeCell) {
        const arrEl = activeCell.querySelector('.sort-direction');
        if (arrEl) {
            arrEl.textContent = listSortDir === 'asc' ? ' ▲' : ' ▼';
        }
    }
}

// ─── Set Dynamic view mode ────────────────────────────────────────────────────
export function applyGalleryViewMode() {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;

    const mode = getState('galleryViewMode') || 'grid'; // 'grid' | 'list' | 'gallery'
    const zoomContainer = document.getElementById('gallery-zoom-container');
    const previewContainer = document.getElementById('gallery-preview-container');
    const listHeader = document.getElementById('gallery-list-header');
    const inspector = document.getElementById('gallery-inspector');
    const sortSelect = document.getElementById('gallery-sort-select');
    const gridWrapper = document.getElementById('gallery-grid-wrapper');

    if (mode === 'grid') {
        if (zoomContainer) zoomContainer.classList.remove('hidden');
        if (previewContainer) previewContainer.classList.add('hidden');
        if (listHeader) listHeader.classList.add('hidden');
        if (sortSelect) sortSelect.classList.remove('hidden');
        if (gridWrapper) gridWrapper.className = 'flex flex-col flex-1 min-h-0 overflow-hidden relative';
        
        // Tailwind Grid classes
        grid.className = 'flex-1 overflow-y-auto outline-none p-4 grid gap-5 align-content-start';
        
        // Apply slider zoom
        const slider = document.getElementById('gallery-zoom-slider');
        if (slider) {
            grid.style.setProperty('--thumb-size', `${slider.value}px`);
            grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(var(--thumb-size, 180px), 1fr))`;
        }
        
        const isOpen = getState('galleryInspectorOpen') === true;
        if (inspector) inspector.classList.toggle('hidden', !isOpen);
    } else if (mode === 'list') {
        if (zoomContainer) zoomContainer.classList.add('hidden');
        if (previewContainer) previewContainer.classList.add('hidden');
        if (listHeader) listHeader.classList.remove('hidden');
        if (sortSelect) sortSelect.classList.add('hidden');
        if (gridWrapper) gridWrapper.className = 'flex flex-col flex-1 min-h-0 overflow-hidden relative';
        
        // Tailwind List classes
        grid.className = 'flex-1 overflow-y-auto outline-none p-0 flex flex-col bg-white/[0.01]';
        grid.style.removeProperty('--thumb-size');
        grid.style.removeProperty('grid-template-columns');
        
        const isOpen = getState('galleryInspectorOpen') === true;
        if (inspector) inspector.classList.toggle('hidden', !isOpen);
        
        // Sync column sorting arrows on render
        updateSortHeaderArrows();
    } else if (mode === 'gallery') {
        if (zoomContainer) zoomContainer.classList.add('hidden');
        if (previewContainer) previewContainer.classList.remove('hidden');
        if (listHeader) listHeader.classList.add('hidden');
        if (sortSelect) sortSelect.classList.remove('hidden');
        if (gridWrapper) gridWrapper.className = 'flex flex-col flex-none min-h-0 overflow-hidden relative';
        
        // Tailwind Filmstrip classes
        grid.className = 'flex-none overflow-x-auto overflow-y-hidden h-[100px] min-h-[100px] max-h-[100px] px-4 py-2 gap-2.5 bg-black/20 border-t border-white/5 flex items-center w-full';
        grid.style.removeProperty('--thumb-size');
        grid.style.removeProperty('grid-template-columns');
        
        if (inspector) inspector.classList.remove('hidden');
    }

    // Sync segmented control buttons
    document.querySelectorAll('.view-segment-btn').forEach(btn => {
        const isActive = btn.dataset.view === mode;
        btn.classList.toggle('active', isActive);
        btn.classList.toggle('bg-white/12', isActive);
        btn.classList.toggle('text-accent', isActive);
        btn.classList.toggle('font-semibold', isActive);
        btn.classList.toggle('shadow-sm', isActive);
        
        btn.classList.toggle('text-text-dim', !isActive);
    });

    // Update active label in info button
    const infoBtn = document.getElementById('btn-gallery-info');
    if (infoBtn && inspector) {
        const isClosed = inspector.classList.contains('hidden');
        infoBtn.classList.toggle('toolbar-btn-active', !isClosed);
        infoBtn.classList.toggle('bg-accent/10', !isClosed);
        infoBtn.classList.toggle('text-accent', !isClosed);
        infoBtn.classList.toggle('border-accent/20', !isClosed);
    }
}

// ─── Filter & Sort ────────────────────────────────────────────────────────────
function filterAndSortImages() {
    let items = [...getState('galleryImages')];
    const query = getState('gallerySearchQuery');

    if (query) {
        items = items.filter(p =>
            getFileName(p).toLowerCase().includes(query.toLowerCase())
        );
    }

    const mode = getState('galleryViewMode');
    if (mode === 'list') {
        items.sort((a, b) => {
            if (listSortKey === 'name') {
                const nameA = getFileName(a).toLowerCase();
                const nameB = getFileName(b).toLowerCase();
                return listSortDir === 'asc' 
                    ? nameA.localeCompare(nameB) 
                    : nameB.localeCompare(nameA);
            } else {
                const indexA = getState('galleryImages').indexOf(a);
                const indexB = getState('galleryImages').indexOf(b);
                return listSortDir === 'asc' 
                    ? indexB - indexA 
                    : indexA - indexB;
            }
        });
    } else {
        const sort = getState('gallerySortOrder');
        if (sort === 'oldest') {
            items.reverse();
        } else if (sort === 'name-asc') {
            items.sort((a, b) =>
                getFileName(a).toLowerCase().localeCompare(getFileName(b).toLowerCase())
            );
        } else if (sort === 'name-desc') {
            items.sort((a, b) =>
                getFileName(b).toLowerCase().localeCompare(getFileName(a).toLowerCase())
            );
        }
    }

    return items;
}

// ─── Create Custom Context Menu ────────────────────────────────────────────────
// ─── Create Custom Context Menu ────────────────────────────────────────────────
function showContextMenu(e, filePath, openLightbox, deleteImageSilently, restoreImage, logToUI) {
    e.preventDefault();
    e.stopPropagation();

    const existing = document.querySelector('.macos-context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'macos-context-menu absolute bg-[#161924] border border-white/12 rounded-lg shadow-2xl w-[180px] z-[9999] py-1 font-sans text-text-d animate-[contextMenuFadeIn_0.1s_ease-out]';

    const name = getFileName(filePath);
    const showTrash = getState('showTrashActive');
    const selectedImages = getState('gallerySelectedImages') || [];
    
    let targetPaths = [filePath];
    if (selectedImages.includes(filePath) && selectedImages.length > 1) {
        targetPaths = selectedImages;
    } else {
        if (getState('gallerySelectModeActive')) {
            // In Select Mode, right-clicking an unselected item adds it to the selection instead of clearing other items
            if (!selectedImages.includes(filePath)) {
                selectedImages.push(filePath);
                setState('gallerySelectedImages', selectedImages);
                selectImage(filePath, { ctrlKey: true, dontToggle: true });
            }
            targetPaths = getState('gallerySelectedImages') || [];
        } else {
            selectImage(filePath);
        }
    }

    const isBulk = targetPaths.length > 1;

    // Position boundaries
    const menuWidth = 180;
    const menuHeight = showTrash ? 160 : 210;
    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 8;
    }
    if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 8;
    }
    menu.style.left = `${Math.max(0, x)}px`;
    menu.style.top = `${Math.max(0, y)}px`;

    if (showTrash) {
        menu.innerHTML = `
            <div class="context-menu-item flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-[#007aff] hover:text-white transition-colors" data-action="quicklook">
                <span>Quick Look (Space)</span>
            </div>
            <div class="context-menu-item flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-[#007aff] hover:text-white transition-colors" data-action="restore">
                <span>${isBulk ? `Restore ${targetPaths.length} Images` : 'Restore Image'}</span>
            </div>
            ${isBulk ? '' : `
            <div class="context-menu-item flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-[#007aff] hover:text-white transition-colors" data-action="reveal">
                <span>Reveal in File Explorer</span>
            </div>
            `}
            <div class="h-px bg-white/10 my-1"></div>
            <div class="context-menu-item flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none text-red-400 hover:bg-red-500 hover:text-white transition-colors" data-action="delete">
                <span>${isBulk ? `Delete ${targetPaths.length} Permanently` : 'Delete Permanently'}</span>
            </div>
        `;
    } else {
        menu.innerHTML = `
            <div class="context-menu-item flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-[#007aff] hover:text-white transition-colors" data-action="quicklook">
                <span>Quick Look (Space)</span>
            </div>
            ${isBulk ? '' : `
            <div class="context-menu-item flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-[#007aff] hover:text-white transition-colors" data-action="open">
                <span>Open in Photo Viewer</span>
            </div>
            `}
            <div class="context-menu-item flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-[#007aff] hover:text-white transition-colors" data-action="copy">
                <span>${isBulk ? 'Copy Selected Paths' : 'Copy File Path'}</span>
            </div>
            ${isBulk ? '' : `
            <div class="context-menu-item flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-[#007aff] hover:text-white transition-colors" data-action="reveal">
                <span>Reveal in File Explorer</span>
            </div>
            <div class="context-menu-item flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-[#007aff] hover:text-white transition-colors" data-action="rename">
                <span>Rename (F2)</span>
            </div>
            `}
            <div class="h-px bg-white/10 my-1"></div>
            <div class="context-menu-item flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none text-red-400 hover:bg-red-500 hover:text-white transition-colors" data-action="delete">
                <span>${isBulk ? `Move ${targetPaths.length} to Trash` : 'Move to Trash'}</span>
            </div>
        `;
    }

    document.body.appendChild(menu);

    menu.addEventListener('click', ev => {
        const item = ev.target.closest('.context-menu-item');
        if (!item) return;
        const action = item.dataset.action;

        if (action === 'quicklook') {
            openLightbox(filePath, name);
        } else if (action === 'open') {
            api.openImage(filePath);
        } else if (action === 'copy') {
            const pathsText = targetPaths.join('\n');
            navigator.clipboard.writeText(pathsText)
                .then(() => logToUI(`[GUI] 📋 Copied to clipboard: ${isBulk ? `${targetPaths.length} paths` : name}`, 'INFO'))
                .catch(err => logToUI(`[GUI] ❌ Failed to copy paths: ${err.message}`, 'ERROR'));
        } else if (action === 'reveal') {
            api.revealImage(filePath);
        } else if (action === 'rename') {
            renameActiveImage(filePath);
        } else if (action === 'delete') {
            deleteImageSilently(targetPaths);
        } else if (action === 'restore') {
            restoreImage(targetPaths);
        }

        menu.remove();
    });

    const removeMenu = () => {
        menu.remove();
        document.removeEventListener('click', removeMenu);
        document.removeEventListener('contextmenu', removeMenu);
    };
    setTimeout(() => {
        document.addEventListener('click', removeMenu);
        document.addEventListener('contextmenu', removeMenu);
    }, 50);
}

// ─── Create Custom Background Context Menu ─────────────────────────────────────
function showBackgroundContextMenu(e, openLightbox, deleteImageSilently, restoreImage, logToUI) {
    e.preventDefault();
    e.stopPropagation();

    const existing = document.querySelector('.macos-context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'macos-context-menu absolute bg-[#161924] border border-white/12 rounded-lg shadow-2xl w-[180px] z-[9999] py-1 font-sans text-text-d animate-[contextMenuFadeIn_0.1s_ease-out]';
    
    const showTrash = getState('showTrashActive');
    const selectedImages = getState('gallerySelectedImages') || [];
    const hasSelections = selectedImages.length > 0;
    const galleryImages = getState('galleryImages') || [];
    const hasImages = galleryImages.length > 0;

    menu.innerHTML = `
        <div class="context-menu-item flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-[#007aff] hover:text-white transition-colors" data-action="refresh">
            <span>Refresh Gallery</span>
        </div>
        ${hasImages ? `
        <div class="context-menu-item flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-[#007aff] hover:text-white transition-colors" data-action="selectall">
            <span>Select All</span>
        </div>
        ` : ''}
        ${hasSelections ? `
        <div class="context-menu-item flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-[#007aff] hover:text-white transition-colors" data-action="clearselect">
            <span>Clear Selection</span>
        </div>
        ` : ''}
        <div class="h-px bg-white/10 my-1"></div>
        <div class="context-menu-item flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer select-none hover:bg-[#007aff] hover:text-white transition-colors" data-action="toggletrash">
            <span>${showTrash ? 'Show Gallery' : 'Show Trash Bin'}</span>
        </div>
    `;

    // Position boundaries
    const menuWidth = 180;
    const menuHeight = 140;
    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 8;
    }
    if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 8;
    }
    menu.style.left = `${Math.max(0, x)}px`;
    menu.style.top = `${Math.max(0, y)}px`;

    document.body.appendChild(menu);

    menu.addEventListener('click', ev => {
        const item = ev.target.closest('.context-menu-item');
        if (!item) return;
        const action = item.dataset.action;

        if (action === 'refresh') {
            refreshGallery(openLightbox, deleteImageSilently, restoreImage, logToUI);
        } else if (action === 'selectall') {
            selectAllImages();
        } else if (action === 'clearselect') {
            selectImage(null);
        } else if (action === 'toggletrash') {
            const btnToggle = document.getElementById('btn-toggle-trash');
            if (btnToggle) btnToggle.click();
        }

        menu.remove();
    });

    const removeMenu = () => {
        menu.remove();
        document.removeEventListener('click', removeMenu);
        document.removeEventListener('contextmenu', removeMenu);
    };
    setTimeout(() => {
        document.addEventListener('click', removeMenu);
        document.addEventListener('contextmenu', removeMenu);
    }, 50);
}

// ─── Select All Images in Gallery ──────────────────────────────────────────────
export function selectAllImages() {
    const filtered = getState('currentFilteredImages') || [];
    setState('gallerySelectedImages', [...filtered]);
    if (filtered.length > 0) {
        setState('galleryLastSelectedImage', filtered[filtered.length - 1]);
        selectImage(filtered[filtered.length - 1], { ctrlKey: true, dontToggle: true });
    }
}

// ─── Create Thumbnail Element ──────────────────────────────────────────────────
function createThumbnail(filePath, viewMode, openLightbox, deleteImageSilently, restoreImage, logToUI) {
    const name = getFileName(filePath);
    const thumb = document.createElement('div');
    thumb.dataset.path = filePath;
    thumb.tabIndex = -1;

    const showTrash = getState('showTrashActive');
    const selectMode = getState('gallerySelectModeActive');

    // Image
    const img = document.createElement('img');
    img.dataset.src = `file://${filePath.replace(/\\/g, '/')}`;
    img.alt = name;
    img.loading = 'lazy';

    // ── List View rendering vs Grid View ──
    if (viewMode === 'list') {
        // Tailwind List View card
        thumb.className = 'gallery-thumb group flex items-center border-b border-white/5 px-4 py-1.5 bg-transparent cursor-pointer h-[52px] min-h-[52px] hover:bg-white/5 select-none focus:outline-none transition-colors';

        // Checkbox wrapper on the left
        const checkWrapper = document.createElement('div');
        checkWrapper.className = `thumb-checkbox-wrapper mr-2 flex-shrink-0 ${selectMode ? '' : 'hidden'}`;
        
        const checkbox = document.createElement('div');
        checkbox.className = 'thumb-checkbox w-4 h-4 rounded border border-white/20 bg-black/60 flex items-center justify-center cursor-pointer transition-all hover:scale-105 hover:border-white/40';
        checkbox.innerHTML = `
            <svg class="check-icon hidden text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" width="8" height="8">
                <polyline points="20 6 9 17 4 12" />
            </svg>
        `;
        checkWrapper.appendChild(checkbox);
        
        checkbox.addEventListener('click', e => {
            e.stopPropagation();
            selectImage(filePath, { ctrlKey: true }); // Toggle this specific image
        });

        img.className = `w-10 h-10 rounded object-cover mr-3 flex-shrink-0 transition-all ${showTrash ? 'grayscale opacity-40' : 'opacity-100'}`;

        const infoEl = document.createElement('div');
        infoEl.className = 'contents';

        const nameEl = document.createElement('span');
        nameEl.className = `gallery-thumb-name flex-[2] min-w-[200px] text-xs font-mono truncate px-2 transition-colors ${showTrash ? 'line-through text-text-muted opacity-50' : 'text-text-d'}`;
        nameEl.textContent = name;
        nameEl.title = name;

        const dateEl = document.createElement('span');
        dateEl.className = 'meta-date flex-[1.2] w-[140px] text-xs text-text-dim px-2 transition-colors';
        dateEl.textContent = 'Loading...';

        const resEl = document.createElement('span');
        resEl.className = 'meta-resolution flex-[1] w-[110px] text-xs text-accent px-2 transition-colors';
        resEl.textContent = '—';

        const sizeEl = document.createElement('span');
        sizeEl.className = 'meta-size-col flex-[0.8] w-[90px] text-xs text-text-dim px-2 transition-colors';
        sizeEl.textContent = '—';

        const actionsEl = document.createElement('div');
        actionsEl.className = 'list-actions-col flex-[0.8] w-[80px] px-2 flex justify-end items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100';
        
        if (showTrash) {
            actionsEl.innerHTML = `
                <button class="thumb-action-btn restore-btn" title="Restore Image">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                </button>
                <button class="thumb-action-btn delete-perm-btn" title="Delete Permanently">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            `;
            actionsEl.querySelector('.restore-btn').addEventListener('click', e => {
                e.stopPropagation();
                restoreImage(filePath, true);
            });
            actionsEl.querySelector('.delete-perm-btn').addEventListener('click', e => {
                e.stopPropagation();
                deleteImageSilently(filePath, true);
            });
        } else {
            actionsEl.innerHTML = `
                <button class="thumb-action-btn copy-btn" title="Copy Path">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                </button>
                <button class="thumb-action-btn delete-btn" title="Move to Trash">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                </button>
            `;
            actionsEl.querySelector('.copy-btn').addEventListener('click', async e => {
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(filePath);
                    const btn = actionsEl.querySelector('.copy-btn');
                    btn.classList.add('bg-green-500', 'border-green-500');
                    setTimeout(() => btn.classList.remove('bg-green-500', 'border-green-500'), 1500);
                } catch (err) {
                    logToUI(`[GUI] ❌ Failed to copy path: ${err.message}`, 'ERROR');
                }
            });
            actionsEl.querySelector('.delete-btn').addEventListener('click', e => {
                e.stopPropagation();
                deleteImageSilently(filePath, true);
            });
        }

        infoEl.append(nameEl, dateEl, resEl, sizeEl, actionsEl);
        thumb.append(checkWrapper, img, infoEl);

        api.getFileStats(filePath).then(stats => {
            if (stats) {
                sizeEl.textContent = formatBytes(stats.size);
                dateEl.textContent = new Date(stats.mtimeMs).toLocaleDateString('id-ID', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });
            }
        }).catch(() => {
            dateEl.textContent = '—';
        });

        img.addEventListener('load', () => {
            img.classList.remove('opacity-0');
            if (img.naturalWidth) {
                resEl.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
            }
        });

    } else if (viewMode === 'gallery') {
        // Filmstrip horizontal mode (simple square box containing image only)
        thumb.className = `gallery-thumb group w-[80px] min-w-[80px] h-[80px] max-h-[80px] rounded-md overflow-hidden cursor-pointer relative flex flex-col flex-shrink-0 transition-all duration-150 hover:border-white/15 select-none focus:outline-none bg-[#0a0c13] border ${showTrash ? 'border-red-500/25' : 'border-white/5'}`;

        // Checkbox wrapper on top right
        const checkWrapper = document.createElement('div');
        checkWrapper.className = `thumb-checkbox-wrapper absolute top-1 right-1 z-20 transition-opacity pointer-events-auto ${selectMode ? 'opacity-100' : 'hidden'}`;
        
        const checkbox = document.createElement('div');
        checkbox.className = 'thumb-checkbox w-3.5 h-3.5 rounded-full border border-white/20 bg-black/60 flex items-center justify-center cursor-pointer transition-all hover:scale-105 hover:border-white/40 shadow-md';
        checkbox.innerHTML = `
            <svg class="check-icon hidden text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" width="7" height="7">
                <polyline points="20 6 9 17 4 12" />
            </svg>
        `;
        checkWrapper.appendChild(checkbox);

        checkbox.addEventListener('click', e => {
            e.stopPropagation();
            selectImage(filePath, { ctrlKey: true }); // Toggle this specific image
        });

        img.className = `w-full h-full object-cover block opacity-0 transition-opacity duration-300 ${showTrash ? 'grayscale opacity-40' : ''}`;

        thumb.append(checkWrapper, img);

        img.addEventListener('load', () => {
            img.classList.remove('opacity-0');
            img.classList.add('opacity-100');
        });
    } else {
        // Grid View (macOS Finder style: square image container + centered labels below)
        thumb.className = 'gallery-thumb group flex flex-col items-center cursor-pointer select-none focus:outline-none relative w-full';

        // 1. Image Container (Square Card)
        const imgContainer = document.createElement('div');
        imgContainer.className = `image-container-box w-full aspect-square bg-[#0b0d15] border rounded-lg overflow-hidden flex items-center justify-center relative shadow-md transition-all duration-150 group-hover:border-white/15 group-hover:bg-[#0f121f] group-hover:shadow-lg ${showTrash ? 'border-red-500/25' : 'border-white/5'}`;

        // Checkbox wrapper on top right
        const checkWrapper = document.createElement('div');
        checkWrapper.className = `thumb-checkbox-wrapper absolute top-1.5 right-1.5 z-20 transition-opacity pointer-events-auto ${selectMode ? 'opacity-100' : 'hidden'}`;
        
        const checkbox = document.createElement('div');
        checkbox.className = 'thumb-checkbox w-4.5 h-4.5 rounded-full border border-white/20 bg-black/60 flex items-center justify-center cursor-pointer transition-all hover:scale-105 hover:border-white/40 shadow-md';
        checkbox.innerHTML = `
            <svg class="check-icon hidden text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" width="10" height="10">
                <polyline points="20 6 9 17 4 12" />
            </svg>
        `;
        checkWrapper.appendChild(checkbox);

        checkbox.addEventListener('click', e => {
            e.stopPropagation();
            selectImage(filePath, { ctrlKey: true }); // Toggle this specific image
        });

        imgContainer.appendChild(checkWrapper);

        if (showTrash) {
            const trashBadge = document.createElement('span');
            trashBadge.className = 'absolute top-1.5 left-1.5 bg-red-600/80 backdrop-blur-md text-white text-[8.5px] font-bold px-1.5 py-0.5 rounded shadow-lg z-10 tracking-wider';
            trashBadge.textContent = 'DELETED';
            imgContainer.appendChild(trashBadge);
        }

        img.className = `w-full h-full object-contain p-1.5 opacity-0 transition-opacity duration-300 flex-shrink-0 ${showTrash ? 'grayscale opacity-40' : ''}`;

        // Hover Overlay Actions
        const overlay = document.createElement('div');
        overlay.className = 'absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-black/60 to-transparent flex justify-end items-center gap-1 px-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10 pointer-events-none group-hover:pointer-events-auto';
        
        if (showTrash) {
            overlay.innerHTML = `
                <button class="thumb-action-btn restore-btn" title="Restore Image">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15 a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                </button>
                <button class="thumb-action-btn delete-perm-btn" title="Delete Permanently">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            `;
            overlay.querySelector('.restore-btn').addEventListener('click', e => {
                e.stopPropagation();
                restoreImage(filePath, true);
            });
            overlay.querySelector('.delete-perm-btn').addEventListener('click', e => {
                e.stopPropagation();
                deleteImageSilently(filePath, true);
            });
        } else {
            overlay.innerHTML = `
                <button class="thumb-action-btn delete-btn" title="Delete Image">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                </button>
                <button class="thumb-action-btn copy-btn" title="Copy Path">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                </button>
            `;
            overlay.querySelector('.copy-btn').addEventListener('click', async e => {
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(filePath);
                    const btn = overlay.querySelector('.copy-btn');
                    btn.classList.add('bg-green-500', 'border-green-500');
                    setTimeout(() => btn.classList.remove('bg-green-500', 'border-green-500'), 1500);
                } catch (err) {
                    logToUI(`[GUI] ❌ Failed to copy path: ${err.message}`, 'ERROR');
                }
            });
            overlay.querySelector('.delete-btn').addEventListener('click', e => {
                e.stopPropagation();
                deleteImageSilently(filePath, true);
            });
        }

        imgContainer.append(img, overlay);

        // 2. Labels Area (Centered below)
        const infoEl = document.createElement('div');
        infoEl.className = 'w-full mt-2 px-1 flex flex-col items-center text-center';

        const nameEl = document.createElement('span');
        nameEl.className = `gallery-thumb-name text-[10.5px] font-sans text-text-dim font-medium truncate max-w-full px-1.5 py-0.5 rounded transition-all ${showTrash ? 'line-through opacity-50' : ''}`;
        nameEl.textContent = name;
        nameEl.title = name;

        const resEl = document.createElement('span');
        resEl.className = 'meta-resolution text-[9px] font-sans text-accent opacity-75 mt-0.5 transition-colors';
        resEl.textContent = '—';

        infoEl.append(nameEl, resEl);
        thumb.append(imgContainer, infoEl);

        img.addEventListener('load', () => {
            img.classList.remove('opacity-0');
            img.classList.add('opacity-100');
            if (img.naturalWidth) {
                resEl.textContent = `${img.naturalWidth}×${img.naturalHeight}`;
            }
        });
    }

    // Bind hover transitions on buttons
    const btns = thumb.querySelectorAll('.thumb-action-btn');
    btns.forEach(btn => {
        btn.className = 'w-5 h-5 rounded border border-white/10 bg-[#080a10]/85 text-white/70 hover:text-white hover:bg-accent2 hover:border-accent2 flex items-center justify-center cursor-pointer transition-all duration-100 flex-shrink-0';
        if (btn.classList.contains('delete-btn') || btn.classList.contains('delete-perm-btn')) {
            btn.addEventListener('mouseenter', () => btn.className = 'w-5 h-5 rounded border border-red-500/30 bg-red-600 text-white flex items-center justify-center cursor-pointer transition-all duration-100 flex-shrink-0');
            btn.addEventListener('mouseleave', () => btn.className = 'w-5 h-5 rounded border border-white/10 bg-[#080a10]/85 text-white/70 hover:text-white flex items-center justify-center cursor-pointer transition-all duration-100 flex-shrink-0');
        }
        if (btn.classList.contains('restore-btn')) {
            btn.addEventListener('mouseenter', () => btn.className = 'w-5 h-5 rounded border border-emerald-500/30 bg-emerald-600 text-white flex items-center justify-center cursor-pointer transition-all duration-100 flex-shrink-0');
            btn.addEventListener('mouseleave', () => btn.className = 'w-5 h-5 rounded border border-white/10 bg-[#080a10]/85 text-white/70 hover:text-white flex items-center justify-center cursor-pointer transition-all duration-100 flex-shrink-0');
        }
    });

    thumb.addEventListener('click', e => {
        if (e.target.closest('.thumb-action-btn') || e.target.closest('.thumb-checkbox-wrapper')) return;
        selectImage(filePath, e);
    });

    thumb.addEventListener('dblclick', e => {
        if (e.target.closest('.thumb-action-btn') || e.target.closest('.thumb-checkbox-wrapper')) return;
        openLightbox(filePath, name);
    });

    thumb.addEventListener('contextmenu', e => {
        showContextMenu(e, filePath, openLightbox, deleteImageSilently, restoreImage, logToUI);
    });

    return { thumb, img };
}

// ─── Render Gallery ───────────────────────────────────────────────────────────
export function renderGallery(openLightbox, deleteImageSilently, restoreImage, logToUI) {
    openLightboxFn = openLightbox;
    deleteImageSilentlyFn = deleteImageSilently;
    restoreImageFn = restoreImage;
    logToUIFn = logToUI;

    const grid = document.getElementById('gallery-grid');
    const empty = document.getElementById('gallery-empty');
    if (!grid) return;

    // Update List View Header Spacer based on Select Mode
    const spacer = document.getElementById('list-header-spacer');
    if (spacer) {
        const selectMode = getState('gallerySelectModeActive');
        if (selectMode) {
            spacer.className = 'w-14 flex-shrink-0 transition-all duration-150';
        } else {
            spacer.className = 'w-8 flex-shrink-0 transition-all duration-150';
        }
    }

    grid.innerHTML = '';

    const items = filterAndSortImages();
    setState('currentFilteredImages', items);

    const galleryImages = getState('galleryImages');
    setState('imageCount', galleryImages.length);

    const countEl = document.getElementById('gallery-count');
    if (countEl) {
        const showTrash = getState('showTrashActive');
        if (showTrash) {
            countEl.textContent = `Trash Bin (${galleryImages.length} image${galleryImages.length !== 1 ? 's' : ''})`;
        } else {
            countEl.textContent = `${galleryImages.length} image${galleryImages.length !== 1 ? 's' : ''}`;
        }
    }

    if (items.length === 0) {
        const titleEl = empty?.querySelector('.gallery-empty-title') || empty?.querySelector('p');
        const subtitleEl = empty?.querySelector('.gallery-empty-sub') || empty?.querySelector('p + p');
        const query = getState('gallerySearchQuery');
        const showTrash = getState('showTrashActive');
        
        if (showTrash) {
            if (titleEl) titleEl.textContent = 'Trash is empty';
            if (subtitleEl) subtitleEl.textContent = 'Images you delete will appear here.';
        } else if (query && galleryImages.length > 0) {
            if (titleEl) titleEl.textContent = 'No results found';
            if (subtitleEl) subtitleEl.textContent = `No images match "${query}". Try a different search term.`;
        } else {
            if (titleEl) titleEl.textContent = 'No images found';
            if (subtitleEl) subtitleEl.textContent = 'Try refining your search or run the bot to generate images.';
        }
        empty?.classList.remove('hidden');
        selectImage(null);
        return;
    }
    empty?.classList.add('hidden');

    let observer = getState('galleryObserver');
    if (!observer) {
        observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        delete img.dataset.src;
                    }
                    observer.unobserve(img);
                }
            });
        }, { root: grid, rootMargin: '300px 0px', threshold: 0.01 });
        setState('galleryObserver', observer);
    }

    const viewMode = getState('galleryViewMode') || 'grid';

    items.forEach(filePath => {
        const { thumb, img } = createThumbnail(
            filePath, viewMode, openLightbox, deleteImageSilently, restoreImage, logToUI
        );
        grid.appendChild(thumb);
        observer.observe(img);
    });

    applyGalleryViewMode();

    if (selectedImagePath && items.includes(selectedImagePath)) {
        selectImage(selectedImagePath);
    } else {
        if (items.length > 0 && viewMode === 'gallery') {
            selectImage(items[0]);
        } else {
            selectImage(null);
        }
    }

    setupKeyboardListeners(openLightbox, deleteImageSilently);
}

// ─── Setup Keyboard Listeners ─────────────────────────────────────────────────
function setupKeyboardListeners(openLightbox, deleteImageSilently) {
    if (keyboardListenerAdded) return;
    keyboardListenerAdded = true;

    document.addEventListener('keydown', async e => {
        const tabEl = document.getElementById('tab-gallery');
        if (!tabEl || !tabEl.classList.contains('active')) return;

        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        // Prevent gallery shortcuts if any modal is active
        const confirmModal = document.getElementById('confirm-modal');
        if (confirmModal && !confirmModal.classList.contains('hidden')) return;

        const renameModal = document.getElementById('rename-modal');
        if (renameModal && !renameModal.classList.contains('hidden')) return;

        const items = getState('currentFilteredImages') || [];
        if (items.length === 0) return;

        // Ctrl + A: select all images
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            selectAllImages();
            return;
        }

        const selected = selectedImagePath;
        let index = items.indexOf(selected);
        const mode = getState('galleryViewMode') || 'grid';

        let cols = 1;
        if (mode === 'grid') {
            const grid = document.getElementById('gallery-grid');
            if (grid) {
                const computed = window.getComputedStyle(grid);
                const colTemplate = computed.getPropertyValue('grid-template-columns');
                cols = colTemplate.split(' ').length || 1;
            }
        }

        let nextIndex = index;

        if (e.key === 'ArrowRight') {
            e.preventDefault();
            nextIndex = (index === -1) ? 0 : Math.min(index + 1, items.length - 1);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            nextIndex = (index === -1) ? 0 : Math.max(index - 1, 0);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (mode === 'grid') {
                nextIndex = (index === -1) ? 0 : Math.min(index + cols, items.length - 1);
            } else {
                nextIndex = (index === -1) ? 0 : Math.min(index + 1, items.length - 1);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (mode === 'grid') {
                nextIndex = (index === -1) ? 0 : Math.max(index - cols, 0);
            } else {
                nextIndex = (index === -1) ? 0 : Math.max(index - 1, 0);
            }
        } else if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (selected) {
                const name = getFileName(selected);
                openLightbox(selected, name);
            }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            const selectedImages = getState('gallerySelectedImages') || [];
            if (selectedImages.length > 0) {
                const deleted = await deleteImageSilently(selectedImages);
                if (deleted) {
                    setTimeout(() => {
                        const newItems = getState('currentFilteredImages') || [];
                        if (newItems.length > 0) {
                            const newSelIndex = Math.min(index, newItems.length - 1);
                            selectImage(newItems[newSelIndex]);
                        }
                    }, 100);
                }
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            selectImage(null);
        } else if (e.key === 'F2') {
            e.preventDefault();
            if (selected) {
                renameActiveImage(selected);
            }
        }

        if (nextIndex !== index && nextIndex >= 0 && nextIndex < items.length) {
            selectImage(items[nextIndex], e);
            
            const targetEl = document.querySelector(`.gallery-thumb[data-path="${CSS.escape(items[nextIndex])}"]`);
            if (targetEl) {
                targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    });
}

// ─── Setup List View Header Click Sorting ──────────────────────────────────────
export function setupListHeaderEvents(openLightbox, deleteImageSilently, restoreImage, logToUI) {
    // Register background context menu on grid
    const grid = document.getElementById('gallery-grid');
    if (grid) {
        grid.addEventListener('contextmenu', e => {
            // Since thumbnail contextmenu listener stops propagation, this is only called when clicking empty background space
            showBackgroundContextMenu(e, openLightbox, deleteImageSilently, restoreImage, logToUI);
        });
    }

    const listHeader = document.getElementById('gallery-list-header');
    if (!listHeader) return;

    // Synchronize initial sorting arrows
    updateSortHeaderArrows();

    listHeader.querySelectorAll('.sortable').forEach(cell => {
        cell.addEventListener('click', () => {
            const key = cell.dataset.sort;
            if (listSortKey === key) {
                listSortDir = listSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                listSortKey = key;
                listSortDir = 'desc';
            }

            updateSortHeaderArrows();

            renderGallery(openLightbox, deleteImageSilently, restoreImage, logToUI);
        });
    });
}

// ─── Add Single Image ──────────────────────────────────────────────────────────
export function addGalleryImage(filePath, isNew, openLightbox, deleteImageSilently, restoreImage, logToUI) {
    // Switch off trash view when a new image comes in
    const showTrash = getState('showTrashActive');
    if (showTrash) {
        setState('showTrashActive', false);
        const btnToggle = document.getElementById('btn-toggle-trash');
        const btnEmpty = document.getElementById('btn-empty-trash');
        const titleLabel = document.querySelector('[data-tab="gallery"] .tab-text');
        
        const iconTrashEmpty = document.getElementById('icon-trash-empty');
        const iconGalleryBack = document.getElementById('icon-gallery-back');
        const textToggle = document.getElementById('text-trash-toggle');

        if (btnToggle) {
            btnToggle.classList.remove('bg-accent/15', 'text-accent', 'border-accent/30');
            btnToggle.title = "Show Trash Bin";
        }
        if (btnEmpty) btnEmpty.classList.add('hidden');
        if (titleLabel) titleLabel.textContent = "Gallery";

        if (iconTrashEmpty) iconTrashEmpty.classList.remove('hidden');
        if (iconGalleryBack) iconGalleryBack.classList.add('hidden');
        if (textToggle) textToggle.textContent = "Trash Bin";
    }

    // Switch off select mode if active
    if (getState('gallerySelectModeActive')) {
        updateSelectModeUI(false);
    }

    const galleryImages = getState('galleryImages');
    if (!galleryImages.includes(filePath)) {
        galleryImages.unshift(filePath);
        setState('galleryImages', galleryImages);
    }
    renderGallery(openLightbox, deleteImageSilently, restoreImage, logToUI);

    if (isNew) {
        setTimeout(() => {
            const el = document.querySelector(
                `.gallery-thumb[data-path="${CSS.escape(filePath)}"]`
            );
            if (el) {
                const badge = document.createElement('span');
                badge.className = 'absolute top-1.5 left-1.5 bg-green-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-lg z-10 tracking-wider';
                badge.textContent = 'NEW';
                // Jika di mode grid, pasang badge di dalam container gambar
                const imgBox = el.querySelector('.image-container-box');
                if (imgBox) {
                    imgBox.appendChild(badge);
                } else {
                    el.appendChild(badge);
                }
                setTimeout(() => badge.remove(), NEW_BADGE_DURATION_MS);
            }
        }, 120);
        if (getState('galleryViewMode') === 'gallery') {
            selectImage(filePath);
        }
    }
    updateProgressStats();
}

// ─── Refresh Gallery ──────────────────────────────────────────────────────────
export async function refreshGallery(openLightbox, deleteImageSilently, restoreImage, logToUI) {
    const dir = getState('currentOutputDir');
    const showTrash = getState('showTrashActive');
    try {
        const images = showTrash
            ? await api.scanTrashImages(dir || undefined)
            : await api.scanImages(dir || undefined);
        setState('galleryImages', images || []);
    } catch {
        setState('galleryImages', []);
    }
    renderGallery(openLightbox, deleteImageSilently, restoreImage, logToUI);
}

// ─── Rename Active Image ──────────────────────────────────────────────────────
export function renameActiveImage(filePath) {
    if (!filePath) return;

    const modal = document.getElementById('rename-modal');
    const input = document.getElementById('rename-input');
    const btnCancel = document.getElementById('btn-rename-cancel');
    const btnSave = document.getElementById('btn-rename-save');
    if (!modal || !input || !btnCancel || !btnSave) return;

    const oldName = getFileName(filePath);
    const ext = '.' + oldName.split('.').pop();
    const base = oldName.substring(0, oldName.length - ext.length);

    // Pre-fill input
    input.value = base;
    modal.classList.remove('hidden');
    input.focus();
    input.select();

    // Clean up function to remove listeners
    function cleanup() {
        modal.classList.add('hidden');
        btnSave.removeEventListener('click', handleSave);
        btnCancel.removeEventListener('click', handleCancel);
        input.removeEventListener('keydown', handleKeydown);
    }

    async function handleSave() {
        const cleaned = input.value.trim();
        if (cleaned === '') {
            showToast("Filename cannot be empty.");
            return;
        }
        if (cleaned === base) {
            cleanup();
            return;
        }

        // Validate filename characters for Windows
        const invalidChars = /[\\/:*?"<>|]/;
        if (invalidChars.test(cleaned)) {
            showToast("Invalid filename. Characters like \\ / : * ? \" < > | are not allowed.");
            if (logToUIFn) logToUIFn(`[GUI] ⚠️ Rename failed: Filename contains invalid characters.`, 'WARN');
            return;
        }

        const newName = cleaned + ext;
        const parentDir = filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
        const sep = filePath.includes('\\') ? '\\' : '/';
        const newPath = parentDir + sep + newName;

        // Release Windows file locks by clearing image sources displaying this file
        const previewImg = document.getElementById('gallery-preview-img');
        const inspectorThumb = document.getElementById('inspector-thumb');
        const lightboxImg = document.getElementById('lightbox-img');

        if (previewImg && decodeURIComponent(previewImg.src).includes(oldName)) {
            previewImg.src = "";
        }
        if (inspectorThumb && decodeURIComponent(inspectorThumb.src).includes(oldName)) {
            inspectorThumb.src = "";
        }
        if (lightboxImg && decodeURIComponent(lightboxImg.src).includes(oldName)) {
            lightboxImg.src = "";
        }

        // Release thumbnail sources
        const thumbs = document.querySelectorAll(`.gallery-thumb[data-path="${CSS.escape(filePath)}"] img`);
        thumbs.forEach(img => {
            img.src = "";
            img.removeAttribute('src');
        });

        cleanup();

        try {
            const res = await api.renameImage(filePath, newPath);
            if (res.ok) {
                const images = getState('galleryImages') || [];
                const idx = images.indexOf(filePath);
                if (idx !== -1) {
                    images[idx] = newPath;
                    setState('galleryImages', images);
                }

                if (selectedImagePath === filePath) {
                    selectedImagePath = newPath;
                    setState('gallerySelectedImage', newPath);
                }

                // Update lightbox path if it was open
                if (getState('lightboxPath') === filePath) {
                    setState('lightboxPath', newPath);
                    const lightboxName = document.getElementById('lightbox-name');
                    if (lightboxName) lightboxName.textContent = newName;
                }

                if (logToUIFn) logToUIFn(`[GUI] ✏️ Renamed "${oldName}" to "${newName}"`, 'SUCCESS');
                showToast(`Renamed to ${newName}`);
            } else {
                if (logToUIFn) logToUIFn(`[GUI] ❌ Failed to rename: ${res.error}`, 'ERROR');
                showToast(`Rename failed: ${res.error}`);
            }
        } catch (err) {
            if (logToUIFn) logToUIFn(`[GUI] ❌ Error during rename: ${err.message}`, 'ERROR');
            showToast(`Rename error: ${err.message}`);
        } finally {
            // Re-render gallery to restore all image paths/sources correctly
            if (openLightboxFn && deleteImageSilentlyFn && restoreImageFn && logToUIFn) {
                renderGallery(openLightboxFn, deleteImageSilentlyFn, restoreImageFn, logToUIFn);
            }
        }
    }

    function handleCancel() {
        cleanup();
    }

    function handleKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel();
        }
    }

    // Bind listeners
    btnSave.addEventListener('click', handleSave);
    btnCancel.addEventListener('click', handleCancel);
    input.addEventListener('keydown', handleKeydown);
}

// ─── Navigate Gallery Selection ───────────────────────────────────────────────
export function navigateGallerySelection(direction) {
    const items = getState('currentFilteredImages') || [];
    if (items.length === 0) return;

    const selected = selectedImagePath;
    let index = items.indexOf(selected);

    let nextIndex;
    if (index === -1) {
        nextIndex = 0;
    } else {
        nextIndex = index + direction;
        nextIndex = Math.max(0, Math.min(nextIndex, items.length - 1));
    }

    if (nextIndex !== index && nextIndex >= 0 && nextIndex < items.length) {
        selectImage(items[nextIndex]);
        const targetEl = document.querySelector(`.gallery-thumb[data-path="${CSS.escape(items[nextIndex])}"]`);
        if (targetEl) {
            targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
}
