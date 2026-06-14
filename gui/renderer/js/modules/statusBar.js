// js/modules/statusBar.js — Update status dot, label, dan tombol start/stop

import { STATUS_META }          from './constants.js';
import { getState, setState }   from './state.js';
import { formatElapsed }        from './utils.js';

// ─── Elapsed timer ────────────────────────────────────────────────────────────
export function startElapsedTimer() {
    stopElapsedTimer();
    setState('startTime', Date.now());
    const label  = document.getElementById('status-label');
    const timerId = setInterval(() => {
        if (getState('currentStatus') === 'running') {
            label.textContent = `Running · ${formatElapsed(Date.now() - getState('startTime'))}`;
        }
    }, 1000);
    setState('elapsedTimer', timerId);
}

export function stopElapsedTimer() {
    const timer = getState('elapsedTimer');
    if (timer) { clearInterval(timer); setState('elapsedTimer', null); }
    setState('startTime', null);
}

// ─── Status update ─────────────────────────────────────────────────────────────
/**
 * Perbarui tampilan status bar, tombol, dan label.
 * @param {string} status - salah satu key dari STATUS_META
 * @param {Function} logToUI - untuk log ke konsol
 */
export function updateStatus(status, logToUI) {
    setState('currentStatus', status);

    const dot      = document.getElementById('status-dot');
    const label    = document.getElementById('status-label');
    const bar      = document.getElementById('status-bar');
    const startBtn = document.getElementById('btn-start');
    const stopBtn  = document.getElementById('btn-stop');

    const meta = STATUS_META[status] || STATUS_META.idle;

    dot.className = status;
    bar.className = bar.className.replace(/\bs-\w+/g, '').trim();
    bar.classList.add(meta.cls);
    label.className = label.className.replace(/\bs-\w+/g, '').trim();
    label.classList.add(meta.cls);
    label.textContent = meta.label;

    // Elapsed timer
    if (status === 'running') {
        startElapsedTimer();
    } else {
        let durationText = '';
        const startTime  = getState('startTime');
        if (startTime) durationText = formatElapsed(Date.now() - startTime);
        stopElapsedTimer();
        if (status === 'completed') {
            label.textContent = `Completed ${durationText ? `· ${durationText}` : ''}`;
            if (durationText) logToUI(`[GUI] ✅ Bot finished in ${durationText}.`, 'SUCCESS');
        } else if (status === 'idle' && durationText) {
            logToUI(`[GUI] ℹ️ Bot stopped after ${durationText}.`, 'INFO');
        }
    }

    const running = status === 'running' || status === 'stopping';
    startBtn.disabled = running;
    stopBtn.disabled  = !running;

    const btnLabel = startBtn.querySelector('.btn-label');
    if (btnLabel) btnLabel.textContent = running ? 'Running…' : 'Start Bot';

    const procBox = document.querySelector('.processing-box');
    if (procBox) procBox.classList.toggle('is-running', running);

    const progressFill = document.getElementById('progress-bar-fill');
    if (progressFill) progressFill.classList.toggle('active', status === 'running');

    // Toggle Dashboard tab running badge dot
    const activeDot = document.getElementById('dashboard-active-dot');
    if (activeDot) activeDot.classList.toggle('hidden', status !== 'running');

    // Update processing text status
    const procText = document.getElementById('current-prompt-text');
    if (procText) {
        if (status === 'idle') {
            procText.textContent = 'Idle — Waiting to start...';
        } else if (status === 'stopping') {
            procText.textContent = 'Stopping bot...';
        } else if (status === 'completed') {
            procText.textContent = 'Completed — All prompts processed.';
        }
    }
}
