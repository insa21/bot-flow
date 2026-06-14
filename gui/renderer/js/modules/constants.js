// js/modules/constants.js — Semua konstanta global: status, config, icon maps
// Tidak ada magic number/string di file lain; semua definisikan di sini.

export const STATUS_META = {
    idle:      { label: 'Idle',      cls: 's-idle',      emoji: '' },
    running:   { label: 'Running',   cls: 's-running',   emoji: '▶' },
    stopping:  { label: 'Stopping…', cls: 's-stopping',  emoji: '⏹' },
    completed: { label: 'Completed', cls: 's-completed', emoji: '✓' },
    error:     { label: 'Error',     cls: 's-error',     emoji: '!' },
};

export const LOG_ICONS = {
    INFO:   `<svg class="inline-icon blue-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8" stroke-width="3"/></svg>`,
    SUCCESS:`<svg class="inline-icon green-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    WARN:   `<svg class="inline-icon amber-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="3"/></svg>`,
    ERROR:  `<svg class="inline-icon red-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    GUI:    `<svg class="inline-icon indigo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    STDERR: `<svg class="inline-icon pink-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
};

export const QUEUE_ICONS = {
    done:    `<svg class="inline-icon green-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12" /></svg>`,
    active:  `<svg class="inline-icon accent-icon spin-slow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" /></svg>`,
    failed:  `<svg class="inline-icon red-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>`,
    pending: `<svg class="inline-icon muted-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.5"><circle cx="12" cy="12" r="10" /></svg>`,
    skipped: `<svg class="inline-icon muted-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="opacity:0.5"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>`,
};

export const EMOJI_MAP = {
    '📋': `<svg class="inline-icon blue-icon" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    '📐': `<svg class="inline-icon accent-icon" viewBox="0 0 24 24"><path d="M22 16V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2z"/></svg>`,
    '✅': `<svg class="inline-icon green-icon" viewBox="0 0 24 24" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    '❌': `<svg class="inline-icon red-icon" viewBox="0 0 24 24" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    '⚠️': `<svg class="inline-icon amber-icon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>`,
    'ℹ️': `<svg class="inline-icon blue-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/></svg>`,
    '🚀': `<svg class="inline-icon indigo-icon" viewBox="0 0 24 24"><path d="M13.5 10.5c1.4-1.4 2.2-3.4 3-5.5-2.1.8-4.1 1.6-5.5 3" /><path d="M17 17.5c-2.3 2-4.3 1-5.5 0l-4-4c-1-1.2-2-3.2 0-5.5L12 4c5 0 8 3 8 8Z" /></svg>`,
    '🔄': `<svg class="inline-icon cyan-icon spin-slow" viewBox="0 0 24 24"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>`,
    '⏱️': `<svg class="inline-icon amber-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    '⚡': `<svg class="inline-icon yellow-icon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    '📸': `<svg class="inline-icon purple-icon" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
    '💾': `<svg class="inline-icon blue-icon" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/></svg>`,
    '🔍': `<svg class="inline-icon accent-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    '📂': `<svg class="inline-icon yellow-icon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    '📝': `<svg class="inline-icon indigo-icon" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    '🎉': `<svg class="inline-icon pink-icon" viewBox="0 0 24 24"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>`,
    '🛑': `<svg class="inline-icon red-icon" viewBox="0 0 24 24"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/></svg>`,
    '⏩': `<svg class="inline-icon blue-icon" viewBox="0 0 24 24"><polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/></svg>`,
    '⏳': `<svg class="inline-icon amber-icon" viewBox="0 0 24 24"><path d="M5 2h14M5 22h14M19 2v4c0 4-3 7-7 7s-7-3-7-7V2M5 22v-4c0-4 3-7 7-7s7 3 7 7v4"/></svg>`,
    '🖱️': `<svg class="inline-icon accent2-icon" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="7"/><line x1="12" y1="6" x2="12" y2="10" stroke-width="2"/></svg>`,
};

export const IMAGE_EXTS       = ['.png', '.jpg', '.jpeg', '.webp'];
export const GALLERY_VIEW_SIZES = {
    'extra-large': { size: 280, cls: 'size-xl', label: 'Extra Large' },
    'large':       { size: 200, cls: 'size-lg', label: 'Large' },
    'medium':      { size: 150, cls: 'size-md', label: 'Medium' },
    'small':       { size: 110, cls: 'size-sm', label: 'Small' },
    'list':        { size: null, cls: 'view-list', label: 'List' },
};
export const DEFAULT_GALLERY_VIEW  = 'large';
export const TOAST_DURATION_MS     = 5000;
export const NEW_BADGE_DURATION_MS = 5000;
export const LIGHTBOX_TRANSITION_MS = 150;

