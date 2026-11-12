require('dotenv').config({
    path: process.env.DOTENV_CONFIG_PATH || require('path').join(process.cwd(), '.env')
});
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { log, LOG_FILE } = require('./utils/logger');

// ============================================================
//  KONFIGURASI
// ============================================================
// ─── URL diupdate ke domain baru (labs.google → flow.google.com) ───────────
const FLOW_URL = 'https://flow.google.com/';
const PROMPT_INPUT_SELECTOR = '[contenteditable="true"]';

// Kandidat selector untuk navigasi ulang sesi (legacy, belum tentu dipakai di UI baru)
const NEW_CONVERSATION_CANDIDATES = [
    'button[aria-label*="New"]',
    'button[aria-label*="new"]',
    'button[aria-label*="Reset"]',
    'button[aria-label*="Clear"]',
    '[data-testid*="new"]',
    '[title*="New"]',
];

// Output directory: GUI sets process.env.OUTPUT_DIR; CLI falls back to ./output
const OUTPUT_DIR = process.env.OUTPUT_DIR
    ? path.resolve(process.env.OUTPUT_DIR)
    : path.join(__dirname, 'output');
const DOWNLOADS_TEMP_DIR = process.env.DOWNLOADS_TEMP_DIR
    ? path.resolve(process.env.DOWNLOADS_TEMP_DIR)
    : path.join(process.cwd(), 'tmp_downloads');
const PROGRESS_FILE = path.join(OUTPUT_DIR, process.env.SESSION_ID ? `.progress_${process.env.SESSION_ID}.json` : '.progress.json');


// Resolusi yang tersedia di Flow (sesuai screenshot)
// IMAGE_SIZE di .env menentukan opsi mana yang diklik di menu Flow
const RESOLUTION_LABELS = {
    '1k': ['1K', '1k', 'Ukuran asli', 'Original size', '1K\nUkuran asli'],
    '2k': ['2K', '2k', 'Resolusi ditingkatkan', 'Enhanced resolution'],
    '4k': ['4K', '4k'],
};
// ============================================================

function randomDelay(min, max) {
    // Distribusi sedikit condong ke bawah agar terasa lebih natural
    const r = Math.random();
    return Math.floor(min + (max - min) * (r * r * 0.4 + r * 0.6));
}

/**
 * Jeda tambahan acak dengan distribusi mendekati human reaction time.
 * Gunakan saat butuh variasi timing yang tidak terlalu dapat diprediksi.
 */
async function humanPause(page, min = 300, max = 900) {
    const ms = randomDelay(min, max);
    try {
        if (!page.isClosed()) await page.waitForTimeout(ms);
    } catch {
        await new Promise(r => setTimeout(r, ms));
    }
}

/**
 * Gerak mouse secara organik dari posisi saat ini ke target (x, y).
 * Menggunakan kurva Bezier sederhana dengan beberapa titik perantara acak
 * untuk meniru gerakan tangan manusia yang tidak pernah lurus sempurna.
 */
async function humanMove(page, targetX, targetY) {
    try {
        // Buat beberapa titik via (control points) secara acak
        const steps = randomDelay(6, 12);
        // Ambil posisi mouse saat ini via CDP (fallback ke tengah layar)
        let startX = 640, startY = 400;
        try {
            const pos = await page.evaluate(() => ({ x: window._lastMouseX || 640, y: window._lastMouseY || 400 }));
            startX = pos.x; startY = pos.y;
        } catch { /* fallback */ }

        // Control point acak untuk kurva
        const cp1x = startX + (targetX - startX) * 0.25 + randomDelay(-60, 60);
        const cp1y = startY + (targetY - startY) * 0.25 + randomDelay(-60, 60);
        const cp2x = startX + (targetX - startX) * 0.75 + randomDelay(-40, 40);
        const cp2y = startY + (targetY - startY) * 0.75 + randomDelay(-40, 40);

        for (let step = 1; step <= steps; step++) {
            const t = step / steps;
            // Cubic bezier formula
            const x = Math.round(
                (1 - t) ** 3 * startX +
                3 * (1 - t) ** 2 * t * cp1x +
                3 * (1 - t) * t ** 2 * cp2x +
                t ** 3 * targetX
            );
            const y = Math.round(
                (1 - t) ** 3 * startY +
                3 * (1 - t) ** 2 * t * cp1y +
                3 * (1 - t) * t ** 2 * cp2y +
                t ** 3 * targetY
            );
            await page.mouse.move(x, y);
            await new Promise(r => setTimeout(r, randomDelay(8, 20)));
        }
        // Track posisi terakhir
        await page.evaluate((pos) => { window._lastMouseX = pos.x; window._lastMouseY = pos.y; }, { x: targetX, y: targetY });
    } catch { /* fallback graceful */ }
}

function killExistingChrome() {
    try {
        execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore' });
    } catch { /* tidak ada Chrome yang berjalan */ }
}

// ── CDP cache untuk restoreWindow ──
let _cdpSession = null;
let _windowId   = null;

function resetCdpCache() {
    _cdpSession = null;
    _windowId   = null;
}

/**
 * Memaksimalkan jendela browser Chrome via CDP agar responsif menyesuaikan layar.
 */
async function maximizeWindow(page) {
    if (process.env.HEADLESS === 'true') return;
    try {
        const ctx = page.context();
        const cdpSession = await ctx.newCDPSession(page);
        const { windowId } = await cdpSession.send('Browser.getWindowForTarget');
        await cdpSession.send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'maximized' },
        });
        log('Browser window maximized successfully via CDP.');
    } catch (e) {
        log(`Failed to maximize browser window: ${e.message}`, 'WARN');
    }
}

/**
 * Restore browser window dari state minimized ke normal.
 * Diperlukan agar klik kanan / hover berjalan di window yang teminimize.
 * Tidak melakukan apa-apa di headless mode.
 */
async function restoreWindow(page) {
    if (process.env.HEADLESS === 'true') return; // tidak ada window di headless
    try {
        const ctx = page.context();
        if (!_cdpSession) {
            _cdpSession = await ctx.newCDPSession(page);
        }
        if (!_windowId) {
            const res = await _cdpSession.send('Browser.getWindowForTarget');
            _windowId = res.windowId;
        }
        // Cek state, restore hanya jika minimized
        const { bounds } = await _cdpSession.send('Browser.getWindowBounds', { windowId: _windowId });
        if (bounds.windowState === 'minimized') {
            await _cdpSession.send('Browser.setWindowBounds', {
                windowId: _windowId,
                bounds: { windowState: 'normal' },
            });
            await new Promise(r => setTimeout(r, 300)); // beri waktu window render
        }
    } catch {
        // Reset cache jika CDP session mati agar di-buat ulang berikutnya
        _cdpSession = null;
        _windowId   = null;
    }
}

// ── Progress tracking: simpan/muat prompt yang sudah selesai ──
function loadProgress() {
    try {
        if (fs.existsSync(PROGRESS_FILE)) {
            return new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8')));
        }
    } catch { /* abaikan */ }
    return new Set();
}

function saveProgress(completed) {
    try {
        fs.writeFileSync(PROGRESS_FILE, JSON.stringify([...completed], null, 2));
    } catch { /* abaikan */ }
}

// ── Cek apakah browser context masih hidup ──
async function isContextAlive(context) {
    try {
        if (!context) return false;
        const pages = context.pages();
        const livePage = pages.find(p => !p.isClosed());
        if (livePage) {
            await livePage.evaluate(() => true);
            return true;
        }
        // Jika tidak ada page terbuka, pastikan context benar-benar bisa membuat page
        const testPage = await context.newPage();
        await testPage.close();
        return true;
    } catch {
        return false;
    }
}

// ── Launch browser baru (bisa dipanggil ulang saat crash) ──
async function launchBrowser() {
    const userDataDir = process.env.USER_DATA_DIR || './browser_session';
    const isHeadless  = process.env.HEADLESS === 'true';

    // ── Deteksi Chrome asli yang terinstall di sistem ──────────────────────────
    // Playwright bawaan menggunakan Chromium "testing build" yang langsung dikenali
    // Google sebagai automation browser. Gunakan Chrome asli agar fingerprint cocok.
    const CHROME_PATH = process.env.CHROME_EXECUTABLE_PATH
        || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

    // ── Versi HARUS cocok dengan binary Chrome yang dijalankan ─────────────────
    // Cek versi Chrome yang terinstall: 153.0.8010.52
    const CHROME_VERSION  = '153.0.8010.52';
    const CHROME_MAJOR    = '153';
    const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;

    log(`Launching Chrome ${CHROME_MAJOR} (real binary)...`);

    const context = await chromium.launchPersistentContext(userDataDir, {
        // ── Gunakan Chrome asli, bukan Chromium Playwright ──
        executablePath: CHROME_PATH,
        headless: isHeadless,
        viewport: null,
        userAgent: UA,
        downloadsPath: DOWNLOADS_TEMP_DIR,
        acceptDownloads: true,
        locale: 'en-US',
        timezoneId: 'Asia/Jakarta',
        args: [
            '--start-maximized',
            // ── Sembunyikan tanda otomasi ──
            '--disable-blink-features=AutomationControlled',
            '--exclude-switches=enable-automation',
            // ── Stabilitas ──
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-default-apps',
            // ── Anti background-tab throttling ──
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-ipc-flooding-protection',
            '--force-device-scale-factor=1',
            // ── Kurangi noise & fingerprint & cegah crash network service download ──
            '--disable-features=TranslateUI,AutofillServerCommunication,Translate,NetworkServiceSandbox',
            '--disable-infobars',
            '--lang=en-US',
            '--metrics-recording-only',
        ],
        // ── Header HTTP default agar mirip browser asli ──
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
        },
        // ── Izinkan izin kamera/mik agar tidak ada prompt yang mengganggu ──
        permissions: [],
    });
    return context;
}


