# ffcli - ffmpeg presets in your terminal, cutting in your browser

`ffcli` runs **FFmpeg** presets or your own FFmpeg commands over as many files as
you like, all from an interactive terminal menu. When you need to actually *see*
where to cut, it opens a local web cutter with a waveform / timeline editor.

Pure Python standard library: no pip installs, no Flask, no Node.js. Runs on
**Windows**, **Linux**, **macOS** and **Android (Termux)**.

---

## 💡 What it does

- **Preset conversions in bulk** - pick files in a terminal menu, choose a preset
  (or write your own FFmpeg options), and run 1-4 conversions in parallel.
- **Custom FFmpeg commands** - type the options after `-i`, or paste a whole
  `ffmpeg -i in.mp4 ... out.mp4` line and let `ffcli` pull the arguments and
  output extension out of it.
- **Preset library** - add, edit and delete presets from the menu. The same
  `ffmpeg_commands.json` feeds the terminal menu and the web UI.
- **Web cutter on demand** - one menu entry starts a local dashboard with a video
  timeline scrubber and an audio waveform studio (zoom, draggable In/Out handles,
  fade in/out, stream-copy or frame-accurate export). See
  [Web cutter](#-web-cutter) below.

---

## 📋 Prerequisites

1. **Python 3.8+** available in your `PATH`.
2. **FFmpeg & FFprobe** available in your `PATH`.

`ffcli` checks both at startup and tells you what is missing.

---

## 🚀 Quick start

### 🖥️ Windows

```cmd
ffcli
```

Add the folder containing `ffcli.bat` to your `PATH` to run it from anywhere -
including the address bar of Windows Explorer.

### 🐧 Linux & 🍎 macOS

```bash
chmod +x ffcli
./ffcli
```

### 📱 Android (Termux)

```bash
pkg update && pkg install python ffmpeg -y
cd ~/storage/shared/DCIM && python ffcli.py
```

---

## ⌨️ Interactive mode

Run `ffcli` with no arguments inside a media folder:

| Key | Action |
| :--- | :--- |
| `↑` / `↓` | Move (separators are skipped) |
| `Enter` | Confirm / open the focused row |
| `Esc` | Back |
| `Space` | Toggle a file or a whole extension group |

The file picker starts with two control rows:

- **Filter** - type a keyword to narrow the list (blank clears it).
- **Sort** - press `Enter` to cycle `name (A-Z)` → `date added (newest first)` →
  `file group (.ext)`.

Below them sit the `Select ALL .mp4` style toggles and the files themselves, each
with its extension, name and size. After picking files you choose a preset or a
custom command, whether to delete the originals, and how many FFmpeg processes to
run at once.

---

## 🧭 The menu

Everything is reachable from the one and only entry point, `ffcli`:

| Entry | What happens |
| :--- | :--- |
| Process media in this folder | Pick files, pick a preset or type an FFmpeg command |
| Manage presets | List / add / edit / delete presets |
| Open the web cutter | Starts the local dashboard for the current folder |
| Show preset file location | Prints the absolute path of `ffmpeg_commands.json` |
| Exit | Closes the tool |

---

## ⚙️ Presets

Presets live in `ffmpeg_commands.json` next to `ffcli.py`; **Show preset file
location** in the menu prints its absolute path. Set `FFCLI_CONFIG` to point at a
different file. The file is created on first save, seeded from the built-in
defaults.

```json
{
    "Extract MP3 Audio (320kbps Best Quality)": {
        "cmd": "-vn -c:a libmp3lame -b:a 320k",
        "ext": ".mp3"
    }
}
```

`cmd` holds the options that come **after** `-i input`, `ext` is the output
extension. The legacy `{"name": "options string"}` form is still read.

Built-in presets:

| Preset | Output | Best for |
| :--- | :---: | :--- |
| Universal Video (Max Compatibility & Quality) | `.mp4` | H.264 CRF 18 + AAC 256k, `+faststart`; plays everywhere. |
| Max Compression (H.265 HEVC) | `.mp4` | HEVC CRF 24; roughly half the size at similar quality. |
| Extract MP3 Audio (320kbps Best Quality) | `.mp3` | Highest quality CBR MP3 from video or audio. |
| Image compress | `.jpg` | Re-encode images at JPEG quality 5. |

---

## ✂️ Web cutter

Choose **Open the web cutter** in the menu and `ffcli` starts the local dashboard
and opens it in your browser, scoped to the folder you launched `ffcli` from.
`Ctrl+C` in the terminal (or the Exit button in the page) stops it.

It is a separate feature, not a replacement for the terminal menu:

- **Video cutter** - frame preview, scrubbing, dual-handle range selection,
  timecode inputs, lossless stream-copy export or frame-accurate re-encode.
- **Audio cutter / waveform studio** - zoomable waveform (1x-8x), draggable
  In/Out handles and region window, fade in / fade out, export to MP3, WAV, AAC,
  FLAC, M4A or stream copy.
- **Batch tab** - preset conversion with live progress, speed and logs, plus
  preview, rename and delete of the files in the current folder.

The server binds to `127.0.0.1` only and shuts down with `Ctrl+C` in the terminal
or the Exit button in the page.

---

## 📂 Project structure

```text
ffcli/
├── ffcli.py               # entry point: the interactive terminal menu
├── ffcore.py              # shared core: media detection, presets, ffmpeg runner
├── ffcli_web.py           # web cutter feature (local HTTP server)
├── ffmpeg_commands.json   # preset library, shared by the menu and the web UI
├── ffcli.bat              # Windows launcher
├── ffcli                  # Linux / macOS / Termux launcher
├── README.md
└── web/                   # web cutter front-end (loaded natively, no build step)
    ├── index.html
    ├── style.css
    └── js/
        ├── main.js
        ├── core/utils.js
        └── features/
            ├── explorer.js   # media explorer, selection, folder switching
            ├── presets.js    # preset library editor
            ├── batch.js      # batch conversion, progress and logs
            ├── preview.js    # media preview lightbox
            ├── tabs.js       # tab navigation and cutter file pickers
            └── cutters/
                ├── video.js  # video cutter controller
                ├── audio.js  # audio cutter / waveform studio
                └── trim.js   # trim execution and status polling
```

---

## 📄 License & Author

Created by [natelyt12](https://github.com/natelyt12/ffcli). Open source under the MIT License.
