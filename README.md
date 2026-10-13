# ffweb - ffmpeg on the web

A modern, lightweight web dashboard for processing media with **FFmpeg** right from your browser. Built with **0 external pip dependencies** using pure Python standard library.

Runs seamlessly on **Windows**, **Linux**, **macOS**, and **Android (Termux)**.

---

## 💡 What You Can Do with ffweb

- **Batch convert media in seconds**: Select multiple videos, audios, or images from your folder, pick an optimized preset, and convert them in one go. Run conversions sequentially or with up to **4 parallel workers** to speed things up.
- **Dedicated Video Cutter**: Live video preview with real-time frame scrubbing, dual-handle range selection, timecode inputs (`hh:mm:ss.ms`), keyframe / stream copy lossless fast-export, frame-accurate re-encoding, and audio waveform displayed directly beneath the timeline.
- **Dedicated Audio Cutter & Waveform Studio**: High-resolution interactive audio waveform canvas with zoom levels (1x-8x), draggable In/Out boundary handles, draggable cut region window, audio playback, Fade In / Fade Out effects, and multi-format export (MP3, WAV, AAC, FLAC, M4A, Stream Copy).
- **Preview media right in your browser**: Watch videos, listen to music tracks, or check images with smooth seeking before converting—no external players needed.
- **Rename or delete files on the spot**: Rename files or clean up unwanted originals directly from the web interface without switching back and forth to File Explorer.
- **Watch real-time speed & inspect full logs**: Monitor live progress percentage, encoding speed multiplier (e.g. `2.8x`), and FPS. Click any task to inspect the exact FFmpeg command and live terminal logs, with a one-click `Copied!` button.
- **Cancel safely without leaving broken files**: Skip an individual file or cancel the whole batch with a single click—any unfinished output files are automatically cleaned up immediately.
- **Create and manage custom presets**: Choose from built-in recipes (universal playback, maximum compression, audio extraction) or save your own custom FFmpeg commands in the Presets tab.
- **Launch from anywhere with zero setup**: Click the address bar of any folder in Windows Explorer (or terminal), type `ffweb`, and the dashboard opens automatically at that folder. No Flask, Node.js, or pip installs needed.

---

## 📋 Prerequisites

1. **Python 3.8+** installed and available in your `PATH`.
2. **FFmpeg & FFprobe** installed and available in your `PATH`.

---

## 🚀 Quick Start

### 🖥️ Windows

Open a terminal or click the address bar in any folder in **Windows Explorer**, type `ffweb`, and press Enter:

```cmd
ffweb
```

Or pass a media folder path directly:

```cmd
ffweb "D:\Videos\Movies"
```

---

### 🐧 Linux & 🍎 macOS

Make the script executable (first time only) and run:

```bash
chmod +x ffweb
./ffweb
# or specify a folder:
./ffweb /path/to/media
```

---

### 📱 Android (Termux)

You can run `ffweb` directly on your Android device:

1. Install **Termux** (from F-Droid) and grant storage permission:
   ```bash
   termux-setup-storage
   ```
2. Install Python and FFmpeg:
   ```bash
   pkg update && pkg install python ffmpeg -y
   ```
3. Navigate to the project folder and launch:
   ```bash
   python ffweb.py ~/storage/shared/DCIM
   ```
   *(Or `./ffweb`). The web dashboard will automatically open in your mobile browser via `termux-open-url`!*

---

## 🛠️ Adding to System PATH (Run from Anywhere)

### Windows
1. Press `Win + S` and search for **Environment Variables**.
2. Click **Edit the system environment variables** $\rightarrow$ **Environment Variables**.
3. Under **User variables**, select `Path` and click **Edit**.
4. Click **New** and paste the folder path containing `ffweb.bat`.
5. Click **OK**. Now you can type `ffweb` in any terminal or Windows Explorer address bar!

### Linux / macOS / Termux
Add an alias to your `~/.bashrc` or `~/.zshrc`:

```bash
echo "alias ffweb='python3 $(pwd)/ffweb.py'" >> ~/.bashrc
source ~/.bashrc
```

---

## ⚙️ Built-in Presets

| Preset | FFmpeg Arguments | Output | Best For |
| :--- | :--- | :---: | :--- |
| **Universal Video** | `-c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -profile:v high -level 4.1 -movflags +faststart -c:a aac -b:a 256k` | `.mp4` | 100% playback compatibility across all devices, TVs, and web browsers with visually lossless quality. |
| **Max Compression** | `-c:v libx265 -crf 24 -preset medium -tag:v hvc1 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 128k` | `.mp4` | H.265 HEVC compression saving 50% to 75% file size while preserving high visual fidelity. |
| **Extract MP3 (320kbps Best Quality)** | `-vn -c:a libmp3lame -b:a 320k` | `.mp3` | Highest quality 320kbps CBR MP3 extraction from video/audio files. |
| **Extract MP3 (VBR High Quality)** | `-vn -c:a libmp3lame -q:a 2` | `.mp3` | High quality variable bitrate (~190-250kbps) MP3 with optimal file size. |

You can add your own custom presets anytime in the **Presets Manager** tab.

---

## 📂 Project Structure

```text
ffweb/
├── ffweb.py               # Main Python server (pure standard library)
├── ffmpeg_commands.json   # Presets database
├── ffweb.bat              # Windows batch launcher
├── ffweb                  # Linux / macOS / Termux bash launcher
├── .gitignore             # Standard repository ignore rules
├── .gitattributes         # Enforce LF endings on shell scripts
├── README.md              # Documentation
└── web/
    ├── index.html         # Frontend HTML structure
    ├── style.css          # Styling & dark pastel theme
    └── js/                # ES modules (loaded natively, no build step)
        ├── main.js        # Bootstrap: global handler binding, listeners, init
        ├── core/
        │   └── utils.js   # Shared helpers (icons, escaping, timecodes)
        └── features/
            ├── explorer.js   # Media explorer, selection & folder switching
            ├── presets.js    # Preset library & editor modal
            ├── batch.js      # Batch conversion, live progress & log modal
            ├── preview.js    # Media preview lightbox
            ├── tabs.js       # Tab navigation & cutter file pickers
            └── cutters/
                ├── video.js  # Video cutter controller
                ├── audio.js  # Audio cutter / waveform studio
                └── trim.js   # Trim execution & status polling
```

---

## 📄 License & Author

Created by [natelyt12](https://github.com/natelyt12/ffweb). Open source under the MIT License.