async function waitForElement(page, selector, timeoutMs = 10000) {
    try {
        const locator = page.locator(selector).first();
        await locator.waitFor({ state: 'visible', timeout: timeoutMs });
        return locator;
    } catch {
        return null;
    }
}

async function findFirstVisible(page, candidates, timeoutMs = 3000) {
    for (const selector of candidates) {
        const el = await waitForElement(page, selector, timeoutMs);
        if (el) return el;
    }
    return null;
}

async function resetFlowSession(page, existingInput, timeoutMs) {
    const newBtn = await findFirstVisible(page, NEW_CONVERSATION_CANDIDATES, 2000);
    if (newBtn) {
        log('New button found, clicking to start clean session...');
        await newBtn.click();
        try {
            await page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch { /* lanjut */ }
        await page.waitForTimeout(2000);
        const freshInput = await waitForFlowReady(page, 45000);
        return freshInput || existingInput;
    }
    log('Session is already clean, proceeding...');
    return existingInput;
}

/**
 * Mengecek apakah Agen di Flow sedang aktif.
 * Agen dianggap aktif jika:
 * 1. Tombol "Petunjuk Agen" atau "Agent Instructions" terlihat.
 * 2. Atau tombol Agen memiliki atribut/class aktif (seperti aria-pressed, dll.).
 */
async function checkIsAgentActive(page, timeoutMs = 1500) {
    try {
        // 1. Cek tombol "Petunjuk Agen" / "Agent Instructions"
        const instructionsBtn = page.locator(
            'button:has-text("Petunjuk Agen"), button:has-text("Agent Instructions")'
        ).first();
        if (await instructionsBtn.isVisible({ timeout: timeoutMs }).catch(() => false)) {
            return true;
        }

        // 2. Cek status tombol toggle Agen itu sendiri
        const agenBtn = page.locator(
            'button:has-text("Agen"):not(:has-text("Petunjuk")), ' +
            'button:has-text("Agent"):not(:has-text("Instructions"))'
        ).first();
        if (await agenBtn.isVisible({ timeout: timeoutMs }).catch(() => false)) {
            const isActive = await agenBtn.evaluate(el => {
                const ariaPressed = el.getAttribute('aria-pressed');
                const ariaChecked = el.getAttribute('aria-checked');
                const ariaExpanded = el.getAttribute('aria-expanded');
                if (ariaPressed === 'true' || ariaChecked === 'true' || ariaExpanded === 'true') {
                    return true;
                }
                const classList = Array.from(el.classList).map(c => c.toLowerCase());
                const activeKeywords = ['active', 'selected', 'checked', 'pressed', 'enabled'];
                return classList.some(cls => activeKeywords.some(keyword => cls.includes(keyword)));
            }).catch(() => false);
            if (isActive) {
                return true;
            }
        }
    } catch (err) {
        log(`Error checking agent status: ${err.message}`, 'WARN');
    }
    return false;
}

/**
 * Memastikan Agen dalam kondisi nonaktif (OFF).
 * Jika aktif, klik tombol untuk mematikannya.
 * Jika sudah nonaktif, jangan lakukan klik apa pun.
 */
async function ensureAgentOff(page, timeoutMs = 1500) {
    log('Checking "Agent" status in main input area...');
    const isActive = await checkIsAgentActive(page, timeoutMs);
    if (isActive) {
        log('Agent is active. Turning off...');
        const agenBtn = page.locator(
            'button:has-text("Agen"):not(:has-text("Petunjuk")), ' +
            'button:has-text("Agent"):not(:has-text("Instructions"))'
        ).first();
        const agenVisible = await agenBtn.isVisible({ timeout: timeoutMs }).catch(() => false);

        if (agenVisible) {
            await agenBtn.click();
            await page.waitForTimeout(1200);

            // Handle modal konfirmasi "Agen Anda aktif" jika muncul
            const okeBtn = page.locator('button:has-text("Oke"), button:has-text("OK")').first();
            if (await okeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                log('  Confirmation modal → clicking "OK"...');
                await okeBtn.click();
                await page.waitForTimeout(1000);
                // Klik Agen lagi untuk benar-benar off jika masih visible dan aktif
                if (await checkIsAgentActive(page, 500)) {
                    if (await agenBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                        await agenBtn.click();
                        await page.waitForTimeout(600);
                    }
                }
            }
            
            // Verifikasi akhir
            const stillActive = await checkIsAgentActive(page, 1000);
            if (stillActive) {
                log('⚠️  "Agent" button is still active after turn-off attempt!', 'WARN');
            } else {
                log('✅ "Agent" button turned off.');
            }
        } else {
            log('⚠️  "Agent" button found active but toggle button is not visible to click.', 'WARN');
        }
    } else {
        log('ℹ️  "Agent" button is already inactive (OFF). No click performed.');
    }
}

/**
 * Memastikan mode generate adalah GAMBAR (bukan Video).
 * UI flow.google.com memiliki toggle Gambar/Video di toolbar bawah.
 * Default bisa Video — bot selalu harus memastikan mode Gambar aktif.
 */
async function ensureImageMode(page) {
    log('Ensuring Image generation mode is active...');
    try {
        // Cek apakah tab Gambar/Image sudah terlihat (popup settings mungkin terbuka)
        let gambarTab = page.locator(
            'button:has-text("Gambar"):not(:has-text("Agen")):not(:has-text("Agent")), ' +
            'button:has-text("Image"):not(:has-text("Agent")):not(:has-text("Agen"))'
        ).first();

        if (!await gambarTab.isVisible({ timeout: 1500 }).catch(() => false)) {
            // Coba buka popup settings via tombol pengaturan di toolbar bawah
            // Urutan selector dari spesifik ke fallback
            const settingsTriggers = [
                'button[aria-label*="Pengaturan"]',
                'button[aria-label*="Settings"]',
                'button[aria-label*="mode"]',
                'button[aria-label*="Mode"]',
                'button[aria-label*="aspect"]',
                'button[aria-label*="ratio"]',
                '[data-testid*="settings"]',
                '[data-testid*="mode"]',
                // Angular/Material component selectors
                'flow-generation-settings button',
                'flow-prompt-bar button.mode-button',
            ];
            for (const sel of settingsTriggers) {
                const btn = page.locator(sel).first();
                if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
                    await btn.click();
                    await page.waitForTimeout(600);
                    break;
                }
            }
        }

        // Sekarang cari tab Gambar
        gambarTab = page.locator(
            'button:has-text("Gambar"):not(:has-text("Agen")):not(:has-text("Agent")), ' +
            'button:has-text("Image"):not(:has-text("Agent")):not(:has-text("Agen"))'
        ).first();

        if (await gambarTab.isVisible({ timeout: 2000 }).catch(() => false)) {
            // Cek apakah sudah aktif lewat class/aria
            const isActive = await gambarTab.evaluate(el => {
                const cls = Array.from(el.classList).join(' ').toLowerCase();
                const ariaSelected = el.getAttribute('aria-selected');
                const ariaPressed  = el.getAttribute('aria-pressed');
                const ariaChecked  = el.getAttribute('aria-checked');
                return cls.includes('active') || cls.includes('selected') ||
                       cls.includes('mdc-tab--active') ||
                       ariaSelected === 'true' || ariaPressed === 'true' || ariaChecked === 'true';
            }).catch(() => false);

            if (!isActive) {
                await gambarTab.click();
                await page.waitForTimeout(600);
                log('✅ Image mode selected.');
            } else {
                log('ℹ️  Image mode is already active.');
            }
            // Tutup popup dengan Escape
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
        } else {
            log('ℹ️  Image mode tab not found — assuming already in correct mode.', 'WARN');
        }
    } catch (e) {
        log(`⚠️  ensureImageMode error: ${e.message}`, 'WARN');
    }
}

