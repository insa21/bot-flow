require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { log } = require('./utils/logger');

// ============================================================
//  KONFIGURASI — sesuaikan di sini jika ada perubahan UI
// ============================================================
const FLOW_URL = 'https://labs.google/fx/tools/flow';

// ✅ Dikonfirmasi dari debug: Google Flow pakai div[contenteditable]
const PROMPT_INPUT_CANDIDATES = [
    '[contenteditable="true"]',
    'textarea:not(.g-recaptcha-response)',
    'textarea[placeholder]',
    'input[type="text"][placeholder]',
    'input[type="text"]',
];

// Kandidat tombol kirim
const SEND_BUTTON_CANDIDATES = [
    'button[aria-label*="Send"]',
    'button[aria-label*="Generate"]',
    'button[aria-label*="Submit"]',
    'button[type="submit"]',
    '[data-testid*="send"]',
    '[data-testid*="submit"]',
];

const OUTPUT_DIR = path.join(__dirname, 'output');
// ============================================================

function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * Kill semua proses Chrome yang memakai user data dir yang sama.
 * Mencegah error "profile is already in use / context closed".
 */
function killExistingChrome() {
    try {
        execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore' });
        log('Chrome lama berhasil ditutup.');
    } catch {
        // Tidak ada Chrome yang berjalan — tidak masalah
    }
}

/**
 * Coba temukan elemen dari daftar kandidat selector.
 * Mengembalikan locator pertama yang terlihat, atau null.
 */
async function findVisibleElement(page, candidates, timeoutMs = 5000) {
    for (const selector of candidates) {
        try {
            const locator = page.locator(selector).first();
            await locator.waitFor({ state: 'visible', timeout: timeoutMs });
            return locator;
        } catch {
            // Tidak ditemukan, coba berikutnya
        }
    }
    return null;
}

/**
 * Debug helper: cetak elemen interaktif + gambar di halaman.
 */
async function debugPageElements(page) {
    log('=== DEBUG: Elemen yang ditemukan di halaman ===');
    const info = await page.evaluate(() => {
        const results = [];

        document.querySelectorAll('textarea').forEach((el, i) => {
            results.push(`[textarea #${i}] placeholder="${el.placeholder}" class="${el.className.substring(0, 80)}"`);
        });
        document.querySelectorAll('input[type="text"], input:not([type])').forEach((el, i) => {
            results.push(`[input #${i}] placeholder="${el.placeholder}" class="${el.className.substring(0, 80)}"`);
        });
        document.querySelectorAll('[contenteditable="true"]').forEach((el, i) => {
            results.push(`[contenteditable #${i}] tag=${el.tagName} class="${el.className.substring(0, 80)}"`);
        });
        document.querySelectorAll('img').forEach((el, i) => {
            if (i > 10) return;
            results.push(`[img #${i}] src="${el.src.substring(0, 80)}" class="${el.className.substring(0, 60)}"`);
        });

        return results;
    });

    if (info.length === 0) {
        log('Tidak ada elemen ditemukan. Halaman mungkin belum load penuh.');
    } else {
        info.forEach(line => log(line));
    }
    log('=== Akhir DEBUG ===');
}

/**
 * Hitung jumlah gambar di halaman saat ini.
 * Digunakan untuk mendeteksi gambar baru yang muncul setelah generate.
 */
async function countImages(page) {
    return page.evaluate(() => document.querySelectorAll('img').length);
}

/**
 * Isi input prompt — mendukung contenteditable dan textarea/input.
 */
async function fillPromptInput(page, inputLocator, text) {
    const isContentEditable = await inputLocator.evaluate(el => el.contentEditable === 'true');

    await inputLocator.click();
    await page.waitForTimeout(200);

    if (isContentEditable) {
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Delete');
        await page.waitForTimeout(300);
        await page.keyboard.type(text, { delay: randomDelay(40, 100) });
    } else {
        await inputLocator.click({ clickCount: 3 });
        await page.keyboard.press('Delete');
        await page.waitForTimeout(300);
        await inputLocator.pressSequentially(text, { delay: randomDelay(40, 100) });
    }
}

/**
 * Tunggu hingga gambar baru muncul di halaman dibanding sebelum generate.
 * Mengembalikan { found: bool, newSrcs: string[] } — daftar src dari img baru.
 */
