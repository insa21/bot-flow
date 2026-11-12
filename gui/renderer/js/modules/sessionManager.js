// js/modules/sessionManager.js — UI untuk multi-sesi paralel berbasis kategori (Apple Design)
'use strict';

import { addLogEntry, openLogDrawer, closeLogDrawer, renderLogTable, clearSessionLogs, enrichLogMessage } from './activityLog.js';

const STATUS_LABEL = {
    idle:      { text: 'Idle',      color: '#8896aa', bg: 'rgba(136, 150, 170, 0.08)', border: 'rgba(136, 150, 170, 0.2)' },
    running:   { text: 'Running',   color: '#10b981', bg: 'rgba(16, 185, 129, 0.08)', border: 'rgba(16, 185, 129, 0.2)' },
    completed: { text: 'Completed', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.08)', border: 'rgba(59, 130, 246, 0.2)' },
    stopped:   { text: 'Stopped',   color: '#f59e0b', bg: 'rgba(245, 158, 171, 0.08)', border: 'rgba(245, 158, 171, 0.2)' },
    error:     { text: 'Error',     color: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)', border: 'rgba(239, 68, 68, 0.2)' },
};

// Warna badge kategori
const CATEGORY_COLORS = [
    '#00d2ff','#3b82f6','#a78bfa','#10b981','#f59e0b',
    '#ef4444','#ec4899','#06b6d4','#f97316','#84cc16'
];

// Map untuk menyimpan riwayat log lokal setiap sesi (untuk ekspor berkas)
const sessionLogsHistory = new Map();
// Map untuk melacak waktu mulai sesi (untuk kalkulasi ETA)
const sessionStartTimes = new Map();

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
    );
}
function pct(cur, tot) { return (!tot) ? 0 : Math.min(100, Math.round((cur / tot) * 100)); }
function catColor(idx) { return CATEGORY_COLORS[idx % CATEGORY_COLORS.length]; }