// ── Buat proyek baru di flow.google.com, dismiss dialog, set mode Gambar ─────
// Catatan (Sep 2026): URL Flow berubah dari labs.google/fx/tools/flow
//   ke flow.google.com. Panel "Sesi tanpa judul" sudah tidak ada di UI baru.
//   Setelah klik "Project baru", halaman langsung navigasi ke /project/<id>.
//   Ada onboarding dialog yang perlu di-dismiss, dan mode default bisa Video.
async function setupNewProject(page) {

    // ── Langkah 1: Klik "Project baru" jika masih di dashboard ────────────────
    const currentUrl = page.url();
    if (!currentUrl.includes('/project/')) {
        log('On dashboard — creating a new project...');
        const newProjectCandidates = [
            'button:has-text("Project baru")',
            'button:has-text("Proyek baru")',
            'button:has-text("New project")',
            'button:has-text("New Project")',
            'button.new-project-button',
            '[data-testid*="new-project"]',
            'button[aria-label*="Project baru"]',
            'button[aria-label*="New project"]',
        ];
        const newProjectBtn = await findFirstVisible(page, newProjectCandidates, 6000);
        if (newProjectBtn) {
            await newProjectBtn.click();
            log('✅ "New project" button clicked.');
            // Tunggu navigasi ke halaman project (URL berubah ke /project/<id>)
            try {
                await page.waitForURL('**/project/**', { timeout: 15000 });
                log('✅ Navigated to new project page.');
            } catch {
                // Fallback: tunggu networkidle
                try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch { /* lanjut */ }
            }
            await page.waitForTimeout(2500);
        } else {
            log('ℹ️  "New project" button not found, proceeding...', 'WARN');
        }
    } else {
        log('ℹ️  Already on a project page, skipping new project creation.');
    }

    // ── Langkah 2: Dismiss onboarding/tutorial dialog jika muncul ────────────
    // Dialog ini muncul saat pertama kali buka project baru di flow.google.com
    // Contoh teks: "Anda membuat video dengan Gemini Omni Flash..."
    log('Checking for onboarding dialogs...');
    const onboardingDismissCandidates = [
        'button:has-text("Oke")',
        'button:has-text("OK")',
        'button:has-text("Got it")',
        'button:has-text("Mengerti")',
        'button:has-text("Selesai")',
        'button:has-text("Done")',
        'button:has-text("Dismiss")',
        'button:has-text("Tutup")',
        'button:has-text("Close")',
    ];
    for (const sel of onboardingDismissCandidates) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
            log(`ℹ️  Onboarding dialog detected → dismissing via: ${sel}`);
            await btn.click();
            await page.waitForTimeout(1000);
            log('✅ Onboarding dialog dismissed.');
            break;
        }
    }

    // ── Langkah 3: Pastikan mode Gambar aktif (bukan Video) ───────────────────
    // flow.google.com mendukung Gambar DAN Video — bot hanya untuk gambar
    await ensureImageMode(page);
    await page.waitForTimeout(500);

    // ── Langkah 4: Matikan tombol "Agen" di area input utama ──────────────────
    await ensureAgentOff(page, 3000);
    await page.waitForTimeout(500);
}

async function waitForFlowReady(page, maxWaitMs = 60000) {

    log('Waiting for Flow page to be ready...');
    const input = await waitForElement(page, PROMPT_INPUT_SELECTOR, maxWaitMs);
    if (input) {
        log('✅ Page ready!');
        return input;
    }
    return null;
}

/**
 * Mengetik teks dengan pola yang menyerupai manusia.
 * Kecepatan dikontrol oleh env TYPING_SPEED:
 *   slow   → ~80–220ms/karakter (seperti manusia lambat)
 *   normal → ~20–60ms/karakter  (default, cepat namun natural)
 *   fast   → ~8–25ms/karakter   (cepat)
 *   turbo  → ~2–8ms/karakter    (secepat mungkin)
 */
async function humanType(page, text, inputLocator = null) {
    // Multiplier delay berdasarkan TYPING_SPEED env
    const speedMode = (process.env.TYPING_SPEED || 'normal').toLowerCase();
    const mult = speedMode === 'slow'   ? 3.5
               : speedMode === 'fast'  ? 0.35
               : speedMode === 'turbo' ? 0.12
               : 1.0; // normal

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        let charDelay;
        if (ch === ' ') {
            charDelay = randomDelay(30, 80);
            // micro-pause ekstra setelah spasi (hanya pada slow/normal)
            if (mult >= 1.0 && Math.random() < 0.10) charDelay += randomDelay(30, 100);
        } else if (/[.,!?;:]/.test(ch)) {
            charDelay = randomDelay(50, 120);
        } else {
            // Burst typing: 15% chance karakter sangat cepat
            charDelay = Math.random() < 0.15 ? randomDelay(10, 30) : randomDelay(20, 60);
        }

        // Pastikan inputLocator terfokus dan kursor berada di akhir sebelum mengetik karakter ini
        if (inputLocator) {
            await inputLocator.evaluate((el) => {
                // Focus element jika kehilangan fokus
                if (document.activeElement !== el) {
                    el.focus();
                }
                // Letakkan kursor di paling akhir teks
                if (el.contentEditable === 'true') {
                    const range = document.createRange();
                    const sel = window.getSelection();
                    range.selectNodeContents(el);
                    range.collapse(false); // collapse ke akhir
                    sel.removeAllRanges();
                    sel.addRange(range);
                } else {
                    const len = el.value ? el.value.length : 0;
                    try {
                        el.setSelectionRange(len, len);
                    } catch (e) {
                        // ignore if not supported by input type
                    }
                }
            }).catch(() => {});
        }

        await page.keyboard.type(ch, { delay: 0 }); // type dulu
        await new Promise(r => setTimeout(r, Math.max(1, Math.round(charDelay * mult)))); // delay × multiplier
    }
}

async function fillPromptInput(page, inputLocator, text) {
    const isContentEditable = await inputLocator.evaluate(el => el.contentEditable === 'true');

    // Gerak mouse ke input secara natural sebelum klik
    try {
        const box = await inputLocator.boundingBox();
        if (box) {
            const targetX = Math.round(box.x + box.width * (0.3 + Math.random() * 0.4));
            const targetY = Math.round(box.y + box.height * (0.3 + Math.random() * 0.4));
            await humanMove(page, targetX, targetY);
            await new Promise(r => setTimeout(r, randomDelay(80, 180)));
        }
    } catch { /* lanjut */ }

    await inputLocator.click();
    await page.waitForTimeout(randomDelay(200, 450));

    if (isContentEditable) {
        await page.keyboard.press('Control+a');
        await page.waitForTimeout(randomDelay(80, 150));
        await page.keyboard.press('Delete');
        await page.waitForTimeout(randomDelay(150, 300));
        await humanType(page, text, inputLocator);
    } else {
        await inputLocator.click({ clickCount: 3 });
        await page.waitForTimeout(randomDelay(100, 200));
        await page.keyboard.press('Delete');
        await page.waitForTimeout(randomDelay(150, 300));
        await humanType(page, text, inputLocator);
    }
}

/**
 * Cek apakah Google Flow menampilkan pesan error kebijakan konten.
 * Pesan yang dideteksi:
 *  - "Pembuatan ini mungkin melanggar kebijakan kami" (ID)
 *  - "This generation may violate our policies" (EN)
 *  - Variasi teks error lain dari Flow
 * Return: true jika error policy terdeteksi di DOM
 */
async function checkPolicyError(page) {
    try {
        // Teks spesifik dari Google Flow saat prompt melanggar kebijakan
        // Tidak menggunakan kata generik seperti "Gagal" untuk menghindari false positive
        const policyTexts = [
            'melanggar kebijakan',           // ID: "mungkin melanggar kebijakan kami"
            'violate our policies',           // EN: "may violate our policies"
            'violates our policies',
            'may violate',
            'mungkin melanggar',
            'Coba perintah lain',            // ID: tombol/teks "Coba perintah lain"
            'Try a different prompt',         // EN versi tombol
        ];

        for (const text of policyTexts) {
            // Cek via page.evaluate — paling akurat, cari teks visible di DOM
            const foundInDom = await page.evaluate((searchText) => {
                const walker = document.createTreeWalker(
                    document.body,
                    NodeFilter.SHOW_TEXT,
                    null
                );
                let node;
                while ((node = walker.nextNode())) {
                    if (node.textContent.toLowerCase().includes(searchText.toLowerCase())) {
                        // Pastikan parent element visible (bukan hidden/display:none)
                        const parent = node.parentElement;
                        if (parent && parent.offsetParent !== null) return true;
                    }
                }
                return false;
            }, text).catch(() => false);

            if (foundInDom) return true;
        }
    } catch { /* page mungkin sudah tutup */ }
    return false;
}

/**
 * Deteksi error "unusual activity" / "aktivitas tidak biasa" dari Google.
 * Error ini berbeda dari policy violation — ini adalah rate limit / bot detection.
 * Return: true jika terdeteksi
 */
async function checkUnusualActivityError(page) {
    try {
        const unusualTexts = [
            'aktivitas yang tidak biasa',    // ID: "Kami mendapati aktivitas yang tidak biasa"
            'unusual activity',              // EN: "We have detected unusual activity"
            'unusual traffic',               // EN: "unusual traffic from your computer network"
            'lalu lintas yang tidak biasa',  // ID variasi
        ];

        for (const text of unusualTexts) {
            const foundInDom = await page.evaluate((searchText) => {
                const walker = document.createTreeWalker(
                    document.body,
                    NodeFilter.SHOW_TEXT,
                    null
                );
                let node;
                while ((node = walker.nextNode())) {
                    if (node.textContent.toLowerCase().includes(searchText.toLowerCase())) {
                        const parent = node.parentElement;
                        if (parent && parent.offsetParent !== null) return true;
                    }
                }
                return false;
            }, text).catch(() => false);

            if (foundInDom) return true;
        }
    } catch { /* page mungkin sudah tutup */ }
    return false;
}

/**
 * Deteksi gambar baru via network response.
 * Return { found, newSrcs, policyBlocked }
 */
