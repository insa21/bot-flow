const { log } = require('./logger');

// Menghasilkan delay acak di antara min dan max (dalam milidetik)
const randomDelay = (min = 2000, max = 5000) => {
    return Math.floor(Math.random() * (max - min + 1) + min);
};

// Fungsi pembungkus untuk mengulang proses jika gagal
const withRetry = async (fn, retries = 3, promptName = '') => {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            log(`Gagal memproses prompt "${promptName}". Percobaan ${i + 1} dari ${retries}`, 'ERROR');
            if (i === retries - 1) throw error;
            // Tunggu sebentar sebelum mencoba lagi
            await new Promise(resolve => setTimeout(resolve, randomDelay(3000, 7000)));
        }
    }
};

// Membersihkan nama file dari karakter ilegal
const sanitizeFilename = (text) => {
    return text.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
};

module.exports = { randomDelay, withRetry, sanitizeFilename };