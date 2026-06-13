# 🤖 Google Flow Bot

> Otomasi download gambar dari **Google Flow (labs.google/fx/tools/flow)** menggunakan Playwright — support resolusi **1K / 2K / 4K**, resume otomatis, dan anti-detection.

---

## 📋 Daftar Isi

- [Fitur Utama](#-fitur-utama)
- [Struktur Proyek](#-struktur-proyek)
- [Prasyarat](#-prasyarat)
- [Instalasi](#-instalasi)
- [Konfigurasi](#-konfigurasi)
- [Cara Pakai](#-cara-pakai)
- [Format prompts.txt](#-format-promptstxt)
- [Resolusi Download](#-resolusi-download)
- [Cara Kerja](#-cara-kerja)
- [Log & Debugging](#-log--debugging)
- [Troubleshooting](#-troubleshooting)
- [Struktur Output](#-struktur-output)

---

## ✨ Fitur Utama

| Fitur | Keterangan |
|---|---|
| 🎨 **Multi-resolusi** | Pilih resolusi download: `native`, `1K`, `2K`, atau `4K` |
| 📋 **Batch prompts** | Proses ratusan prompt sekaligus dari `prompts.txt` |
| 💾 **Resume otomatis** | Lanjut dari prompt terakhir jika bot dihentikan di tengah jalan |
| 🔄 **Auto-retry** | Coba ulang otomatis hingga `MAX_RETRIES` kali per prompt |
| 🛡️ **Anti-detection** | Sembunyikan tanda otomasi (webdriver, visibility API) |
| 🪟 **Window restore** | Otomatis restore window saat minimized agar klik kanan berjalan |
| 📸 **Screenshot debug** | Simpan screenshot otomatis saat error/timeout untuk inspeksi |
| 📝 **Log harian** | Log lengkap tersimpan di folder `logs/` per tanggal |
| 🔁 **Browser relaunch** | Relaunch browser otomatis jika context/page mati saat berjalan |

---

## 📁 Struktur Proyek

```
bot2/
├── index.js              # Entry point utama — logika otomasi Playwright
├── prompts.txt           # Daftar prompt yang akan di-generate (1 prompt/baris)
├── .env                  # Konfigurasi environment (tidak di-commit ke Git)
├── .env.example          # Contoh konfigurasi (salin ke .env)
├── package.json          # Metadata proyek & dependensi
├── .gitignore            # File/folder yang diabaikan Git
│
├── utils/
│   ├── logger.js         # Modul logging ke konsol + file harian
│   └── helpers.js        # Fungsi utilitas: randomDelay, withRetry, sanitizeFilename
│
├── output/               # 📂 Hasil gambar tersimpan di sini (auto-created)
│   └── .progress.json    # File tracking progress resume (auto-created)
│
├── logs/                 # 📂 Log harian bot (auto-created)
│   └── bot-YYYY-MM-DD.log
│
├── browser_session/      # 📂 Sesi login browser (auto-created, tidak di-commit)
└── tmp_downloads/        # 📂 Folder download sementara (auto-created & dibersihkan)
```

> **Catatan:** Folder `output/`, `logs/`, `browser_session/`, dan `tmp_downloads/` dibuat otomatis saat bot pertama kali dijalankan dan **tidak perlu dibuat manual**.

---

## ✅ Prasyarat

- **Node.js** versi 18 atau lebih baru → [Download Node.js](https://nodejs.org/)
- **Akun Google** yang sudah bisa mengakses [Google Flow](https://labs.google/fx/tools/flow)
- **OS Windows** (bot menggunakan `taskkill` untuk manajemen Chrome)
- Koneksi internet yang stabil

---

## 🚀 Instalasi

### 1. Clone repositori

```bash
git clone https://github.com/insa21/bot-flow.git
cd bot-flow
```

### 2. Install dependensi Node.js

```bash
npm install
```

### 3. Install browser Playwright

```bash
npx playwright install chromium
```

### 4. Salin dan konfigurasi file environment

```bash
# Salin template konfigurasi
copy .env.example .env
```

Kemudian edit file `.env` sesuai kebutuhan (lihat bagian [Konfigurasi](#-konfigurasi)).

---

## ⚙️ Konfigurasi

Semua konfigurasi diatur melalui file `.env` di root proyek:

```env
# ── Mode Browser ────────────────────────────────────────────────
# false = browser terlihat (recommended untuk pertama kali / debug)
# true  = headless (tidak ada jendela browser)
HEADLESS=false

# ── Folder Sesi Browser ─────────────────────────────────────────
# Menyimpan cookie & login Google agar tidak perlu login setiap kali
USER_DATA_DIR=./browser_session

# ── Timeout & Retry ─────────────────────────────────────────────
# Maksimum waktu tunggu generate per prompt (milidetik)
TIMEOUT_MS=120000

# Jumlah percobaan ulang jika generate/download gagal
MAX_RETRIES=3

# Timeout menunggu context menu muncul setelah klik kanan (ms)
CONTEXT_MENU_TIMEOUT_MS=15000

# Timeout menunggu server Google upscale + kirim file ke browser (ms)
# 2K biasanya butuh 30-120 detik. Default 5 menit sudah sangat cukup.
DOWNLOAD_TIMEOUT_MS=300000

# ── Resolusi Download ───────────────────────────────────────────
# Pilihan: native | 1k | 2k | 4k
IMAGE_SIZE=1k
```

### Penjelasan Parameter Penting

| Parameter | Default | Keterangan |
|---|---|---|
| `HEADLESS` | `false` | `false` = browser terlihat; `true` = tidak ada jendela |
| `USER_DATA_DIR` | `./browser_session` | Lokasi penyimpanan sesi login Google |
| `TIMEOUT_MS` | `120000` | Timeout per prompt (2 menit). Naikkan jika koneksi lambat |
| `MAX_RETRIES` | `3` | Jumlah retry per prompt sebelum dianggap gagal |
| `CONTEXT_MENU_TIMEOUT_MS` | `15000` | Timeout menu klik kanan muncul |
| `DOWNLOAD_TIMEOUT_MS` | `300000` | Timeout download file (5 menit) |
| `IMAGE_SIZE` | `1k` | Resolusi gambar yang didownload |

---

## 🎮 Cara Pakai

### Langkah 1 — Isi `prompts.txt`

Edit file `prompts.txt` dan masukkan prompt gambar, satu prompt per baris:

```
Coffee shop branding identity collection.
Technology company branding collection.
Luxury business card branding collection.
```

- Baris yang diawali `#` akan diabaikan (komentar)
- Baris kosong otomatis dilewati

### Langkah 2 — Jalankan Bot

```bash
npm start
```

atau langsung:

```bash
node index.js
```

### Langkah 3 — Login Google (Pertama Kali)

Saat pertama kali dijalankan, browser akan terbuka dan menampilkan halaman Google Flow. Jika belum login:

1. Login ke akun Google Anda di jendela browser yang terbuka
2. Bot akan otomatis mendeteksi setelah login dan melanjutkan
3. Sesi login disimpan di `browser_session/` — **login hanya diperlukan sekali**

### Langkah 4 — Tunggu hingga Selesai

Bot akan memproses setiap prompt secara berurutan. Progress ditampilkan di konsol:

```
[2026-06-13 18:00:01] ℹ️ [1/77] "Coffee shop branding identity collection."
[2026-06-13 18:00:03] ℹ️   Generate dimulai...
[2026-06-13 18:00:45] ℹ️   📸 Gambar 1 terdeteksi via network!
[2026-06-13 18:00:47] ℹ️   🖱️  Klik kanan pada gambar...
[2026-06-13 18:00:49] ✅   Download selesai via direct fetch (1K): coffee_shop_...png
[2026-06-13 18:00:49] ✅   1 gambar didownload.
```

---

## 📝 Format prompts.txt

```text
# Ini adalah komentar, akan diabaikan

Educational content social media showcase.
Podcast promotion social media collection.
Event marketing social media layouts.

# Kelompok berikutnya
Coffee shop branding identity collection.
Technology company branding collection.
```

**Tips prompt:**
- Tulis dalam bahasa Inggris untuk hasil optimal di Google Flow
- Prompt deskriptif menghasilkan gambar lebih konsisten
- Setiap baris = 1 prompt = 1 sesi generate di Flow

---

## 🖼️ Resolusi Download

Atur `IMAGE_SIZE` di `.env`:

| Nilai | Resolusi | Keterangan |
|---|---|---|
| `native` | ~1024px | Download gambar asli langsung tanpa menu |
| `1k` | 1024px | Download via menu → opsi "1K / Ukuran asli" |
| `2k` | ~2048px | Download via menu → opsi "2K" (upscale server Google) |
| `4k` | ~4096px | Download via menu → opsi "4K" (perlu akun Google One/Pro) |

> **Catatan:** Resolusi `2K` dan `4K` di-upscale langsung oleh server Google Flow — bukan resize lokal — sehingga kualitas lebih baik dari upscale manual.

---

## 🔧 Cara Kerja

### Alur Otomasi

```
prompts.txt
    │
    ▼
[Launch Browser] → Login Google (pertama kali saja)
    │
    ▼
[Untuk setiap prompt:]
    │
    ├─ 1. Ketik prompt ke input box Flow
    ├─ 2. Tekan Enter → tunggu generate selesai
    ├─ 3. Deteksi gambar baru via network response
    ├─ 4. Klik kanan gambar → hover "Download" → klik resolusi target
    ├─ 5. Intercept URL download → fetch & simpan ke output/
    └─ 6. Simpan progress → lanjut ke prompt berikutnya
```

### Mekanisme Download (Berlapis)

Bot menggunakan 3 metode download secara bertahap (fallback):

1. **Direct Fetch** — Intercept URL dari `requestfinished` event, lalu fetch langsung tanpa dialog
2. **Playwright saveAs** — Gunakan Playwright download event + `download.saveAs()` sebagai backup
3. **Network URL Fallback** — Fetch dari URL gambar yang terdeteksi via network response

### Anti-Detection

- Sembunyikan property `navigator.webdriver`
- Spoof `document.visibilityState` → selalu `'visible'`
- Blokir event `visibilitychange` agar Flow tidak throttle saat tab di-background
- Keep-alive setiap 20 detik: `bringToFront()` + gerakan mouse sintetis
- CDP: nonaktifkan background throttling

### Resume Otomatis

Progress disimpan di `output/.progress.json`. Jika bot dihentikan (Ctrl+C, crash, dsb), jalankan ulang `npm start` dan bot akan **melanjutkan dari prompt yang belum selesai**.

---

## 📊 Log & Debugging

### Log Konsol (Real-time)

Semua aktivitas ditampilkan langsung di terminal dengan emoji dan timestamp.

### Log File Harian

Log tersimpan di `logs/bot-YYYY-MM-DD.log` dalam format plain text yang mudah dibaca:

```
[2026-06-13 18:00:01] [INFO   ] Meluncurkan browser...
[2026-06-13 18:00:05] [INFO   ] Membuka https://labs.google/fx/tools/flow ...
[2026-06-13 18:00:45] [SUCCESS] Download selesai via direct fetch (1K): file.png
[2026-06-13 18:01:20] [ERROR  ] Attempt 1 error: Timeout 120000ms exceeded
```

### Screenshot Debug

Saat error atau timeout, bot otomatis menyimpan screenshot ke folder `output/`:
- `_debug_no_menu_<timestamp>.png` — saat menu klik kanan tidak muncul
- `_debug_no_resolution_<timestamp>.png` — saat opsi resolusi tidak ditemukan
- `<prompt>_screenshot.png` — screenshot saat download gagal semua retry
- `<prompt>_timeout.png` — screenshot saat generate timeout

---

## 🔍 Troubleshooting

### ❓ Bot stuck di "Menunggu halaman Flow siap..."

**Penyebab:** Perlu login Google atau halaman Flow tidak terbuka  
**Solusi:**
1. Pastikan `HEADLESS=false` di `.env`
2. Login manual di jendela browser yang terbuka
3. Tunggu hingga halaman Flow termuat penuh

---

### ❓ Download selalu gagal / file kosong

**Penyebab:** Resolusi `2K`/`4K` membutuhkan waktu upscale lebih lama  
**Solusi:**
```env
DOWNLOAD_TIMEOUT_MS=600000   # Naikkan ke 10 menit
CONTEXT_MENU_TIMEOUT_MS=20000
```

---

### ❓ Error "Browser sudah direlaunch 5x"

**Penyebab:** Browser crash berulang (RAM penuh, konflik Chrome)  
**Solusi:**
1. Tutup semua Chrome yang berjalan: `taskkill /F /IM chrome.exe`
2. Hapus folder `browser_session/` jika korup
3. Jalankan ulang bot

---

### ❓ Prompt yang sudah selesai diproses ulang

**Penyebab:** File `.progress.json` terhapus  
**Solusi:** Progress direset otomatis setelah semua prompt selesai — ini adalah perilaku normal.

---

### ❓ Gambar tidak terdeteksi meskipun Generate sudah selesai di UI

**Penyebab:** Tab di-background terlalu lama, Flow throttle request  
**Solusi:**
```env
HEADLESS=false   # Jangan gunakan headless
TIMEOUT_MS=180000  # Naikkan timeout
```

---

## 📦 Struktur Output

Gambar tersimpan di folder `output/` dengan format penamaan:

```
output/
├── .progress.json                          ← tracking progress (auto)
├── coffee_shop_branding_1718906401234_1k_1.png
├── technology_company_brandin_1718906445678_1k_1.png
└── luxury_business_card_brand_1718906489012_1k_1.png
```

**Format nama file:**
```
{nama_prompt_sanitasi}_{timestamp}_{resolusi}_{nomor}.png
```

Contoh: `coffee_shop_branding_1718906401234_1k_1.png`
- `coffee_shop_branding` → 40 karakter pertama prompt (huruf/angka saja)
- `1718906401234` → Unix timestamp milidetik
- `1k` → resolusi download
- `1` → nomor gambar (jika 1 prompt menghasilkan beberapa gambar)

---

## 🛠️ Teknologi

| Library | Versi | Kegunaan |
|---|---|---|
| [Playwright](https://playwright.dev/) | `^1.42.1` | Browser automation |
| [dotenv](https://github.com/motdotla/dotenv) | `^16.4.5` | Manajemen environment variable |
| [sharp](https://sharp.pixelplumbing.com/) | `^0.34.5` | Pemrosesan gambar |

---

## 🔒 Keamanan

- File `.env` **tidak di-commit** ke Git (sudah ada di `.gitignore`)
- Folder `browser_session/` (berisi cookie & token login) juga **tidak di-commit**
- Jangan bagikan file `.env` atau folder `browser_session/` ke orang lain

---

## 📄 Lisensi

Proyek ini untuk keperluan pribadi. Gunakan sesuai [Ketentuan Layanan Google](https://policies.google.com/terms).

---

<div align="center">
  <sub>Made with ☕ — Google Flow Bot v1.0.0</sub>
</div>