function setupImageDetection(page, srcsBefore, maxWaitMs) {
    return new Promise((resolve) => {
        const collectedUrls = [];
        let batchTimer = null;
        const start = Date.now();
        const MIN_GEN_TIME_MS = 4500; // AI image generation Google Flow tidak pernah selesai < 4.5 detik

        // ── Progress log setiap 15s ──
        const progressInterval = setInterval(() => {
            const elapsed = Math.round((Date.now() - start) / 1000);
            log(`  Waiting for generation... ${elapsed}s`);
        }, 15000);

        // ── Polling cek error kebijakan, unusual activity, & gambar baru setiap 3 detik ──
        const policyCheckInterval = setInterval(async () => {
            try {
                if (page.isClosed()) return;
                const isBlocked = await checkPolicyError(page);
                if (isBlocked) {
                    log('  🚫 Policy violation detected! Skipping this prompt...', 'WARN');
                    done(false, true);
                    return;
                }
                const isUnusual = await checkUnusualActivityError(page);
                if (isUnusual) {
                    log('  🛑 Unusual activity detected by Google! Rate limit hit.', 'WARN');
                    done(false, false, true); // unusual = true
                    return;
                }

                // Abaikan pengecekan gambar DOM sebelum waktu minimum generasi tercapai
                const elapsed = Date.now() - start;
                if (elapsed < MIN_GEN_TIME_MS) return;

                // Cek apakah ada gambar baru di DOM (flow-image-tile img)
                const currentTileImgs = await page.evaluate((before) => {
                    const imgs = Array.from(document.querySelectorAll('flow-image-tile img, .aisandbox-content img, img'));
                    return imgs
                        .map(i => i.src)
                        .filter(s => s && s.length > 15 && !before.includes(s) && !s.startsWith('data:') && !s.includes('avatar') && !s.includes('profile') && !s.includes('favicon'));
                }, srcsBefore).catch(() => []);

                for (const tsrc of currentTileImgs) {
                    if (!collectedUrls.includes(tsrc)) {
                        collectedUrls.push(tsrc);
                        log(`  📸 Image ${collectedUrls.length} detected via DOM! (${Math.round(elapsed / 1000)}s)`);
                        clearTimeout(batchTimer);
                        // 6 detik setelah gambar TERAKHIR terdeteksi — memberi waktu untuk gambar ke-2, ke-3 dst.
                        batchTimer = setTimeout(() => done(true, false), 6000);
                    }
                }
            } catch { /* abaikan */ }
        }, 3000);

        // ── KeepAlive: setiap 20s bring tab ke depan + emit fake activity ──
        // Ini mencegah Flow berhenti generate saat tab di-background
        const keepAliveInterval = setInterval(async () => {
            try {
                if (page.isClosed()) {
                    done(false, false);
                    return;
                }
                await page.bringToFront();
                // Emit synthetic mousemove agar browser tidak throttle page
                await page.mouse.move(640, 400);
            } catch { /* abaikan jika page sudah mati */ }
        }, 20000);

        const closeHandler = () => {
            log('  ⚡ Page was closed during image detection!', 'WARN');
            done(false, false);
        };
        page.on('close', closeHandler);

        let settled = false;
        const done = (found, blocked = false, unusual = false) => {
            if (settled) return;
            settled = true;
            clearTimeout(batchTimer);
            clearTimeout(globalTimer);
            clearInterval(progressInterval);
            clearInterval(keepAliveInterval);
            clearInterval(policyCheckInterval);
            try {
                page.off('close', closeHandler);
                page.off('response', responseHandler);
            } catch { /* page already closed */ }
            resolve({ found, newSrcs: found ? collectedUrls : [], policyBlocked: blocked, unusualActivity: unusual });
        };

        const globalTimer = setTimeout(() => {
            log('  ⏱️ Timeout waiting for images from server.');
            done(false, false);
        }, maxWaitMs);

        const responseHandler = (response) => {
            try {
                const elapsed = Date.now() - start;
                // Abaikan respons jaringan sebelum batas minimum waktu generasi
                if (elapsed < MIN_GEN_TIME_MS) return;

                const url = response.url();
                const isImage = (response.request().resourceType() === 'image') ||
                                url.includes('googleusercontent.com') ||
                                url.includes('ggpht.com') ||
                                url.includes('media.getMediaUrlRedirect') ||
                                /\.(png|jpg|jpeg|webp)/i.test(url);
                if (
                    isImage &&
                    !url.includes('avatar') &&
                    !url.includes('profile') &&
                    !url.includes('favicon') &&
                    !srcsBefore.includes(url) &&
                    !collectedUrls.includes(url)
                ) {
                    collectedUrls.push(url);
                    log(`  📸 Image ${collectedUrls.length} detected via network! (${Math.round(elapsed / 1000)}s)`);
                    clearTimeout(batchTimer);
                    // 6 detik setelah gambar TERAKHIR terdeteksi — memberi waktu untuk gambar ke-2, ke-3 dst.
                    batchTimer = setTimeout(() => done(true, false), 6000);
                }
            } catch { /* abaikan */ }
        };

        page.on('response', responseHandler);
    });
}

/**
 * Ambil semua gambar yang baru muncul di DOM setelah generate.
 * Return array of { element, src } untuk gambar-gambar baru.
 */
async function getNewImageElements(page, srcsBefore) {
    return page.evaluate((before) => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs
            .filter(img => img.src && !before.includes(img.src) && !img.src.startsWith('data:'))
            .map((img, idx) => ({ idx, src: img.src }));
    }, srcsBefore);
}

/**
 * Simulasi klik kanan pada gambar → hover Download → klik resolusi target.
 * Ini persis sama dengan cara manual user download di Flow UI.
 *
 * Flow: klik kanan gambar → menu muncul → hover "Download" → submenu resolusi → klik target resolusi
 *
 * @param {object} page - Playwright page
 * @param {object} imgLocator - Locator gambar yang akan didownload
 * @param {string} imageSize - '1k' | '2k' | '4k'
 * @param {string} filePath - Path file tujuan
 * @returns {boolean} true jika berhasil
 */
