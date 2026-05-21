# FFCLI - FFmpeg CLI Manager

An interactive command-line interface designed to streamline media processing workflows using FFmpeg, optimized for both **Windows** and **Android (Termux)**.

---

## Features

- **Multi-Platform Support**: Dedicated versions for Windows (`ffmgr.py`) and Android (`ffmgr_android.py`) for optimized compatibility.
- **Unified Keyboard Controls (WASD + F)**:
  - **`w`**: Move selection up.
  - **`s`**: Move selection down.
  - **`f`** or **`Enter`**: Confirm/Proceed.
  - **`Esc`**: Back/Cancel (removes key mapping conflicts with native terminal keyboard shortcuts).
- **Clickable Virtual Search Button**:
  - `🔍 Search` is now represented as a dedicated, clickable option at the top of lists. Confirming it opens a safe input prompt via `interactive_input` to filter lists, preventing navigation keys from colliding with live typing filters.
- **Auto-Suggested Input Extension**:
  - When writing custom FFmpeg commands (`[Manual] Enter Custom FFmpeg Command`), the program automatically suggests the exact extension of the first selected input file as the default output format.
- **Preset Block Layouts**:
  - Horizontal preset tables are refactored into modern, clean vertical block layouts separated by subtle dividers, ensuring full responsiveness on small mobile screens.
- **Smart Android Directory Browser (`ffmgr_android.py`)**:
  - Visually lists folders in white (`📁 `) and files in muted gray (`📄 `).
  - Preventative guardrails: Automatically hides the `< back` navigation option when inside storage base directories (e.g., `/storage/emulated/0`) and safely redirects the user to their Termux Home directory if directory access failures occur, preventing infinite terminal freeze loops.
- **Automatic Media Discovery**: Automatically scans the current working directory for supported video, audio, and image formats.
- **Integrated Utilities**: Fast metadata viewer powered by `ffprobe` and safe native file launching.

---

## Prerequisites

1. **Python 3.x**: Must be installed and configured in your path environment.
2. **FFmpeg**: Both `ffmpeg` and `ffprobe` binaries must be installed and accessible.

---

## Installation & Setup

### 🖥️ Windows Setup
1. Clone or download this repository:
   ```bash
   git clone https://github.com/natelyt12/ffcli.git
   cd ffcli
   ```
2. (Optional) To launch `ffcli` from any directory, add the folder path of this repository to your system's Environment Variables (`PATH`). You can then launch it instantly by typing:
   ```cmd
   ffcli
   ```

### 📱 Android (Termux) Setup
1. Download and install **Termux** (strongly recommended to install the latest build from [F-Droid](https://f-droid.org/en/packages/com.termux/)).
2. Grant storage permission to Termux by running:
   ```bash
   termux-setup-storage
   ```
   *Accept the system storage permission prompt.*
3. Install dependencies:
   ```bash
   pkg update && pkg upgrade -y
   pkg install python ffmpeg termux-api -y
   ```
4. Transfer `ffmgr_android.py` and `ffmpeg_commands.json` to your phone (e.g., into your phone's `Download` directory).
5. Open Termux, navigate to the folder, and run:
   ```bash
   cd /sdcard/Download
   python ffmgr_android.py
   ```
6. **Pro-tip (Create a command shortcut):**
   Run the following in Termux to create a quick alias:
   ```bash
   echo "alias ffcli='python /sdcard/Download/ffmgr_android.py'" >> ~/.bashrc
   source ~/.bashrc
   ```
   Now you can just type `ffcli` from anywhere in Termux to open the app!

---

## Usage Controls

* **`w` / `s`**: Navigate Menu Items (Up/Down)
* **`f` / `Enter`**: Confirm Selection / Action
* **`Space`**: Toggle items (in multi-select screens)
* **`Esc`**: Go Back / Cancel current dialog or prompt

---

## Project Structure

- `ffmgr.py`: The CLI manager application optimized for **Windows** environments.
- `ffmgr_android.py`: The CLI manager application optimized for **Android (Termux)**, removing unsafe preview functions and featuring sandboxed directory protections.
- `ffmpeg_commands.json`: A JSON database storing your saved FFmpeg command presets.
- `ffcli.bat`: A lightweight batch wrapper for simple launch execution on Windows.

---
Developed by [natelyt12](https://github.com/natelyt12)