async function waitForNewImage(page, imgCountBefore, maxWaitMs = 120000) {
    log('  Menunggu gambar hasil muncul...');
    const pollInterval = 3000;
    const start = Date.now();

    // Ambil semua src yang sudah ada sebelum generate
    const srcsBefore = await page.evaluate(() =>
        Array.from(document.querySelectorAll('img')).map(img => img.src)
    );

    while (Date.now() - start < maxWaitMs) {
        await page.waitForTimeout(pollInterval);

        const imgCountNow = await countImages(page);
        if (imgCountNow > imgCountBefore) {
            log(`  ✅ Gambar baru terdeteksi! (sebelum: ${imgCountBefore}, sekarang: ${imgCountNow})`);
            await page.waitForTimeout(2000); // beri waktu render selesai

            // Kumpulkan src dari img yang BARU (tidak ada di daftar sebelumnya)
            const srcsNow = await page.evaluate(() =>
                Array.from(document.querySelectorAll('img')).map(img => img.src)
            );
            const newSrcs = srcsNow.filter(src => !srcsBefore.includes(src) && src.length > 0);
            log(`  Ditemukan ${newSrcs.length} src gambar baru.`);

            return { found: true, newSrcs };
        }

        const elapsed = Math.round((Date.now() - start) / 1000);
        log(`  Menunggu... ${elapsed}s (img: ${imgCountNow})`);
    }

    return { found: false, newSrcs: [] };
}

/**
 * Download satu gambar dari URL dan simpan ke filePath.
 * Mendukung tiga jenis URL:
 *   - blob:     → baca bytes via page.evaluate (FileReader di browser)
 *   - data:     → decode base64 langsung
 *   - http/https → page.request.get() — OTOMATIS membawa cookie sesi Google
 */
async function downloadImage(page, src, filePath) {
    if (src.startsWith('blob:')) {
        // Blob URL: hanya bisa diakses dari dalam konteks browser
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
        // Data URI: decode base64 langsung
        const base64 = src.split(',')[1];
        if (base64) {
            fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
            return true;
        }
        return false;
    }

    if (src.startsWith('http://') || src.startsWith('https://')) {
        // ✅ Gunakan page.request.get() — otomatis membawa cookie sesi browser
        // Penting untuk URL Google Flow yang memerlukan autentikasi
        const response = await page.request.get(src);
        if (response.ok()) {
            const buffer = await response.body();
            fs.writeFileSync(filePath, buffer);
            return true;
        }
        log(`  HTTP ${response.status()} untuk: ${src.substring(0, 70)}`, 'WARN');
        return false;
    }

    return false; // tipe URL tidak dikenal
}

/**
 * Download semua gambar baru yang ditemukan setelah generate.
 * Setiap gambar disimpan sebagai file PNG terpisah.
 * Returns jumlah gambar yang berhasil didownload.
 */
