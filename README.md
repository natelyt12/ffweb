# ffcli - ffmpeg presets in your terminal, cutting in your browser

`ffcli` runs **FFmpeg** presets or your own FFmpeg commands over as many files as
you like - from an interactive terminal menu or from a plain command line. When
you need to actually *see* where to cut, it opens a local web cutter with a
waveform / timeline editor.

Pure Python standard library: no pip installs, no Flask, no Node.js. Runs on
**Windows**, **Linux**, **macOS** and **Android (Termux)**.

---

## 💡 What it does

- **Preset conversions in bulk** - pick files in a terminal menu, choose a preset
  (or write your own FFmpeg options), and run 1-4 conversions in parallel.
- **Scriptable** - `ffcli run *.mp4 -p "preset"` works in pipelines, cron jobs
  and batch files, with progress, exit codes and `--dry-run`.
- **Custom FFmpeg commands** - type the options after `-i`, or paste a whole
  `ffmpeg -i in.mp4 ... out.mp4` line and let `ffcli` pull the arguments and
  output extension out of it.
- **Preset library** - add, edit, delete, import and export presets. The same
  `ffmpeg_commands.json` feeds the CLI and the web UI.
- **Web cutter on demand** - `ffcli cut` starts a local dashboard with a video
  timeline scrubber and an audio waveform studio (zoom, draggable In/Out handles,
  fade in/out, stream-copy or frame-accurate export). See
  [Web cutter](#-web-cutter) below.

---

## 📋 Prerequisites

1. **Python 3.8+** available in your `PATH`.
2. **FFmpeg & FFprobe** available in your `PATH`.

`ffcli doctor` tells you what is missing.

---

## 🚀 Quick start

### 🖥️ Windows

```cmd
ffcli                                  :: interactive menu for the current folder
ffcli run movie.mkv -p "Max Compression (H.265 HEVC)"
```

Add the folder containing `ffcli.bat` to your `PATH` to run it from anywhere -
including the address bar of Windows Explorer.

### 🐧 Linux & 🍎 macOS

```bash
chmod +x ffcli
./ffcli
./ffcli run *.mp4 -p "Extract MP3 Audio (VBR High Quality)"
```

### 📱 Android (Termux)

```bash
pkg update && pkg install python ffmpeg -y
cd ~/storage/shared/DCIM && python ffcli.py              # interactive menu
python ffcli.py -C ~/storage/shared/DCIM run *.mp4 -p "Extract MP3 Audio (VBR High Quality)"
python ffcli.py cut ~/storage/shared/DCIM                # web cutter in your browser
```

---

## ⌨️ Interactive mode

Run `ffcli` with no arguments inside a media folder:

| Key | Action |
| :--- | :--- |
| `↑` / `↓` | Move |
| `Enter` | Confirm |
| `Esc` | Back |
| `Space` | Toggle a file (multi-select) |
| Typing a letter/digit | Jump to the matching entry |

The file picker offers `Select ALL .mp4` style toggles, shows size and type per
file, and supports a search filter. After picking files you choose a preset or a
custom command, whether to delete the originals, and how many FFmpeg processes to
run at once.

---

## 🧰 Command line

```text
ffcli [--config FILE] [-C DIR] <command> ...
```

| Command | Purpose |
| :--- | :--- |
| `ffcli` | Interactive menu for the current folder |
| `ffcli run <inputs...>` | Convert files with `--preset` or `--cmd` |
| `ffcli presets list\|show\|add\|set\|rm\|import\|export` | Manage the preset library |
| `ffcli cut [path]` (alias `web`) | Start the web cutter in your browser |
| `ffcli doctor` | Check Python, FFmpeg, FFprobe and the preset file |

Useful `run` options: `-p/--preset`, `-c/--cmd`, `-e/--ext`, `-o/--out`,
`-j/--jobs`, `--delete`, `--skip-existing`, `--dry-run`, `-q/--quiet`.
Inputs may be files, glob patterns (`*.mp4`) or folders.

```bash
# preset over a whole folder
ffcli run clips/ -p "Universal Video (Max Compatibility & Quality)"

# four files at a time, delete the sources when they succeed
ffcli run *.mkv -p "Max Compression (H.265 HEVC)" -j 4 --delete

# custom options, exact output name, see the command without running it
ffcli run talk.mp4 -c "-vn -c:a libmp3lame -b:a 192k" -o talk.mp3 --dry-run
```

### ⚠️ Passing FFmpeg options

FFmpeg options start with `-`, so anything after `--` is treated as FFmpeg
arguments verbatim:

```bash
ffcli run *.mp4 -- -c:v libx264 -crf 23 -c:a aac
```

If your shell mangles `-c:v` (PowerShell treats the colon specially), quote the
option, or use the `--cmd="..."` form:

```powershell
ffcli run *.mp4 -- "-c:v" libx264 -crf 23 "-c:a" aac
ffcli run *.mp4 -e .mp4 --cmd="-c:v libx264 -crf 23 -c:a aac"
```

---

## ⚙️ Presets

Presets live in `ffmpeg_commands.json` next to `ffcli.py`. Override the location
with `--config PATH` or the `FFCLI_CONFIG` environment variable; the file is
created on first use, seeded from the built-in defaults.

```json
{
    "Extract MP3 Audio (VBR High Quality)": {
        "cmd": "-vn -c:a libmp3lame -q:a 2",
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
| Extract MP3 Audio (VBR High Quality) | `.mp3` | Variable bitrate MP3 (~190-250kbps), smaller files. |
| Image compress | `.jpg` | Re-encode images at JPEG quality 5. |

---

## ✂️ Web cutter

`ffcli cut` (or `ffcli web`) starts the local dashboard and opens it in your
browser, scoped to a folder:

```bash
ffcli cut                      # current folder
ffcli cut "D:\Videos\Movies"   # a specific folder
ffcli cut movie.mp4 --port 8800
```

It is a separate feature, not a replacement for the CLI:

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
├── ffcli.py               # CLI entry point: interactive menu + subcommands
├── ffcore.py              # shared core: media detection, presets, ffmpeg runner
├── ffcli_web.py           # web cutter feature (local HTTP server)
├── ffmpeg_commands.json   # preset library, shared by the CLI and the web UI
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
