// js/modules/toastNotification.js — Tampilkan dan sembunyikan toast notification

import { TOAST_DURATION_MS } from './constants.js';

// SVG Icons for each notification type
const ICONS = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-green-400 flex-shrink-0">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
    </svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-red-400 flex-shrink-0">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
    </svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-amber-400 flex-shrink-0">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-blue-400 flex-shrink-0">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>`
};

// ─── Queue State ──────────────────────────────────────────────────────────────
const toastQueue = [];
let isToastActive = false;
let isHiding = false;

let activeToastElement = null;
let activeToastTimeoutId = null;
let activeToastStartTime = null;
let activeToastOnClosed = null;

// ─── Sembunyikan toast ────────────────────────────────────────────────────────
function hideToast(toast, onClosed) {
    // If there are more toasts in the queue, morph the active toast instead of hiding it!
    if (toastQueue.length > 0) {
        const nextItem = toastQueue.shift();
        morphToast(toast, nextItem, onClosed);
    } else {
        toast.classList.remove('visible');
        toast.classList.add('hide');
        isHiding = true;
        
        let called = false;
        const handleEnd = () => {
            if (called) return;
            called = true;
            toast.remove();
            
            isHiding = false;
            activeToastElement = null;
            activeToastTimeoutId = null;
            activeToastStartTime = null;
            activeToastOnClosed = null;
            
            if (onClosed) onClosed();
        };

        toast.addEventListener('transitionend', handleEnd);
        setTimeout(handleEnd, 400); // safety fallback
    }
}

// ─── Morph Toast Content (Liquid Transition) ──────────────────────────────────
function morphToast(toast, nextItem, onClosed) {
    const content = toast.querySelector('.toast-content');
    if (!content) {
        // Fallback: If DOM is not built correctly, hide and show normally
        toast.classList.remove('visible');
        toast.classList.add('hide');
        setTimeout(() => {
            toast.remove();
            
            isHiding = false;
            activeToastElement = null;
            activeToastTimeoutId = null;
            activeToastStartTime = null;
            activeToastOnClosed = null;
            isToastActive = false;
            
            toastQueue.unshift(nextItem);
            processQueue();
        }, 250);
        return;
    }

    // Fade out text and icon
    content.style.opacity = '0';

    setTimeout(() => {
        let type = 'info';
        let actionLabel = null;
        let callback = null;
        const validTypes = ['info', 'success', 'warning', 'error'];

        // Dynamic arguments parsing
        if (validTypes.includes(nextItem.typeOrActionLabel)) {
            type = nextItem.typeOrActionLabel;
            actionLabel = nextItem.actionLabelOrCallback;
            callback = nextItem.actionCallback;
        } else {
            actionLabel = nextItem.typeOrActionLabel;
            callback = nextItem.actionLabelOrCallback;
            const msg = nextItem.message.toLowerCase();
            if (msg.includes('success') || msg.includes('restored') || msg.includes('empty') || msg.includes('copied') || msg.includes('renamed') || msg.includes('saved')) {
                type = 'success';
            } else if (msg.includes('failed') || msg.includes('error') || msg.includes('invalid') || msg.includes('cannot')) {
                type = 'error';
            } else if (msg.includes('warning') || msg.includes('nothing') || msg.includes('limit')) {
                type = 'warning';
            } else {
                type = 'info';
            }
        }

        // Smoothly swap border colors and glows via class change
        toast.className = `toast-notification ${type} visible`;

        // Update content layout
        content.innerHTML = `
            <span class="toast-icon">${ICONS[type]}</span>
            <span class="toast-message">${nextItem.message}</span>
            ${actionLabel ? `<button class="toast-action-btn">${actionLabel}</button>` : ''}
        `;

        // Fade in new text and icon
        content.style.opacity = '1';

        activeToastStartTime = Date.now();
        activeToastElement = toast;
        activeToastOnClosed = onClosed;

        // Use adaptive timeout duration: speed up if queue is backed up
        const duration = toastQueue.length > 0 ? 1500 : TOAST_DURATION_MS;
        activeToastTimeoutId = setTimeout(() => hideToast(toast, onClosed), duration);

        // Bind new action listener
        if (actionLabel && callback) {
            const actionBtn = content.querySelector('.toast-action-btn');
            if (actionBtn) {
                actionBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (activeToastTimeoutId) clearTimeout(activeToastTimeoutId);
                    callback();
                    hideToast(toast, onClosed);
                };
            }
        }

        // Bind new close listener
        const closeBtn = toast.querySelector('.toast-close-btn');
        if (closeBtn) {
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                if (activeToastTimeoutId) clearTimeout(activeToastTimeoutId);
                hideToast(toast, onClosed);
            };
        }
    }, 150);
}

// ─── Tampilkan toast ──────────────────────────────────────────────────────────
export function showToast(message, typeOrActionLabel = null, actionLabelOrCallback = null, actionCallback = null) {
    toastQueue.push({ message, typeOrActionLabel, actionLabelOrCallback, actionCallback });
    
    if (isToastActive) {
        if (isHiding) {
            // The active toast is fading out. Let's force-close it immediately to show the new toast!
            if (activeToastElement) {
                activeToastElement.remove();
            }
            isHiding = false;
            isToastActive = false;
            activeToastElement = null;
            if (activeToastTimeoutId) clearTimeout(activeToastTimeoutId);
            activeToastTimeoutId = null;
            activeToastStartTime = null;
            const savedOnClosed = activeToastOnClosed;
            activeToastOnClosed = null;
            
            if (savedOnClosed) savedOnClosed(); // this will set isToastActive = false and call processQueue()
        } else {
            // Reschedule / speed up the active toast
            const QUEUE_SPEED_MS = 1500;
            const elapsed = Date.now() - activeToastStartTime;
            if (elapsed >= QUEUE_SPEED_MS) {
                if (activeToastTimeoutId) clearTimeout(activeToastTimeoutId);
                hideToast(activeToastElement, activeToastOnClosed);
            } else {
                if (activeToastTimeoutId) clearTimeout(activeToastTimeoutId);
                const remaining = QUEUE_SPEED_MS - elapsed;
                activeToastTimeoutId = setTimeout(() => hideToast(activeToastElement, activeToastOnClosed), remaining);
            }
        }
    } else {
        processQueue();
    }
}

// ─── Process the Queue ────────────────────────────────────────────────────────
function processQueue() {
    if (isToastActive || toastQueue.length === 0) return;
    isToastActive = true;

    const { message, typeOrActionLabel, actionLabelOrCallback, actionCallback } = toastQueue.shift();
    renderToast(message, typeOrActionLabel, actionLabelOrCallback, actionCallback);
}

// ─── Render the Active Toast ──────────────────────────────────────────────────
function renderToast(message, typeOrActionLabel, actionLabelOrCallback, actionCallback) {
    const container = document.getElementById('toast-container');
    if (!container) {
        isToastActive = false;
        processQueue();
        return;
    }

    let type = 'info';
    let actionLabel = null;
    let callback = null;
    const validTypes = ['info', 'success', 'warning', 'error'];

    if (validTypes.includes(typeOrActionLabel)) {
        type = typeOrActionLabel;
        actionLabel = actionLabelOrCallback;
        callback = actionCallback;
    } else {
        actionLabel = typeOrActionLabel;
        callback = actionLabelOrCallback;
        
        const msg = message.toLowerCase();
        if (msg.includes('success') || msg.includes('restored') || msg.includes('empty') || msg.includes('copied') || msg.includes('renamed') || msg.includes('saved')) {
            type = 'success';
        } else if (msg.includes('failed') || msg.includes('error') || msg.includes('invalid') || msg.includes('cannot')) {
            type = 'error';
        } else if (msg.includes('warning') || msg.includes('nothing') || msg.includes('limit')) {
            type = 'warning';
        } else {
            type = 'info';
        }
    }

    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    toast.innerHTML = `
        <div class="toast-content flex items-center gap-3 flex-1 min-w-0 transition-opacity duration-150" style="transition: opacity 0.15s ease-in-out;">
            <span class="toast-icon">${ICONS[type]}</span>
            <span class="toast-message">${message}</span>
            ${actionLabel ? `<button class="toast-action-btn">${actionLabel}</button>` : ''}
        </div>
        <button class="toast-close-btn" title="Dismiss">&times;</button>
    `;

    container.appendChild(toast);
    void toast.offsetWidth; // force reflow
    toast.classList.add('visible');

    const onClosed = () => {
        isToastActive = false;
        processQueue();
    };

    activeToastStartTime = Date.now();
    activeToastElement = toast;
    activeToastOnClosed = onClosed;

    const duration = toastQueue.length > 0 ? 1500 : TOAST_DURATION_MS;
    activeToastTimeoutId = setTimeout(() => hideToast(toast, onClosed), duration);

    // Setup action button listener
    if (actionLabel && callback) {
        const actionBtn = toast.querySelector('.toast-action-btn');
        if (actionBtn) {
            actionBtn.onclick = (e) => {
                e.stopPropagation();
                if (activeToastTimeoutId) clearTimeout(activeToastTimeoutId);
                callback();
                hideToast(toast, onClosed);
            };
        }
    }

    // Setup close button listener
    const closeBtn = toast.querySelector('.toast-close-btn');
    if (closeBtn) {
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            if (activeToastTimeoutId) clearTimeout(activeToastTimeoutId);
            hideToast(toast, onClosed);
        };
    }
}
