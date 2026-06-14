require('dotenv').config();
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
const DOWNLOADS_TEMP_DIR = path.join(__dirname, 'tmp_downloads');
const PROGRESS_FILE = path.join(OUTPUT_DIR, '.progress.json');


// Resolusi yang tersedia di Flow (sesuai screenshot)
// IMAGE_SIZE di .env menentukan opsi mana yang diklik di menu Flow
const RESOLUTION_LABELS = {
    '1k': ['1K', '1k', 'Ukuran asli', 'Original size', '1K\nUkuran asli'],
    '2k': ['2K', '2k', 'Resolusi ditingkatkan', 'Enhanced resolution'],
    '4k': ['4K', '4k'],
};
// ============================================================

function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
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
    const isHeadless = process.env.HEADLESS === 'true';

    log('Launching browser...');
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: isHeadless,
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        downloadsPath: DOWNLOADS_TEMP_DIR,
        acceptDownloads: true,
        args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-infobars',
            '--no-first-run',
            '--no-default-browser-check',
            // ── Anti background-tab throttling ──
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-ipc-flooding-protection',
            '--force-device-scale-factor=1',
        ],
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
    log('Checking "Agent" button in main input area...');
    await page.waitForTimeout(800);

    try {
        // Deteksi: Agen aktif jika ada tombol "Petunjuk Agen"
        const isAgenActive = await page.locator(
            'button:has-text("Petunjuk Agen"), button:has-text("Agent Instructions")'
        ).first().isVisible({ timeout: 3000 }).catch(() => false);

        // Tombol Agen toggle — pastikan bukan "Petunjuk Agen"
        const agenBtn = page.locator(
            'button:has-text("Agen"):not(:has-text("Petunjuk")), ' +
            'button:has-text("Agent"):not(:has-text("Instructions"))'
        ).first();
        const agenVisible = await agenBtn.isVisible({ timeout: 3000 }).catch(() => false);

        if (isAgenActive || agenVisible) {
            log(isAgenActive ? 'Agent is active. Turning off...' : 'Agent button visible. Clicking...');

            if (agenVisible) {
                await agenBtn.click();
                await page.waitForTimeout(1200);

                // Handle modal konfirmasi "Agen Anda aktif" jika muncul
                const okeBtn = page.locator('button:has-text("Oke"), button:has-text("OK")').first();
                if (await okeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    log('  Confirmation modal → clicking "OK"...');
                    await okeBtn.click();
                    await page.waitForTimeout(1000);
                    // Klik Agen lagi untuk benar-benar off
                    if (await agenBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                        await agenBtn.click();
                        await page.waitForTimeout(600);
                    }
                }
                log('✅ "Agent" button turned off.');
            }
        } else {
            log('ℹ️  "Agent" button inactive or not found.');
        }
    } catch (err) {
        log(`ℹ️  Failed to check Agent: ${err.message}`, 'WARN');
    }

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

async function fillPromptInput(page, inputLocator, text) {
    const isContentEditable = await inputLocator.evaluate(el => el.contentEditable === 'true');
    await inputLocator.click();
    await page.waitForTimeout(150);

    if (isContentEditable) {
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Delete');
        await page.waitForTimeout(200);
        await page.keyboard.type(text, { delay: randomDelay(20, 50) });
    } else {
        await inputLocator.click({ clickCount: 3 });
        await page.keyboard.press('Delete');
        await page.waitForTimeout(200);
        await inputLocator.pressSequentially(text, { delay: randomDelay(20, 50) });
    }
}

/**
 * Deteksi gambar baru via network response.
 * Return list elemen <img> baru yang muncul di DOM setelah generate.
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

        // ── KeepAlive: setiap 20s bring tab ke depan + emit fake activity ──
        // Ini mencegah Flow berhenti generate saat tab di-background
        const keepAliveInterval = setInterval(async () => {
            try {
                if (page.isClosed()) {
                    done(false);
                    return;
                }
                await page.bringToFront();
                // Emit synthetic mousemove agar browser tidak throttle page
                await page.mouse.move(640, 400);
            } catch { /* abaikan jika page sudah mati */ }
        }, 20000);

        const closeHandler = () => {
            log('  ⚡ Page was closed during image detection!', 'WARN');
            done(false);
        };
        page.on('close', closeHandler);

        const done = (found) => {
            clearTimeout(batchTimer);
            clearTimeout(globalTimer);
            clearInterval(progressInterval);
            clearInterval(keepAliveInterval);
            try {
                page.off('close', closeHandler);
                page.off('response', responseHandler);
            } catch { /* page already closed */ }
            resolve({ found, newSrcs: found ? collectedUrls : [] });
        };

        const globalTimer = setTimeout(() => {
            log('  ⏱️ Timeout waiting for images from server.');
            done(false);
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
                    batchTimer = setTimeout(() => done(true), 2000);
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
        await imgLocator.click({ button: 'right' });
        // Tunggu context menu muncul
        await page.waitForTimeout(800);

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
        await downloadMenuItem.hover({ force: true });
        // Tunggu submenu muncul — Flow butuh ~500-1000ms render submenu
        await page.waitForTimeout(1000);

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
                const resp = await page.request.get(resolvedDownloadUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
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

    await page.addInitScript(() => {
        // Anti-detection: sembunyikan webdriver
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

        // ── Spoof Page Visibility API ──
        // Agar Flow tidak tahu tab sedang di-background dan tidak berhenti generate
        Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
        // Blokir event visibilitychange agar Flow tidak merespons tab switch
        document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
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
    const promptsPath = path.join(__dirname, 'prompts.txt');
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
                    await fillPromptInput(page, promptInput, prompt);
                    await page.waitForTimeout(randomDelay(400, 700));

                    // Setup deteksi network SEBELUM Enter
                    const dlTimeoutMs = parseInt(process.env.DOWNLOAD_TIMEOUT_MS) || 300000;
                    const detectionPromise = setupImageDetection(page, srcsBefore, dlTimeoutMs);
                    await page.keyboard.press('Enter');
                    log('  Generation started...');

                    const { found: resultFound, newSrcs } = await detectionPromise;

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

            // Jeda antar prompt
            if (i < pending.length - 1) {
                const gap = randomDelay(2000, 4000);
                log(`Delay ${Math.round(gap / 1000)}s...`);
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