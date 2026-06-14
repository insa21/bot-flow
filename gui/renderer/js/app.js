// js/app.js — Entry point renderer; inisialisasi & wire semua modul

import { getState, setState }       from './modules/state.js';
import { updateStatus }             from './modules/statusBar.js';
import { renderLogLine, clearLog, applyLogFiltersAndSearch, updateLogStatsUI } from './modules/logPanel.js';
import { buildQueueList, updateProgressStats, parseLogLine } from './modules/progressPanel.js';
import { renderGallery, addGalleryImage, refreshGallery, applyGalleryViewMode, setupListHeaderEvents, renameActiveImage, navigateGallerySelection, updateSelectModeUI, selectImage } from './modules/gallery.js';
import { openLightbox, closeLightbox, navigateLightbox } from './modules/lightbox.js';
import { showToast }                from './modules/toastNotification.js';
import { deleteImageSilently, undoLastDelete, redoLastDelete, restoreImageFromTrash, deleteImagePermanently, emptyAllTrash } from './modules/imageActions.js';
import { toggleSidebar, setupResponsive, setupResizer } from './modules/sidebar.js';
import { getFileName }              from './modules/utils.js';
import { showConfirmModal }         from './modules/confirmModal.js';

const api = window.botAPI;

// ─── Shortcut untuk render gallery dengan dependencies ────────────────────────
function doRenderGallery() {
    renderGallery(openLightbox, doDeleteImage, doRestoreImage, logToUI);
}

async function doDeleteImage(filePath, forceSingle = false) {
    const showTrash = getState('showTrashActive');
    const selectedImages = getState('gallerySelectedImages') || [];
    
    let targets = [];
    if (forceSingle) {
        targets = [filePath];
    } else if (Array.isArray(filePath)) {
        targets = filePath;
    } else if (selectedImages.includes(filePath)) {
        targets = selectedImages;
    } else {
        targets = [filePath];
    }

    if (targets.length === 0) return false;

    if (showTrash) {
        return await deleteImagePermanently(targets, logToUI, doRenderGallery);
    } else {
        const label = targets.length === 1 ? `"${getFileName(targets[0])}"` : `${targets.length} selected images`;
        const confirmed = await showConfirmModal({
            title: 'Move Images to Trash',
            message: `Are you sure you want to move ${label} to the Trash Bin?`,
            details: 'The images can still be restored later from the Trash Bin.',
            confirmText: targets.length === 1 ? 'Move to Trash' : `Move to Trash (${targets.length})`,
            type: 'trash',
            prefKey: 'move_to_trash'
        });
        if (confirmed) {
            return await deleteImageSilently(targets, logToUI, doRenderGallery);
        }
        return false;
    }
}

function doRestoreImage(filePath, forceSingle = false) {
    const selectedImages = getState('gallerySelectedImages') || [];
    
    let targets = [];
    if (forceSingle) {
        targets = [filePath];
    } else if (Array.isArray(filePath)) {
        targets = filePath;
    } else if (selectedImages.includes(filePath)) {
        targets = selectedImages;
    } else {
        targets = [filePath];
    }
    
    restoreImageFromTrash(targets, logToUI, doRenderGallery);
}

// ─── Log ke UI (dipanggil oleh modul lain) ───────────────────────────────────
function logToUI(line, typeHint) {
    renderLogLine(line, typeHint);
    parseLogLine(line);
}

