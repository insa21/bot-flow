// js/modules/activityLog.js — Manajemen log aktivitas multi-sesi (Apple-style UI)
'use strict';

// Simpan semua log dalam array global di memori renderer
let allLogs = [];
let sessAutoScroll = true;
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
    
    // Default values
    let status = 'Running';
    let action = 'Aktivitas';
    let cleanMessage = line;

    // ─── PARSER LOG UNTUK LINGKUNGAN MULTI-USER/MULTI-SESI ───
    const lineTrim = line.trim();

    // 1. Deteksi Error / Gagal
    if (lineTrim.includes('[ERR]') || lineTrim.toLowerCase().includes('error') || lineTrim.toLowerCase().includes('fail')) {
        status = 'Error';
        action = 'System Error';
        cleanMessage = lineTrim
            .replace(/^\[ERR\]\s*/i, '')
            .replace(/^Error:\s*/i, '')
            .replace(/Access is denied.*/i, 'Windows folder access blocked (Access Denied).');
    }
    // 2. Deteksi Blokir Kebijakan Konten Google (Penting untuk User)
    else if (lineTrim.includes('Policy violation detected') || lineTrim.includes('Prompt blocked by Google policy')) {
        status = 'Error';
        action = 'Content Blocked';
        cleanMessage = '⚠️ Google Policy: Prompt violated content policy and was skipped.';
    }
    // 3. Deteksi Prompt Tersimpan/Diproses
    else if (lineTrim.match(/^\[(\d+)\/(\d+)\]\s*"(.*)"/)) {
        const m = lineTrim.match(/^\[(\d+)\/(\d+)\]\s*"(.*)"/);
        status = 'Running';
        action = 'Process Prompt';
        cleanMessage = `Processing prompt [${m[1]}/${m[2]}]: "${m[3]}"`;
    }
    // 4. Deteksi Gambar Berhasil Disimpan
    else if (lineTrim.includes('Saved image:') || lineTrim.includes('Saved scaled image:')) {
        status = 'Running';
        action = 'Download Image';
        const fileMatch = lineTrim.match(/(Saved image:|Saved scaled image:)\s*(.*)/i);
        const fileName = fileMatch ? fileMatch[2].split(/[\\/]/).pop() : 'Gambar.png';
        cleanMessage = `🎉 Image downloaded successfully: ${fileName}`;
    }
    // 5. Deteksi Mulai Pemrosesan Sesi
    else if (lineTrim.includes('Ready! Starting prompt processing')) {
        status = 'Running';
        action = 'Session Ready';
        cleanMessage = 'Browser opened successfully. Starting prompt processing...';
    }
    // 6. Deteksi Resume Session
    else if (lineTrim.includes('Resuming:')) {
        status = 'Running';
        action = 'Resume Sesi';
        const m = lineTrim.match(/Resuming:\s*(.*)/i);
        cleanMessage = `Resuming previous session: ${m ? m[1] : 'Reading progress file...'}`;
    }
    // 7. Deteksi Penyimpanan Gagal ke log/file
    else if (lineTrim.includes('Prompt recorded in failed/failed.txt') || lineTrim.includes('Blocked prompt saved')) {
        status = 'Error';
        action = 'Log Failed';
        cleanMessage = 'Failed prompt recorded to failed history file.';
    }
    // 8. Deteksi Semua Selesai
    else if (lineTrim.includes('All prompts completed') || lineTrim.includes('selesai')) {
        status = 'Completed';
        action = 'Selesai';
        cleanMessage = '✓ All prompts in this category have been completed.';
    }
    // 9. Deteksi Inisialisasi Akun Google oleh Bot
    else if (lineTrim.includes('[GUI] 👤 Akun aktif:')) {
        status = 'Running';
        action = 'Auth';
        const m = lineTrim.match(/Akun aktif:\s*(.*)/i);
        cleanMessage = `Activating Google Account session: ${m ? m[1] : 'Default'}`;
    }
    // 10. Session Stopped / Tutup
    else if (lineTrim.includes('exit') || lineTrim.includes('stopped') || lineTrim.includes('selesai (exit')) {
        status = 'Stopped';
        action = 'Sesi Berhenti';
        cleanMessage = 'Category process stopped.';
    }

    const entry = {
        id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
        time,
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

    // Jika drawer sedang terbuka, render ulang tabel log
    if (isDrawerOpen()) {
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

        return `
            <div class="log-line ${esc(typeClass)}" style="font-family: var(--font-mono); font-size: 11px; padding: 6px 10px; border-radius: 6px; display: flex; gap: 10px; align-items: center;">
                <span class="log-time text-[10px] text-[#6e7a90] whitespace-nowrap" style="min-width: 50px;">${timeStr}</span>
                <span class="inline-flex px-1.5 py-0.5 rounded text-[9px] font-mono bg-white/5 text-[#8896aa] border border-white/5 mr-1 font-bold uppercase whitespace-nowrap" style="min-width: 65px; justify-content: center; opacity: 0.85;">${esc(log.action)}</span>
                <span class="text-text-d font-semibold text-[10px] truncate" style="max-width: 80px; min-width: 50px;" title="${esc(log.sessionName)}">${esc(log.sessionName)}</span>
                <span class="text-[#8896aa] text-[10px] truncate" style="max-width: 100px; min-width: 60px;" title="${esc(log.accountName)}">${esc(log.accountName)}</span>
                <span class="log-msg text-text-d font-mono flex-1 break-all md:break-normal text-left">${esc(log.message)}</span>
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
