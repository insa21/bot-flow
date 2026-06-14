// js/modules/utils.js — Fungsi utilitas murni (tanpa side-effect DOM)

/**
 * Escape karakter HTML untuk mencegah XSS.
 * @param {string} str
 * @returns {string}
 */
export function escHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Format durasi milidetik menjadi string yang mudah dibaca.
 * @param {number} ms
 * @returns {string}
 */
export function formatElapsed(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
}

/**
 * Ambil nama file dari path absolut (cross-platform: / atau \).
 * @param {string} filePath
 * @returns {string}
 */
export function getFileName(filePath) {
    return filePath.split(/[/\\]/).pop();
}

/**
 * Klasifikasi log line berdasarkan kontennya.
 * @param {string} line
 * @returns {'GUI'|'STDERR'|'ERROR'|'SUCCESS'|'WARN'|'INFO'}
 */
export function classifyLine(line) {
    if (line.startsWith('[GUI]'))          return 'GUI';
    if (line.startsWith('[STDERR]'))       return 'STDERR';
    if (/\[ERROR\s*\]|❌/.test(line))     return 'ERROR';
    if (/\[SUCCESS\s*\]|✅/.test(line))   return 'SUCCESS';
    if (/\[WARN\s*\]|⚠️/.test(line))     return 'WARN';
    return 'INFO';
}

/**
 * Trigger animasi CSS dengan menghapus & menambahkan class.
 * @param {HTMLElement} el
 * @param {string} className
 */
export function triggerAnimation(el, className) {
    if (!el) return;
    el.classList.remove(className);
    void el.offsetWidth; // force reflow
    el.classList.add(className);
}