// ─── Load konfigurasi dari .env ───────────────────────────────────────────────
async function loadConfig() {
    try {
        const cfg  = await api.readConfig();
        const size = (cfg.IMAGE_SIZE || '2k').toLowerCase();
        document.querySelectorAll('.res-option').forEach(el => {
            el.classList.toggle('selected', el.dataset.val === size);
            el.querySelector('input').checked = el.dataset.val === size;
        });
        document.getElementById('headless-toggle').checked          = cfg.HEADLESS === 'true';
        document.getElementById('input-timeout').value              = cfg.TIMEOUT_MS || '120000';
        document.getElementById('input-retries').value              = cfg.MAX_RETRIES || '3';
        document.getElementById('input-dl-timeout').value           = cfg.DOWNLOAD_TIMEOUT_MS || '300000';
        if (cfg.OUTPUT_DIR) {
            setState('currentOutputDir', cfg.OUTPUT_DIR);
            const display = document.getElementById('output-path-display');
            display.textContent = cfg.OUTPUT_DIR;
            display.title       = cfg.OUTPUT_DIR;
            await refreshGallery(openLightbox, doDeleteImage, doRestoreImage, logToUI);
        }
    } catch (e) { logToUI(`[GUI] Could not load config: ${e.message}`, 'WARN'); }
}

// ─── Load prompts dari prompts.txt ────────────────────────────────────────────
async function loadPrompts() {
    try {
        const txt = await api.readPrompts();
        document.getElementById('prompts-textarea').value = txt;
        updatePromptCount();
    } catch { /* file belum ada */ }
}

// ─── Switch tab ───────────────────────────────────────────────────────────────
function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t =>
        t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(c =>
        c.classList.toggle('active', c.id === `tab-${name}`));

    if (name === 'progress') {
        const status = getState('currentStatus');
        if (status === 'idle' || status === 'completed') {
            const prompts = parseAllPrompts();
            buildQueueList(prompts);
        }
    }
}

// ─── Update badge jumlah prompt ───────────────────────────────────────────────
function updatePromptCount() {
    const raw   = document.getElementById('prompts-textarea').value;
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const active = lines.filter(l => !l.startsWith('#')).length;
    const skipped = lines.filter(l => l.startsWith('#')).length;

    const activeEl = document.getElementById('prompt-count-active');
    const skippedEl = document.getElementById('prompt-count-skipped');
    if (activeEl) activeEl.textContent = active;
    if (skippedEl) skippedEl.textContent = skipped;

    const countEl = document.getElementById('prompt-count');
    if (countEl) countEl.textContent = active;

    syncHighlights();
    return active;
}

// ─── Parse prompts dari textarea (hanya yang aktif) ──────────────────────────
function parsePrompts() {
    return document.getElementById('prompts-textarea').value
        .split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
}

// ─── Parse all prompts (termasuk komentar/skipped) ───────────────────────────
function parseAllPrompts() {
    return document.getElementById('prompts-textarea').value
        .split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

// ─── Sync highlights untuk baris komentar (#) di halaman Prompts ─────────────
function syncHighlights() {
    const textarea = document.getElementById('prompts-textarea');
    const highlight = document.getElementById('prompts-highlight');
    if (!textarea || !highlight) return;

    const text = textarea.value;
    const lines = text.split('\n');
    const esc = str => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Ambil query pencarian
    const searchInput = document.getElementById('prompt-search-input');
    const query = searchInput ? searchInput.value : '';
    
    // Hitung kemunculan prompt non-komentar
    const counts = {};
    lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            counts[trimmed] = (counts[trimmed] || 0) + 1;
        }
    });

    const highlightedLines = lines.map(line => {
        const trimmed = line.trim();
        const escapedLine = esc(line);
        if (trimmed.startsWith('#')) {
            return `<span class="prompts-comment-line">${escapedLine}</span>`;
        } else if (trimmed && counts[trimmed] > 1) {
            return `<span class="prompts-duplicate-line" title="Duplicate prompt">${escapedLine}</span>`;
        }
        return escapedLine;
    });

    let html = highlightedLines.join('\n') + (text.endsWith('\n') ? '\n' : '');

    if (query && query.trim().length > 0) {
        try {
            const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            // Menemukan kata pencarian, mengecualikan tag HTML agar tidak merusak markup komentar
            const safeRegex = new RegExp(`(${escapedQuery})(?![^<>]*>)`, 'gi');
            
            let matchCount = 0;
            html = html.replace(safeRegex, (match) => {
                matchCount++;
                return `<mark class="search-match" data-match-idx="${matchCount}">${match}</mark>`;
            });
            
            const countLabel = document.getElementById('prompt-search-index');
            const nav = document.getElementById('prompt-search-nav');
            if (countLabel && nav) {
                if (matchCount > 0) {
                    nav.classList.remove('hidden');
                    let activeIdx = getState('promptSearchActiveIdx') || 1;
                    if (activeIdx > matchCount) activeIdx = matchCount;
                    if (activeIdx < 1) activeIdx = 1;
                    setState('promptSearchActiveIdx', activeIdx);
                    setState('promptSearchMatchCount', matchCount);
                    countLabel.textContent = `${activeIdx}/${matchCount}`;
                    
                    // Highlight index aktif secara khusus
                    html = html.replace(`class="search-match" data-match-idx="${activeIdx}"`, `class="search-match active-match" data-match-idx="${activeIdx}"`);
                } else {
                    nav.classList.add('hidden');
                    setState('promptSearchActiveIdx', 0);
                    setState('promptSearchMatchCount', 0);
                }
            }
        } catch (e) {
            console.error('Search regex error:', e);
        }
    } else {
        const nav = document.getElementById('prompt-search-nav');
        if (nav) nav.classList.add('hidden');
        setState('promptSearchActiveIdx', 0);
        setState('promptSearchMatchCount', 0);
    }

    highlight.innerHTML = html;
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
}

