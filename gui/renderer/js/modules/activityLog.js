// js/modules/activityLog.js — Manajemen log aktivitas multi-sesi (Apple-style UI)
'use strict';

import { EMOJI_MAP } from './constants.js';

// Simpan semua log dalam array global di memori renderer
let allLogs = [];
let sessAutoScroll = true;
let sessLogPaused = false;
let currentSessFilter = 'all';

/**
 * Tambahkan entri log baru ke database renderer dengan parser log yang ramah pengguna
 * @param {string} sessionId
 * @param {string} sessionName
 * @param {string} accountName
 * @param {string} line
 */
export function addLogEntry(sessionId, sessionName, accountName, line) {
    const time = new Date();
    const lineTrim = line.trim();

    // 1. Parse timestamp dan emoji prefix dari bot logger
    let parsedTime = time;
    let prefix = '';
    let cleanMessage = lineTrim;

    const tsMatch = lineTrim.match(/^\[([\d-:\s]+)\]\s*(.*)$/);
    if (tsMatch) {
        const tsStr = tsMatch[1];
        const parts = tsStr.split(' ');
        if (parts.length === 2) {
            const dtParts = parts[0].split('-');
            const tmParts = parts[1].split(':');
            if (dtParts.length === 3 && tmParts.length === 3) {
                try {
                    parsedTime = new Date(
                        parseInt(dtParts[0]),
                        parseInt(dtParts[1]) - 1,
                        parseInt(dtParts[2]),
                        parseInt(tmParts[0]),
                        parseInt(tmParts[1]),
                        parseInt(tmParts[2])
                    );
                } catch {
                    parsedTime = time;
                }
            }
        }
        
        const rest = tsMatch[2].trim();
        // Deteksi dan bersihkan emoji di awal sisa pesan
        const emojiMatch = rest.match(/^(❌|✅|⚠️|ℹ️|ℹ)\s*(.*)$/);
        if (emojiMatch) {
            prefix = emojiMatch[1];
            cleanMessage = emojiMatch[2];
        } else {
            cleanMessage = rest;
        }
    }

    // Default values
    let status = 'Running';
    let action = 'Aktivitas';

    // Klasifikasi status & action awal berdasarkan prefix emoji dari logger
    if (prefix === '❌') {
        status = 'Error';
        action = 'System Error';
    } else if (prefix === '⚠️') {
        status = 'Stopped';
        action = 'Sesi Berhenti';
    } else if (prefix === '✅') {
        status = 'Completed';
        action = 'Download Image';
    } else {
        status = 'Running';
        action = 'Aktivitas';
    }

    // Klasifikasi / Penyesuaian khusus berdasarkan teks pesan
    const msgLower = cleanMessage.toLowerCase();

    // 1. Deteksi Error / Gagal
    if (msgLower.includes('[err]') || msgLower.includes('error') || msgLower.includes('fail')) {
        status = 'Error';
        action = 'System Error';
        cleanMessage = cleanMessage
            .replace(/^\[ERR\]\s*/i, '')
            .replace(/^Error:\s*/i, '')
            .replace(/Access is denied.*/i, 'Windows folder access blocked (Access Denied).');
    }
    // 2. Deteksi Blokir Kebijakan Konten Google (Penting untuk User)
    else if (msgLower.includes('policy violation detected') || msgLower.includes('prompt blocked by google policy')) {
        status = 'Error';
        action = 'Content Blocked';
        cleanMessage = '⚠️ Google Policy: Prompt violated content policy and was skipped.';
    }
    // 3. Deteksi Prompt Tersimpan/Diproses
    else if (cleanMessage.match(/^\[(\d+)\/(\d+)\]\s*"(.*)"/)) {
        const m = cleanMessage.match(/^\[(\d+)\/(\d+)\]\s*"(.*)"/);
        status = 'Running';
        action = 'Process Prompt';
        cleanMessage = `Processing prompt [${m[1]}/${m[2]}]: "${m[3]}"`;
    }
    // 4. Deteksi Gambar Berhasil Disimpan
    else if (msgLower.includes('saved') && (prefix === '✅' || msgLower.includes('image:') || msgLower.includes('scaled image:'))) {
        status = 'Completed';
        action = 'Download Image';
        let fileName = 'Gambar.png';
        const parts = cleanMessage.split(':');
        if (parts.length > 1) {
            fileName = parts[parts.length - 1].trim().split(/[\\/]/).pop();
        }
        cleanMessage = `🎉 Image downloaded successfully: ${fileName}`;
    }
    // 5. Deteksi Mulai Pemrosesan Sesi
    else if (msgLower.includes('ready! starting prompt processing')) {
        status = 'Running';
        action = 'Session Ready';
        cleanMessage = 'Browser opened successfully. Starting prompt processing...';
    }
    // 6. Deteksi Resume Session
    else if (msgLower.includes('resuming:')) {
        status = 'Running';
        action = 'Resume Sesi';
        const m = cleanMessage.match(/Resuming:\s*(.*)/i);
        cleanMessage = `Resuming previous session: ${m ? m[1] : 'Reading progress file...'}`;
    }
    // 7. Deteksi Penyimpanan Gagal ke log/file
    else if (msgLower.includes('prompt recorded in failed/failed.txt') || msgLower.includes('blocked prompt saved')) {
        status = 'Error';
        action = 'Log Failed';
        cleanMessage = 'Failed prompt recorded to failed history file.';
    }
    // 8. Deteksi Semua Selesai
    else if (msgLower.includes('all prompts completed') || msgLower.includes('selesai')) {
        status = 'Completed';
        action = 'Selesai';
        cleanMessage = '✓ All prompts in this category have been completed.';
    }
    // 9. Deteksi Inisialisasi Akun Google oleh Bot
    else if (msgLower.includes('[gui]') && msgLower.includes('akun aktif:')) {
        status = 'Running';
        action = 'Auth';
        const m = cleanMessage.match(/Akun aktif:\s*(.*)/i);
        cleanMessage = `Activating Google Account session: ${m ? m[1] : 'Default'}`;
    }
    // 10. Session Stopped / Tutup
    else if (msgLower.includes('exit') || msgLower.includes('stopped') || msgLower.includes('selesai (exit')) {
        status = 'Stopped';
        action = 'Sesi Berhenti';
        cleanMessage = 'Category process stopped.';
    }

    const entry = {
        id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
        time: parsedTime,
        sessionId,
        sessionName: sessionName || 'Category',
        accountName: accountName || 'Default Account',
        status,
        action,
        message: cleanMessage
    };

    allLogs.unshift(entry); // Tambahkan log terbaru di atas
    
    // Batasi log agar memori tidak bengkak (maksimal 1000 entri)
    if (allLogs.length > 1000) {
        allLogs.pop();
    }

    // Jika drawer sedang terbuka, render ulang tabel log (HANYA jika tidak di-pause!)
    if (isDrawerOpen() && !sessLogPaused) {
        renderLogTable();
    }
}