async function downloadViaFlowMenu(page, imgLocator, imageSize, filePath) {
    const targetLabels = RESOLUTION_LABELS[imageSize.toLowerCase()] || RESOLUTION_LABELS['2k'];
    const downloadTimeout = parseInt(process.env.DOWNLOAD_TIMEOUT_MS) || 300000;

    try {
        // Pastikan gambar visible dan scroll ke view
        await imgLocator.waitFor({ state: 'visible', timeout: 10000 });
        await imgLocator.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);

        // Restore window jika minimized + bringToFront agar menu muncul
        await restoreWindow(page);
        await page.bringToFront();

        // ── Langkah 1: Buka context menu ──
        // Cara 1: Klik kanan pada gambar (cara asli Flow)
        log('  🖱️  Klik kanan pada gambar...');
        await imgLocator.click({ button: 'right' });
        await page.waitForTimeout(800);

        // Cari item "Download" / "Unduh" di context menu
        const downloadMenuSelectors = [
            // Role-based
            '[role="menuitem"]:has-text("Download")',
            '[role="menuitem"]:has-text("Unduh")',
            '[role="option"]:has-text("Download")',
            '[role="option"]:has-text("Unduh")',
            // Class Angular Material
            '.mat-mdc-menu-item:has-text("Download")',
            '.mat-mdc-menu-item:has-text("Unduh")',
            // Tag-based
            'li[class*="menu"]:has-text("Download")',
            'li[class*="menu"]:has-text("Unduh")',
            'li:has-text("Download")',
            'li:has-text("Unduh")',
            'button:has-text("Download")',
            'button:has-text("Unduh")',
            'div[class*="item"]:has-text("Download")',
            'div[class*="item"]:has-text("Unduh")',
            'span:has-text("Download")',
            'span:has-text("Unduh")',
        ];

        let downloadMenuItem = null;
        for (const sel of downloadMenuSelectors) {
            try {
                const candidates = page.locator(sel);
                const count = await candidates.count();
                for (let ci = 0; ci < count; ci++) {
                    const el = candidates.nth(ci);
                    if (await el.isVisible()) {
                        downloadMenuItem = el;
                        log(`  📋 Menu "Download" ditemukan via: ${sel}`);
                        break;
                    }
                }
                if (downloadMenuItem) break;
            } catch { /* coba selector berikutnya */ }
        }

        // Fallback: Jika klik kanan tidak memunculkan menu, coba tombol ⋮ (Opsi lainnya)
        if (!downloadMenuItem) {
            log('  ⚠️  Menu tidak muncul via klik kanan, mencoba tombol ⋮ (Opsi lainnya)...');
            try {
                await imgLocator.hover({ force: true });
                await page.waitForTimeout(500);

                const threeDotCandidates = [
                    'button[aria-label*="Opsi"]',
                    'button[aria-label*="opsi"]',
                    'button[aria-label*="More"]',
                    'button[aria-label*="more"]',
                    'button:has(mat-icon:has-text("more_vert"))',
                    'button.mat-mdc-icon-button:has(mat-icon)',
                ];

                for (const sel of threeDotCandidates) {
                    try {
                        const btn = page.locator(sel).first();
                        if (await btn.isVisible()) {
                            await btn.click({ force: true });
                            await page.waitForTimeout(800);
                            break;
                        }
                    } catch { /* next */ }
                }

                // Cari ulang menu Download
                for (const sel of downloadMenuSelectors) {
                    try {
                        const candidates = page.locator(sel);
                        const count = await candidates.count();
                        for (let ci = 0; ci < count; ci++) {
                            const el = candidates.nth(ci);
                            if (await el.isVisible()) {
                                downloadMenuItem = el;
                                log(`  📋 Menu "Download" ditemukan via ⋮ menu: ${sel}`);
                                break;
                            }
                        }
                        if (downloadMenuItem) break;
                    } catch { /* next */ }
                }
            } catch { /* abaikan fallback three-dot */ }
        }

        if (!downloadMenuItem) {
            log('  ⚠️  Menu "Download" tidak ditemukan setelah klik kanan.', 'WARN');
            await page.keyboard.press('Escape').catch(() => {});
            return false;
        }

        // ── Langkah 2: Buka submenu resolusi ──
        log('  🖱️  Membuka submenu resolusi...');
        await downloadMenuItem.hover({ force: true });
        await page.waitForTimeout(600);

        // Jika submenu belum terbuka, coba klik menuItem-nya
        const subCount = await page.locator('.cdk-overlay-container [role="menuitem"]').count().catch(() => 0);
        if (subCount <= 1) {
            await downloadMenuItem.click({ force: true }).catch(() => {});
            await page.waitForTimeout(800);
        }

        // ── Langkah 3: Cari dan klik opsi resolusi target (misal "2K") ──
        log(`  🔍 Mencari opsi resolusi "${imageSize.toUpperCase()}" di submenu...`);
        let resolutionItem = null;

        for (const label of targetLabels) {
            const candidates = [
                `[role="menuitem"]:has-text("${label}")`,
                `[role="option"]:has-text("${label}")`,
                `.mat-mdc-menu-item:has-text("${label}")`,
                `li:has-text("${label}"):not(:has-text("Upgrade"))`,
                `div[class*="item"]:has-text("${label}")`,
                `span:has-text("${label}")`,
                `*:has-text("${label}")`,
            ];

            for (const sel of candidates) {
                try {
                    const els = page.locator(sel);
                    const cnt = await els.count();
                    for (let ci = 0; ci < cnt; ci++) {
                        const el = els.nth(ci);
                        if (!await el.isVisible()) continue;
                        const txt = await el.textContent().catch(() => '');
                        if (txt.toLowerCase().includes('upgrade')) continue;
                        resolutionItem = el;
                        log(`  ✅ Opsi resolusi "${label}" ditemukan via: ${sel}`);
                        break;
                    }
                    if (resolutionItem) break;
                } catch { /* coba berikutnya */ }
            }
            if (resolutionItem) break;
        }

        if (!resolutionItem) {
            log(`  ⚠️  Opsi resolusi "${imageSize.toUpperCase()}" tidak ditemukan di submenu.`, 'WARN');
            await page.keyboard.press('Escape').catch(() => {});
            return false;
        }

        // ── Langkah 4: Intercept URL download & Klik resolusi ──
        log(`  ⏳ Menyiapkan download resolusi "${imageSize.toUpperCase()}"...`);
        let resolvedDownloadUrl = null;

        const requestHandler = (request) => {
            try {
                const url = request.url();
                if (
                    (url.includes('ggpht.com') ||
                     url.includes('googleusercontent.com') ||
                     url.includes('lh3.google') ||
                     url.includes('export') ||
                     url.includes('media.getMediaUrlRedirect') ||
                     /\.(png|jpg|jpeg|webp)(\?|$)/i.test(url)) &&
                    !url.includes('avatar') && !url.includes('favicon') && !url.includes('profile')
                ) {
                    resolvedDownloadUrl = url;
                }
            } catch { /* abaikan */ }
        };

        const upscaleWaitMs = Math.min(downloadTimeout, 90000); // Batas tunggu proses upscale server (max 90s)
        const downloadPromise = page.waitForEvent('download', { timeout: upscaleWaitMs }).catch(() => null);
        page.on('requestfinished', requestHandler);

        try {
            await resolutionItem.click({ force: true });
            log(`  🖱️  Klik "${imageSize.toUpperCase()}" — menunggu proses upscale server Flow (15-30 detik)...`);

            // Tunggu download event atau URL resolusi selesai dengan progress log setiap 5s
            const waitStart = Date.now();
            let download = null;

            while (Date.now() - waitStart < upscaleWaitMs) {
                // Cek apakah downloadPromise sudah selesai
                const raceResult = await Promise.race([
                    downloadPromise,
                    new Promise(r => setTimeout(() => r('PENDING'), 2000))
                ]);

                if (raceResult !== 'PENDING') {
                    download = raceResult;
                    break;
                }

                const elapsed = Math.round((Date.now() - waitStart) / 1000);
                if (elapsed > 0 && elapsed % 5 === 0) {
                    log(`  ⏳ Menunggu server Google Flow selesai upscaling ${imageSize.toUpperCase()}... (${elapsed}s)`);
                }

                if (page.isClosed()) break;
            }

            // ── Strategi 1: Playwright download event (Paling Utama di Google Flow) ──
            if (download) {
                const failure = await download.failure().catch(() => null);
                if (failure) {
                    log(`  ⚠️ Browser download event error: ${failure}`, 'WARN');
                } else {
                    log(`  💾 Download event diterima, menyimpan file: ${path.basename(filePath)}...`);
                    const outDir = path.dirname(filePath);
                    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

                    try {
                        await download.saveAs(filePath);
                        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 10000) {
                            const kb = Math.round(fs.statSync(filePath).size / 1024);
                            log(`  ✅ Download selesai via saveAs (${imageSize.toUpperCase()}): ${path.basename(filePath)} (${kb} KB)`, 'SUCCESS');
                            return true;
                        }
                    } catch (saveErr) {
                        log(`  ⚠️ saveAs error (${saveErr.message}), mencoba fallback copy dari temp path...`, 'WARN');
                        try {
                            const tempPath = await download.path();
                            if (tempPath && fs.existsSync(tempPath)) {
                                fs.copyFileSync(tempPath, filePath);
                                if (fs.existsSync(filePath) && fs.statSync(filePath).size > 10000) {
                                    const kb = Math.round(fs.statSync(filePath).size / 1024);
                                    log(`  ✅ Download selesai via temp path (${imageSize.toUpperCase()}): ${path.basename(filePath)} (${kb} KB)`, 'SUCCESS');
                                    return true;
                                }
                            }
                        } catch (pathErr) {
                            log(`  ⚠️ download.path() gagal: ${pathErr.message}`, 'WARN');
                        }
                    }
                }
            }

            // ── Strategi 2: Direct fetch dari intercepted URL ──
            if (resolvedDownloadUrl) {
                log(`  🔗 Mencoba fetch dari intercepted URL: ${resolvedDownloadUrl.substring(0, 80)}...`);
                try {
                    const resp = await page.request.get(resolvedDownloadUrl, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                        timeout: 30000,
                    });
                    if (resp.ok()) {
                        const body = await resp.body();
                        if (body.length > 50000) {
                            const outDir = path.dirname(filePath);
                            if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
                            fs.writeFileSync(filePath, body);
                            const kb = Math.round(body.length / 1024);
                            log(`  ✅ Download selesai via direct fetch (${imageSize.toUpperCase()}): ${path.basename(filePath)} (${kb} KB)`, 'SUCCESS');
                            return true;
                        }
                    }
                } catch (fetchErr) {
                    log(`  ⚠️ Direct fetch gagal: ${fetchErr.message}`, 'WARN');
                }
            }

            log(`  ⚠️ Download upscale ${imageSize.toUpperCase()} tidak terdeteksi dalam batas waktu ${Math.round(upscaleWaitMs / 1000)}s.`, 'WARN');
            return false;

        } finally {
            try { page.off('requestfinished', requestHandler); } catch {}
        }

    } catch (err) {
        log(`  ❌ Error saat download via menu: ${err.message}`, 'ERROR');
        try { await page.keyboard.press('Escape'); } catch {}
        return false;
    }
}

/**
 * Fallback: download langsung dari URL network response (tanpa menu).
 * Dipakai jika simulasi klik menu gagal atau untuk mode native.
 */
async function downloadImageDirect(page, src, filePath) {
    try {
        if (src.startsWith('blob:')) {
            if (!page || page.isClosed()) return false;
            const base64 = await page.evaluate(async (blobUrl) => {
                const response = await fetch(blobUrl);
                const blob = await response.blob();
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result.split(',')[1]);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            }, src).catch(() => null);
            if (base64) {
                fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
                return true;
            }
            return false;
        }

        if (src.startsWith('data:image')) {
            const base64 = src.split(',')[1];
            if (base64) {
                fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
                return true;
            }
            return false;
        }

        if (src.startsWith('http://') || src.startsWith('https://')) {
            // Coba via page.request jika page masih hidup
            if (page && !page.isClosed()) {
                try {
                    const response = await page.request.get(src);
                    if (response.ok()) {
                        fs.writeFileSync(filePath, await response.body());
                        return true;
                    }
                } catch { /* coba Node fetch di bawah */ }
            }
            // Fallback: Node native fetch
            try {
                const res = await fetch(src);
                if (res.ok) {
                    const buffer = Buffer.from(await res.arrayBuffer());
                    fs.writeFileSync(filePath, buffer);
                    return true;
                }
            } catch { /* gagal */ }
            return false;
        }
    } catch {
        return false;
    }

    return false;
}

