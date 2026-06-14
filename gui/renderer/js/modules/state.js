// js/modules/state.js — Shared mutable state untuk seluruh aplikasi renderer
// Import & mutasi via fungsi getter/setter agar tidak ada raw global variable.

const _state = {
    currentStatus:    'idle',
    autoScroll:       true,
    logLines:         [],
    logLineCount:     0,
    promptList:       [],
    promptStatuses:   {},
    currentOutputDir: null,
    lightboxPath:     null,
    imageCount:       0,
    completedCount:   0,
    totalCount:       0,
    elapsedTimer:     null,
    startTime:        null,
    currentLogFilter: 'all',
    logSearchQuery:   '',
    logStats:         { info: 0, success: 0, warn: 0, error: 0 },
    galleryImages:       [],
    gallerySearchQuery:  '',
    gallerySortOrder:    'newest',
    currentFilteredImages: [],
    lightboxIndex:       -1,
    deletedHistory:      [],
    redoHistory:         [],
    galleryViewMode:     localStorage.getItem('galleryViewMode') || 'grid',
    galleryObserver:     null,
    sidebarOpen:         true,
    showTrashActive:     false,
    promptSearchActiveIdx: 0,
    promptSearchMatchCount: 0,
    gallerySelectedImages: [],
    galleryLastSelectedImage: null,
    gallerySelectModeActive: false,
};

export function getState(key) { return _state[key]; }
export function setState(key, value) { _state[key] = value; }

// Shorthand untuk state yang sering di-set/get bersamaan
export function resetLogStats() {
    _state.logStats = { info: 0, success: 0, warn: 0, error: 0 };
}
