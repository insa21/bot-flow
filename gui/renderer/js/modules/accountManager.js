// js/modules/accountManager.js — Multi-account UI logic (Apple style)
'use strict';

import { openLogDrawer } from './activityLog.js';

/** Konversi ID ke warna avatar yang konsisten */
function stringToColor(str) {
    const colors = ['#1a73e8','#0f9d58','#e91e63','#9c27b0','#ff5722','#00bcd4','#ff9800','#795548'];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
    );
}

/** Render satu kartu akun */
function renderAccountCard(acc, isActive, onSwitch, onDelete, onShowLog) {
    const card = document.createElement('div');
    card.className = 'account-card' + (isActive ? ' account-card--active' : '');
    card.dataset.id = acc.id;

    const label    = acc.email || acc.name || 'Akun';
    const initials = label.split(/[@.\s]/).filter(Boolean)
        .slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
    const color = stringToColor(acc.id);

    // Modern thin document/log SVG
    const logIcon = `<svg viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`;

    card.innerHTML = `
        <div class="acc-avatar" style="background:${color}">
            ${acc.avatar
                ? `<img src="${escHtml(acc.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display='none'">`
                : `<span>${initials}</span>`
            }
        </div>
        <div class="acc-info">
            <div class="acc-name">${escHtml(acc.name || acc.email || 'Akun')}</div>
            ${acc.email && acc.email !== acc.name
                ? `<div class="acc-email">${escHtml(acc.email)}</div>`
                : ''
            }
        </div>
        <div class="acc-actions">
            <!-- Tombol Log untuk Akun/User -->
            <button class="acc-btn-delete acc-btn-log flex items-center justify-center" title="Lihat log aktivitas user ini" style="width:24px;height:24px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--color-text-muted,#6e7a90);cursor:pointer;padding:0;transition:all .15s;">
                ${logIcon}
            </button>
            ${isActive
                ? `<span class="acc-badge-active">Aktif</span>`
                : `<button class="acc-btn-switch" title="Gunakan akun ini">Pakai</button>`
            }
            <button class="acc-btn-delete flex items-center justify-center" title="Hapus akun ini">
                <svg viewBox="0 0 24 24" fill="none" width="11" height="11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
            </button>
        </div>
    `;

    const switchBtn = card.querySelector('.acc-btn-switch');
    if (switchBtn) switchBtn.addEventListener('click', () => onSwitch(acc.id));

    card.querySelector('.acc-btn-delete:not(.acc-btn-log)').addEventListener('click', () => onDelete(acc.id, acc.name || acc.email));
    
    // Bind tombol log
    card.querySelector('.acc-btn-log').addEventListener('click', (e) => {
        e.stopPropagation();
        onShowLog(acc.email || acc.name || 'Default Account');
    });

    return card;
}