/**
 * Download semua gambar baru:
 * 1. Cari elemen gambar baru di DOM
 * 2. Untuk setiap gambar: klik kanan → Download → pilih resolusi dari .env
 * 3. Fallback ke download langsung jika menu gagal
 */
async function downloadAllNewImages(page, newSrcs, baseName, outputDir, imageSize) {
    if (newSrcs.length === 0) return 0;

    const sizeSuffix = (!imageSize || imageSize.toLowerCase() === 'native')
        ? ''
        : `_${imageSize.toLowerCase()}`;

    let downloaded = 0;

    // ── Snapshot semua tile gambar di DOM sebelum mulai loop download ──
    // Ini diperlukan agar fallback locator tahu berapa total tile yang ada
    // dan bisa memetakan newSrcs[i] ke tile yang benar (bukan selalu tile terakhir)
    let tileSnapshot = [];
    try {
        const allTiles = page.locator('flow-image-tile img');
        const tileCount = await allTiles.count();
        for (let ti = 0; ti < tileCount; ti++) {
            const el = allTiles.nth(ti);
            const tsrc = await el.getAttribute('src').catch(() => '');
            const visible = await el.isVisible().catch(() => false);
            const box = await el.boundingBox().catch(() => null);
            if (visible && box && box.width > 80 && box.height > 80) {
                tileSnapshot.push({ el, src: tsrc || '' });
            }
        }
        log(`  🗂️  Snapshot tile: ${tileSnapshot.length} gambar ditemukan di DOM.`);
    } catch { /* skip snapshot */ }

    // Jumlah tile baru = jumlah gambar yang baru di-generate pada batch ini
    // Tile terbaru ada di akhir array (index paling tinggi)
    // newSrcs[0] = gambar pertama, newSrcs[1] = gambar kedua, dst.
    // Maka tile yang cocok: tileSnapshot[tileSnapshot.length - newSrcs.length + i]
    const tileBaseIndex = tileSnapshot.length - newSrcs.length;

    for (let i = 0; i < newSrcs.length; i++) {
        const src = newSrcs[i];
        const filePath = path.join(outputDir, `${baseName}${sizeSuffix}_${i + 1}.png`);
        log(`  Mendownload gambar ${i + 1}/${newSrcs.length}...`);

        // ── Cari elemen <img> yang cocok dengan src hasil deteksi network ──
        let imgLocator = null;

        // Tunggu hingga elemen gambar benar-benar siap dan visible di DOM (hingga 5 detik)
        for (let attempt = 0; attempt < 5; attempt++) {
            // Strategi 1: Exact match src
            try {
                const exactMatch = page.locator(`img[src="${src}"]`);
                if (await exactMatch.count() > 0) {
                    const el = exactMatch.first();
                    if (await el.isVisible().catch(() => false)) {
                        imgLocator = el;
                        log(`  🎯 Gambar ${i+1}: ditemukan via exact src match.`);
                        break;
                    }
                }
            } catch { /* skip */ }

            // Strategi 2: Partial URL match (ambil bagian unik dari URL)
            if (!imgLocator) {
                try {
                    const urlObj = new URL(src);
                    const partialKey = urlObj.pathname.split('/').filter(Boolean).pop() || '';
                    if (partialKey && partialKey.length > 5) {
                        const partialMatch = page.locator(`img[src*="${partialKey}"]`);
                        if (await partialMatch.count() > 0) {
                            const el = partialMatch.first();
                            if (await el.isVisible().catch(() => false)) {
                                imgLocator = el;
                                log(`  🎯 Gambar ${i+1}: ditemukan via partial URL: ...${partialKey}`);
                                break;
                            }
                        }
                    }
                } catch { /* URL parsing gagal, skip */ }
            }

            // Strategi 3: Index-aware tile snapshot
            // Memetakan gambar ke-i ke tile yang sesuai berdasarkan posisi di DOM
            if (!imgLocator) {
                try {
                    const tileIdx = tileBaseIndex + i;
                    if (tileIdx >= 0 && tileIdx < tileSnapshot.length) {
                        const snapEl = tileSnapshot[tileIdx].el;
                        if (await snapEl.isVisible().catch(() => false)) {
                            imgLocator = snapEl;
                            log(`  🎯 Gambar ${i+1}: ditemukan via tile snapshot (index ${tileIdx}).`);
                            break;
                        }
                    }
                } catch { /* skip */ }
            }

            // Strategi 4: Scan ulang flow-image-tile secara segar dan pilih sesuai index
            if (!imgLocator) {
                try {
                    const freshTiles = page.locator('flow-image-tile img');
                    const freshCount = await freshTiles.count();
                    // Estimasi index tile: gambar ke-0 = tile[count-N], gambar ke-1 = tile[count-N+1]
                    const N = newSrcs.length;
                    const targetIdx = freshCount - N + i;
                    if (targetIdx >= 0 && targetIdx < freshCount) {
                        const el = freshTiles.nth(targetIdx);
                        if (await el.isVisible().catch(() => false)) {
                            const box = await el.boundingBox().catch(() => null);
                            if (box && box.width > 80 && box.height > 80) {
                                imgLocator = el;
                                log(`  🎯 Gambar ${i+1}: ditemukan via fresh tile scan (targetIdx ${targetIdx}/${freshCount-1}).`);
                                break;
                            }
                        }
                    }
                } catch { /* skip */ }
            }

            // Strategi 5: Last resort — tile terakhir (untuk kasus single image)
            if (!imgLocator && newSrcs.length === 1) {
                try {
                    const allImgs = page.locator('flow-image-tile img');
                    const imgCount = await allImgs.count();
                    if (imgCount > 0) {
                        const el = allImgs.nth(imgCount - 1);
                        if (await el.isVisible().catch(() => false)) {
                            const box = await el.boundingBox().catch(() => null);
                            if (box && box.width > 100 && box.height > 100) {
                                imgLocator = el;
                                log(`  🎯 Gambar ${i+1}: ditemukan via last-tile last-resort.`);
                                break;
                            }
                        }
                    }
                } catch { /* skip */ }
            }

            if (imgLocator) break;
            await page.waitForTimeout(1000);
        }

        let ok = false;

        if (imgLocator && imageSize && imageSize.toLowerCase() !== 'native') {
            // ── Utama: Simulasi klik kanan → Download → resolusi target ──
            ok = await downloadViaFlowMenu(page, imgLocator, imageSize, filePath);

            // Jika percobaan pertama gagal, coba sekali lagi setelah jeda singkat
            if (!ok && !page.isClosed()) {
                log(`  ⚠️  Percobaan pertama download menu belum berhasil, mencoba sekali lagi...`, 'WARN');
                await page.waitForTimeout(2000);
                ok = await downloadViaFlowMenu(page, imgLocator, imageSize, filePath);
            }
        }

        if (!ok) {
            // ── Fallback: download langsung dari URL network response ke folder utama ──
            log(`  ↩️  Fallback ke download langsung (resolusi asli)...`);
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    ok = await downloadImageDirect(page, src, filePath);
                    if (ok) break;
                    if (attempt < 2) await page.waitForTimeout(2000);
                } catch (err) {
                    if (attempt < 2) await page.waitForTimeout(2000);
                    else log(`  ❌ Error download fallback: ${err.message}`, 'ERROR');
                }
            }
        }

        if (ok) {
            const stat = fs.statSync(filePath);
            const kb = Math.round(stat.size / 1024);
            log(`  ✅ Tersimpan (${kb} KB): ${path.basename(filePath)}`, 'SUCCESS');
            downloaded++;
        } else {
            log(`  ⚠️  Gagal download gambar ${i + 1}`, 'WARN');
        }
    }

    return downloaded;
}

// ============================================================
//  PAGE SETUP
// ============================================================
async function isPageAlive(page) {
    try {
        if (!page || page.isClosed()) return false;
        return true;
    } catch {
        return false;
    }
}