/** Buat satu kartu kategori dengan visual minimalis premium (Apple Style) */
function buildCard(sess, idx, accounts) {
    const st        = STATUS_LABEL[sess.status] || STATUS_LABEL.idle;
    const progress  = pct(sess.progress?.current, sess.progress?.total);
    const isRunning = sess.status === 'running';
    const isDone    = sess.status === 'completed';
    const color     = catColor(idx);
    const disAttr   = isRunning ? 'disabled' : '';

    const accOptions = [
        `<option value="">— Select Google Account —</option>`,
        ...accounts.map(a =>
            `<option value="${esc(a.id)}" ${a.id === sess.accountId ? 'selected' : ''}>${esc(a.email || a.name || a.id)}</option>`
        ),
    ].join('');

    const promptLabel = sess.promptCount
        ? `<span style="color:#e8eaf0;font-weight:600;">${sess.promptCount}</span> prompts`
        : `<span style="color:#6e7a90;font-style:italic;">No prompt file selected</span>`;

    const promptFile = sess.promptsSourcePath
        ? `<span class="sess-fname" title="${esc(sess.promptsSourcePath)}">${esc(sess.promptsSourcePath.split(/[\\/]/).pop())}</span>`
        : '';

    const outLabel = sess.outputDir
        ? `<span class="sess-path-display" title="${esc(sess.outputDir)}">${esc(sess.outputDir)}</span>`
        : `<span style="color:#6e7a90;font-style:italic;">Not selected (Auto-created on start)</span>`;

    // Modern SVGs
    const resetIcon = `<svg viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>`;
    const stopIcon = `<svg viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/></svg>`;
    const startIcon = `<svg viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>`;
    const deleteIcon = `<svg viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    const logIcon = `<svg viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`;

    return `
    <div class="sess-card ${isRunning ? 'sess-card--running' : ''}" data-session-id="${esc(sess.id)}" data-idx="${idx}" style="--cat-color: ${color};">

        <!-- ── Accent strip kiri (Apple Style Thin Line) ── -->
        <div class="sess-accent-strip" style="background:${color};"></div>

        <!-- ── Header ── -->
        <div class="sess-card-inner">
            <div class="sess-card-header">
                <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
                    <div class="sess-idx-badge" style="background:${color}15;color:${color};border-color:${color}30;">${idx + 1}</div>

                    <!-- Category Name (editable) -->
                    <input class="sess-name-input"
                        data-id="${esc(sess.id)}"
                        value="${esc(sess.name)}"
                        placeholder="Category Name..."
                        title="Click to rename"
                        ${disAttr}
                    />
                </div>

                <!-- Action Button Group -->
                <div class="flex items-center gap-1.5 flex-shrink-0">
                    <span class="sess-status-pill" style="color:${st.color};border-color:${st.border};background:${st.bg};">${st.text}</span>

                    <!-- Activity Log Button per-category -->
                    <button class="sess-btn-sm sess-btn-log flex items-center gap-1" data-id="${esc(sess.id)}" title="Open Activity Log for this category">
                        ${logIcon}
                        <span>Log</span>
                    </button>

                    ${(isDone || sess.status === 'stopped' || sess.status === 'error')
                        ? `<button class="sess-btn-sm sess-btn-reset flex items-center justify-center" data-id="${esc(sess.id)}" title="Restart from beginning">${resetIcon}</button>`
                        : ''
                    }

                    ${isRunning
                        ? `<button class="sess-btn-sm sess-btn-stop flex items-center justify-center" data-id="${esc(sess.id)}" title="Stop process">${stopIcon}</button>`
                        : `<button class="sess-btn-sm sess-btn-start flex items-center justify-center" data-id="${esc(sess.id)}" ${isDone ? 'disabled title="Already completed"' : 'title="Start process"'} style="${isDone ? '' : 'color:#10b981; border-color:rgba(16,185,129,0.2); background:rgba(16,185,129,0.03);'}">${startIcon}</button>`
                    }

                    <button class="sess-btn-sm sess-btn-delete flex items-center justify-center" data-id="${esc(sess.id)}" title="Delete category">${deleteIcon}</button>
                </div>
            </div>

            <!-- ── Config Grid (2-Column Responsive Layout) ── -->
            <div class="sess-config-grid">

                <!-- Left Column -->
                <div class="sess-col">
                    <!-- Prompts File -->
                    <div class="sess-field-row">
                        <span class="sess-field-icon text-[#60a5fa]">
                            <svg viewBox="0 0 24 24" fill="none" width="13" height="13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                        </span>
                        <div class="sess-field-body">
                            <div class="sess-field-label">Prompts File</div>
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;">
                                <div style="flex:1;min-width:0;">${promptFile || '<span style="color:#6e7a90;font-size:10px;font-style:italic;">Not selected</span>'}</div>
                                <button class="sess-pill-btn sess-btn-prompt" data-id="${esc(sess.id)}" ${disAttr}>
                                    ${sess.promptCount ? 'Change' : 'Choose File'}
                                </button>
                            </div>
                            <div class="sess-field-hint">${promptLabel}</div>
                        </div>
                    </div>

                    <!-- Google Account -->
                    <div class="sess-field-row">
                        <span class="sess-field-icon text-[#3b82f6]">
                            <svg viewBox="0 0 24 24" fill="none" width="13" height="13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                        </span>
                        <div class="sess-field-body">
                            <div class="sess-field-label">Google Account</div>
                            <select class="sess-select" style="width:100%;" data-field="accountId" data-id="${esc(sess.id)}" ${disAttr}>
                                ${accOptions}
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Right Column -->
                <div class="sess-col">
                    <!-- Output Folder -->
                    <div class="sess-field-row">
                        <span class="sess-field-icon text-[#a78bfa]">
                            <svg viewBox="0 0 24 24" fill="none" width="13" height="13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                        </span>
                        <div class="sess-field-body">
                            <div class="sess-field-label">Output Folder</div>
                            <div style="display:flex;align-items:flex-start;gap:6px;min-width:0;">
                                <div style="flex:1;min-width:0;">${outLabel}</div>
                                <button class="sess-pill-btn sess-btn-folder" data-id="${esc(sess.id)}" ${disAttr}>
                                    ${sess.outputDir ? 'Change' : 'Browse'}
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Browser, Resume, Resolution & Typing Speed in Grid -->
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;">
                        <!-- Browser Mode -->
                        <div class="sess-field-body">
                            <div class="sess-field-label">Browser Mode</div>
                            <select class="sess-select" style="width:100%;" data-field="headless" data-id="${esc(sess.id)}" ${disAttr}>
                                <option value="false" ${sess.config?.headless === false ? 'selected' : ''}>Show Browser (Headful)</option>
                                <option value="true" ${sess.config?.headless === true ? 'selected' : ''}>Run in Background (Headless)</option>
                            </select>
                        </div>

                        <!-- Resume Mode -->
                        <div class="sess-field-body">
                            <div class="sess-field-label">Resume Mode</div>
                            <select class="sess-select" style="width:100%;" data-field="resume" data-id="${esc(sess.id)}" ${disAttr}>
                                <option value="true" ${sess.config?.resume !== false ? 'selected' : ''}>Resume Last</option>
                                <option value="false" ${sess.config?.resume === false ? 'selected' : ''}>Restart Fresh</option>
                            </select>
                        </div>

                        <!-- Image Resolution -->
                        <div class="sess-field-body">
                            <div class="sess-field-label">Resolution</div>
                            <select class="sess-select" style="width:100%;" data-field="imageSize" data-id="${esc(sess.id)}" ${disAttr}>
                                <option value="1k" ${sess.config?.imageSize === '1k' ? 'selected' : ''}>1K (Original)</option>
                                <option value="2k" ${sess.config?.imageSize === '2k' || !sess.config?.imageSize ? 'selected' : ''}>2K (Enhanced)</option>
                                <option value="4k" ${sess.config?.imageSize === '4k' ? 'selected' : ''}>4K (Ultra HD)</option>
                            </select>
                        </div>

                        <!-- Typing Speed -->
                        <div class="sess-field-body">
                            <div class="sess-field-label">Typing Speed</div>
                            <select class="sess-select" style="width:100%;" data-field="typingSpeed" data-id="${esc(sess.id)}" ${disAttr}>
                                <option value="slow"   ${sess.config?.typingSpeed === 'slow'   ? 'selected' : ''}>🐢 Slow</option>
                                <option value="normal" ${sess.config?.typingSpeed === 'normal' || !sess.config?.typingSpeed ? 'selected' : ''}>⚡ Normal</option>
                                <option value="fast"   ${sess.config?.typingSpeed === 'fast'   ? 'selected' : ''}>🚀 Fast</option>
                                <option value="turbo"  ${sess.config?.typingSpeed === 'turbo'  ? 'selected' : ''}>💨 Turbo</option>
                            </select>
                        </div>
                    </div>

                </div>
            </div>

            <!-- ── Progress ── -->
            <div class="sess-progress-wrap">
                <div class="sess-progress-bar">
                    <div class="sess-progress-fill ${isRunning ? 'sess-progress-fill--animated' : ''}"
                        style="width:${progress}%;color:${color};background:${color};"></div>
                </div>
                <span class="sess-progress-text font-mono text-[10px]">
                    ${sess.progress?.total
                        ? `Completed: ${sess.progress.current} / ${sess.progress.total} (${progress}%)`
                        : isRunning ? 'Starting...' : '—'
                    }
                </span>
            </div>

            <!-- ── Log mini (tampil saat running) dengan fitur Export Log ── -->
            <div class="sess-log-mini ${isRunning ? '' : 'hidden'}" id="sess-log-${esc(sess.id)}">
                <div class="flex justify-between items-center mb-1.5 border-b border-white/5 pb-1 select-none">
                    <span style="font-size:9px;color:#6e7c99;font-weight:700;text-transform:uppercase;">Live Console</span>
                    <button class="sess-pill-btn sess-btn-export-log hover:bg-white/10" data-id="${esc(sess.id)}" style="padding:1px 6px;font-size:8px;line-height:1.2;height:auto;margin:0;">Ekspor Log</button>
                </div>
                <div class="sess-log-inner" id="sess-log-inner-${esc(sess.id)}"></div>
            </div>

        </div><!-- end sess-card-inner -->
    </div>
    `;
}

/** Setup session manager — dipanggil dari app.js */
export async function setupSessionManager() {
    const api       = window.botAPI;
    const container = document.getElementById('sessions-container');
    const emptyEl   = document.getElementById('sessions-empty');
    const countBadge = document.getElementById('sessions-count-badge');
    const runBadge  = document.getElementById('sessions-running-badge');
    const searchInp = document.getElementById('session-search-input');

    if (!container) return;

    let sessions = [];
    let accounts = [];
    let accountsCache = null;

    async function getAccounts(force = false) {
        if (!accountsCache || force) {
            const ad = await api.accountList().catch(() => ({ accounts: [] }));
            accountsCache = ad.accounts || [];
        }
        return accountsCache;
    }

    // ── Update Statistik Global tanpa re-render DOM ──────────────────────────
    function updateGlobalStats(sessionsList) {
        const running = sessionsList.filter(s => s.status === 'running').length;
        if (countBadge) countBadge.textContent = `${sessionsList.length} categories`;
        if (runBadge) {
            runBadge.style.display = running > 0 ? 'inline-flex' : 'none';
            runBadge.textContent = running;
        }

        const statActive = document.getElementById('stat-active-sessions');
        const statTotal  = document.getElementById('stat-total-sessions');
        const statTxt    = document.getElementById('stat-global-progress-txt');
        const statFill   = document.getElementById('stat-global-progress-fill');
        const statETA    = document.getElementById('stat-global-eta');

        let totalCurrent = 0;
        let totalTotal   = 0;
        let maxSessionETA = 0;

        sessionsList.forEach(s => {
            totalCurrent += s.progress?.current || 0;
            totalTotal   += s.progress?.total || 0;

            // Hitung ETA per sesi aktif
            if (s.status === 'running' && s.progress?.current > 0 && s.progress?.total > 0) {
                const startTime = sessionStartTimes.get(s.id);
                if (startTime) {
                    const elapsed = Date.now() - startTime;
                    const speed = elapsed / s.progress.current; // ms per prompt
                    const remaining = s.progress.total - s.progress.current;
                    const sessionETA = speed * remaining; // ms
                    if (sessionETA > maxSessionETA) {
                        maxSessionETA = sessionETA;
                    }
                }
            }
        });

        if (statActive) statActive.textContent = running;
        if (statTotal)  statTotal.textContent = sessionsList.length;
        if (statTxt)    statTxt.textContent = `${totalCurrent} / ${totalTotal}`;
        if (statFill) {
            const globalPct = totalTotal ? Math.round((totalCurrent / totalTotal) * 100) : 0;
            statFill.style.width = `${globalPct}%`;
        }
        if (statETA) {
            if (running === 0) {
                statETA.textContent = '—';
                statETA.style.color = '#8896aa';
            } else if (maxSessionETA === 0) {
                statETA.textContent = 'Calculating...';
                statETA.style.color = '#8896aa';
            } else {
                const sec = Math.ceil(maxSessionETA / 1000);
                const min = Math.floor(sec / 60);
                const remainingSec = sec % 60;
                statETA.textContent = min > 0 ? `${min}m ${remainingSec}s` : `${remainingSec}s`;
                statETA.style.color = '#fbbf24';
            }
        }
    }

    // ── Update satu kartu secara in-place tanpa menghapus elemen DOM ─────────
    function updateCardInPlace(card, sess) {
        const isRunning = sess.status === 'running';
        const isDone    = sess.status === 'completed';
        const st        = STATUS_LABEL[sess.status] || STATUS_LABEL.idle;
        const progress  = pct(sess.progress?.current, sess.progress?.total);

        card.classList.toggle('sess-card--running', isRunning);

        const statusPill = card.querySelector('.sess-status-pill');
        if (statusPill) {
            statusPill.textContent = st.text;
            statusPill.style.color = st.color;
            statusPill.style.borderColor = st.border;
            statusPill.style.background = st.bg;
        }

        const progressFill = card.querySelector('.sess-progress-fill');
        if (progressFill) {
            progressFill.style.width = `${progress}%`;
            progressFill.classList.toggle('sess-progress-fill--animated', isRunning);
        }

        const progressTxt = card.querySelector('.sess-progress-text');
        if (progressTxt) {
            progressTxt.textContent = sess.progress?.total
                ? `Completed: ${sess.progress.current} / ${sess.progress.total} (${progress}%)`
                : (isRunning ? 'Starting...' : '—');
        }

        // Nonaktifkan / aktifkan input saat running
        card.querySelectorAll('.sess-select, .sess-name-input, .sess-pill-btn').forEach(el => {
            el.disabled = isRunning;
        });

        // Update tombol start/stop
        const startBtn = card.querySelector('.sess-btn-start');
        const stopBtn  = card.querySelector('.sess-btn-stop');
        if (isRunning && startBtn) {
            startBtn.className = 'sess-btn-sm sess-btn-stop flex items-center justify-center';
            startBtn.title = 'Stop process';
            startBtn.style.cssText = '';
            startBtn.disabled = false;
            startBtn.innerHTML = ICONS.stop;
        } else if (!isRunning && stopBtn) {
            stopBtn.className = 'sess-btn-sm sess-btn-start flex items-center justify-center';
            stopBtn.title = isDone ? 'Already completed' : 'Start process';
            stopBtn.disabled = isDone;
            stopBtn.style.cssText = isDone ? '' : 'color:#10b981; border-color:rgba(16,185,129,0.2); background:rgba(16,185,129,0.03);';
            stopBtn.innerHTML = ICONS.start;
        }
    }

    // ── Render semua kartu & Update Statistik Global ──────────────────────────
    async function refresh(incoming, forceRender = false) {
        sessions = incoming ?? await api.sessionList().catch(() => []);
        window.currentSessionsList = sessions;

        // Cek apakah kartu DOM sudah ada dan strukturnya sama persis (bisa update in-place)
        const existingCards = container.querySelectorAll('.sess-card');
        const canUpdateInPlace = !forceRender &&
            existingCards.length === sessions.length &&
            sessions.every((s, i) => existingCards[i]?.dataset?.sessionId === s.id);

        if (canUpdateInPlace) {
            sessions.forEach((s, i) => updateCardInPlace(existingCards[i], s));
            updateGlobalStats(sessions);
            applySessionFilters();
            return;
        }

        // Full render hanya jika struktur sesi berubah (tambah/hapus) atau initial load / force
        accounts = await getAccounts(forceRender);
        updateGlobalStats(sessions);

        emptyEl.style.display = sessions.length === 0 ? 'flex' : 'none';
        container.innerHTML   = sessions.length === 0
            ? ''
            : sessions.map((s, i) => buildCard(s, i, accounts)).join('');

        attachListeners();
        applySessionFilters(); // Terapkan query pencarian jika ada
    }

    // ── Terapkan filter pencarian kategori secara real-time ────────────────
    function applySessionFilters() {
        if (!searchInp) return;
        const query = searchInp.value.toLowerCase().trim();
        container.querySelectorAll('.sess-card').forEach(card => {
            const name = card.querySelector('.sess-name-input')?.value.toLowerCase() || '';
            const status = card.querySelector('.sess-status-pill')?.textContent.toLowerCase() || '';
            const accountSelect = card.querySelector('.sess-select[data-field="accountId"]');
            const account = accountSelect ? accountSelect.selectedOptions[0]?.textContent.toLowerCase() : '';
            const promptsFile = card.querySelector('.sess-fname')?.textContent.toLowerCase() || '';
            const outputPath = card.querySelector('.sess-path-display')?.textContent.toLowerCase() || '';

            const match = name.includes(query) || 
                          status.includes(query) || 
                          account.includes(query) || 
                          promptsFile.includes(query) || 
                          outputPath.includes(query);

            card.style.display = match ? 'flex' : 'none';
        });
    }

    // ── Event listeners pada cards ────────────────────────────────────────
    function attachListeners() {

        // Nama kategori (blur untuk simpan)
        container.querySelectorAll('.sess-name-input').forEach(inp => {
            inp.addEventListener('change', async () => {
                await api.sessionUpdate(inp.dataset.id, { name: inp.value.trim() || `Category` });
            });
        });

        // Dropdown Browser Mode Change
        container.querySelectorAll('.sess-select[data-field="headless"]').forEach(sel => {
            sel.addEventListener('change', async () => {
                const id = sel.dataset.id;
                const sess = sessions.find(s => s.id === id);
                if (sess) {
                    const config = sess.config || {};
                    config.headless = sel.value === 'true';
                    await api.sessionUpdate(id, { config });
                }
            });
        });

        // Dropdown Resume Mode Change
        container.querySelectorAll('.sess-select[data-field="resume"]').forEach(sel => {
            sel.addEventListener('change', async () => {
                const id = sel.dataset.id;
                const sess = sessions.find(s => s.id === id);
                if (sess) {
                    const config = sess.config || {};
                    config.resume = sel.value === 'true';
                    await api.sessionUpdate(id, { config });
                }
            });
        });

        // Dropdown Image Resolution Change
        container.querySelectorAll('.sess-select[data-field="imageSize"]').forEach(sel => {
            sel.addEventListener('change', async () => {
                const id = sel.dataset.id;
                const sess = sessions.find(s => s.id === id);
                if (sess) {
                    const config = sess.config || {};
                    config.imageSize = sel.value;
                    await api.sessionUpdate(id, { config });
                }
            });
        });

        // Dropdown Typing Speed Change
        container.querySelectorAll('.sess-select[data-field="typingSpeed"]').forEach(sel => {
            sel.addEventListener('change', async () => {
                const id = sel.dataset.id;
                const sess = sessions.find(s => s.id === id);
                if (sess) {
                    const config = sess.config || {};
                    config.typingSpeed = sel.value;
                    await api.sessionUpdate(id, { config });
                }
            });
        });

        // Buka Activity Log Kategori (per user/session)
        container.querySelectorAll('.sess-btn-log').forEach(btn => {
            btn.addEventListener('click', () => {
                openLogDrawer(btn.dataset.id);
            });
        });

        // Ekspor Log Mini per kategori ke File .txt
        container.querySelectorAll('.sess-btn-export-log').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const logs = sessionLogsHistory.get(id) || [];
                if (logs.length === 0) {
                    showToast('Logs are empty, no data to export.', 'info');
                    return;
                }
                const text = logs.join('\n');
                const r = await api.exportLog(text);
                if (r && r.ok) {
                    showToast('Session logs exported successfully! 💾', 'success');
                } else if (r && r.error) {
                    showToast(`Failed to export: ${r.error}`, 'error');
                }
            });
        });

        // Pilih file prompts
        container.querySelectorAll('.sess-btn-prompt').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.textContent = '⏳...';
                const r = await api.sessionChoosePromptsFile(btn.dataset.id);
                if (r.ok) {
                    showToast(`File loaded: ${r.promptCount} prompts ✓`, 'success');
                    await refresh();
                }
                btn.disabled = false;
            });
        });

        // Pilih output folder
        container.querySelectorAll('.sess-btn-folder').forEach(btn => {
            btn.addEventListener('click', async () => {
                const r = await api.sessionChooseDir(btn.dataset.id);
                if (r.ok) await refresh();
            });
        });

        // Account dropdown
        container.querySelectorAll('.sess-select[data-field="accountId"]').forEach(sel => {
            sel.addEventListener('change', async () => {
                await api.sessionUpdate(sel.dataset.id, { accountId: sel.value || null });
            });
        });

        // Start
        container.querySelectorAll('.sess-btn-start').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (btn.disabled) return;
                btn.disabled = true;
                
                // Catat waktu mulai sesi untuk kalkulasi ETA
                sessionStartTimes.set(btn.dataset.id, Date.now());
                // Reset log history lokal
                sessionLogsHistory.set(btn.dataset.id, []);
                // Hapus log lama sesi ini dari central activity log
                clearSessionLogs(btn.dataset.id);

                const r = await api.sessionStart(btn.dataset.id);
                if (!r.ok) {
                    showToast(`❌ ${r.error}`, 'error');
                    btn.disabled = false;
                } else {
                    await refresh();
                }
            });
        });

        // Stop
        container.querySelectorAll('.sess-btn-stop').forEach(btn => {
            btn.addEventListener('click', async () => {
                await api.sessionStop(btn.dataset.id);
                await refresh();
            });
        });

        // Reset
        container.querySelectorAll('.sess-btn-reset').forEach(btn => {
            btn.addEventListener('click', async () => {
                await api.sessionReset(btn.dataset.id);
                sessionStartTimes.delete(btn.dataset.id);
                sessionLogsHistory.set(btn.dataset.id, []);
                await refresh();
            });
        });

        // Delete
        container.querySelectorAll('.sess-btn-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const card = btn.closest('.sess-card');
                const name = card?.querySelector('.sess-name-input')?.value || 'kategori ini';
                const ok   = await showConfirm(`Delete "${name}"?`, 'This category and its configuration will be deleted permanently.');
                if (!ok) return;
                await api.sessionDelete(btn.dataset.id);
                sessionStartTimes.delete(btn.dataset.id);
                sessionLogsHistory.delete(btn.dataset.id);
                showToast('Category deleted.', 'info');
                await refresh();
            });
        });
    }

    // ── Tambah kategori baru ────────────────────────────────────────────────
    async function addSession() {
        const idx = sessions.length + 1;
        const r   = await api.sessionCreate({ name: `Category ${idx}` });
        if (r.ok) {
            await refresh();
            setTimeout(() => {
                const last = container.lastElementChild;
                last?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        }
    }

    document.getElementById('btn-add-session')?.addEventListener('click', addSession);
    document.getElementById('btn-add-session-empty')?.addEventListener('click', addSession);

    // ── Buka general Activity Log drawer ───────────────────────────────────
    document.getElementById('btn-show-all-logs')?.addEventListener('click', () => {
        openLogDrawer();
    });

    // ── Close Activity Log drawer ──────────────────────────────────────────
    document.getElementById('btn-close-log-drawer')?.addEventListener('click', () => {
        closeLogDrawer();
    });

    // ── Real-time Search Input on Multi-Sesi Tab ───────────────────────────
    searchInp?.addEventListener('input', applySessionFilters);

    // ── Log Search & Filters ──
    document.getElementById('log-search-input')?.addEventListener('input', () => renderLogTable());
    document.getElementById('log-filter-session')?.addEventListener('change', () => renderLogTable());
    document.getElementById('log-filter-account')?.addEventListener('change', () => renderLogTable());
    document.getElementById('log-filter-status')?.addEventListener('change', () => renderLogTable());
    document.getElementById('log-sort-time')?.addEventListener('change', () => renderLogTable());

    // ── Bagi Prompts (opsional: dari textarea utama) ──────────────────────
    document.getElementById('btn-split-prompts')?.addEventListener('click', async () => {
        if (sessions.length === 0) {
            showToast('Please add at least 1 category first.', 'error'); return;
        }
        const ta   = document.getElementById('prompts-textarea');
        const text = ta?.value?.trim() ?? '';
        if (!text) {
            showToast('Prompts tab is empty. Fill prompts or choose file per category.', 'error');
            return;
        }
        const r = await api.sessionSplitPrompts(text);
        if (r.ok) {
            await refresh();
            showToast(`Prompts split: ${r.counts.map((c,i) => `${sessions[i]?.name||'Session '+(i+1)}: ${c}`).join(' | ')}`, 'success');
        } else {
            showToast(`❌ ${r.error}`, 'error');
        }
    });

    // ── Mulai Semua ──────────────────────────────────────────────────────
    document.getElementById('btn-session-start-all')?.addEventListener('click', async () => {
        sessions.forEach(s => {
            if (s.status !== 'running') {
                sessionStartTimes.set(s.id, Date.now());
                sessionLogsHistory.set(s.id, []);
                // Hapus log lama sesi ini dari central activity log
                clearSessionLogs(s.id);
            }
        });
        const r = await api.sessionStartAll();
        if (!r.ok && r.errors?.length) {
            showToast('Some categories failed to start:\n' + r.errors.join('\n'), 'error');
        }
        await refresh();
    });

    // ── Stop Semua ───────────────────────────────────────────────────────
    document.getElementById('btn-session-stop-all')?.addEventListener('click', async () => {
        await api.sessionStopAll();
        showToast('All categories stopped.', 'info');
        await refresh();
    });

    // ── Realtime update dari main process ─────────────────────────────────
    api.onSessionUpdate(async (data) => { await refresh(data); });

    // ── Dengarkan update akun dari main process ───────────────────────────
    if (api.onAccountUpdate) {
        api.onAccountUpdate(async (data) => {
            accountsCache = data?.accounts || null;
            await refresh(null, true);
        });
    }

    // ── Per-sesi log streaming ────────────────────────────────────────────
    api.onSessionLog(({ sessionId, line }) => {
        // 1. Catat ke riwayat log lokal sesi (untuk ekspor berkas)
        if (!sessionLogsHistory.has(sessionId)) {
            sessionLogsHistory.set(sessionId, []);
        }
        const timeStr = new Date().toLocaleTimeString('id-ID');
        sessionLogsHistory.get(sessionId).push(`[${timeStr}] ${line}`);

        // 2. Tulis ke log mini card
        const inner = document.getElementById(`sess-log-inner-${sessionId}`);
        if (inner) {
            // Parse line
            const lineTrim = line.trim();
            
            let timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            let prefix = '';
            let cleanMessage = lineTrim;
            
            const tsMatch = lineTrim.match(/^\[([\d-:\s]+)\]\s*(.*)$/);
            if (tsMatch) {
                const tsStr = tsMatch[1];
                const parts = tsStr.split(' ');
                if (parts.length === 2) {
                    timeStr = parts[1]; // ambil HH:MM:SS saja
                }
                const rest = tsMatch[2].trim();
                const emojiMatch = rest.match(/^(❌|✅|⚠️|ℹ️|ℹ)\s*(.*)$/);
                if (emojiMatch) {
                    prefix = emojiMatch[1];
                    cleanMessage = emojiMatch[2];
                } else {
                    cleanMessage = rest;
                }
            }

            let typeClass = 'INFO';
            let iconHtml = '';
            
            if (prefix === '❌') {
                typeClass = 'ERROR';
                iconHtml = `<svg viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" stroke-width="2.2" class="inline-block text-red-400" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15" stroke-width="2.5"></line><line x1="9" y1="9" x2="15" y2="15" stroke-width="2.5"></line></svg>`;
            } else if (prefix === '⚠️') {
                typeClass = 'WARN';
                iconHtml = `<svg viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" stroke-width="2.2" class="inline-block text-amber-400" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13" stroke-width="2.5"></line><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="3"></line></svg>`;
            } else if (prefix === '✅') {
                typeClass = 'SUCCESS';
                iconHtml = `<svg viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" stroke-width="2.2" class="inline-block text-green-400 animate-bounce" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" stroke-width="2.2"></circle><polyline points="16 9 11 14 8 11" stroke-width="2.5"></polyline></svg>`;
            } else {
                typeClass = 'INFO';
                const msgLower = cleanMessage.toLowerCase();
                if (msgLower.includes('clicking') || msgLower.includes('hovering') || msgLower.includes('waiting') || msgLower.includes('searching') || msgLower.includes('activating')) {
                    iconHtml = `<svg class="inline-block text-blue-400 animate-spin" viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" stroke-width="3" style="animation-duration: 1s;"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.2"></circle><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path></svg>`;
                } else {
                    iconHtml = `<svg viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" stroke-width="2.2" class="inline-block text-blue-400" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12" stroke-width="2.5"></line><line x1="12" y1="8" x2="12.01" y2="8" stroke-width="3"></line></svg>`;
                }
            }

            const el = document.createElement('div');
            el.className = `sess-mini-log-line ${typeClass}`;
            el.innerHTML = `
                <span class="text-[#8e8e93] font-mono whitespace-nowrap" style="font-size: 9px; opacity: 0.7;">${timeStr}</span>
                <span style="display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 12px; height: 12px;">${iconHtml}</span>
                <span class="font-mono truncate" style="flex: 1; text-align: left;" title="${esc(cleanMessage)}">${enrichLogMessage(cleanMessage)}</span>
            `;
            inner.appendChild(el);
            while (inner.children.length > 5) inner.removeChild(inner.firstChild);
            document.getElementById(`sess-log-${sessionId}`)?.classList.remove('hidden');
        }

        // 3. Kirim ke central activity log database
        const sess = sessions.find(s => s.id === sessionId);
        const account = accounts.find(a => a.id === sess?.accountId);
        const sessionName = sess?.name || 'Kategori';
        const accountName = account?.email || account?.name || 'Default Account';
        
        addLogEntry(sessionId, sessionName, accountName, line);

        // 4. Update ETA & global stats secara berkala tanpa re-render DOM
        if (line.match(/\[(\d+)\/(\d+)\]/)) {
            updateGlobalStats(sessions);
        }
    });

    // Inject spin animation
    if (!document.getElementById('sess-spin-style')) {
        const s = document.createElement('style');
        s.id = 'sess-spin-style';
        s.textContent = '@keyframes sessProgShimmer{to{background-position:-200% 0;}}';
        document.head.appendChild(s);
    }

    await refresh();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
    if (window._showToast) { window._showToast(msg, type); return; }
    console.log(`[Toast][${type}] ${msg}`);
}

function showConfirm(title, msg) {
    if (window._showConfirm) {
        return new Promise(r => window._showConfirm(title, msg, 'Hapus', 'danger', r));
    }
    return Promise.resolve(window.confirm(`${title}\n\n${msg}`));
}
