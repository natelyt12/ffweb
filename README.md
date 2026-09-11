# ffweb - ffmpeg in the web

A modern, ultra-lightweight web dashboard for batch media conversion powered by **FFmpeg**. Built with **0 external pip dependencies** using pure Python standard library.

Runs everywhere: **Windows**, **Linux**, **macOS**, and **Android (Termux)**.

---

## ✨ Features

- **Zero Pip Dependencies**: Runs 100% on standard Python (`http.server`, `threading`, `subprocess`). No `pip install flask`, `fastapi`, or heavy frameworks required.
- **Modern Clean Flat UI**: Pastel dark theme with crisp **Lucide Icons** and high-density pro layout.
- **In-Browser Media Preview**: Watch videos, listen to audios, or view images directly in your browser with smooth seeking before converting.
- **Batch Processing with Concurrency (1–4 Workers)**: Convert multiple media files sequentially or up to 4 files in parallel.
- **Real-Time Progress & Metrics**: Live encoding progress bar with active file name, encoding speed (e.g. `2.8x`), and FPS.
- **Live FFmpeg Log Modal**: Click any task in the queue to inspect full command arguments and stderr output in real time, with a one-click `Copied!` button.
- **Explorer File Management**: Rename or delete media files directly from the explorer table with safety locks during active conversions.
- **Instant Rollback on Cancel**: Cancel individual tasks or cancel the whole batch with automatic cleanup of unfinished output files.
- **Preset Manager**: Easily create, edit, customize, and delete your FFmpeg presets stored in `ffmpeg_commands.json`.
- **Dynamic Folder Switching**: Type `ffweb` in any folder, enter a directory path in the browser, or pick a folder with the native folder dialog.

---

## 📋 Prerequisites

1. **Python 3.8+** installed and available in your `PATH`.
2. **FFmpeg & FFprobe** installed and available in your `PATH`.

---

## 🚀 Quick Start

### 🖥️ Windows

Open a terminal or click on the address bar of any folder in **Windows Explorer**, type `ffweb`, and press Enter:

```cmd
ffweb
```

Or pass a specific media folder path directly:

```cmd
ffweb "D:\Videos\Movies"
```

*(Note: `ffcli` also works and automatically redirects to `ffweb`)*.

---

### 🐧 Linux & 🍎 macOS

Make the script executable (first time only) and run:

```bash
chmod +x ffweb
./ffweb
# or pass a folder:
./ffweb /path/to/media
```

---

### 📱 Android (Termux)

You can run `ffweb` on your Android phone using Termux:

1. Install **Termux** (from F-Droid) and set up storage:
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
   *(Or run `./ffweb` after `chmod +x ffweb`). The dashboard will automatically open in your mobile browser via `termux-open-url`!*

---

## 🛠️ Adding to System PATH (Run from Anywhere)

### Windows
1. Press `Win + S` and search for **Environment Variables**.
2. Click **Edit the system environment variables** $\rightarrow$ **Environment Variables**.
3. Under **User variables**, select `Path` and click **Edit**.
4. Click **New** and paste the folder path containing `ffweb.bat`.
5. Click **OK**. Now you can open terminal or type `ffweb` in the Explorer address bar in any folder!

### Linux / macOS / Termux
Add an alias or link to `/usr/local/bin` (or `~/.bashrc`):

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
| **Extract MP3 Audio** | `-vn -c:a libmp3lame -q:a 2` | `.mp3` | High quality VBR MP3 extraction from media files containing an audio stream. |

You can add your own custom presets anytime in the **Presets Manager** tab.

---

## 📂 Project Structure

```text
ffcli/
├── ffweb.py               # Main Python server (pure standard library)
├── ffmpeg_commands.json   # Presets database
├── ffweb.bat              # Windows batch launcher
├── ffcli.bat              # Windows backward compatibility wrapper
├── ffweb                  # Linux / macOS / Termux bash launcher
├── ffcli                  # Linux / Termux backward compatibility wrapper
├── .gitignore             # Standard repository ignore rules
├── README.md              # Documentation
└── web/
    ├── index.html         # Frontend HTML structure
    ├── style.css          # Styling & dark pastel theme
    └── app.js             # Client logic, live polling & preview
```

---

## 📄 License & Author

Created by [natelyt12](https://github.com/natelyt12). Open source under the MIT License.