async function setupPage(context, timeoutMs) {
    const page = await context.newPage();

    // ── Anti-detection: script diinjeksi SEBELUM halaman apapun load ──
    await page.addInitScript(() => {
        // 1. Sembunyikan webdriver flag
        //    Chrome asli tidak pernah mengekspos ini, tapi Playwright menambahkannya
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

        // 2. Hapus jejak CDP/Playwright
        //    Playwright mengekspos variabel window ini yang bisa dideteksi Google
        try {
            const pwVars = Object.getOwnPropertyNames(window).filter(k =>
                k.startsWith('cdc_') || k.startsWith('__playwright') || k.startsWith('__pw_')
            );
            pwVars.forEach(v => {
                try { delete window[v]; } catch { Object.defineProperty(window, v, { get: () => undefined }); }
            });
        } catch { /* abaikan */ }

        // 3. window.chrome — JANGAN di-spoof jika Chrome asli sudah ada
        //    Chrome asli sudah punya window.chrome native yang benar.
        //    Overwrite justru jadi sinyal deteksi karena property-nya berbeda.
        //    Hanya tambahkan jika benar-benar tidak ada (fallback untuk Chromium).
        if (!window.chrome || !window.chrome.runtime) {
            window.chrome = window.chrome || {};
            window.chrome.runtime = window.chrome.runtime || {
                id: undefined,
                connect: () => {},
                sendMessage: () => {},
                onMessage: { addListener: () => {}, removeListener: () => {} },
            };
        }

        // 4. navigator.plugins — Chrome asli sudah punya plugins nyata.
        //    Hanya tambahkan fallback jika kosong (Chromium headless).
        if (navigator.plugins.length === 0) {
            const fakePlugins = [
                { name: 'Chrome PDF Plugin',      filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'Chrome PDF Viewer',      filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                { name: 'Native Client',          filename: 'internal-nacl-plugin', description: '' },
            ];
            const pluginArray = fakePlugins.map(p => {
                const plugin = Object.create(Plugin.prototype);
                Object.defineProperty(plugin, 'name',        { get: () => p.name });
                Object.defineProperty(plugin, 'filename',    { get: () => p.filename });
                Object.defineProperty(plugin, 'description', { get: () => p.description });
                Object.defineProperty(plugin, 'length',      { get: () => 0 });
                return plugin;
            });
            Object.defineProperty(navigator, 'plugins', {
                get: () => Object.assign(pluginArray, {
                    item:      (i) => pluginArray[i],
                    namedItem: (n) => pluginArray.find(p => p.name === n),
                    length:    pluginArray.length,
                }),
            });
        }

        // 5. Bahasa — pastikan konsisten dengan extraHTTPHeaders
        try { Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] }); } catch {}
        try { Object.defineProperty(navigator, 'language',  { get: () => 'en-US' }); } catch {}

        // 6. Spoof Page Visibility API — Flow tidak throttle saat tab di-background
        try {
            Object.defineProperty(document, 'hidden',          { get: () => false, configurable: true });
            Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
        } catch {}
        document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);

        // 7. Track posisi mouse untuk humanMove()
        document.addEventListener('mousemove', (e) => {
            window._lastMouseX = e.clientX;
            window._lastMouseY = e.clientY;
        }, { passive: true });
    });

    // Paksa page tetap di depan agar interaksi UI tidak di-throttle
    await page.bringToFront();

    // Memaksimalkan jendela Chrome via CDP agar responsif mengikuti layar penuh
    await maximizeWindow(page);

    log(`Opening ${FLOW_URL} ...`);

    // ── CDP: nonaktifkan throttling agar tab tidak di-throttle saat di-background ──
    try {
        const cdpSession = await context.newCDPSession(page);
        await cdpSession.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    } catch { /* CDP tidak tersedia di semua versi, lanjut */ }

    await page.goto(FLOW_URL, { waitUntil: 'load', timeout: timeoutMs });

    try {
        await page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch { /* lanjut */ }
    await page.waitForTimeout(3000);

    // ── Setup proyek baru: buat proyek, tutup popup, matikan Agen ──
    await setupNewProject(page);

    let promptInput = await waitForFlowReady(page, 60000);
    if (!promptInput) {
        log('Input box not found. Login might be required.', 'WARN');
        log('Please log in using the browser window. Waiting up to 120 seconds...', 'WARN');
        promptInput = await waitForFlowReady(page, 120000);
        if (!promptInput) return { page, promptInput: null };
    }

    // Catatan: resetFlowSession TIDAK dipanggil di sini karena setupNewProject
    // sudah membuat proyek baru yang bersih setiap kali.

    return { page, promptInput };
}

