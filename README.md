# ffweb - ffmpeg on the web

A modern, lightweight web dashboard for processing media with **FFmpeg** right from your browser. Built with **0 external pip dependencies** using pure Python standard library.

Runs seamlessly on **Windows**, **Linux**, **macOS**, and **Android (Termux)**.

---

## 💡 What You Can Do with ffweb

- **Batch convert media in seconds**: Select multiple videos, audios, or images from your folder, pick an optimized preset, and convert them in one go. Run conversions sequentially or with up to **4 parallel workers** to speed things up.
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

*(Note: `ffcli` also works and automatically redirects to `ffweb`)*.

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
├── .gitattributes         # Enforce LF endings on shell scripts
├── README.md              # Documentation
└── web/
    ├── index.html         # Frontend HTML structure
    ├── style.css          # Styling & dark pastel theme
    └── app.js             # Client logic, live polling & preview
```

---

## 📄 License & Author

Created by [natelyt12](https://github.com/natelyt12). Open source under the MIT License.