/** Setup Account Manager panel di sidebar */
export async function setupAccountManager() {
    const api       = window.botAPI;
    const listEl    = document.getElementById('account-list');
    const addBtn    = document.getElementById('btn-add-account');
    const hintEl    = document.getElementById('account-login-hint');

    if (!listEl || !addBtn) return;

    // ── Render daftar akun ─────────────────────────────────────────────────────
    async function refreshAccounts() {
        const data = await api.accountList().catch(() => ({ accounts: [], activeAccountId: null }));
        listEl.innerHTML = '';

        if (!data.accounts || data.accounts.length === 0) {
            listEl.innerHTML = `<p style="font-size:10px;color:#8896aa;text-align:center;padding:6px 0;line-height:1.6;">
                Belum ada akun.<br>Klik tombol di bawah untuk login.
            </p>`;
            return;
        }

        data.accounts.forEach(acc => {
            const isActive = acc.id === data.activeAccountId;
            const card = renderAccountCard(acc, isActive,
                // onSwitch
                async (id) => {
                    await api.accountSetActive(id);
                    await refreshAccounts();
                    showToast(`Akun "${acc.email || acc.name}" diaktifkan ✓`, 'success');
                },
                // onDelete
                async (id, label) => {
                    const confirmed = await showConfirm(
                        `Hapus akun "${label}"?`,
                        'Sesi login dan data lokal akun ini akan dihapus permanen.',
                        'Hapus Akun'
                    );
                    if (!confirmed) return;
                    const r = await api.accountDelete(id);
                    if (r.ok) {
                        await refreshAccounts();
                        showToast('Akun dihapus.', 'info');
                    }
                },
                // onShowLog
                (email) => {
                    openLogDrawer(null, email);
                }
            );
            listEl.appendChild(card);
        });
    }

    await refreshAccounts();

    // ── State UI login ─────────────────────────────────────────────────────────
    let isLoggingIn = false;
    let cancelBtn   = null;

    function setLoginState(active) {
        isLoggingIn = active;
        addBtn.disabled = active;

        if (active) {
            addBtn.innerHTML = `
                <span style="display:inline-block;width:9px;height:9px;border:2px solid #8896aa;border-top-color:#00d2ff;border-radius:50%;animation:spin .7s linear infinite;margin-right:5px;vertical-align:middle;"></span>
                Menunggu login di Chrome...`;
            hintEl.innerHTML = `
                <strong style="color:#e8eaf0;">Instruksi:</strong><br>
                1. Jendela Chrome terbuka → login ke akun Google Anda<br>
                2. Setelah masuk ke Google Flow, <strong>tutup jendela Chrome</strong><br>
                3. Akun akan otomatis tersimpan di sini`;
            hintEl.style.display = 'block';

            // Tampilkan tombol Batal
            if (!cancelBtn) {
                cancelBtn = document.createElement('button');
                cancelBtn.textContent = 'Batalkan Login';
                cancelBtn.style.cssText = `
                    margin-top:6px;width:100%;padding:5px;border-radius:7px;
                    font-size:10px;background:rgba(239,68,68,.12);
                    color:#ef4444;border:1px solid rgba(239,68,68,.25);cursor:pointer;
                    font-family:inherit;`;
                cancelBtn.addEventListener('click', async () => {
                    await api.accountCancelLogin();
                    setLoginState(false);
                    showToast('Login dibatalkan.', 'info');
                });
                hintEl.after(cancelBtn);
            }
        } else {
            addBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" width="11" height="11" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="16"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
                Tambah Akun Google`;
            hintEl.style.display = 'none';
            hintEl.innerHTML = '';
            if (cancelBtn) { cancelBtn.remove(); cancelBtn = null; }
        }
    }

    // ── Tombol Tambah Akun ─────────────────────────────────────────────────────
    addBtn.addEventListener('click', async () => {
        if (isLoggingIn) return;
        setLoginState(true);

        try {
            const result = await api.accountAdd();

            if (result.ok) {
                await refreshAccounts();
                const email = result.account?.email || result.account?.name || 'baru';
                showToast(`Akun "${email}" berhasil ditambahkan! 🎉`, 'success');
            } else if (result.error) {
                if (!result.error.includes('Proses login')) {
                    showToast(`❌ ${result.error}`, 'error');
                }
            }
        } catch (e) {
            showToast('Terjadi error saat proses login.', 'error');
            console.error('[accountManager] accountAdd error:', e);
        } finally {
            setLoginState(false);
        }
    });

    // ── Dengarkan update akun dari main process ────────────────────────────────
    api.onAccountUpdate(async () => {
        await refreshAccounts();
    });

    // ── Dengarkan sinyal login dimulai (dari main process) ────────────────────
    if (api.onLoginStarted) {
        api.onLoginStarted((data) => {
            // Tampilkan toast informasi jika belum tampil
            if (data?.message) showToast(data.message, 'info');
        });
    }

    // Injeksi animasi spin jika belum ada
    if (!document.getElementById('acc-spin-style')) {
        const s = document.createElement('style');
        s.id = 'acc-spin-style';
        s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(s);
    }
}

// ── Helpers (fallback ke native jika modul global belum siap) ─────────────────
function showToast(msg, type = 'info') {
    if (window._showToast) { window._showToast(msg, type); return; }
    console.log(`[Toast] [${type}] ${msg}`);
}

function showConfirm(title, message, actionLabel = 'Hapus') {
    if (window._showConfirm) {
        return new Promise(resolve => window._showConfirm(title, message, actionLabel, 'danger', resolve));
    }
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
}
