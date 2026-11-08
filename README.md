# ffcli - ffmpeg presets in your terminal, cutting in your browser

`ffcli` runs **FFmpeg** presets or your own FFmpeg commands over as many files as
you like, all from an interactive terminal menu. Each audio/video row also has a
focused web cutter for trimming that one file.

Pure Python standard library: no pip installs, no Flask, no Node.js. Runs on
**Windows**, **Linux**, **macOS** and **Android (Termux)**.

---

## 💡 What it does

- **Preset conversions in bulk** - pick files in a terminal menu, choose a preset
  (or write your own FFmpeg options), and run 1-4 conversions in parallel.
- **Custom FFmpeg commands** - type the options after `-i`, or paste a whole
  `ffmpeg -i in.mp4 ... out.mp4` line and let `ffcli` pull the arguments and
  output extension out of it.
- **Preset library** - add, edit and delete presets from the menu.
- **Per-file row actions** - `View`, `Rename`, `Cut`, `Delete` on audio and video,
  `View`, `Rename`, `Delete` on images.
- **Focused cutter** - `Cut` opens a local page that trims *only that file*: a
  video timeline or an audio waveform, In/Out handles, and a `_output` file. No
  file browser, no presets, no batch. It closes itself and hands the terminal
  back when the cut is done. See [Web cutter](#-web-cutter).

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
| `→` | Focus the next row action (`View` → `Rename` → `Cut` → `Delete`) |
| `←` | Step back through the row actions |
| `Enter` | Confirm, or run the focused row action |
| `Esc` | Back - returns to the file list from any sub-menu |
| `Space` | Toggle a file or a whole extension group |

The file picker starts with two control rows:

- **Filter** - type a keyword to narrow the list (blank clears it).
- **Sort** - press `Enter` to cycle `name (A-Z)` → `date added (newest first)` →
  `file group (.ext)`.

Below them sit the `Select ALL .mp4` style toggles and the files themselves, each
with its extension, name and size. Move onto a file and the row shows its action
buttons:

```
 ➜  [ ] [MP4]   clip.mp4 (45.1 KB)  [ View ] [ Rename ] [ Cut ] [ Delete ]
```

`View` opens the file in your default player, `Rename` asks for a new name,
`Cut` opens the web cutter for that file and `Delete` removes it after a
confirmation. Images get `View`, `Rename` and `Delete`.

`Back` (or `Esc`) never throws away your work: from the preset menu, the
post-process menu or the concurrency menu it returns to the file list with your
selection still checked - and the row you were on stays focused, even after a
`Cut` refreshes the folder.

---

## 🧭 The menu

Everything is reachable from the one and only entry point, `ffcli`:

| Entry | What happens |
| :--- | :--- |
| Process media in this folder | Pick files, pick a preset or type an FFmpeg command |
| Manage presets | List / add / edit / delete presets |
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

Pick `Cut` on an audio or video row and `ffcli` starts `ffcli_web.py` for **that
one file** and opens it in your browser:

- **Video** - preview player, a timeline with the audio waveform behind it and
  draggable In/Out handles, timecode inputs, and three modes: *stream copy*
  (fast, keyframe aligned), *re-encode* (frame accurate, H.264 CRF 19 + AAC) or
  *extract audio* (MP3 320k).
- **Audio** - waveform canvas with draggable In/Out handles, fade in / fade out,
  and export as copy, MP3 320k, WAV, FLAC or AAC 256k.

Only the player that matches the file is shown, and `Space` plays or pauses it.

The output is always `<name>_output.<ext>` next to the source. When the cut
finishes the page reports it, tries to close its own tab and stops the server, so
the terminal menu comes straight back with the new `_output` file in the list.
`Ctrl+C` in the terminal aborts instead.

The page is deliberately single-purpose: it serves exactly the file you asked to
cut, binds to `127.0.0.1`, and exposes no file browser, no presets and no batch
conversion.

---

## 📂 Project structure

```text
ffcli/
├── ffcli.py               # entry point: the interactive terminal menu
├── ffcore.py              # shared core: media detection, presets, ffmpeg runner
├── ffcli_web.py           # single-file cutter server (one file, trim only)
├── ffmpeg_commands.json   # preset library
├── ffcli.bat              # Windows launcher
├── ffcli                  # Linux / macOS / Termux launcher
├── README.md
└── web/                   # cutter page (plain HTML/CSS/JS, no build step)
    ├── index.html
    ├── style.css          # dark stone theme
    └── js/
        └── app.js         # timeline + waveform, cut request, status polling
```

---

## 📄 License & Author

Created by [natelyt12](https://github.com/natelyt12/ffcli). Open source under the MIT License.
