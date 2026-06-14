// js/modules/progressPanel.js — Kelola stat cards, progress bar, dan queue list

import { QUEUE_ICONS }          from './constants.js';
import { getState, setState }   from './state.js';
import { escHtml, triggerAnimation } from './utils.js';
import { showToast }            from './toastNotification.js';

// ─── Update semua stat cards dan progress bar ─────────────────────────────────
export function updateProgressStats() {
    const promptList     = getState('promptList');
    const promptStatuses = getState('promptStatuses');
    const imageCount     = getState('imageCount');
    let   totalCount     = getState('totalCount');

    const doneCount    = promptList.filter(p => promptStatuses[p] === 'done').length;
    const failedCount  = promptList.filter(p => promptStatuses[p] === 'failed').length;
    const processedCount = doneCount + failedCount;

    setState('completedCount', doneCount);
    const remainingCount = Math.max(0, totalCount - processedCount);

    const el = id => document.getElementById(id);
    if (el('stat-total'))     el('stat-total').textContent     = totalCount;
    if (el('stat-completed')) el('stat-completed').textContent = doneCount;
    if (el('stat-remaining')) el('stat-remaining').textContent = remainingCount;
    if (el('stat-images'))    el('stat-images').textContent    = imageCount;

    if (el('prog-completed-sub')) el('prog-completed-sub').textContent = processedCount;
    if (el('prog-total-sub'))     el('prog-total-sub').textContent     = totalCount;
    if (el('prog-images-sub'))    el('prog-images-sub').textContent    =
        `${imageCount} image${imageCount !== 1 ? 's' : ''} saved`;

    const qBadge = el('queue-badge');
    if (qBadge) qBadge.textContent = `${promptList.length} items`;

    const pct  = totalCount > 0 ? Math.round(processedCount / totalCount * 100) : 0;
    if (el('progress-bar-fill')) el('progress-bar-fill').style.width = `${pct}%`;
    if (el('progress-pct'))      el('progress-pct').textContent      = `${pct}%`;

    ['stat-completed', 'stat-remaining', 'stat-images', 'stat-total'].forEach(id => {
        triggerAnimation(el(id), 'pop');
    });
}

// ─── Build queue dari daftar prompt ──────────────────────────────────────────
export function buildQueueList(prompts) {
    setState('promptList', prompts);
    const statuses = {};
    prompts.forEach(p => {
        statuses[p] = p.startsWith('#') ? 'skipped' : 'pending';
    });
    setState('promptStatuses', statuses);
    renderQueueList();
    const activeCount = prompts.filter(p => !p.startsWith('#')).length;
    setState('totalCount',     activeCount);
    setState('completedCount', 0);
    updateProgressStats();
}

// ─── Render ulang seluruh queue list ─────────────────────────────────────────
export function renderQueueList() {
    const container     = document.getElementById('prompt-queue-list');
    const promptList    = getState('promptList');
    const promptStatuses = getState('promptStatuses');
    container.innerHTML = '';

    promptList.forEach((p, i) => {
        const status   = promptStatuses[p] || 'pending';
        const iconHtml = QUEUE_ICONS[status] || QUEUE_ICONS.pending;
        const el       = document.createElement('div');
        el.className   = `queue-item${status !== 'pending' ? ` ${status}` : ''}`;
        el.dataset.prompt = p;
        el.innerHTML = `
            <span class="queue-icon">${iconHtml}</span>
            <span class="queue-text" title="${escHtml(p)}">${escHtml(p)}</span>
            <span class="queue-num">#${i + 1}</span>
        `;
        el.addEventListener('dblclick', async () => {
            try {
                await navigator.clipboard.writeText(p);
                showToast('Prompt copied to clipboard');
            } catch (err) {
                console.error('Failed to copy prompt:', err);
            }
        });
        container.appendChild(el);
    });
}

// ─── Update status satu item queue ───────────────────────────────────────────
export function updateQueueItem(prompt, status) {
    const promptStatuses = getState('promptStatuses');
    if (promptStatuses[prompt] === status) return;
    promptStatuses[prompt] = status;
    setState('promptStatuses', promptStatuses);

    const el = document.querySelector(`.queue-item[data-prompt="${CSS.escape(prompt)}"]`);
    if (!el) { renderQueueList(); return; }

    el.className = `queue-item${status !== 'pending' ? ` ${status}` : ''}`;
    el.querySelector('.queue-icon').innerHTML = QUEUE_ICONS[status] || QUEUE_ICONS.pending;
    if (status === 'active') el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    updateProgressStats();
}

// ─── Parse log line untuk update progress & queue ────────────────────────────
export function parseLogLine(line) {
    const progMatch = line.match(/\[(\d+)\/(\d+)\]/);
    if (progMatch) {
        setState('totalCount', parseInt(progMatch[2]));
        updateProgressStats();

        const promptMatch = line.match(/\[\d+\/\d+\]\s+"([^"]+)"/);
        if (promptMatch) {
            const p          = promptMatch[1].trim();
            const promptList = getState('promptList');
            const pIndex     = promptList.findIndex(item => item.startsWith(p));
            const fullPrompt = pIndex !== -1 ? promptList[pIndex] : p;

            const el = document.getElementById('current-prompt-text');
            if (el) el.textContent = fullPrompt;

            if (pIndex !== -1) {
                for (let idx = 0; idx < pIndex; idx++) {
                    const prev = promptList[idx];
                    const prevStatuses = getState('promptStatuses');
                    if (prevStatuses[prev] === 'pending' || prevStatuses[prev] === 'active') {
                        updateQueueItem(prev, 'done');
                    }
                }
                updateQueueItem(promptList[pIndex], 'active');
            } else {
                const prev = Object.entries(getState('promptStatuses')).find(([, s]) => s === 'active');
                if (prev && prev[0] !== p) updateQueueItem(prev[0], 'done');
            }
        }
    }

    if (/gambar didownload|images downloaded/i.test(line)) {
        const active = Object.entries(getState('promptStatuses')).find(([, s]) => s === 'active');
        if (active) updateQueueItem(active[0], 'done');
    }

    if (/Selesai! Semua prompt|All prompts completed/i.test(line)) {
        const el = document.getElementById('current-prompt-text');
        if (el) el.textContent = '✅ All done!';
        getState('promptList').forEach(p => updateQueueItem(p, 'done'));
    }

    if (/gagal setelah|failed after/i.test(line)) {
        const active = Object.entries(getState('promptStatuses')).find(([, s]) => s === 'active');
        if (active) updateQueueItem(active[0], 'failed');
    }
}