// ─── Scroll active search match ke tengah layar ──────────────────────────────
function scrollActiveMatchIntoView() {
    setTimeout(() => {
        const highlight = document.getElementById('prompts-highlight');
        const textarea = document.getElementById('prompts-textarea');
        if (!highlight || !textarea) return;

        const activeEl = highlight.querySelector('.active-match');
        if (activeEl) {
            const activeRect = activeEl.getBoundingClientRect();
            const highlightRect = highlight.getBoundingClientRect();
            const relativeTop = activeRect.top - highlightRect.top + textarea.scrollTop;
            const relativeLeft = activeRect.left - highlightRect.left + textarea.scrollLeft;
            
            textarea.scrollTo({
                top: relativeTop - textarea.clientHeight / 2,
                left: relativeLeft - textarea.clientWidth / 2,
                behavior: 'smooth'
            });
        }
    }, 50);
}

// ─── Pilih folder output ─────────────────────────────────────────────────────
async function chooseFolder() {
    const p = await api.chooseFolder();
    if (p) {
        setState('currentOutputDir', p);
        const display = document.getElementById('output-path-display');
        display.textContent = p;
        display.title       = p;
        await refreshGallery(openLightbox, doDeleteImage, doRestoreImage, logToUI);
    }
}

// ─── Start bot ────────────────────────────────────────────────────────────────
async function startBot() {
    const prompts = parsePrompts();
    if (prompts.length === 0) {
        logToUI('[GUI] ⚠️  No prompts entered. Please add prompts first.', 'WARN');
        switchTab('prompts');
        return;
    }

    const resolution = document.querySelector('input[name="resolution"]:checked')?.value || '2k';
    const config = {
        imageSize:  resolution,
        headless:   document.getElementById('headless-toggle').checked,
        timeoutMs:  document.getElementById('input-timeout').value    || '120000',
        maxRetries: document.getElementById('input-retries').value    || '3',
        ctxTimeout: '15000',
        dlTimeout:  document.getElementById('input-dl-timeout').value || '300000',
        resume:     document.getElementById('resume-toggle').checked,
    };

    buildQueueList(parseAllPrompts());
    switchTab('progress');

    const result = await api.startBot({
        config,
        prompts: document.getElementById('prompts-textarea').value,
        outputDir: getState('currentOutputDir') || null,
    });

    if (!result.ok) {
        logToUI(`[GUI] ❌ Failed to start: ${result.error}`, 'ERROR');
        return;
    }
    logToUI(`[GUI] 🚀 Bot started — ${prompts.length} prompts queued at ${resolution.toUpperCase()} resolution.`, 'GUI');
}