/** Cek apakah drawer log sedang aktif di layar */
function isDrawerOpen() {
    const drawer = document.getElementById('sess-log-drawer');
    return drawer && !drawer.classList.contains('translate-x-full');
}

/** Tampilkan drawer log dengan transisi Apple yang mulus */
export function openLogDrawer(filterSessionId = null, filterAccountName = null) {
    const drawer = document.getElementById('sess-log-drawer');
    const backdrop = document.getElementById('sess-log-backdrop');
    if (!drawer || !backdrop) return;

    // Reset status pause ke false (Live stream aktif kembali)
    sessLogPaused = false;
    const pauseBtn = document.getElementById('btn-sess-pause');
    if (pauseBtn) {
        pauseBtn.classList.remove('toolbar-btn-active', 'bg-red-500/20', 'text-red-400', 'border-red-500/30');
        pauseBtn.title = "Pause log stream (freeze UI)";
        pauseBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
            </svg>
            <span>Pause</span>
        `;
    }
    const statusDiv = document.getElementById('sess-log-live-status');
    if (statusDiv) {
        statusDiv.className = "flex items-center gap-1 text-[#10b981]";
        statusDiv.innerHTML = `
            <span class="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse"></span>
            <span class="font-mono" style="font-size: 8px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;">Parallel Live</span>
        `;
    }

    // Reset filter input
    const searchInp = document.getElementById('log-search-input');
    if (searchInp) searchInp.value = '';

    const filterSel = document.getElementById('log-filter-session');
    if (filterSel) {
        const sessions = window.currentSessionsList || [];
        filterSel.innerHTML = '<option value="">Semua Kategori</option>' + 
            sessions.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        filterSel.value = filterSessionId || '';
    }

    const filterAccSel = document.getElementById('log-filter-account');
    if (filterAccSel) {
        const uniqueAccounts = [...new Set(allLogs.map(l => l.accountName).filter(Boolean))];
        filterAccSel.innerHTML = '<option value="">Semua User</option>' + 
            uniqueAccounts.map(email => `<option value="${email}">${email}</option>`).join('');
        filterAccSel.value = filterAccountName || '';
    }

    // Tampilkan Backdrop (Fade In)
    backdrop.classList.remove('hidden');
    // Tampilkan Drawer (Slide In)
    drawer.classList.remove('hidden');

    setTimeout(() => {
        backdrop.classList.remove('opacity-0');
        drawer.classList.remove('translate-x-full');
    }, 10);

    renderLogTable();
}

/** Tutup drawer log dengan transisi Apple yang mulus */
export function closeLogDrawer() {
    const drawer = document.getElementById('sess-log-drawer');
    const backdrop = document.getElementById('sess-log-backdrop');
    if (!drawer || !backdrop) return;

    // Slide out drawer & Fade out backdrop
    backdrop.classList.add('opacity-0');
    drawer.classList.add('translate-x-full');

    setTimeout(() => {
        backdrop.classList.add('hidden');
        drawer.classList.add('hidden');
    }, 300);
}

/** Render tabel log berdasarkan filter dan sorting */
export function renderLogTable() {
    const tbody = document.getElementById('log-table-body');
    if (!tbody) return;

    const query = document.getElementById('log-search-input')?.value.toLowerCase().trim() || '';
    const sessFilter = document.getElementById('log-filter-session')?.value || '';
    const accFilter = document.getElementById('log-filter-account')?.value || '';
    const statusFilter = document.getElementById('log-filter-status')?.value || '';
    const sortBy = document.getElementById('log-sort-time')?.value || 'newest';

    // 1. Jalankan filter dasar
    let filtered = allLogs.filter(log => {
        if (sessFilter && log.sessionId !== sessFilter) return false;
        if (accFilter && log.accountName !== accFilter) return false;
        if (statusFilter && log.status !== statusFilter) return false;
        if (query) {
            const matchesQuery = 
                log.message.toLowerCase().includes(query) ||
                log.sessionName.toLowerCase().includes(query) ||
                log.accountName.toLowerCase().includes(query) ||
                log.action.toLowerCase().includes(query);
            if (!matchesQuery) return false;
        }
        return true;
    });

    // 2. Jalankan sorting
    if (sortBy === 'newest') {
        filtered.sort((a, b) => b.time - a.time);
    } else {
        filtered.sort((a, b) => a.time - b.time);
    }

    // 3. Hitung stats berdasarkan filter dasar (sebelum pill filter)
    const stats = { info: 0, success: 0, warn: 0, error: 0 };
    filtered.forEach(log => {
        let typeClass = 'INFO';
        if (log.status === 'Error') typeClass = 'ERROR';
        else if (log.status === 'Completed') typeClass = 'SUCCESS';
        else if (log.status === 'Stopped') typeClass = 'WARN';
        else if (log.action === 'GUI') typeClass = 'GUI';

        if (typeClass === 'ERROR') stats.error++;
        else if (typeClass === 'SUCCESS') stats.success++;
        else if (typeClass === 'WARN') stats.warn++;
        else stats.info++;
    });

    // Update stats UI
    const infoVal = document.getElementById('sess-log-stat-info');
    if (infoVal) infoVal.textContent = stats.info;
    const successVal = document.getElementById('sess-log-stat-success');
    if (successVal) successVal.textContent = stats.success;
    const warnVal = document.getElementById('sess-log-stat-warn');
    if (warnVal) warnVal.textContent = stats.warn;
    const errorVal = document.getElementById('sess-log-stat-error');
    if (errorVal) errorVal.textContent = stats.error;

    // 4. Jalankan pill filter
    if (currentSessFilter !== 'all') {
        filtered = filtered.filter(log => {
            let typeClass = 'INFO';
            if (log.status === 'Error') typeClass = 'ERROR';
            else if (log.status === 'Completed') typeClass = 'SUCCESS';
            else if (log.status === 'Stopped') typeClass = 'WARN';
            else if (log.action === 'GUI') typeClass = 'GUI';

            if (currentSessFilter === 'ERROR' && typeClass === 'ERROR') return true;
            if (currentSessFilter === 'SUCCESS' && typeClass === 'SUCCESS') return true;
            if (currentSessFilter === 'WARN' && typeClass === 'WARN') return true;
            if (currentSessFilter === 'GUI' && typeClass === 'GUI') return true;
            if (currentSessFilter === 'INFO' && typeClass === 'INFO') return true;
            return false;
        });
    }

    // 5. Update Line Count Badge
    const llc = document.getElementById('sess-log-line-count');
    if (llc) llc.textContent = `${filtered.length} lines`;

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <div class="py-8 text-center text-xs text-[#6e7a90] italic">
                No log activity matches the current filters.
            </div>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(log => {
        const timeStr = log.time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        let typeClass = 'INFO';
        if (log.status === 'Error') typeClass = 'ERROR';
        else if (log.status === 'Completed') typeClass = 'SUCCESS';
        else if (log.status === 'Stopped') typeClass = 'WARN';
        else if (log.action === 'GUI') typeClass = 'GUI';

        const iconHtml = getActivityIcon(log.action, log.status);
        const shortUser = log.accountName ? log.accountName.split('@')[0] : 'Default';

        return `
            <div class="log-line ${esc(typeClass)}" style="font-size: 11px;">
                <span class="log-time">${timeStr}</span>
                <span class="log-icon-wrap" style="width: 32px; height: 16px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    ${iconHtml}
                </span>
                <span class="log-metadata" style="font-size: 10px; font-weight: 600; color: #8896aa; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 1.5px 6px; border-radius: 4px; opacity: 0.85; flex-shrink: 0; font-family: var(--font-mono); margin-right: 4px;" title="${esc(log.sessionName)} (${esc(log.accountName)})">
                    ${esc(log.sessionName)} (${esc(shortUser)})
                </span>
                <span class="log-msg">${enrichLogMessage(log.message)}</span>
            </div>
        `;
    }).join('');

    // 6. Autoscroll ke baris terbaru jika aktif
    if (sessAutoScroll) {
        setTimeout(() => {
            const panel = document.getElementById('sess-log-panel');
            if (panel) {
                if (sortBy === 'newest') panel.scrollTop = 0;
                else panel.scrollTop = panel.scrollHeight;
            }
        }, 50);
    }
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
}

export function enrichLogMessage(message) {
    let escaped = esc(message);
    const keys  = Object.keys(EMOJI_MAP).sort((a, b) => b.length - a.length);
    const regex = new RegExp(keys.join('|'), 'g');
    return escaped.replace(regex, match => EMOJI_MAP[match] || match);
}

function getActivityIcon(action, status) {
    const isRunning = status === 'Running';
    
    // Choose SVG based on action
    let svg = '';
    let colorClass = 'blue-icon';
    let animClass = '';

    switch (action) {
        case 'System Error':
        case 'Log Failed':
            svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
            colorClass = 'red-icon';
            break;
        case 'Content Blocked':
            svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="3"/></svg>`;
            colorClass = 'red-icon';
            if (isRunning) animClass = 'pulse-active';
            break;
        case 'Process Prompt':
            // Icon: pencil/edit
            svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
            colorClass = 'blue-icon';
            if (isRunning) animClass = 'pulse-active';
            break;
        case 'Download Image':
            // Icon: Image
            svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
            colorClass = 'pink-icon';
            if (isRunning) animClass = 'pulse-active';
            break;
        case 'Session Ready':
            // Icon: Rocket
            svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2l-7 20-4-9-9-4Z"/><path d="M22 2L11 13"/></svg>`;
            colorClass = 'green-icon';
            if (isRunning) animClass = 'pulse-active';
            break;
        case 'Resume Sesi':
            // Icon: reload
            svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>`;
            colorClass = 'cyan-icon';
            if (isRunning) animClass = 'spin-slow';
            break;
        case 'Auth':
            // Icon: user
            svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
            colorClass = 'indigo-icon';
            if (isRunning) animClass = 'pulse-active';
            break;
        case 'Selesai':
            // Icon: check-circle
            svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
            colorClass = 'green-icon';
            break;
        case 'Sesi Berhenti':
            // Icon: stop-circle
            svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>`;
            colorClass = 'amber-icon';
            break;
        default:
            // Icon: info
            svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
            colorClass = 'blue-icon';
            if (isRunning) animClass = 'pulse-active';
            break;
    }

    let iconHtml = svg.replace('<svg', `<svg class="inline-icon ${colorClass} ${animClass}"`);

    if (isRunning) {
        const spinner = `<svg class="inline-icon accent-icon spin-fast" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width: 10px; height: 10px; margin-right: 2px;"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.2"></circle><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path></svg>`;
        return `<div class="flex items-center gap-1">${spinner}${iconHtml}</div>`;
    }

    return iconHtml;
}