// ============================================================
//  MAIN
// ============================================================
async function runAutomation() {
    const runStartTime = Date.now();
    // ── Pastikan folder output dan temp ada ──
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (fs.existsSync(DOWNLOADS_TEMP_DIR)) {
        try { fs.rmSync(DOWNLOADS_TEMP_DIR, { recursive: true, force: true }); } catch {}
    }
    fs.mkdirSync(DOWNLOADS_TEMP_DIR, { recursive: true });

    log(`📋 Log saved in: ${LOG_FILE}`);

    // ── Baca prompts ──
    const promptsPath = process.env.PROMPTS_PATH || path.join(process.cwd(), 'prompts.txt');
    if (!fs.existsSync(promptsPath)) { log('File prompts.txt not found!', 'ERROR'); return; }

    const prompts = fs.readFileSync(promptsPath, 'utf-8')
        .split('\n').map(p => p.trim()).filter(p => p.length > 0 && !p.startsWith('#'));

    if (prompts.length === 0) { log('prompts.txt is empty.', 'ERROR'); return; }

    const imageSize = (process.env.IMAGE_SIZE || '2k').toLowerCase();
    const timeoutMs  = parseInt(process.env.TIMEOUT_MS)  || 120000;
    const maxRetries = parseInt(process.env.MAX_RETRIES)  || 3;
    const MAX_BROWSER_RELAUNCHES = 5; // batas relaunch browser sebelum berhenti total

    // ── Muat progress sebelumnya (resume) ──
    const completed = loadProgress();
    const pending = prompts.filter(p => !completed.has(p));
    const skipped = prompts.length - pending.length;
    if (skipped > 0) log(`⏩ Resuming: ${skipped} prompts already completed, ${pending.length} remaining.`);
    log(`Found ${pending.length} prompts to process.`);
    log(`📐 Download resolution: ${imageSize.toUpperCase()}`);

    if (pending.length === 0) {
        log('✅ All prompts completed previously!', 'SUCCESS');
        // Reset progress jika ingin mulai ulang
        return;
    }

    let context = null;
    let page = null;
    let promptInput = null;
    let browserLaunches = 0;

    // ── Fungsi relaunch browser + setup page ──
    async function initBrowser() {
        if (context) { try { await context.close(); } catch {} }
        resetCdpCache(); // Reset CDP session saat browser baru diluncurkan
        browserLaunches++;
        if (browserLaunches > MAX_BROWSER_RELAUNCHES) {
            throw new Error(`Browser sudah direlaunch ${MAX_BROWSER_RELAUNCHES}x. Hentikan untuk mencegah loop tak terbatas.`);
        }
        log(`🔄 Browser launch #${browserLaunches}...`);
        context = await launchBrowser();
        const result = await setupPage(context, timeoutMs);
        page = result.page;
        promptInput = result.promptInput;
        if (!promptInput) throw new Error('Failed to get input box after relaunch.');
    }

    try {
        await initBrowser();
        log('✅ Ready! Starting prompt processing...\n');

        for (let i = 0; i < pending.length; i++) {
            const prompt = pending[i];
            const globalIdx = prompts.indexOf(prompt) + 1;
            log(`[${globalIdx}/${prompts.length}] "${prompt}"`);

            let success = false;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    // ── Deteksi: context mati → relaunch browser penuh ──
                    const ctxAlive = await isContextAlive(context);
                    if (!ctxAlive) {
                        log('  ⚡ Browser context is dead! Relaunching browser...', 'WARN');
                        await initBrowser();
                    } else if (!await isPageAlive(page)) {
                        log('  ⚡ Page is dead, opening new page...', 'WARN');
                        const result = await setupPage(context, timeoutMs);
                        page = result.page;
                        promptInput = result.promptInput;
                        if (!promptInput) throw new Error('Failed to setup new page.');
                    }

                    // ── Retry loop khusus policy error (terpisah dari retry umum) ──
                    const MAX_POLICY_RETRIES = 5;
                    let policyRetryCount = 0;
                    const MAX_UNUSUAL_RETRIES = 2;
                    let unusualRetryCount = 0;
                    let attemptSuccess = false;
                    while (true) {
                        const srcsBefore = await page.evaluate(() =>
                            Array.from(document.querySelectorAll('img')).map(img => img.src)
                        );

                        // Restore window jika minimized + bringToFront sebelum ketik prompt
                        await restoreWindow(page);
                        await page.bringToFront();

                        // Pastikan Agen selalu nonaktif (OFF)
                        await ensureAgentOff(page, 1000);

                        await fillPromptInput(page, promptInput, prompt);
                        await page.waitForTimeout(randomDelay(400, 700));

                        // Setup deteksi network SEBELUM Enter & submit (gunakan timeoutMs untuk batas waktu pembuatan AI)
                        const detectionPromise = setupImageDetection(page, srcsBefore, timeoutMs);

                        // Tekan Enter & klik tombol submit ("Mulai pembuatan" / arrow icon)
                        await page.keyboard.press('Enter');
                        await page.waitForTimeout(300);

                        const submitCandidates = [
                            'button:has-text("Mulai pembuatan")',
                            'button[aria-label*="Mulai pembuatan"]',
                            'button[aria-label*="mulai pembuatan"]',
                            'button:has-text("Buat")',
                            'button[aria-label*="Buat"]',
                            'button:has-text("Generate")',
                            'button[aria-label*="Generate"]',
                            'button:has-text("Create")',
                            'button[aria-label*="Create"]',
                            'button[aria-label*="Submit"]',
                            'button:has(mat-icon:has-text("arrow_forward"))',
                            'button:has(mat-icon:has-text("send"))',
                            'button:has(mat-icon:has-text("play_arrow"))',
                            'button.run-button',
                            'button.submit-button',
                            'button.send-button',
                        ];

                        for (const sel of submitCandidates) {
                            try {
                                const btn = page.locator(sel).first();
                                if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
                                    await btn.click({ force: true });
                                    log(`  🚀 Submit button clicked: ${sel}`);
                                    break;
                                }
                            } catch {}
                        }

                        log('  Generation started...');

                        const { found: resultFound, newSrcs, policyBlocked, unusualActivity } = await detectionPromise;

                        // ── Jika Google mendeteksi "unusual activity" (rate limit / bot detection) ──
                        if (unusualActivity) {
                            unusualRetryCount++;
                            if (unusualRetryCount > MAX_UNUSUAL_RETRIES) {
                                log(`  🛑 Google unusual activity persists after ${MAX_UNUSUAL_RETRIES} attempts. Skipping prompt to avoid infinite reload loop.\n`, 'WARN');
                                const blockedDir  = path.join(OUTPUT_DIR, 'failed');
                                const blockedFile = path.join(blockedDir, 'unusual_activity.txt');
                                try {
                                    if (!fs.existsSync(blockedDir)) fs.mkdirSync(blockedDir, { recursive: true });
                                    fs.appendFileSync(blockedFile, prompt + '\n', 'utf-8');
                                    log(`  📝 Prompt saved to failed/unusual_activity.txt`);
                                } catch { /* abaikan */ }
                                completed.add(prompt);
                                saveProgress(completed);
                                success = true;
                                break;
                            }

                            const cooldownMs = randomDelay(180000, 300000); // 3–5 menit cooldown
                            log(`  🛑 Google unusual activity detected (retry ${unusualRetryCount}/${MAX_UNUSUAL_RETRIES})! Cooling down for ${Math.round(cooldownMs / 60000)} minutes...`, 'WARN');
                            try { await page.waitForTimeout(cooldownMs); } catch { await new Promise(r => setTimeout(r, cooldownMs)); }
                            // Reload halaman setelah cooldown
                            try {
                                await page.reload({ waitUntil: 'load', timeout: timeoutMs });
                                await page.waitForTimeout(3000);
                                await setupNewProject(page);
                                promptInput = await waitForFlowReady(page, 60000);
                            } catch { /* lanjut retry */ }
                            continue; // ulang while loop
                        }

                        // ── Jika Google Flow memblokir prompt karena kebijakan konten ──
                        if (policyBlocked) {
                            policyRetryCount++;
                            log(`  🚫 Policy violation detected (retry ${policyRetryCount}/${MAX_POLICY_RETRIES}). Clearing and retrying prompt...`, 'WARN');

                            if (policyRetryCount >= MAX_POLICY_RETRIES) {
                                // Melebihi batas retry policy → catat dan skip
                                log(`  🚫 Policy block persists after ${MAX_POLICY_RETRIES} retries. Skipping prompt.\n`, 'WARN');
                                const blockedDir  = path.join(OUTPUT_DIR, 'failed');
                                const blockedFile = path.join(blockedDir, 'policy_blocked.txt');
                                try {
                                    if (!fs.existsSync(blockedDir)) fs.mkdirSync(blockedDir, { recursive: true });
                                    fs.appendFileSync(blockedFile, prompt + '\n', 'utf-8');
                                    log(`  📝 Blocked prompt saved to failed/policy_blocked.txt`);
                                } catch { /* abaikan */ }
                                completed.add(prompt);
                                saveProgress(completed);
                                success = true;
                                break;
                            }

                            // Bersihkan input dan tunggu sebelum retry
                            try {
                                await page.keyboard.press('Escape');
                                await page.waitForTimeout(500);
                                // Klik input & clear
                                await promptInput.click();
                                await page.waitForTimeout(300);
                                await page.keyboard.press('Control+a');
                                await page.waitForTimeout(200);
                                await page.keyboard.press('Delete');
                                await page.waitForTimeout(randomDelay(10000, 20000)); // Jeda 10-20s sebelum retry
                            } catch { /* lanjut */ }
                            continue; // ulang while loop (retry prompt yang sama)
                        }

                        // ── Tidak ada policy error: proses hasil generate ──
                        const timestamp = Date.now();
                        const safeName = prompt.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 40);
                        const baseName = `${safeName}_${timestamp}`;

                        if (resultFound) {
                            // ── Tunggu sebentar agar gambar fully rendered sebelum download ──
                            await page.waitForTimeout(1500);

                            // ── Download semua gambar SAMPAI SELESAI sebelum lanjut ──
                            log('  ⬇️  Mendownload gambar...');
                            const dlCount = await downloadAllNewImages(page, newSrcs, baseName, OUTPUT_DIR, imageSize);

                            if (dlCount > 0) {
                                log(`  ✅ ${dlCount} gambar didownload.\n`, 'SUCCESS');
                                completed.add(prompt);
                                saveProgress(completed);
                                success = true;
                                attemptSuccess = true;
                                break; // keluar dari while (policy retry) loop
                            }
                            if (attempt < maxRetries) {
                                log(`  ⚠️  Download gagal (attempt ${attempt}), mencoba lagi...\n`, 'WARN');
                            }
                        } else {
                            // Cek sekali lagi secara sinkron sebelum declare timeout
                            const finalCheck = await checkPolicyError(page);
                            if (finalCheck) {
                                policyRetryCount++;
                                log(`  🚫 Policy error confirmed on final check (retry ${policyRetryCount}/${MAX_POLICY_RETRIES})...`, 'WARN');
                                if (policyRetryCount >= MAX_POLICY_RETRIES) {
                                    log(`  🚫 Policy block persists. Skipping prompt.\n`, 'WARN');
                                    const blockedDir  = path.join(OUTPUT_DIR, 'failed');
                                    const blockedFile = path.join(blockedDir, 'policy_blocked.txt');
                                    try {
                                        if (!fs.existsSync(blockedDir)) fs.mkdirSync(blockedDir, { recursive: true });
                                        fs.appendFileSync(blockedFile, prompt + '\n', 'utf-8');
                                    } catch { /* abaikan */ }
                                    completed.add(prompt);
                                    saveProgress(completed);
                                    success = true;
                                    break;
                                }
                                // Jeda sebelum retry
                                try {
                                    await page.keyboard.press('Escape');
                                    await page.waitForTimeout(500);
                                    await promptInput.click();
                                    await page.waitForTimeout(300);
                                    await page.keyboard.press('Control+a');
                                    await page.waitForTimeout(200);
                                    await page.keyboard.press('Delete');
                                    await page.waitForTimeout(randomDelay(10000, 20000));
                                } catch { /* lanjut */ }
                                continue; // retry prompt dari while loop
                            }
                            log(`  ⚠️  Timeout on attempt ${attempt} — no images detected.\n`, 'WARN');
                        }

                        break; // keluar dari while loop jika tidak ada policy error
                    }

                    if (success || attemptSuccess) break; // keluar dari for (attempt) loop

                } catch (err) {
                    const msg = err.message || '';
                    const isFatalClosed = 
                        msg.includes('Target page, context or browser has been closed') || 
                        msg.includes('browser has been closed') || 
                        msg.includes('Browser closed') || 
                        msg.includes('Target closed') || 
                        msg.includes('connection closed') || 
                        msg.includes('Protocol error: Connection closed');
                    log(`  ❌ Attempt ${attempt} error: ${msg}`, 'ERROR');

                    if (isFatalClosed) {
                        const reallyDead = !await isContextAlive(context);
                        if (reallyDead) {
                            log('  🔄 Browser context is closed. Relaunching browser and retrying this prompt...', 'WARN');
                            try {
                                await initBrowser();
                            } catch (re) {
                                log(`  ❌ Relaunch failed: ${re.message}`, 'ERROR');
                                if (re.message.includes('relaunch')) throw re; // batas relaunch tercapai
                            }
                        } else {
                            log('  ℹ️ Browser context is still alive, skipping unnecessary relaunch.', 'INFO');
                        }
                    } else if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, randomDelay(3000, 6000)));
                    }
                }
            }

            if (!success) {
                log(`❌ Prompt "${prompt.substring(0, 40)}" failed after ${maxRetries} attempts.\n`, 'ERROR');
            }

            // Jeda antar prompt — durasi lebih lama dan natural (meniru jeda berpikir manusia)
            if (i < pending.length - 1) {
                // Basis: 8–20 detik. Setiap 5 prompt: tambah 10–30 detik "break panjang"
                let gap = randomDelay(8000, 20000);
                if ((i + 1) % 5 === 0) {
                    const longBreak = randomDelay(10000, 30000);
                    log(`☕ Taking a longer break (${Math.round((gap + longBreak) / 1000)}s after ${i + 1} prompts)...`);
                    gap += longBreak;
                } else {
                    log(`Delay ${Math.round(gap / 1000)}s before next prompt...`);
                }
                try { await page.waitForTimeout(gap); } catch { await new Promise(r => setTimeout(r, gap)); }
            }
        }

        const durationMs = Date.now() - runStartTime;
        const durationSec = Math.floor(durationMs / 1000);
        const min = Math.floor(durationSec / 60);
        const sec = durationSec % 60;
        const durationStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;

        log(`\n🎉 All prompts completed in ${durationStr}.`, 'SUCCESS');
        log(`📁 Images saved in: ${OUTPUT_DIR}`, 'SUCCESS');
        // Hapus file progress setelah semua selesai agar next run mulai dari awal
        try { fs.unlinkSync(PROGRESS_FILE); } catch {}

    } catch (error) {
        const durationMs = Date.now() - runStartTime;
        const durationSec = Math.floor(durationMs / 1000);
        const min = Math.floor(durationSec / 60);
        const sec = durationSec % 60;
        const durationStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
        log(`Fatal error after ${durationStr}: ${error.message}`, 'ERROR');
        log(`Progress saved. Restart the bot to resume unfinished prompts.`, 'WARN');
    } finally {
        log('Closing browser...');
        try { if (context) await context.close(); } catch {}
    }
}

runAutomation();