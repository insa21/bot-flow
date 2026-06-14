# 🤖 Flow Bot

![Flow Bot Banner](gui/renderer/flow_bot_banner.png)

> **Flow Bot** adalah aplikasi otomasi cerdas untuk men-download dan mengelola hasil generate gambar dari **Google Flow (labs.google/fx/tools/flow)**. Proyek ini hadir dalam dua versi: **CLI (Command Line Interface)** yang cepat dan minimalis, serta **GUI (Graphical User Interface)** modern berbasis **Electron** dengan desain premium (glassmorphic dark-theme) yang dilengkapi dengan dasbor pemantauan, editor prompt interaktif, konsol aktivitas, dan galeri manajemen gambar yang canggih.

---

## 📋 Daftar Isi

- [✨ Fitur Utama](#-fitur-utama)
- [🛠️ Teknologi Yang Digunakan](#️-teknologi-yang-digunakan)
- [📁 Struktur Folder Proyek](#-struktur-folder-proyek)
- [✅ Prasyarat Sistem](#-prasyarat-sistem)
- [🚀 Instalasi & Setup](#-instalasi--setup)
- [⚙️ Konfigurasi (.env)](#️-konfigurasi-env)
- [🎮 Cara Menjalankan Aplikasi](#-cara-menjalankan-aplikasi)
- [📦 Cara Build Aplikasi Menjadi Executable (.exe)](#-cara-build-aplikasi-menjadi-executable-exe)
- [🔍 Troubleshooting Umum](#-troubleshooting-umum)
- [🔒 Keamanan & Lisensi](#-keamanan--lisensi)

---

## ✨ Fitur Utama

### 1. Core Bot & Automasi (CLI & GUI)
* 🎨 **Multi-resolusi**: Mendukung download gambar dengan resolusi `native` (~1024px), `1K` (1024px via menu), `2K` (~2048px via upscale server Google), dan `4K` (~4096px - membutuhkan akun Google One/Pro).
* 🛡️ **Anti-detection**: Menyembunyikan parameter webdriver, men-spoof `visibilityState` agar tab tetap aktif meskipun di-background, dan menggerakkan mouse secara sintetik secara berkala.
* 💾 **Resume Otomatis**: Melacak progress unduhan melalui `.progress.json` sehingga bot dapat melanjutkan pekerjaan yang tertunda jika dihentikan di tengah jalan.
* 🔄 **Mekanisme Fallback Multi-metode**: Melakukan download melalui tiga lapis pengamanan: Direct Fetch intercept, Playwright `saveAs` download event, dan Network URL fallback.

### 2. Panel Kontrol Electron GUI
* 💻 **Desain Premium Glassmorphism**: Antarmuka bertema gelap modern dengan animasi mikro yang responsif dan tata letak sidebar yang dapat disesuaikan.
* 📝 **Interactive Prompt Editor**:
  * Menulis dan memformat ratusan prompt langsung di aplikasi.
  * Fitur pencarian kata kunci (*Find*) dengan navigasi hasil pencarian (*Next / Previous match*).
  * Auto-detection baris komentar (`#`) dan baris kosong.
* 📊 **Dashboard & Queue**:
  * Statistik real-time: Jumlah prompt selesai, total antrean, sisa proses, dan total gambar tersimpan.
  * Progress Bar dinamis berbasis persentase.
  * Preview visual status prompt yang sedang diproses.
* 💻 **Konsol Aktivitas Terintegrasi**:
  * Log real-time dari output proses bot.
  * Filter kategori log: *All, Info, Success, Warning, Error, GUI*.
  * Pencarian instan pada baris log.
  * Tombol aksi cepat untuk menyalin (*Copy*) log atau mengekspor (*Export*) log ke file `.txt`.
* 🖼️ **Galeri Gambar Canggih**:
  * Tiga mode tampilan: **Grid** (tampilan kartu), **List** (tabel detail), dan **Gallery** (viewer besar dengan sidebar metadata).
  * Zoom slider interaktif untuk menyesuaikan ukuran kartu gambar pada mode Grid.
  * Fitur pencarian nama prompt dan pengurutan berkas (Berdasarkan tanggal modifikasi terbaru/terlama, nama A-Z, nama Z-A).
  * **Metadata Inspector**: Sidebar yang menyajikan informasi detail berkas (ukuran, dimensi resolusi, tanggal pembuatan, tanggal modifikasi, dan salin path absolut gambar).
  * **Manajemen Berkas Terintegrasi**: Buka gambar langsung di viewer default OS (*Open*), buka lokasi folder di File Explorer (*Reveal*), ganti nama file secara aman (*Rename*), serta hapus berkas (*Delete*) dengan memindahkannya ke folder `.trash`.
  * **Trash & Restore**: Gambar yang dihapus dari galeri dapat dikembalikan seketika (*Restore*) tanpa kehilangan data.
  * **Lightbox Preview**: Viewer gambar layar penuh dengan navigasi keyboard (panah kiri/kanan untuk slide, tombol Esc untuk menutup) dan akses cepat ke tindakan file.

---

## 🛠️ Teknologi Yang Digunakan

| Komponen | Teknologi | Kegunaan |
|---|---|---|
| **Core Automation** | [Playwright](https://playwright.dev/) | Automasi dan navigasi browser Chromium |
| **GUI Runtime** | [Electron](https://www.electronjs.org/) | Framework aplikasi desktop lintas platform |
| **Interface Styling** | CSS Vanilla (Custom) & [Tailwind CSS v3](https://tailwindcss.com/) | Kerangka desain responsif dan styling visual UI |
| **Image Processing** | [Sharp](https://sharp.pixelplumbing.com/) | Optimasi, pengenalan, dan pemrosesan gambar lokal |
| **App Builder** | [Electron Builder](https://www.electron.build/) | Pengemasan aplikasi menjadi installer Windows (`.exe`) |
| **Configuration** | [Dotenv](https://github.com/motdotla/dotenv) | Pengelolaan environment variables (`.env`) |

---

## 📁 Struktur Folder Proyek

```
bot2/
├── index.js                  # Entry point utama untuk mode CLI (Playwright Core)
├── prompts.txt               # File daftar prompt gambar (1 prompt per baris)
├── .env                      # Konfigurasi variabel lingkungan lokal (sensitif, diabaikan Git)
├── .env.example              # Template contoh konfigurasi .env
├── package.json              # Metadata proyek, skrip NPM, dan daftar dependensi
├── package-lock.json         # Lockfile dependensi Node.js
├── electron-builder.yml      # Konfigurasi pembungkusan (build) installer Electron
├── .gitignore                # Aturan pengabaian file Git
│
├── gui/                      # 📂 Folder Aplikasi Electron GUI
│   ├── main.js               # Main process Electron (bootstrap window & IPC listeners)
│   ├── preload.js            # Preload script (jembatan API IPC aman ke renderer)
│   │
│   ├── handlers/             # 📂 Handler Backend IPC (Main Process)
│   │   ├── botHandlers.js    # Mengelola lifecycle proses bot (spawn, monitoring, kill)
│   │   ├── fileHandlers.js   # Operasi manajemen file galeri (read, rename, delete, restore)
│   │   └── windowHandlers.js # Kontrol jendela window (minimize, maximize, close, config file)
│   │
│   └── renderer/             # 📂 Frontend Aplikasi (Renderer Process)
│       ├── index.html        # Struktur HTML utama panel kontrol
│       ├── flow_bot_banner.png # Gambar banner aplikasi
│       ├── icon.png          # Logo aplikasi
│       ├── css/              # 📂 Modular CSS Stylesheets
│       │   ├── base.css      # CSS Reset, variabel warna, font, dan keyframes animasi
│       │   ├── layout.css    # Layout structural (titlebar, sidebar, main panel, tab-bar)
│       │   ├── main.css      # Entrypoint CSS yang meng-import semua modul stylesheet
│       │   └── components/   # Komponen visual (buttons, cards, logs, gallery, lightbox, modal)
│       └── js/               # 📂 Modular Frontend Javascript
│           ├── app.js        # Entrypoint frontend (menginisialisasi dan menghubungkan semua modul)
│           └── modules/      # Modul logika (gallery, lightbox, progress, logs, sidebar, state, toast, dll.)
│
├── utils/                    # 📂 Folder Utilitas Bot Core
│   ├── helpers.js            # Fungsi pembantu bot (retry, delay, pembersih nama berkas)
│   └── logger.js             # Logger bot core untuk output konsol dan file harian
│
├── output/                   # 📂 Folder Output Gambar (dibuat otomatis, diabaikan Git)
│   ├── .trash/               # Folder penampung sementara gambar yang dihapus dari galeri
│   └── .progress.json        # File pelacakan resume progress unduhan
│
├── logs/                     # 📂 Folder Log Bot Core (dibuat otomatis, diabaikan Git)
│   └── bot-YYYY-MM-DD.log    # Berkas log plain-text harian
│
└── browser_session/          # 📂 Folder Profil Sesi Browser CLI (dibuat otomatis, diabaikan Git)
```

---

## ✅ Prasyarat Sistem

Sebelum menjalankan aplikasi, pastikan sistem Anda memenuhi prasyarat berikut:
* **Node.js**: Versi **18 atau yang lebih baru** (Direkomendasikan versi LTS terbaru) -> [Download Node.js](https://nodejs.org/)
* **Operating System**: Windows 10 / 11 (Diperlukan karena bot menggunakan perintah command prompt bawaan seperti `taskkill` untuk manajemen proses Chrome).
* **Akun Google**: Akun Google yang aktif dengan akses ke Google Flow.
* Koneksi internet stabil untuk proses upscale gambar server-side di Google Flow.

---

## 🚀 Instalasi & Setup

### 1. Clone Repository
Buka terminal/CMD dan jalankan perintah:
```bash
git clone https://github.com/insa21/bot-flow.git
cd bot-flow
```

### 2. Install Dependensi Proyek
Install semua dependensi Node.js yang diperlukan:
```bash
npm install
```

### 3. Install Browser Playwright Chromium
Playwright memerlukan instalasi browser Chromium internal agar automasi berjalan dengan andal:
```bash
npx playwright install chromium
```

### 4. Setup File Environment
Salin berkas `.env.example` menjadi `.env` di root direktori proyek:
```bash
copy .env.example .env
```
Buka file `.env` yang baru dibuat dan sesuaikan pengaturannya (lihat bagian [Konfigurasi](#-konfigurasi-env) di bawah).

---

## ⚙️ Konfigurasi (.env)

Berikut adalah pengaturan parameter di dalam file `.env`:

```env
# ── Mode Browser ────────────────────────────────────────────────
# false = Browser terlihat (direkomendasikan untuk login awal & debug)
# true  = Headless (berjalan di latar belakang tanpa jendela browser)
HEADLESS=false

# ── Folder Sesi Browser ─────────────────────────────────────────
# Tempat menyimpan cookie dan sesi login Google agar tidak perlu login ulang
USER_DATA_DIR=./browser_session

# ── Timeout & Retry ─────────────────────────────────────────────
# Maksimal waktu tunggu generate gambar per prompt (dalam milidetik)
TIMEOUT_MS=120000

# Jumlah percobaan ulang jika generate atau unduhan gambar gagal
MAX_RETRIES=3

# Timeout menunggu menu klik kanan muncul pada gambar (ms)
CONTEXT_MENU_TIMEOUT_MS=15000

# Timeout maksimal menunggu server Google melakukan upscale dan mengirim gambar (ms)
DOWNLOAD_TIMEOUT_MS=300000

# ── Resolusi Download ───────────────────────────────────────────
# Pilihan ukuran: native | 1k | 2k | 4k
IMAGE_SIZE=2k
```

---

## 🎮 Cara Menjalankan Aplikasi

Aplikasi dapat dijalankan dalam dua mode operasional:

### A. Mode Graphical User Interface (GUI) - Direkomendasikan
Mode ini mempermudah pengelolaan antrean, monitoring log secara visual, dan manajemen file gambar yang diunduh.

#### 1. Mode Development (dengan Electron Live)
Untuk menjalankan aplikasi GUI dalam lingkungan pengembangan:
```bash
npm run gui
```
*Tips: Tekan tombol **F12** pada keyboard untuk membuka Electron DevTools jika ingin melakukan inspeksi elemen UI.*

#### 2. Mode Production
Jalankan file `.exe` hasil kompilasi yang ada di dalam folder `dist/` setelah Anda melakukan build aplikasi.

#### Alur Login Pertama Kali di GUI:
1. Klik tombol **Start Bot** di panel kiri bawah GUI.
2. Jendela browser otomatis terbuka.
3. Masukkan kredensial akun Google Anda di browser tersebut untuk login.
4. Setelah login berhasil dan masuk ke halaman Google Flow, bot akan mendeteksi otomatis dan mulai bekerja.
5. Sesi login tersimpan dengan aman secara lokal, sehingga pada eksekusi berikutnya Anda tidak perlu login ulang.

---

### B. Mode Command Line Interface (CLI)
Mode ini sangat cocok untuk eksekusi cepat langsung melalui terminal tanpa membuka jendela aplikasi Electron.

#### 1. Isi Prompt
Edit file `prompts.txt` di root proyek dan tuliskan prompt Anda (satu prompt per baris). Baris yang diawali dengan tanda `#` dianggap sebagai komentar dan dilewati.

#### 2. Jalankan Bot
Eksekusi perintah berikut di terminal:
```bash
npm start
```
Atau alternatifnya:
```bash
node index.js
```

---

## 📦 Cara Build Aplikasi Menjadi Executable (.exe)

Anda dapat mengemas seluruh kode aplikasi GUI menjadi file setup executable (`.exe`) mandiri yang dapat diinstal di komputer Windows lain tanpa memerlukan dependensi Node.js eksternal.

Jalankan perintah berikut:
```bash
npm run build:gui
```

Proses kompilasi akan berjalan menggunakan `electron-builder` dan hasilnya akan disimpan di dalam folder baru bernama `dist/`:
* File utama: `dist/Flow Bot Setup 1.0.0.exe` (Installer aplikasi).
* Konfigurasi installer mendukung pemilihan folder instalasi kustom oleh user (*installation directory chooser*).

---

## 🔍 Troubleshooting Umum

### ❓ Jendela browser tertutup atau crash dengan kode kesalahan
* **Penyebab**: Terjadi konflik dengan instance Chrome lain atau RAM sistem penuh.
* **Solusi**: Tutup semua proses Chrome yang berjalan di latar belakang dengan menjalankan perintah berikut di Command Prompt (Administrator):
  ```cmd
  taskkill /F /IM chrome.exe
  ```
  Jika masalah berlanjut, Anda dapat menghapus folder sesi lokal `browser_session/` atau `browser_session_gui/` untuk merestart sesi dari awal.

### ❓ Bot macet pada tulisan "Menunggu halaman Flow siap..."
* **Penyebab**: Sesi login Google kedaluwarsa atau memerlukan verifikasi keamanan tambahan (seperti 2FA).
* **Solusi**: Pastikan opsi `HEADLESS=false` diatur di `.env` (atau matikan toggle headless di GUI), lalu lakukan proses login/verifikasi 2FA secara manual pada jendela browser Chromium yang muncul.

### ❓ Gambar gagal didownload dengan resolusi 2K atau 4K
* **Penyebab**: Server Google memerlukan waktu lebih lama untuk melakukan upscale gambar sebelum mengirimkannya ke browser.
* **Solusi**: Naikkan durasi batas waktu download di file `.env` atau melalui sidebar pengaturan GUI:
  ```env
  DOWNLOAD_TIMEOUT_MS=600000   # Naikkan menjadi 10 menit
  CONTEXT_MENU_TIMEOUT_MS=25000 # Naikkan waktu tunggu klik kanan menjadi 25 detik
  ```

### ❓ Tombol Galeri tidak memuat gambar yang baru saja di-download
* **Penyebab**: Folder output gambar berbeda dengan folder pemantauan aktif galeri.
* **Solusi**: Periksa sidebar pengaturan GUI pada bagian **Output Folder**. Pastikan path menunjuk ke folder yang sesuai (misalnya `./output`). Anda juga dapat mengklik tombol **Open in Explorer** untuk memverifikasi secara langsung keberadaan berkas gambar tersebut.

---

## 🔒 Keamanan & Lisensi

* **Keamanan Kredensial**: File `.env` dan folder `browser_session/` atau `browser_session_gui/` menyimpan informasi penting (seperti token akses & cookies akun Google). **JANGAN PERNAH** membagikan atau mem-push berkas/folder tersebut ke repository publik. Aturan ini telah dikonfigurasi secara ketat pada berkas `.gitignore`.
* **Ketentuan Penggunaan**: Gunakan aplikasi otomasi ini secara bijak dan patuhi ketentuan layanan penggunaan layanan Google Labs.
* **Lisensi**: Proyek ini dilisensikan untuk penggunaan personal dan pengembangan internal.

---

<div align="center">
  <sub>Dibuat dengan ☕ — Flow Bot v1.0.0</sub>
</div>