// ─── Setup semua event listeners DOM ─────────────────────────────────────────
function setupListeners() {
    // Window controls
    document.getElementById('btn-minimize').addEventListener('click', () => api.minimize());
    document.getElementById('btn-maximize').addEventListener('click', () => api.maximize());
    document.getElementById('btn-close').addEventListener('click',    () => api.close());

    // Sidebar
    document.getElementById('btn-sidebar-toggle').addEventListener('click', toggleSidebar);

    // Tabs
    document.querySelectorAll('.tab').forEach(t => {
        t.addEventListener('click', () => switchTab(t.dataset.tab));
    });

    // Resolution picker
    document.querySelectorAll('.res-option').forEach(el => {
        el.addEventListener('click', () => {
            document.querySelectorAll('.res-option').forEach(o => o.classList.remove('selected'));
            el.classList.add('selected');
            el.querySelector('input').checked = true;
        });
    });

    // Prompts
    const ta = document.getElementById('prompts-textarea');
    const hl = document.getElementById('prompts-highlight');
    const container = document.getElementById('prompts-editor-container');
    if (ta && hl && container) {
        ta.addEventListener('input', updatePromptCount);
        ta.addEventListener('scroll', () => {
            hl.scrollTop = ta.scrollTop;
            hl.scrollLeft = ta.scrollLeft;
        });
        ta.addEventListener('focus', () => container.classList.add('focused'));
        ta.addEventListener('blur', () => container.classList.remove('focused'));
    }
    document.getElementById('btn-upload-prompts').addEventListener('click', async () => {
        const res = await api.choosePromptsFile();
        if (res !== null) {
            const { content, ext } = res;
            let parsedText = content;
            if (ext === '.json') {
                try {
                    const parsed = JSON.parse(content);
                    if (Array.isArray(parsed)) {
                        parsedText = parsed.map(item => {
                            if (typeof item === 'string') return item;
                            if (typeof item === 'object' && item !== null) {
                                return item.prompt || item.text || item.content || JSON.stringify(item);
                            }
                            return String(item);
                        }).join('\n');
                    } else if (typeof parsed === 'object' && parsed !== null) {
                        const list = parsed.prompts || parsed.list || parsed.data;
                        if (Array.isArray(list)) {
                            parsedText = list.map(item => typeof item === 'string' ? item : (item.prompt || item.text || item.content || JSON.stringify(item))).join('\n');
                        } else {
                            parsedText = Object.values(parsed).map(v => typeof v === 'string' ? v : JSON.stringify(v)).join('\n');
                        }
                    }
                } catch (e) {
                    logToUI(`[GUI] ⚠️ Failed to parse JSON prompts, inserting raw text: ${e.message}`, 'WARN');
                }
            } else if (ext === '.csv') {
                try {
                    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
                    if (lines.length > 0) {
                        const rows = lines.map(line => {
                            return line.split(',').map(cell => cell.replace(/^["']|["']$/g, '').trim());
                        });
                        const headers = rows[0];
                        let colIdx = 0;
                        const promptHeaderIdx = headers.findIndex(h => h.toLowerCase().includes('prompt') || h.toLowerCase().includes('text'));
                        if (promptHeaderIdx !== -1) {
                            colIdx = promptHeaderIdx;
                            rows.shift();
                        }
                        parsedText = rows.map(row => row[colIdx] || '').filter(p => p.length > 0).join('\n');
                    }
                } catch (e) {
                    logToUI(`[GUI] ⚠️ Failed to parse CSV prompts, inserting raw text: ${e.message}`, 'WARN');
                }
            }
            document.getElementById('prompts-textarea').value = parsedText;
            updatePromptCount();
        }
    });
    document.getElementById('btn-clear-prompts').addEventListener('click', () => {
        document.getElementById('prompts-textarea').value = '';
        updatePromptCount();
    });

    // Prompt search listeners
    const pSearchInput = document.getElementById('prompt-search-input');
    if (pSearchInput) {
        pSearchInput.addEventListener('input', () => {
            setState('promptSearchActiveIdx', 1);
            syncHighlights();
            scrollActiveMatchIntoView();
        });
        pSearchInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const active = getState('promptSearchActiveIdx') || 1;
                const count = getState('promptSearchMatchCount') || 0;
                if (count > 0) {
                    let nextIdx;
                    if (e.shiftKey) {
                        nextIdx = active <= 1 ? count : active - 1;
                    } else {
                        nextIdx = active >= count ? 1 : active + 1;
                    }
                    setState('promptSearchActiveIdx', nextIdx);
                    syncHighlights();
                    scrollActiveMatchIntoView();
                }
            } else if (e.key === 'Escape') {
                pSearchInput.value = '';
                setState('promptSearchActiveIdx', 0);
                setState('promptSearchMatchCount', 0);
                syncHighlights();
            }
        });
    }

    const pSearchPrev = document.getElementById('btn-prompt-search-prev');
    if (pSearchPrev) {
        pSearchPrev.addEventListener('click', e => {
            e.stopPropagation();
            const active = getState('promptSearchActiveIdx') || 1;
            const count = getState('promptSearchMatchCount') || 0;
            if (count > 0) {
                const prevIdx = active <= 1 ? count : active - 1;
                setState('promptSearchActiveIdx', prevIdx);
                syncHighlights();
                scrollActiveMatchIntoView();
            }
        });
    }

    const pSearchNext = document.getElementById('btn-prompt-search-next');
    if (pSearchNext) {
        pSearchNext.addEventListener('click', e => {
            e.stopPropagation();
            const active = getState('promptSearchActiveIdx') || 1;
            const count = getState('promptSearchMatchCount') || 0;
            if (count > 0) {
                const nextIdx = active >= count ? 1 : active + 1;
                setState('promptSearchActiveIdx', nextIdx);
                syncHighlights();
                scrollActiveMatchIntoView();
            }
        });
    }

    // Output folder
    document.getElementById('btn-choose-folder').addEventListener('click', chooseFolder);
    document.getElementById('output-path-display').addEventListener('click', chooseFolder);
    document.getElementById('btn-open-folder').addEventListener('click', () =>
        api.openOutputFolder(getState('currentOutputDir') || undefined));

    // Bot control
    document.getElementById('btn-start').addEventListener('click', startBot);
    document.getElementById('btn-stop').addEventListener('click', async () => await api.stopBot());

    // Log actions
    document.getElementById('btn-autoscroll').addEventListener('click', () => {
        const next = !getState('autoScroll');
        setState('autoScroll', next);
        document.getElementById('btn-autoscroll').classList.toggle('off', !next);
    });
    document.getElementById('btn-clear-log').addEventListener('click', clearLog);
    document.getElementById('btn-export-log').addEventListener('click', async () => {
        const plain = getState('logLines').map(l => l.line).join('\n');
        await api.exportLog(plain);
    });
    document.getElementById('btn-copy-log').addEventListener('click', async () => {
        const plain = getState('logLines').map(l => l.line).join('\n');
        try {
            await navigator.clipboard.writeText(plain);
            const btn   = document.getElementById('btn-copy-log');
            const label = btn.querySelector('span');
            const orig  = label.textContent;
            label.textContent = 'Copied!';
            btn.classList.add('toolbar-btn-active');
            setTimeout(() => { label.textContent = orig; btn.classList.remove('toolbar-btn-active'); }, 2000);
        } catch (err) { logToUI(`[GUI] ❌ Failed to copy log: ${err.message}`, 'ERROR'); }
    });

    // Log filters
    document.querySelectorAll('.filter-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            setState('currentLogFilter', pill.dataset.filter);
            applyLogFiltersAndSearch();
        });
    });
    const searchInput = document.getElementById('log-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', e => {
            setState('logSearchQuery', e.target.value);
            applyLogFiltersAndSearch();
        });
        searchInput.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                searchInput.value = '';
                setState('logSearchQuery', '');
                applyLogFiltersAndSearch();
            }
        });
    }

    // Gallery
    document.getElementById('btn-refresh-gallery').addEventListener('click',
        () => refreshGallery(openLightbox, doDeleteImage, doRestoreImage, logToUI));
    document.getElementById('btn-open-gallery-folder').addEventListener('click', () =>
        api.openOutputFolder(getState('currentOutputDir') || undefined));
    const galSearch = document.getElementById('gallery-search-input');
    if (galSearch) galSearch.addEventListener('input', e => {
        setState('gallerySearchQuery', e.target.value);
        doRenderGallery();
    });
    const galSort = document.getElementById('gallery-sort-select');
    if (galSort) galSort.addEventListener('change', e => {
        setState('gallerySortOrder', e.target.value);
        doRenderGallery();
    });

    document.getElementById('btn-toggle-trash').addEventListener('click', async () => {
        const showTrash = !getState('showTrashActive');
        setState('showTrashActive', showTrash);

        const btnToggle = document.getElementById('btn-toggle-trash');
        const btnEmpty = document.getElementById('btn-empty-trash');
        const titleLabel = document.querySelector('[data-tab="gallery"] .tab-text');

        const iconTrashEmpty = document.getElementById('icon-trash-empty');
        const iconGalleryBack = document.getElementById('icon-gallery-back');
        const textToggle = document.getElementById('text-trash-toggle');

        if (showTrash) {
            btnToggle.classList.add('bg-accent/15', 'text-accent', 'border-accent/30');
            btnToggle.title = "Show Active Gallery";
            if (btnEmpty) btnEmpty.classList.remove('hidden');
            if (titleLabel) titleLabel.textContent = "Trash Bin";

            if (iconTrashEmpty) iconTrashEmpty.classList.add('hidden');
            if (iconGalleryBack) iconGalleryBack.classList.remove('hidden');
            if (textToggle) textToggle.textContent = "Back to Gallery";
        } else {
            btnToggle.classList.remove('bg-accent/15', 'text-accent', 'border-accent/30');
            btnToggle.title = "Show Trash Bin";
            if (btnEmpty) btnEmpty.classList.add('hidden');
            if (titleLabel) titleLabel.textContent = "Gallery";

            if (iconTrashEmpty) iconTrashEmpty.classList.remove('hidden');
            if (iconGalleryBack) iconGalleryBack.classList.add('hidden');
            if (textToggle) textToggle.textContent = "Trash Bin";
        }

        // Clear selection
        setState('gallerySelectedImage', null);

        // Refresh list
        await refreshGallery(openLightbox, doDeleteImage, doRestoreImage, logToUI);
    });

    document.getElementById('btn-empty-trash').addEventListener('click', async () => {
        await emptyAllTrash(logToUI, doRenderGallery);
    });

    // Gallery view mode (segmented buttons)
    document.querySelectorAll('.view-segment-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const view = btn.dataset.view;
            setState('galleryViewMode', view);
            localStorage.setItem('galleryViewMode', view);
            applyGalleryViewMode();
            doRenderGallery();
        });
    });

    // Gallery zoom slider
    const zoomSlider = document.getElementById('gallery-zoom-slider');
    if (zoomSlider) {
        zoomSlider.addEventListener('input', e => {
            const val = e.target.value;
            const grid = document.getElementById('gallery-grid');
            if (grid) {
                grid.style.setProperty('--thumb-size', `${val}px`);
            }
        });
    }

    // Toggle Inspector Sidebar
    const infoBtn = document.getElementById('btn-gallery-info');
    const inspector = document.getElementById('gallery-inspector');
    if (infoBtn && inspector) {
        // Restore inspector state from localStorage/default
        const isOpen = localStorage.getItem('galleryInspectorOpen') === 'true';
        setState('galleryInspectorOpen', isOpen);
        
        infoBtn.addEventListener('click', () => {
            const currentView = getState('galleryViewMode');
            if (currentView === 'gallery') return; // Forced open in gallery view
            
            const nextState = !getState('galleryInspectorOpen');
            setState('galleryInspectorOpen', nextState);
            localStorage.setItem('galleryInspectorOpen', nextState);
            
            inspector.classList.toggle('hidden', !nextState);
            infoBtn.classList.toggle('toolbar-btn-active', nextState);
        });
    }

    // Inspector quick action buttons
    const insOpen = document.getElementById('inspector-action-open');
    if (insOpen) insOpen.addEventListener('click', () => {
        const selected = getState('gallerySelectedImages') || [];
        if (selected.length > 0) {
            selected.forEach(path => api.openImage(path));
        } else {
            const path = getState('gallerySelectedImage');
            if (path) api.openImage(path);
        }
    });

    const insReveal = document.getElementById('inspector-action-reveal');
    if (insReveal) insReveal.addEventListener('click', () => {
        const selected = getState('gallerySelectedImages') || [];
        const path = selected.length > 0 ? selected[0] : getState('gallerySelectedImage');
        if (path) api.revealImage(path);
    });

    const insRename = document.getElementById('inspector-action-rename');
    if (insRename) insRename.addEventListener('click', () => {
        const path = getState('gallerySelectedImage');
        if (path) renameActiveImage(path);
    });

    const insRestore = document.getElementById('inspector-action-restore');
    if (insRestore) insRestore.addEventListener('click', () => {
        const path = getState('gallerySelectedImage');
        if (path) doRestoreImage(path);
    });

    const insDelete = document.getElementById('inspector-action-delete');
    if (insDelete) insDelete.addEventListener('click', () => {
        const path = getState('gallerySelectedImage');
        if (path) doDeleteImage(path);
    });

    // Inspector click path to copy
    const insWhere = document.getElementById('inspector-val-where');
    if (insWhere) {
        insWhere.addEventListener('click', async () => {
            const path = getState('gallerySelectedImage');
            if (!path) return;
            try {
                await navigator.clipboard.writeText(path);
                const orig = insWhere.textContent;
                insWhere.textContent = 'Copied!';
                insWhere.style.color = '#4ade80';
                setTimeout(() => {
                    insWhere.textContent = orig;
                    insWhere.style.color = '';
                }, 1500);
            } catch (err) {
                logToUI(`[GUI] ❌ Failed to copy path: ${err.message}`, 'ERROR');
            }
        });
    }

    // Gallery scroll to top
    const galGrid     = document.getElementById('gallery-grid');
    const scrollTopBtn = document.getElementById('btn-gallery-scroll-top');
    if (galGrid && scrollTopBtn) {
        galGrid.addEventListener('scroll', () =>
            scrollTopBtn.classList.toggle('hidden', galGrid.scrollTop <= 200));
        scrollTopBtn.addEventListener('click', () => galGrid.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    // Gallery Preview Navigation Buttons
    const prevNav = document.getElementById('preview-nav-prev');
    if (prevNav) prevNav.addEventListener('click', e => {
        e.stopPropagation();
        navigateGallerySelection(-1);
    });

    const nextNav = document.getElementById('preview-nav-next');
    if (nextNav) nextNav.addEventListener('click', e => {
        e.stopPropagation();
        navigateGallerySelection(1);
    });

    // Lightbox
    document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
    document.getElementById('lightbox-backdrop').addEventListener('click', closeLightbox);
    document.getElementById('lightbox-open').addEventListener('click', () => {
        const lp = getState('lightboxPath');
        if (lp) api.openImage(lp);
    });
    document.getElementById('lightbox-prev').addEventListener('click', e => { e.stopPropagation(); navigateLightbox(-1); });
    document.getElementById('lightbox-next').addEventListener('click', e => { e.stopPropagation(); navigateLightbox(1); });
    document.getElementById('lightbox-img').addEventListener('click', function(e) {
        e.stopPropagation();
        this.classList.toggle('zoomed');
        document.getElementById('lightbox-img-wrap')?.classList.toggle('zoomed');
    });
    document.getElementById('lightbox-img').addEventListener('load', function() {
        if (this.naturalWidth)
            document.getElementById('lightbox-resolution').textContent = `${this.naturalWidth} × ${this.naturalHeight} px`;
    });
    document.getElementById('lightbox-copy-path').addEventListener('click', async () => {
        const lp = getState('lightboxPath');
        if (!lp) return;
        try {
            await navigator.clipboard.writeText(lp);
            const btn = document.getElementById('lightbox-copy-path');
            const orig = btn.innerHTML;
            btn.textContent = 'Copied!';
            btn.style.color = '#4ade80';
            setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 1500);
        } catch (err) { alert('Failed to copy: ' + err.message); }
    });
    document.getElementById('lightbox-restore').addEventListener('click', () => {
        const lp = getState('lightboxPath');
        if (lp) {
            doRestoreImage(lp);
            closeLightbox();
        }
    });
    document.getElementById('lightbox-delete').addEventListener('click', () => {
        const lp = getState('lightboxPath');
        if (lp) doDeleteImage(lp);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        // Prevent global shortcuts if a confirmation/rename modal is active
        const confirmModal = document.getElementById('confirm-modal');
        if (confirmModal && !confirmModal.classList.contains('hidden')) return;

        const renameModal = document.getElementById('rename-modal');
        if (renameModal && !renameModal.classList.contains('hidden')) return;

        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undoLastDelete(logToUI, doRenderGallery);
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' ||
            (e.shiftKey && e.key.toLowerCase() === 'z'))) {
            e.preventDefault();
            redoLastDelete(logToUI, doRenderGallery);
            return;
        }

        const lightbox = document.getElementById('lightbox');
        if (!lightbox?.classList.contains('hidden')) {
            if (e.key === 'Escape')          closeLightbox();
            else if (e.key === 'ArrowLeft')  navigateLightbox(-1);
            else if (e.key === 'ArrowRight') navigateLightbox(1);
            else if (e.key === 'Delete' || e.key === 'Backspace') {
                const lp = getState('lightboxPath');
                if (lp) doDeleteImage(lp);
            }
        }
    });
}

// ─── Setup IPC listeners (main → renderer) ────────────────────────────────────
function setupIPCListeners() {
    api.onLogLine(line => {
        logToUI(line);
    });

    api.onBotStatus(status => {
        updateStatus(status, logToUI);
        if (status === 'completed' || status === 'idle') {
            setTimeout(() => refreshGallery(openLightbox, doDeleteImage, doRestoreImage, logToUI), 1500);
        }
    });

    api.onBotProgress(({ current, total }) => {
        setState('totalCount', total);
        updateProgressStats();
    });

    api.onNewImage(filePath => {
        addGalleryImage(filePath, true, openLightbox, doDeleteImage, doRestoreImage, logToUI);
    });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    await loadConfig();
    await loadPrompts();
    setupListeners();
    setupResizer();
    setupIPCListeners();
    setupResponsive(() => applyGalleryViewMode(logToUI));
    setupListHeaderEvents(openLightbox, doDeleteImage, doRestoreImage, logToUI);
    updatePromptCount();
    applyGalleryViewMode(logToUI);
    updateProgressStats();
    switchTab('prompts');
}

document.addEventListener('DOMContentLoaded', init);
