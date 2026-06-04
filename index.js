require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sharp = require('sharp');
const { log } = require('./utils/logger');

// ============================================================
//  KONFIGURASI
// ============================================================
const FLOW_URL = 'https://labs.google/fx/tools/flow';

// ✅ Dikonfirmasi: Google Flow pakai div[contenteditable]
const PROMPT_INPUT_SELECTOR = '[contenteditable="true"]';

// Kandidat tombol New Conversation / Reset sesi lama
// Ini mencegah agen Flow dari sesi sebelumnya masih aktif
const NEW_CONVERSATION_CANDIDATES = [
    'button[aria-label*="New"]',
    'button[aria-label*="new"]',
    'button[aria-label*="Reset"]',
    'button[aria-label*="Clear"]',
    '[data-testid*="new"]',
    '[title*="New"]',
    'a[href*="flow"]:not([href*="?"])', // link ke halaman flow baru
];

const OUTPUT_DIR = path.join(__dirname, 'output');

// Peta resolusi output gambar (pixels)
// Digunakan bersama setting IMAGE_SIZE di file .env
const RESOLUTION_MAP = {
    '1k': 1024,   // 1024 x 1024 px
    '2k': 2048,   // 2048 x 2048 px
    '4k': 4096,   // 4096 x 4096 px
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

/**
 * Tunggu elemen tertentu muncul dan visible, lalu kembalikan locatornya.
 */
async function waitForElement(page, selector, timeoutMs = 10000) {
    try {
        const locator = page.locator(selector).first();
        await locator.waitFor({ state: 'visible', timeout: timeoutMs });
        return locator;
    } catch {
        return null;
    }
}

/**
 * Coba beberapa selector, kembalikan yang pertama visible.
 */
async function findFirstVisible(page, candidates, timeoutMs = 3000) {
    for (const selector of candidates) {
        const el = await waitForElement(page, selector, timeoutMs);
        if (el) return el;
    }
    return null;
}

/**
 * Reset sesi Flow agar agen lama tidak aktif.
 * Jika tombol New ditemukan: klik, tunggu halaman siap, kembalikan promptInput baru.
 * Jika tidak ditemukan: JANGAN reload — lanjutkan dengan sesi yang sudah ada.
 * Return: promptInput setelah reset (atau null jika tidak perlu reset).
 */
async function resetFlowSession(page, existingInput, timeoutMs) {
    const newBtn = await findFirstVisible(page, NEW_CONVERSATION_CANDIDATES, 2000);
    if (newBtn) {
        log('Menemukan tombol New, mengklik untuk memulai sesi bersih...');
        await newBtn.click();

        // Tunggu halaman baru siap setelah klik New
        try {
            await page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch { /* lanjut */ }
        await page.waitForTimeout(2000);

        // Cari ulang input prompt di halaman yang sudah di-reset
        const freshInput = await waitForFlowReady(page, 45000);
        return freshInput || existingInput; // fallback ke input lama jika tidak ketemu
    }

    // Tombol New tidak ada — halaman sudah bersih, pakai input yang ada
    log('Sesi sudah bersih, melanjutkan...');
    return existingInput;
}

/**
 * Tunggu halaman Flow siap (kotak input muncul).
 * Lebih cepat dari fixed delay — langsung lanjut saat elemen ready.
 * Maksimal menunggu maxWaitMs (default 60 detik).
 */
async function waitForFlowReady(page, maxWaitMs = 60000) {
    log('Menunggu halaman Flow siap...');
    const input = await waitForElement(page, PROMPT_INPUT_SELECTOR, maxWaitMs);
    if (input) {
        log('✅ Halaman siap!');
        return input;
    }
    return null;
}

/**
 * Hitung jumlah gambar di halaman (untuk deteksi gambar baru setelah generate).
 */
async function countImages(page) {
    return page.evaluate(() => document.querySelectorAll('img').length);
}

/**
 * Isi kotak prompt (contenteditable div).
 */
async function fillPromptInput(page, inputLocator, text) {
    const isContentEditable = await inputLocator.evaluate(el => el.contentEditable === 'true');

    await inputLocator.click();
    await page.waitForTimeout(150);

    if (isContentEditable) {
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Delete');
        await page.waitForTimeout(200);
        // Ketik cepat tapi masih terlihat natural
        await page.keyboard.type(text, { delay: randomDelay(20, 50) });
    } else {
        await inputLocator.click({ clickCount: 3 });
        await page.keyboard.press('Delete');
        await page.waitForTimeout(200);
        await inputLocator.pressSequentially(text, { delay: randomDelay(20, 50) });
    }
}

/**
 * Deteksi gambar baru via network response — JAUH lebih cepat dari polling.
 * HARUS dipanggil SEBELUM menekan Enter agar tidak ada response yang terlewat.
 * Return Promise yang resolve saat gambar baru diterima, atau timeout.
 */
function setupImageDetection(page, srcsBefore, maxWaitMs) {
    return new Promise((resolve) => {
        const collectedUrls = [];
        let batchTimer = null;
        const start = Date.now();

        // Log progres setiap 15 detik agar user tahu masih berjalan
        const progressInterval = setInterval(() => {
            const elapsed = Math.round((Date.now() - start) / 1000);
            log(`  Menunggu generate... ${elapsed}s`);
        }, 15000);

        const done = (found) => {
            clearTimeout(batchTimer);
            clearTimeout(globalTimer);
            clearInterval(progressInterval);
            page.off('response', responseHandler);
            resolve({ found, newSrcs: found ? collectedUrls : [] });
        };

        // Timeout global: cold start bisa sampai 2-3 menit
        const globalTimer = setTimeout(() => {
            log('  ⏱️ Timeout menunggu gambar dari server.');
            done(false);
        }, maxWaitMs);

        const responseHandler = (response) => {
            try {
                const url = response.url();
                // Hanya tangkap URL gambar hasil generate yang benar-benar baru
                if (
                    url.includes('media.getMediaUrlRedirect') &&
                    !srcsBefore.includes(url) &&
                    !collectedUrls.includes(url)
                ) {
                    collectedUrls.push(url);
                    log(`  📸 Gambar ${collectedUrls.length} terdeteksi via network!`);

                    // Tunggu 2 detik: mungkin ada gambar lagi dalam satu batch
                    clearTimeout(batchTimer);
                    batchTimer = setTimeout(() => done(true), 2000);
                }
            } catch {
                // Abaikan error pada response handler
            }
        };

        page.on('response', responseHandler);
    });
}


/**
 * Download satu gambar:
 * - blob:  → FileReader di browser
 * - data:  → decode base64
 * - https: → page.request.get() (membawa cookie sesi Google)
 */
async function downloadImage(page, src, filePath) {
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
        // page.request.get() otomatis membawa cookie sesi Google
        const response = await page.request.get(src);
        if (response.ok()) {
            const buffer = await response.body();
            fs.writeFileSync(filePath, buffer);
            return true;
        }
        log(`  HTTP ${response.status()} untuk: ${src.substring(0, 70)}`, 'WARN');
        return false;
    }

    return false;
}

/**
 * Download semua gambar baru. Return jumlah yang berhasil.
 */
/**
 * Resize gambar ke resolusi target menggunakan sharp.
 * imageSize: 'native' | '1k' | '2k' | '4k'
 * Jika 'native', tidak ada proses resize.
 * Output disimpan ke filePath yang sama (overwrite).
 */
async function resizeImage(filePath, imageSize) {
    if (!imageSize || imageSize.toLowerCase() === 'native') return false;

    const targetPx = RESOLUTION_MAP[imageSize.toLowerCase()];
    if (!targetPx) {
        log(`  ⚠️  IMAGE_SIZE "${imageSize}" tidak dikenal. Gunakan: native, 1k, 2k, atau 4k.`, 'WARN');
        return false;
    }

    try {
        const tempPath = filePath + '.tmp.png';
        await sharp(filePath)
            .resize(targetPx, targetPx, {
                fit: 'inside',          // jaga aspek rasio, tidak crop
                withoutEnlargement: false, // izinkan upscale
                kernel: sharp.kernel.lanczos3, // kualitas terbaik untuk upscale
            })
            .png({ quality: 100, compressionLevel: 6 })
            .toFile(tempPath);

        fs.renameSync(tempPath, filePath);
        return true;
    } catch (err) {
        log(`  ❌ Gagal resize gambar: ${err.message}`, 'ERROR');
        return false;
    }
}

async function downloadAllNewImages(page, newSrcs, baseName, outputDir, imageSize) {
    if (newSrcs.length === 0) return 0;

    // Tentukan suffix nama file berdasarkan resolusi
    const sizeSuffix = (!imageSize || imageSize.toLowerCase() === 'native') ? '' : `_${imageSize.toLowerCase()}`;

    let downloaded = 0;
    for (let i = 0; i < newSrcs.length; i++) {
        const src = newSrcs[i];
        const filePath = path.join(outputDir, `${baseName}${sizeSuffix}_${i + 1}.png`);
        log(`  Mendownload ${i + 1}/${newSrcs.length}...`);

        let ok = false;
        // Coba download hingga 2 kali jika gagal (URL mungkin belum siap)
        for (let dlAttempt = 1; dlAttempt <= 2; dlAttempt++) {
            try {
                ok = await downloadImage(page, src, filePath);
                if (ok) break;
                if (dlAttempt < 2) await page.waitForTimeout(2000);
            } catch (err) {
                if (dlAttempt < 2) await page.waitForTimeout(2000);
                else log(`  ❌ Error download gambar ${i + 1}: ${err.message}`, 'ERROR');
            }
        }

        if (ok) {
            // Resize jika IMAGE_SIZE bukan 'native'
            const resized = await resizeImage(filePath, imageSize);
            if (resized) {
                const meta = await sharp(filePath).metadata();
                log(`  ✅ Tersimpan (${imageSize.toUpperCase()} — ${meta.width}x${meta.height}px): ${path.basename(filePath)}`, 'SUCCESS');
            } else {
                log(`  ✅ Tersimpan (native): ${path.basename(filePath)}`, 'SUCCESS');
            }
            downloaded++;
        } else {
            log(`  ⚠️  Gagal download gambar ${i + 1}`, 'WARN');
        }
    }

    return downloaded;
}

// ============================================================
//  MAIN
// ============================================================

/**
 * Cek apakah halaman masih hidup (belum ditutup).
 */
async function isPageAlive(page) {
    try {
        await page.evaluate(() => true);
        return true;
    } catch {
        return false;
    }
}

/**
 * Setup halaman baru: buka Flow, tunggu siap, reset sesi lama.
 * Dipanggil saat pertama kali dan saat halaman mati di tengah run.
 */
async function setupPage(context, timeoutMs) {
    const page = await context.newPage();

    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    log(`Membuka ${FLOW_URL} ...`);
    await page.goto(FLOW_URL, { waitUntil: 'load', timeout: timeoutMs });

    try {
        await page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch { /* lanjut saja */ }
    await page.waitForTimeout(3000);

    // Tunggu kotak input muncul
    let promptInput = await waitForFlowReady(page, 60000);

    if (!promptInput) {
        log('Kotak input belum muncul. Mungkin perlu login.', 'WARN');
        log('Silakan login di jendela browser. Menunggu hingga 120 detik...', 'WARN');
        promptInput = await waitForFlowReady(page, 120000);
        if (!promptInput) return { page, promptInput: null };
    }

    // Reset agen Flow dari sesi sebelumnya
    log('Mereset sesi Flow sebelumnya...');
    promptInput = await resetFlowSession(page, promptInput, timeoutMs);

    return { page, promptInput };
}

// ============================================================
//  MAIN
// ============================================================
async function runAutomation() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const promptsPath = path.join(__dirname, 'prompts.txt');
    if (!fs.existsSync(promptsPath)) {
        log('File prompts.txt tidak ditemukan!', 'ERROR');
        return;
    }

    const prompts = fs
        .readFileSync(promptsPath, 'utf-8')
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0 && !p.startsWith('#'));

    if (prompts.length === 0) {
        log('prompts.txt kosong. Tambahkan prompt terlebih dahulu.', 'ERROR');
        return;
    }

    const imageSize = (process.env.IMAGE_SIZE || 'native').toLowerCase();
    const sizeLabel = imageSize === 'native' ? 'native (asli)' : `${imageSize.toUpperCase()} (${RESOLUTION_MAP[imageSize] || '?'}px)`;
    log(`Ditemukan ${prompts.length} prompt. Resolusi output: ${sizeLabel}`);

    killExistingChrome();
    await new Promise(r => setTimeout(r, 1500));

    const userDataDir = process.env.USER_DATA_DIR || './browser_session';
    const isHeadless = process.env.HEADLESS === 'true';
    const timeoutMs = parseInt(process.env.TIMEOUT_MS) || 60000;
    const maxRetries = parseInt(process.env.MAX_RETRIES) || 3;


    log('Meluncurkan browser...');
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: isHeadless,
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-infobars',
            '--no-first-run',
            '--no-default-browser-check',
        ],
    });

    try {
        // Setup halaman pertama kali
        let { page, promptInput } = await setupPage(context, timeoutMs);

        if (!promptInput) {
            log('❌ Gagal mendapatkan kotak input. Script berhenti.', 'ERROR');
            await context.close();
            return;
        }

        log('✅ Siap! Memulai pemrosesan prompt...\n');

        for (let i = 0; i < prompts.length; i++) {
            const prompt = prompts[i];
            log(`[${i + 1}/${prompts.length}] "${prompt.substring(0, 70)}"`);

            let success = false;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    // Cek apakah halaman masih hidup sebelum mulai
                    if (!await isPageAlive(page)) {
                        log('  Halaman tertutup! Membuka halaman baru...', 'WARN');
                        const result = await setupPage(context, timeoutMs);
                        page = result.page;
                        promptInput = result.promptInput;
                        if (!promptInput) throw new Error('Gagal setup halaman baru.');
                        log('  ✅ Halaman baru siap.');
                    }

                    const srcsBefore = await page.evaluate(() =>
                        Array.from(document.querySelectorAll('img')).map(img => img.src)
                    );

                    // 1. Isi prompt
                    await fillPromptInput(page, promptInput, prompt);
                    await page.waitForTimeout(randomDelay(400, 700));

                    // 2. Setup deteksi SEBELUM Enter — agar tidak ada response yang terlewat
                    //    cold start Google Flow bisa 60-120 detik, maxWaitMs diberi 3x timeout
                    const detectionPromise = setupImageDetection(page, srcsBefore, timeoutMs * 3);

                    // 3. Kirim prompt
                    await page.keyboard.press('Enter');
                    log('  Generate dimulai...');

                    // 4. Tunggu gambar dari network (instan saat response tiba)
                    const { found: resultFound, newSrcs } = await detectionPromise;

                    const timestamp = Date.now();
                    const safeName = prompt.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 40);
                    const baseName = `${safeName}_${timestamp}`;

                    if (resultFound) {
                        const dlCount = await downloadAllNewImages(page, newSrcs, baseName, OUTPUT_DIR, imageSize);
                        if (dlCount > 0) {
                            log(`  ✅ ${dlCount} gambar didownload.\n`, 'SUCCESS');
                            success = true; // Berhasil — keluar dari retry loop
                            break;
                        }
                        // Download gagal: jangan set success=true, biarkan retry
                        if (attempt < maxRetries) {
                            log('  ⚠️  Download gagal, mencoba lagi...\n', 'WARN');
                        } else {
                            const sp = path.join(OUTPUT_DIR, `${baseName}_screenshot.png`);
                            await page.screenshot({ path: sp });
                            log(`  ⚠️  Download gagal setelah ${maxRetries}x. Screenshot: ${path.basename(sp)}\n`, 'WARN');
                        }
                    } else {
                        // Timeout — jangan set success=true, biarkan retry
                        if (attempt < maxRetries) {
                            log(`  ⚠️  Timeout attempt ${attempt}. Mencoba lagi...\n`, 'WARN');
                        } else {
                            const sp = path.join(OUTPUT_DIR, `${baseName}_timeout.png`);
                            await page.screenshot({ path: sp });
                            log(`  ⚠️  Timeout setelah ${maxRetries}x percobaan. Screenshot: ${path.basename(sp)}\n`, 'WARN');
                        }
                    }

                } catch (err) {
                    const isPageClosed = err.message.includes('closed') || err.message.includes('Target page');
                    log(`  ❌ Attempt ${attempt} gagal: ${err.message}`, 'ERROR');

                    if (attempt < maxRetries) {
                        if (isPageClosed) {
                            // Halaman mati — langsung setup ulang tanpa jeda
                            log('  Halaman mati. Setup ulang halaman...', 'WARN');
                            try {
                                const result = await setupPage(context, timeoutMs);
                                page = result.page;
                                promptInput = result.promptInput;
                            } catch (setupErr) {
                                log(`  Gagal setup ulang: ${setupErr.message}`, 'ERROR');
                            }
                        } else {
                            await new Promise(r => setTimeout(r, randomDelay(3000, 6000)));
                        }
                    }
                }
            }

            if (!success) {
                log(`❌ Prompt "${prompt.substring(0, 40)}" gagal setelah ${maxRetries} percobaan.\n`, 'ERROR');
            }

            // Jeda antar prompt
            if (i < prompts.length - 1) {
                const gap = randomDelay(2000, 4000);
                log(`Jeda ${Math.round(gap / 1000)}s...`);
                try { await page.waitForTimeout(gap); } catch { await new Promise(r => setTimeout(r, gap)); }
            }
        }

        log('\n🎉 Selesai! Semua prompt sudah diproses.', 'SUCCESS');
        log(`📁 Gambar tersimpan di: ${OUTPUT_DIR}`, 'SUCCESS');

    } catch (error) {
        log(`Kesalahan fatal: ${error.message}`, 'ERROR');
    } finally {
        log('Menutup browser...');
        try { await context.close(); } catch {}
    }
}

runAutomation();