// js/modules/confirmModal.js — Controller untuk Custom Confirmation Modal

let modalQueue = [];
let isModalOpen = false;
let currentResolve = null;
let currentPrefKey = null;

// Icons mapping matching the requested context
const ICONS = {
    warning: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>`,
    trash: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
    </svg>`,
    delete: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="14" y2="15" />
        <line x1="14" y1="11" x2="10" y2="15" />
    </svg>`,
    success: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
    </svg>`,
    restore: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>`,
    info: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>`
};

// Color scheme mapping
const TYPE_COLORS = {
    warning: { bg: 'bg-amber-500/10', text: 'text-amber-500', btn: 'bg-amber-600 hover:bg-amber-500 shadow-amber-500/20' },
    trash: { bg: 'bg-yellow-500/10', text: 'text-yellow-500', btn: 'bg-yellow-600 hover:bg-yellow-500 shadow-yellow-500/20' },
    delete: { bg: 'bg-red-500/10', text: 'text-red-500', btn: 'bg-red-600 hover:bg-red-500 shadow-red-500/20' },
    success: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', btn: 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20' },
    restore: { bg: 'bg-indigo-500/10', text: 'text-indigo-500', btn: 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/20' },
    info: { bg: 'bg-blue-500/10', text: 'text-blue-500', btn: 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/20' }
};

export function showConfirmModal(options) {
    return new Promise(resolve => {
        // If a preference key is provided, check localStorage skip option
        if (options.prefKey && localStorage.getItem(`pref_skip_${options.prefKey}`) === 'true') {
            resolve(true);
            return;
        }

        modalQueue.push({ options, resolve });
        processQueue();
    });
}

function processQueue() {
    if (isModalOpen || modalQueue.length === 0) return;
    
    isModalOpen = true;
    const { options, resolve } = modalQueue.shift();
    currentResolve = resolve;
    currentPrefKey = options.prefKey;

    const modal = document.getElementById('confirm-modal');
    const content = document.getElementById('confirm-modal-content');
    const titleEl = document.getElementById('confirm-modal-title');
    const msgEl = document.getElementById('confirm-modal-message');
    const detailsEl = document.getElementById('confirm-modal-details');
    const prefRow = document.getElementById('confirm-modal-pref-row');
    const checkbox = document.getElementById('confirm-modal-checkbox');
    const btnCancel = document.getElementById('btn-confirm-cancel');
    const btnConfirm = document.getElementById('btn-confirm-action');
    const iconWrapper = document.getElementById('confirm-modal-icon-wrapper');

    if (!modal || !content) {
        resolve(false);
        isModalOpen = false;
        return;
    }

    // Reset UI elements
    titleEl.textContent = options.title || 'Confirm Action';
    msgEl.textContent = options.message || 'Are you sure?';
    
    if (options.details) {
        detailsEl.textContent = options.details;
        detailsEl.classList.remove('hidden');
    } else {
        detailsEl.classList.add('hidden');
    }

    // Configure "Don't show again" checkbox
    if (options.prefKey) {
        prefRow.classList.remove('hidden');
        checkbox.checked = false;
    } else {
        prefRow.classList.add('hidden');
    }

    btnCancel.textContent = options.cancelText || 'Cancel';
    btnConfirm.textContent = options.confirmText || 'Confirm';

    // Apply colors and icon based on type
    const type = options.type || 'warning';
    const scheme = TYPE_COLORS[type] || TYPE_COLORS.warning;

    // Reset and apply icon classes
    iconWrapper.className = `w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${scheme.bg} ${scheme.text}`;
    iconWrapper.innerHTML = ICONS[type] || ICONS.warning;

    // Reset and apply confirm button classes
    btnConfirm.className = `px-6 py-2 rounded-xl text-white transition-all active:scale-[0.98] cursor-pointer shadow-lg ${scheme.btn}`;

    // Bind dynamic click events
    btnCancel.onclick = () => closeActiveModal(false);
    btnConfirm.onclick = () => closeActiveModal(true);

    modal.onclick = (e) => {
        if (e.target === modal) {
            closeActiveModal(false);
        }
    };

    // Show modal
    modal.classList.remove('hidden');
    // Force browser reflow to trigger scale animation
    modal.offsetHeight;
    modal.classList.add('modal-open');

    // Focus Confirm button by default
    btnConfirm.focus();

    // Trap Keyboard Navigation
    setupFocusTrap(modal);
}

function closeActiveModal(result) {
    const modal = document.getElementById('confirm-modal');
    if (!modal) return;

    modal.classList.remove('modal-open');
    
    // Wait for transition to finish before hiding
    setTimeout(() => {
        modal.classList.add('hidden');
        
        // Save preference if checkbox is ticked
        if (result && currentPrefKey) {
            const checkbox = document.getElementById('confirm-modal-checkbox');
            if (checkbox && checkbox.checked) {
                localStorage.setItem(`pref_skip_${currentPrefKey}`, 'true');
            }
        }

        const resolve = currentResolve;
        currentResolve = null;
        currentPrefKey = null;
        isModalOpen = false;

        if (resolve) resolve(result);

        // Process next modal in queue
        processQueue();
    }, 200);
}

function setupFocusTrap(modal) {
    const focusableEls = modal.querySelectorAll('button, input[type="checkbox"]');
    const firstFocusable = focusableEls[0];
    const lastFocusable = focusableEls[focusableEls.length - 1];

    function handleTab(e) {
        if (e.key !== 'Tab') return;
        
        if (e.shiftKey) {
            if (document.activeElement === firstFocusable) {
                lastFocusable.focus();
                e.preventDefault();
            }
        } else {
            if (document.activeElement === lastFocusable) {
                firstFocusable.focus();
                e.preventDefault();
            }
        }
    }

    function handleKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeActiveModal(false);
        } else if (e.key === 'Enter') {
            // Only trigger confirm if not focusing the cancel button
            if (document.activeElement !== document.getElementById('btn-confirm-cancel')) {
                e.preventDefault();
                closeActiveModal(true);
            }
        }
    }

    // Clean listeners
    const cleanup = () => {
        modal.removeEventListener('keydown', handleTab);
        document.removeEventListener('keydown', handleKeydown);
    };

    modal.addEventListener('keydown', handleTab);
    document.addEventListener('keydown', handleKeydown);

    // Override currentResolve to include listener cleanup
    const origResolve = currentResolve;
    currentResolve = (result) => {
        cleanup();
        origResolve(result);
    };
}