export function clearSessionLogs(sessionId) {
    allLogs = allLogs.filter(log => log.sessionId !== sessionId);
    if (isDrawerOpen()) {
        renderLogTable();
    }
}

// ── Bind event listeners untuk panel log laci paralel ──
document.addEventListener('DOMContentLoaded', () => {
    const backdrop = document.getElementById('sess-log-backdrop');
    if (backdrop) {
        backdrop.addEventListener('click', closeLogDrawer);
    }

    // Auto-scroll toggle
    const autoBtn = document.getElementById('btn-sess-autoscroll');
    if (autoBtn) {
        autoBtn.addEventListener('click', () => {
            sessAutoScroll = !sessAutoScroll;
            autoBtn.classList.toggle('toolbar-btn-active', sessAutoScroll);
        });
    }

    // Clear logs
    const clearBtn = document.getElementById('btn-sess-clear-log');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            allLogs = [];
            renderLogTable();
            if (window.showToast) window.showToast('Console logs cleared.', 'info');
        });
    }

    // Copy logs
    const copyBtn = document.getElementById('btn-sess-copy-log');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const logLines = Array.from(document.querySelectorAll('#log-table-body .log-line'))
                .map(el => el.textContent.replace(/\s+/g, ' ').trim())
                .join('\n');
            if (!logLines) {
                if (window.showToast) window.showToast('No logs to copy.', 'info');
                return;
            }
            navigator.clipboard.writeText(logLines);
            if (window.showToast) window.showToast('Logs copied to clipboard!', 'success');
        });
    }

    // Export logs
    const exportBtn = document.getElementById('btn-sess-export-log');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            const logLines = Array.from(document.querySelectorAll('#log-table-body .log-line'))
                .map(el => el.textContent.replace(/\s+/g, ' ').trim())
                .join('\n');
            if (!logLines) {
                if (window.showToast) window.showToast('No logs to export.', 'info');
                return;
            }
            const result = await window.botAPI.saveFile({
                title: 'Export Parallel Logs',
                defaultPath: `parallel_activity_log_${Date.now()}.txt`,
                filters: [{ name: 'Text Files', extensions: ['txt'] }],
                content: logLines
            });
            if (result?.ok) {
                if (window.showToast) window.showToast('Logs exported successfully!', 'success');
            }
        });
    }

    // Filter pills
    const pillsContainer = document.getElementById('sess-log-filter-pills');
    if (pillsContainer) {
        pillsContainer.addEventListener('click', (e) => {
            const pill = e.target.closest('.filter-pill');
            if (!pill) return;
            pillsContainer.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentSessFilter = pill.dataset.filter;
            renderLogTable();
        });
    }

    // Pause stream toggle
    const pauseBtn = document.getElementById('btn-sess-pause');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            sessLogPaused = !sessLogPaused;
            const statusDiv = document.getElementById('sess-log-live-status');
            if (sessLogPaused) {
                // Set button to Active/Resume state (warning/danger red theme)
                pauseBtn.classList.add('toolbar-btn-active', 'bg-red-500/20', 'text-red-400', 'border-red-500/30');
                pauseBtn.title = "Resume log stream (live updates)";
                pauseBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="5 3 19 12 5 21"></polygon>
                    </svg>
                    <span>Resume</span>
                `;
                // Ubah penanda status menjadi merah
                if (statusDiv) {
                    statusDiv.className = "flex items-center gap-1 text-[#ef4444]";
                    statusDiv.innerHTML = `
                        <span class="w-1.5 h-1.5 rounded-full bg-[#ef4444]"></span>
                        <span class="font-mono" style="font-size: 8px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;">Stream Paused</span>
                    `;
                }
            } else {
                // Set button back to standard Pause state
                pauseBtn.classList.remove('toolbar-btn-active', 'bg-red-500/20', 'text-red-400', 'border-red-500/30');
                pauseBtn.title = "Pause log stream (freeze UI)";
                pauseBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="6" y="4" width="4" height="16"></rect>
                        <rect x="14" y="4" width="4" height="16"></rect>
                    </svg>
                    <span>Pause</span>
                `;
                // Kembalikan penanda status menjadi hijau berkedip
                if (statusDiv) {
                    statusDiv.className = "flex items-center gap-1 text-[#10b981]";
                    statusDiv.innerHTML = `
                        <span class="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse"></span>
                        <span class="font-mono" style="font-size: 8px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;">Parallel Live</span>
                    `;
                }
                // Render accumulated logs immediately
                renderLogTable();
            }
        });
    }

    // Input pencarian & dropdown filter
    const searchInp = document.getElementById('log-search-input');
    if (searchInp) {
        searchInp.addEventListener('input', renderLogTable);
    }
    const filterSess = document.getElementById('log-filter-session');
    if (filterSess) {
        filterSess.addEventListener('change', renderLogTable);
    }
    const filterAcc = document.getElementById('log-filter-account');
    if (filterAcc) {
        filterAcc.addEventListener('change', renderLogTable);
    }
    const sortTime = document.getElementById('log-sort-time');
    if (sortTime) {
        sortTime.addEventListener('change', renderLogTable);
    }
});