async function downloadAllNewImages(page, newSrcs, baseName, outputDir) {
    if (newSrcs.length === 0) return 0;

    let downloaded = 0;
    for (let i = 0; i < newSrcs.length; i++) {
        const src = newSrcs[i];
        const filePath = path.join(outputDir, `${baseName}_${i + 1}.png`);
        log(`  Mendownload gambar ${i + 1}/${newSrcs.length}: ${src.substring(0, 60)}...`);

        try {
            const ok = await downloadImage(page, src, filePath);
            if (ok) {
                log(`  ✅ Download berhasil: ${path.basename(filePath)}`, 'SUCCESS');
                downloaded++;
            } else {
                log(`  ⚠️  Download gagal untuk gambar ${i + 1} (URL tidak didukung atau error)`, 'WARN');
            }
        } catch (err) {
            log(`  ❌ Error saat download gambar ${i + 1}: ${err.message}`, 'ERROR');
        }
    }

    return downloaded;
}

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
        log('prompts.txt tidak memiliki prompt yang valid.', 'ERROR');
        return;
    }

    log(`Ditemukan ${prompts.length} prompt untuk diproses.`);

    // ✅ FIX: Tutup Chrome lama agar tidak ada konflik profile/session
    log('Memastikan tidak ada Chrome lama yang berjalan...');
    killExistingChrome();
    await new Promise(r => setTimeout(r, 2000)); // tunggu proses benar-benar mati

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

    const page = await context.newPage();

    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    try {
        log(`Membuka ${FLOW_URL} ...`);
        await page.goto(FLOW_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await page.waitForTimeout(4000);

        log('Menjalankan debug awal...');
        await debugPageElements(page);

        log('---');
        log('⚠️  PENTING: Jika belum login, silakan login sekarang di jendela browser.');
        log('⚠️  Script menunggu 30 detik...');
        log('---');
        await page.waitForTimeout(30000);

        await debugPageElements(page);

        // Cari input prompt
        const promptInput = await findVisibleElement(page, PROMPT_INPUT_CANDIDATES, 8000);
        if (!promptInput) {
            log('❌ Kotak input prompt tidak ditemukan!', 'ERROR');
            log('Petunjuk: Buka DevTools di browser, inspeksi kotak prompt, update PROMPT_INPUT_CANDIDATES di index.js.', 'ERROR');
            await page.screenshot({ path: path.join(OUTPUT_DIR, '_debug_no_input_found.png') });
            return;
        }

        log('✅ Kotak input prompt ditemukan!');

        for (let i = 0; i < prompts.length; i++) {
            const prompt = prompts[i];
            log(`\n[${i + 1}/${prompts.length}] Memproses: "${prompt.substring(0, 70)}"`);

            let success = false;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    // Catat jumlah gambar SEBELUM generate
                    const imgCountBefore = await countImages(page);

                    // 1. Isi prompt
                    log(`  Attempt ${attempt}: Mengisi prompt...`);
                    await fillPromptInput(page, promptInput, prompt);
                    await page.waitForTimeout(randomDelay(800, 1500));

                    // 2. Kirim
                    const sendBtn = await findVisibleElement(page, SEND_BUTTON_CANDIDATES, 2000);
                    if (sendBtn) {
                        log('  Mengklik tombol kirim...');
                        await sendBtn.click();
                    } else {
                        log('  Tombol kirim tidak ditemukan, menekan Enter...');
                        await page.keyboard.press('Enter');
                    }

                    log(`  Generate dimulai (img count sebelum: ${imgCountBefore})...`);

                    // 3. Tunggu gambar baru muncul di DOM
                    const { found: resultFound, newSrcs } = await waitForNewImage(page, imgCountBefore, timeoutMs * 2);

                    const timestamp = Date.now();
                    const safeName = prompt.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 40);
                    const baseName = `${safeName}_${timestamp}`;

                    if (resultFound) {
                        // 4a. Download gambar asli (file langsung, bukan screenshot)
                        const dlCount = await downloadAllNewImages(page, newSrcs, baseName, OUTPUT_DIR);

                        if (dlCount > 0) {
                            log(`  ✅ ${dlCount} gambar berhasil didownload ke folder output/`, 'SUCCESS');
                        } else {
                            // Fallback: download gagal, pakai screenshot
                            log('  ⚠️  Download langsung gagal, menggunakan screenshot sebagai fallback...', 'WARN');
                            const screenshotPath = path.join(OUTPUT_DIR, `${baseName}_screenshot.png`);
                            await page.screenshot({ path: screenshotPath, fullPage: false });
                            log(`  ✅ Screenshot disimpan: ${screenshotPath}`, 'SUCCESS');
                        }
                    } else {
                        // 4b. Timeout — ambil screenshot untuk dicek manual
                        log('  ⚠️  Gambar tidak terdeteksi otomatis. Mengambil screenshot...', 'WARN');
                        const screenshotPath = path.join(OUTPUT_DIR, `${baseName}_perlu_cek.png`);
                        await page.screenshot({ path: screenshotPath, fullPage: false });
                        log(`  Screenshot diambil: ${screenshotPath}`, 'WARN');
                    }

                    success = true;
                    break;

                } catch (err) {
                    log(`  ❌ Attempt ${attempt} gagal: ${err.message}`, 'ERROR');
                    if (attempt < maxRetries) {
                        const waitTime = randomDelay(5000, 10000);
                        log(`  Menunggu ${Math.round(waitTime / 1000)}s sebelum mencoba lagi...`);
                        await new Promise(r => setTimeout(r, waitTime)); // Gunakan setTimeout, bukan page.waitForTimeout
                    }
                }
            }

            if (!success) {
                log(`❌ Prompt "${prompt.substring(0, 40)}" gagal setelah ${maxRetries} percobaan.`, 'ERROR');
            }

            if (i < prompts.length - 1) {
                const gap = randomDelay(5000, 10000);
                log(`Jeda ${Math.round(gap / 1000)}s sebelum prompt berikutnya...`);
                await page.waitForTimeout(gap);
            }
        }

        log('\n🎉 Semua prompt selesai diproses!', 'SUCCESS');
        log(`Gambar tersimpan di folder: ${OUTPUT_DIR}`, 'SUCCESS');

    } catch (error) {
        log(`Terjadi kesalahan fatal: ${error.message}`, 'ERROR');
        try {
            await page.screenshot({ path: path.join(OUTPUT_DIR, '_debug_fatal_error.png') });
            log('Screenshot error disimpan di folder output.');
        } catch {}
    } finally {
        log('Menutup browser...');
        try { await context.close(); } catch {}
    }
}

runAutomation();