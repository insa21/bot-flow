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
const FLOW_URL = 'https://labs.google/fx/tools/flow';
const PROMPT_INPUT_SELECTOR = '[contenteditable="true"]';

const NEW_CONVERSATION_CANDIDATES = [
    'button[aria-label*="New"]',
    'button[aria-label*="new"]',
    'button[aria-label*="Reset"]',
    'button[aria-label*="Clear"]',
    '[data-testid*="new"]',
    '[title*="New"]',
    'a[href*="flow"]:not([href*="?"])',
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
        const pages = context.pages();
        if (pages.length === 0) return true; // context ada, belum ada page
        await pages[0].evaluate(() => true);
        return true;
    } catch {
        return false;
    }
}

// ── Launch browser baru (bisa dipanggil ulang saat crash) ──
async function launchBrowser() {
    killExistingChrome();
    await new Promise(r => setTimeout(r, 2000));

    const userDataDir = process.env.USER_DATA_DIR || './browser_session';
    const isHeadless  = process.env.HEADLESS === 'true';

    // ── Deteksi Chrome asli yang terinstall di sistem ──────────────────────────
    // Playwright bawaan menggunakan Chromium "testing build" yang langsung dikenali
    // Google sebagai automation browser. Gunakan Chrome asli agar fingerprint cocok.
    const CHROME_PATH = process.env.CHROME_EXECUTABLE_PATH
        || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

    // ── Versi HARUS cocok dengan binary Chrome yang dijalankan ─────────────────
    // Cek versi Chrome yang terinstall: 149.0.7827.156
    const CHROME_VERSION  = '149.0.7827.156';
    const CHROME_MAJOR    = '149';
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
            '--no-sandbox',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-default-apps',
            // ── Anti background-tab throttling ──
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-ipc-flooding-protection',
            '--force-device-scale-factor=1',
            // ── Kurangi noise & fingerprint ──
            '--disable-features=TranslateUI,AutofillServerCommunication,Translate',
            '--disable-infobars',
            '--lang=en-US',
            '--metrics-recording-only',
            '--disable-breakpad',
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

// ── Buat proyek baru, tutup panel "Sesi tanpa judul", matikan Agen ──────────
async function setupNewProject(page) {

    // ── Langkah 1: Klik tombol "Project baru" ──────────────────────────────────
    log('Creating a new project in Flow...');
    const newProjectCandidates = [
        'button:has-text("Project baru")',
        'button:has-text("Proyek baru")',
        'button:has-text("New project")',
        'button:has-text("New Project")',
        '[data-testid*="new-project"]',
        'button[aria-label*="Project baru"]',
    ];
    const newProjectBtn = await findFirstVisible(page, newProjectCandidates, 6000);
    if (newProjectBtn) {
        await newProjectBtn.click();
        log('✅ "New project" button clicked.');
        try {
            await page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch { /* lanjut */ }
        await page.waitForTimeout(2500);
    } else {
        log('ℹ️  "New project" button not found, proceeding...', 'WARN');
    }

    // ── Langkah 2: Tunggu panel muncul, lalu tutup dengan scoped selector ──────
    // Panel "Sesi tanpa judul" adalah sidebar bukan dialog.
    // Tombol ✕ adalah SATU-SATUNYA button dengan teks "close" + "Tutup" di header panel.
    log('Waiting for "Untitled session" panel to appear...');

    let panelLocator = null;
    try {
        // Tunggu teks "Sesi tanpa judul" muncul di DOM (max 8 detik)
        await page.waitForSelector('text="Sesi tanpa judul"', { timeout: 8000, state: 'visible' });
        // Ambil elemen kontainer terdekat yang mengandung teks tersebut
        panelLocator = page.locator('div').filter({ hasText: /^Sesi tanpa judul$/ }).last();
        log('"Untitled session" panel detected.');
    } catch {
        // Coba versi Inggris
        try {
            await page.waitForSelector('text="Untitled session"', { timeout: 3000, state: 'visible' });
            panelLocator = page.locator('div').filter({ hasText: /^Untitled session$/ }).last();
            log('"Untitled session" panel detected.');
        } catch {
            log('ℹ️  Session panel not detected, proceeding...', 'WARN');
        }
    }

    if (panelLocator) {
        // Cari tombol close yang paling dekat: naik ke ancestor yang berisi tombol
        // Struktur: header row → ☰ "Sesi tanpa judul" ↗ ✕
        // Tombol ✕ memiliki teks gabungan "close" (icon) + "Tutup"
        let panelClosed = false;

        // Metode 1: getByRole scoped — cari button bernama "Tutup" atau "Close"
        try {
            const closeBtn = page.getByRole('button', { name: /^(Tutup|Close)$/i });
            const count = await closeBtn.count();
            for (let i = 0; i < count; i++) {
                const btn = closeBtn.nth(i);
                if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
                    await btn.click();
                    await page.waitForTimeout(800);
                    panelClosed = true;
                    log('✅ Panel closed via getByRole("button", {name: Tutup/Close}).');
                    break;
                }
            }
        } catch { /* lanjut ke metode berikutnya */ }

        // Metode 2: Cari tombol yang berisi KEDUANYA "close" DAN "Tutup"
        if (!panelClosed) {
            try {
                const closeBtns = page.locator('button').filter({ hasText: 'Tutup' });
                const count = await closeBtns.count();
                for (let i = 0; i < count; i++) {
                    const btn = closeBtns.nth(i);
                    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
                        await btn.click();
                        await page.waitForTimeout(800);
                        panelClosed = true;
                        log('✅ Panel closed via button.filter(hasText: Tutup/Close).');
                        break;
                    }
                }
            } catch { /* lanjut */ }
        }

        // Verifikasi apakah panel benar-benar sudah tertutup
        await page.waitForTimeout(500);
        const panelStillVisible = await page.locator('text="Sesi tanpa judul"').isVisible({ timeout: 1500 }).catch(() => false);

        if (panelStillVisible) {
            log('⚠️  Panel is still open! Trying Escape...', 'WARN');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(800);

            // Cek sekali lagi setelah Escape
            const stillOpen = await page.locator('text="Sesi tanpa judul"').isVisible({ timeout: 1500 }).catch(() => false);
            if (!stillOpen) {
                log('✅ Panel closed via Escape.');
            } else {
                log('⚠️  Panel could not be closed.', 'WARN');
            }
        } else {
            log('✅ "Untitled session" panel is no longer in DOM.');
        }
    }

    // ── Langkah 3: Matikan tombol "Agen" di area input utama ───────────────────
    // Hanya lakukan SETELAH panel tertutup supaya tidak match tombol di dalam panel
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
 * Mengetik teks dengan pola yang lebih menyerupai manusia:
 * - Delay per karakter 80–200ms (rata-rata manusia ~120ms)
 * - Sesekali ada burst cepat (saat mengetik kata umum)
 * - Sesekali ada micro-pause antar kata (50–300ms ekstra)
 * - Tidak ada interval yang terlalu seragam
 */
async function humanType(page, text) {
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        // Karakter spasi/tanda baca → pause lebih lama (jeda berpikir antar kata)
        let charDelay;
        if (ch === ' ') {
            charDelay = randomDelay(80, 220);
            // 20% chance: micro-pause ekstra setelah spasi (seperti berpikir)
            if (Math.random() < 0.20) charDelay += randomDelay(100, 400);
        } else if (/[.,!?;:]/.test(ch)) {
            charDelay = randomDelay(120, 300);
        } else {
            // Burst typing: 15% chance karakter sangat cepat (jari sudah posisi)
            charDelay = Math.random() < 0.15 ? randomDelay(30, 80) : randomDelay(80, 180);
        }
        await page.keyboard.type(ch, { delay: 0 }); // type dulu
        await new Promise(r => setTimeout(r, charDelay)); // baru delay
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
        await humanType(page, text);
    } else {
        await inputLocator.click({ clickCount: 3 });
        await page.waitForTimeout(randomDelay(100, 200));
        await page.keyboard.press('Delete');
        await page.waitForTimeout(randomDelay(150, 300));
        await humanType(page, text);
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
 * Deteksi gambar baru via network response.
 * Return { found, newSrcs, policyBlocked }
 */
function setupImageDetection(page, srcsBefore, maxWaitMs) {
    return new Promise((resolve) => {
        const collectedUrls = [];
        let batchTimer = null;
        const start = Date.now();

        // ── Progress log setiap 15s ──
        const progressInterval = setInterval(() => {
            const elapsed = Math.round((Date.now() - start) / 1000);
            log(`  Waiting for generation... ${elapsed}s`);
        }, 15000);

        // ── Polling cek error kebijakan setiap 4 detik ──
        // Jauh lebih cepat dari menunggu timeout (300 detik)
        const policyCheckInterval = setInterval(async () => {
            try {
                if (page.isClosed()) return;
                const isBlocked = await checkPolicyError(page);
                if (isBlocked) {
                    log('  🚫 Policy violation detected! Skipping this prompt...', 'WARN');
                    done(false, true);
                }
            } catch { /* abaikan */ }
        }, 4000);

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
        const done = (found, blocked = false) => {
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
            resolve({ found, newSrcs: found ? collectedUrls : [], policyBlocked: blocked });
        };

        const globalTimer = setTimeout(() => {
            log('  ⏱️ Timeout waiting for images from server.');
            done(false, false);
        }, maxWaitMs);

        const responseHandler = (response) => {
            try {
                const url = response.url();
                if (
                    url.includes('media.getMediaUrlRedirect') &&
                    !srcsBefore.includes(url) &&
                    !collectedUrls.includes(url)
                ) {
                    collectedUrls.push(url);
                    log(`  📸 Image ${collectedUrls.length} detected via network!`);
                    clearTimeout(batchTimer);
                    batchTimer = setTimeout(() => done(true, false), 2000);
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
    const ctxMenuTimeout = parseInt(process.env.CONTEXT_MENU_TIMEOUT_MS) || 15000;
    const downloadTimeout = parseInt(process.env.DOWNLOAD_TIMEOUT_MS) || 300000;

    try {
        // Pastikan gambar visible dan scroll ke view
        await imgLocator.waitFor({ state: 'visible', timeout: 10000 });
        await imgLocator.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);

        // ── Langkah 1: Klik kanan pada gambar untuk memunculkan context menu ──
        // Restore window jika minimized + bringToFront agar menu muncul
        await restoreWindow(page);
        await page.bringToFront();
        log('  🖱️  Right click on image...');
        // Gerak mouse ke gambar secara organik sebelum klik kanan
        try {
            const box = await imgLocator.boundingBox();
            if (box) {
                const tx = Math.round(box.x + box.width  * (0.25 + Math.random() * 0.5));
                const ty = Math.round(box.y + box.height * (0.25 + Math.random() * 0.5));
                await humanMove(page, tx, ty);
                await new Promise(r => setTimeout(r, randomDelay(100, 250)));
            }
        } catch { /* lanjut */ }
        await imgLocator.click({ button: 'right' });
        // Tunggu context menu muncul (variasi timing natural)
        await page.waitForTimeout(randomDelay(600, 1100));

        // ── Langkah 2: Cari item "Download" di context menu dengan selector yang lebih presisi ──
        // Urutan selector dari yang paling spesifik ke paling umum
        const downloadMenuSelectors = [
            // Role-based (paling akurat)
            '[role="menuitem"]:has-text("Download")',
            '[role="option"]:has-text("Download")',
            // Tag-based
            'li[class*="menu"]:has-text("Download")',
            'li:has-text("Download")',
            // Button
            'button:has-text("Download")',
            // Div leaf-node (tidak punya child div dengan teks Download)
            'div[class*="item"]:has-text("Download")',
            'div[class*="menu"]:has-text("Download")',
            // Fallback paling umum
            'span:has-text("Download")',
        ];

        let downloadMenuItem = null;
        for (const sel of downloadMenuSelectors) {
            try {
                // Pakai filter visible agar tidak menangkap elemen tersembunyi
                const candidates = page.locator(sel).filter({ hasText: /^Download$|Download/ });
                const count = await candidates.count();
                if (count > 0) {
                    // Pilih yang visible
                    for (let ci = 0; ci < count; ci++) {
                        const el = candidates.nth(ci);
                        if (await el.isVisible()) {
                            downloadMenuItem = el;
                            break;
                        }
                    }
                    if (downloadMenuItem) {
                        log(`  📋 "Download" menu found via: ${sel}`);
                        break;
                    }
                }
            } catch { /* coba selector berikutnya */ }
        }

        if (!downloadMenuItem) {
            log('  ⚠️  "Download" menu not found after right click.', 'WARN');
            await page.keyboard.press('Escape');
            return false;
        }

        // ── Langkah 3: Hover item "Download" untuk memunculkan submenu resolusi ──
        log('  🖱️  Hovering over "Download" to open resolution submenu...');
        // Gerak mouse ke item Download secara organik
        try {
            const box = await downloadMenuItem.boundingBox();
            if (box) {
                const tx = Math.round(box.x + box.width  * (0.2 + Math.random() * 0.6));
                const ty = Math.round(box.y + box.height * (0.2 + Math.random() * 0.6));
                await humanMove(page, tx, ty);
            }
        } catch { /* fallback ke hover biasa */ }
        await downloadMenuItem.hover({ force: true });
        // Tunggu submenu muncul — variasi natural
        await page.waitForTimeout(randomDelay(700, 1300));

        // ── Langkah 4: Cari dan klik opsi resolusi target (misal "2K") ──
        log(`  🔍 Searching for resolution option "${imageSize.toUpperCase()}" in submenu...`);
        let resolutionItem = null;

        for (const label of targetLabels) {
            const candidates = [
                // Role-based
                `[role="menuitem"]:has-text("${label}")`,
                `[role="option"]:has-text("${label}")`,
                // Tidak Upgrade (4K terkunci)
                `li:has-text("${label}"):not(:has-text("Upgrade"))`,
                // Div / span
                `div[class*="item"]:has-text("${label}")`,
                `span:has-text("${label}")`,
            ];

            for (const sel of candidates) {
                try {
                    const els = page.locator(sel);
                    const cnt = await els.count();
                    for (let ci = 0; ci < cnt; ci++) {
                        const el = els.nth(ci);
                        if (await el.isVisible()) {
                            resolutionItem = el;
                            log(`  ✅ Option "${label}" found via: ${sel}`);
                            break;
                        }
                    }
                    if (resolutionItem) break;
                } catch { /* coba berikutnya */ }
            }
            if (resolutionItem) break;
        }

        if (!resolutionItem) {
            log(`  ⚠️  Resolution option "${imageSize.toUpperCase()}" not found in submenu.`, 'WARN');
            await page.keyboard.press('Escape');
            return false;
        }

        // ── Langkah 5: Intercept URL download SEBELUM klik resolusi ──
        // Strategi: tangkap URL final dari request yang dipicu klik "2K",
        // lalu fetch langsung — tanpa saveAs, tanpa dialog, 100% background-safe.
        log(`  ⏳ Waiting for download URL (timeout: ${Math.round(downloadTimeout / 1000)}s)...`);

        let resolvedDownloadUrl = null;

        // Intercept via 'requestfinished' — tangkap URL setelah semua redirect selesai
        const requestHandler = async (request) => {
            try {
                const url = request.url();
                const resourceType = request.resourceType();
                // Flow mengirim file gambar sebagai 'document' atau 'other' saat download
                if (
                    resourceType !== 'script' &&
                    resourceType !== 'stylesheet' &&
                    resourceType !== 'image' &&
                    (
                        url.includes('ggpht.com') ||
                        url.includes('googleusercontent.com') ||
                        url.includes('lh3.google') ||
                        url.includes('export') ||
                        url.includes('media.getMediaUrlRedirect') ||
                        /\.(png|jpg|jpeg|webp)/i.test(url)
                    )
                ) {
                    resolvedDownloadUrl = url;
                }
            } catch { /* abaikan */ }
        };

        // Juga intercept Playwright download event sebagai backup
        const downloadPromise = page.waitForEvent('download', { timeout: downloadTimeout }).catch(() => null);
        page.on('requestfinished', requestHandler);

        // ── Langkah 6: Klik opsi resolusi — ini memicu download ──
        await resolutionItem.click();
        log(`  🖱️  Clicking "${imageSize.toUpperCase()}" — waiting for download...`);

        // Tunggu sebentar agar request sempat ditangkap
        await page.waitForTimeout(3000);
        page.off('requestfinished', requestHandler);

        // ── Metode A: Fetch langsung dari URL yang diintercept (tidak butuh saveAs) ──
        if (resolvedDownloadUrl) {
            try {
                log(`  🔗 Fetching file from: ${resolvedDownloadUrl.substring(0, 80)}...`);
                // Header lengkap menyerupai browser Chrome asli
                const resp = await page.request.get(resolvedDownloadUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.156 Safari/537.36',
                        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not/A)Brand";v="99"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"Windows"',
                        'sec-fetch-dest': 'image',
                        'sec-fetch-mode': 'no-cors',
                        'sec-fetch-site': 'cross-site',
                        'Referer': 'https://labs.google/',
                    },
                    timeout: downloadTimeout,
                });
                if (resp.ok()) {
                    const body = await resp.body();
                    if (body.length > 10000) { // minimal 10KB untuk validasi bukan error page
                        fs.writeFileSync(filePath, body);
                        log(`  ✅ Download completed via direct fetch (${imageSize.toUpperCase()}): ${path.basename(filePath)}`, 'SUCCESS');
                        return true;
                    }
                }
            } catch (fetchErr) {
                log(`  ⚠️  Direct fetch failed: ${fetchErr.message}`, 'WARN');
            }
        }

        // ── Metode B: Playwright download event + saveAs sebagai fallback ──
        const download = await downloadPromise;
        if (download) {
            log(`  💾 Fallback saveAs: ${path.basename(filePath)}`);
            // Tunggu file temp benar-benar ada sebelum saveAs
            for (let wi = 0; wi < 10; wi++) {
                try {
                    await download.saveAs(filePath);
                    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
                        log(`  ✅ Download completed via saveAs (${imageSize.toUpperCase()}): ${path.basename(filePath)}`, 'SUCCESS');
                        return true;
                    }
                } catch { /* retry */ }
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // ── Fallback Metode C: dari resolvedDownloadUrl yang sudah di-intercept ──
        if (resolvedDownloadUrl) {
            log(`  🔗 Fallback: re-fetching from previously intercepted URL...`);
            try {
                const resp = await page.request.get(resolvedDownloadUrl);
                if (resp.ok()) {
                    const body = await resp.body();
                    if (body.length > 10000) {
                        fs.writeFileSync(filePath, body);
                        if (fs.statSync(filePath).size > 0) {
                            log(`  ✅ Download completed via re-fetching intercepted URL: ${path.basename(filePath)}`, 'SUCCESS');
                            return true;
                        }
                    }
                }
            } catch (fetchErr) {
                log(`  ⚠️  Failed to re-fetch from intercepted URL: ${fetchErr.message}`, 'WARN');
            }
        }

        log('  ⚠️  Download event not detected after clicking resolution option.', 'WARN');
        return false;

    } catch (err) {
        log(`  ❌ Error during menu download: ${err.message}`, 'ERROR');
        // Pastikan menu tertutup
        try { await page.keyboard.press('Escape'); } catch {}
        return false;
    }
}

/**
 * Fallback: download langsung dari URL network response (tanpa menu).
 * Dipakai jika simulasi klik menu gagal.
 */
async function downloadImageDirect(page, src, filePath) {
    if (src.startsWith('blob:')) {
        const base64 = await page.evaluate(async (blobUrl) => {
            const response = await fetch(blobUrl);
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }, src);
        fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
        return true;
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
        const response = await page.request.get(src);
        if (response.ok()) {
            fs.writeFileSync(filePath, await response.body());
            return true;
        }
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
async function downloadAllNewImages(page, newSrcs, baseName, outputDir, imageSize, prompt) {
    if (newSrcs.length === 0) return 0;

    const failedDir = path.join(outputDir, 'failed');
    if (!fs.existsSync(failedDir)) fs.mkdirSync(failedDir, { recursive: true });
    const failedTxtPath = path.join(failedDir, 'failed.txt');
    let anyFailed = false; // flag: ada gambar yang masuk folder failed?

    const sizeSuffix = (!imageSize || imageSize.toLowerCase() === 'native')
        ? ''
        : `_${imageSize.toLowerCase()}`;

    let downloaded = 0;

    for (let i = 0; i < newSrcs.length; i++) {
        const src = newSrcs[i];
        // Path utama: folder output normal (hanya jika 2K/4K berhasil)
        const filePath       = path.join(outputDir, `${baseName}${sizeSuffix}_${i + 1}.png`);
        // Path fallback: folder failed (jika resolusi target gagal)
        const failedFilePath = path.join(failedDir,  `${baseName}_native_${i + 1}.png`);
        log(`  Downloading image ${i + 1}/${newSrcs.length} via Flow menu...`);

        // ── Cari elemen <img> yang cocok dengan src hasil deteksi network ──
        // Strategi berlapis karena URL di DOM bisa sedikit berbeda dari URL network response
        let imgLocator = null;

        // Strategi 1: Exact match src
        const exactMatch = page.locator(`img[src="${src}"]`);
        if (await exactMatch.count() > 0) {
            imgLocator = exactMatch.first();
            log(`  🎯 Image found via exact src match.`);
        }

        // Strategi 2: Partial URL match (ambil bagian unik dari URL)
        if (!imgLocator) {
            try {
                const urlObj = new URL(src);
                // Pakai pathname atau sebagian query string yang unik
                const partialKey = urlObj.pathname.split('/').filter(Boolean).pop() || '';
                if (partialKey && partialKey.length > 5) {
                    const partialMatch = page.locator(`img[src*="${partialKey}"]`);
                    if (await partialMatch.count() > 0) {
                        imgLocator = partialMatch.first();
                        log(`  🎯 Image found via partial URL: ...${partialKey}`);
                    }
                }
            } catch { /* URL parsing gagal, skip */ }
        }

        // Strategi 3: Ambil gambar visible terakhir yang baru muncul di halaman
        // (Flow selalu append gambar baru di bawah)
        if (!imgLocator) {
            try {
                // Cari semua img yang visible dan bukan icon kecil (width > 100)
                const allImgs = page.locator('img').filter({ hasNotText: '' });
                const imgCount = await allImgs.count();
                for (let ci = imgCount - 1; ci >= Math.max(0, imgCount - 6); ci--) {
                    const el = allImgs.nth(ci);
                    if (await el.isVisible()) {
                        const box = await el.boundingBox();
                        if (box && box.width > 100 && box.height > 100) {
                            imgLocator = el;
                            log(`  🎯 Image found via last-visible fallback (index ${ci}).`);
                            break;
                        }
                    }
                }
            } catch { /* skip */ }
        }

        let ok = false;

        if (imgLocator && imageSize && imageSize.toLowerCase() !== 'native') {
            // ── Utama: Simulasi klik kanan → Download → resolusi target ──
            ok = await downloadViaFlowMenu(page, imgLocator, imageSize, filePath);
        }

        if (!ok) {
            // ── Fallback: download langsung ke folder FAILED (bukan folder utama) ──
            log(`  ↩️  Download ${imageSize.toUpperCase()} failed — saving native to failed/ folder...`);
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    ok = await downloadImageDirect(page, src, failedFilePath);
                    if (ok) {
                        const stat = fs.statSync(failedFilePath);
                        const kb = Math.round(stat.size / 1024);
                        log(`  📂 Saved in failed/ (${kb} KB): ${path.basename(failedFilePath)}`, 'WARN');
                        anyFailed = true;
                        break;
                    }
                    if (attempt < 2) await page.waitForTimeout(2000);
                } catch (err) {
                    if (attempt < 2) await page.waitForTimeout(2000);
                    else log(`  ❌ Fallback download error: ${err.message}`, 'ERROR');
                }
            }
            // Gambar failed TIDAK dihitung sebagai sukses di folder utama
            continue;
        }

        if (ok) {
            const stat = fs.statSync(filePath);
            const kb = Math.round(stat.size / 1024);
            log(`  ✅ Saved ${imageSize.toUpperCase()} (${kb} KB): ${path.basename(filePath)}`, 'SUCCESS');
            downloaded++;
        } else {
            log(`  ⚠️  Failed to download image ${i + 1} (all methods failed)`, 'WARN');
        }
    }

    // Jika ada gambar yang masuk folder failed/, catat prompt-nya sekali ke failed.txt
    if (anyFailed && prompt) {
        try {
            fs.appendFileSync(failedTxtPath, prompt + '\n', 'utf-8');
            log(`  📝 Prompt recorded in failed/failed.txt`);
        } catch { /* abaikan */ }
    }

    return downloaded;
}

// ============================================================
//  PAGE SETUP
// ============================================================
async function isPageAlive(page) {
    try {
        await page.evaluate(() => true);
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
    const timeoutMs  = parseInt(process.env.TIMEOUT_MS)  || 60000;
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

                    // Setup deteksi network SEBELUM Enter
                    const dlTimeoutMs = parseInt(process.env.DOWNLOAD_TIMEOUT_MS) || 300000;
                    const detectionPromise = setupImageDetection(page, srcsBefore, dlTimeoutMs);
                    await page.keyboard.press('Enter');
                    log('  Generation started...');

                    const { found: resultFound, newSrcs, policyBlocked } = await detectionPromise;

                    // ── Jika Google Flow memblokir prompt karena kebijakan konten ──
                    if (policyBlocked) {
                        log(`  🚫 Prompt blocked by Google policy. Skipping...\n`, 'WARN');
                        // Catat prompt yang diblokir ke file
                        const blockedDir  = path.join(OUTPUT_DIR, 'failed');
                        const blockedFile = path.join(blockedDir, 'policy_blocked.txt');
                        try {
                            if (!fs.existsSync(blockedDir)) fs.mkdirSync(blockedDir, { recursive: true });
                            fs.appendFileSync(blockedFile, prompt + '\n', 'utf-8');
                            log(`  📝 Blocked prompt saved to failed/policy_blocked.txt`);
                        } catch { /* abaikan */ }
                        // Tandai sebagai "selesai" agar tidak diulang saat resume
                        completed.add(prompt);
                        saveProgress(completed);
                        success = true; // keluar dari retry loop
                        break;
                    }

                    const timestamp = Date.now();
                    const safeName = prompt.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 40);
                    const baseName = `${safeName}_${timestamp}`;

                    if (resultFound) {
                        await page.waitForTimeout(1500);
                        const dlCount = await downloadAllNewImages(page, newSrcs, baseName, OUTPUT_DIR, imageSize, prompt);
                        if (dlCount > 0) {
                            log(`  ✅ ${dlCount} images downloaded to main folder.\n`, 'SUCCESS');
                            completed.add(prompt);
                            saveProgress(completed);
                            success = true;
                            break;
                        }
                        if (attempt < maxRetries) {
                            log(`  ⚠️  Download ${imageSize.toUpperCase()} failed (attempt ${attempt}), retrying...\n`, 'WARN');
                        }
                    } else {
                        // Cek sekali lagi secara sinkron sebelum declare timeout
                        const finalCheck = await checkPolicyError(page);
                        if (finalCheck) {
                            log(`  🚫 Policy error confirmed on final check. Skipping prompt...\n`, 'WARN');
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
                        log(`  ⚠️  Timeout on attempt ${attempt} — no images detected.\n`, 'WARN');
                    }

                } catch (err) {
                    const msg = err.message || '';
                    const isCtxDead = 
                        msg.includes('closed') || 
                        msg.includes('Target page') || 
                        msg.includes('browser has been closed') || 
                        msg.includes('context') ||
                        msg.includes('connection closed') ||
                        msg.includes('Protocol error');
                    log(`  ❌ Attempt ${attempt} error: ${msg}`, 'ERROR');

                    if (isCtxDead) {
                        log('  🔄 Context/browser dead (possibly closed by user). Relaunching browser and retrying this prompt...', 'WARN');
                        try {
                            await initBrowser();
                            attempt--; // Decrement attempt to retry the same prompt attempt
                        } catch (re) {
                            log(`  ❌ Relaunch failed: ${re.message}`, 'ERROR');
                            if (re.message.includes('relaunch')) throw re; // batas relaunch tercapai
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