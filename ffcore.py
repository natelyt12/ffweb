"""ffcore.py - Shared core for the ffcli tool.

Holds everything that is not UI: media detection, preset storage and ffmpeg
invocation. `ffcli.py` is the terminal front-end today; the web dashboard will
import this module in a later phase so both entry points build identical
ffmpeg commands from the same preset file.

Standard library only.
"""
from __future__ import annotations

import contextlib
import json
import os
import shlex
import shutil
import subprocess
import sys
import threading
import time

VERSION = "2.0.0"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_PRESETS = os.path.join(SCRIPT_DIR, "ffmpeg_commands.json")
LEGACY_PRESETS = os.path.join(os.path.expanduser("~"), ".ffcli", "ffmpeg_commands.json")

DEFAULT_PRESETS = {
    "Universal Video (Max Compatibility & Quality)": {
        "cmd": "-c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -profile:v high "
               "-level 4.1 -movflags +faststart -c:a aac -b:a 256k",
        "ext": ".mp4",
    },
    "Max Compression (H.265 HEVC)": {
        "cmd": "-c:v libx265 -crf 24 -preset medium -tag:v hvc1 -pix_fmt yuv420p "
               "-movflags +faststart -c:a aac -b:a 128k",
        "ext": ".mp4",
    },
    "Extract MP3 Audio (320kbps Best Quality)": {
        "cmd": "-vn -c:a libmp3lame -b:a 320k",
        "ext": ".mp3",
    },
    "Compress Image (JPEG q5)": {"cmd": "-q:v 5", "ext": ".jpg"},
    "Remux to MKV (No Encode)": {"cmd": "-c copy", "ext": ".mkv"},
}


class Media:
    VIDEO = {".mp4", ".mkv", ".avi", ".mov", ".flv", ".wmv", ".webm", ".m4v", ".mpg", ".mpeg", ".3gp", ".ts"}
    AUDIO = {".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".opus", ".wma", ".mka"}
    IMAGE = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".svg", ".heic", ".heif"}
    ALL = VIDEO | AUDIO | IMAGE

    @staticmethod
    def ext(name):
        return os.path.splitext(name)[1].lower()

    @classmethod
    def kind(cls, name):
        ext = cls.ext(name)
        if ext in cls.VIDEO:
            return "video"
        if ext in cls.AUDIO:
            return "audio"
        if ext in cls.IMAGE:
            return "image"
        return "file"

    @classmethod
    def is_media(cls, name):
        return cls.ext(name) in cls.ALL

    @classmethod
    def ext_label(cls, name):
        ext = cls.ext(name)
        return f"[{ext[1:].upper()}]".ljust(7) if ext else "[FILE] ".ljust(7)

    @staticmethod
    def human_size(path):
        try:
            size = os.path.getsize(path)
        except OSError:
            return "N/A"
        for unit, limit in (("GB", 1024 ** 3), ("MB", 1024 ** 2), ("KB", 1024)):
            if size >= limit:
                return f"{size / limit:.1f} {unit}"
        return f"{size} B"

    @classmethod
    def list_dir(cls, directory="."):
        """Media file names inside `directory`, sorted for stable menu indexes."""
        try:
            names = os.listdir(directory)
        except OSError:
            return []
        return sorted(n for n in names if os.path.isfile(os.path.join(directory, n)) and cls.is_media(n))


def normalize_ext(ext, default=""):
    ext = (ext or "").strip().strip('"').strip("'")
    if not ext:
        return default
    return ext if ext.startswith(".") else "." + ext


def default_output(input_path, ext, suffix="_output"):
    stem, old_ext = os.path.splitext(input_path)
    return stem + suffix + normalize_ext(ext, old_ext)


def parse_args(template):
    """Split a preset/command string into argv tokens (posix rules, like the web app)."""
    template = (template or "").strip()
    if not template:
        return []
    try:
        return shlex.split(template)
    except ValueError:
        return template.split()


def quote_token(token):
    if token == "":
        return '""'
    if any(c in token for c in ' \t"\'') or ";" in token:
        if '"' in token and "'" not in token:
            return f"'{token}'"
        return '"' + token.replace('"', '\\"') + '"'
    return token


def format_args(args):
    return " ".join(quote_token(a) for a in args)


def extract_pasted(text, fallback_ext=""):
    """Accept a whole `ffmpeg ... -i IN ... OUT` line and keep only the options.

    Returns (args_list, output_ext). Mirrors the behaviour of the original
    terminal tool so pasted commands keep working.
    """
    tokens = parse_args(text)
    if not tokens:
        return [], normalize_ext(fallback_ext)
    if os.path.basename(tokens[0]).lower() not in ("ffmpeg", "ffmpeg.exe"):
        return tokens, normalize_ext(fallback_ext)
    if "-i" not in tokens:
        return tokens[1:], normalize_ext(fallback_ext)

    i = tokens.index("-i")
    rest = tokens[i + 2:]
    ext = normalize_ext(fallback_ext)
    if rest and not rest[-1].startswith("-"):
        detected = normalize_ext(os.path.splitext(rest[-1])[1])
        if detected:
            ext = detected
        rest = rest[:-1]
    return [t for t in rest if t not in ("-y", "-nostdin")], ext


def resolve_config_path(explicit=None):
    if explicit:
        return os.path.abspath(os.path.expanduser(explicit))
    env = os.environ.get("FFCLI_CONFIG")
    if env:
        return os.path.abspath(os.path.expanduser(env))
    if os.path.exists(LOCAL_PRESETS):
        return LOCAL_PRESETS
    if os.path.exists(LEGACY_PRESETS):
        return LEGACY_PRESETS
    return LOCAL_PRESETS


def normalize_presets(raw):
    """Coerce both the legacy `{"name": "args"}` and the current schema."""
    presets = {}
    if not isinstance(raw, dict):
        return presets
    for name, data in raw.items():
        name = str(name).strip()
        if not name:
            continue
        if isinstance(data, str):
            presets[name] = {"cmd": data, "ext": ".mp4"}
        elif isinstance(data, dict) and "cmd" in data:
            presets[name] = {
                "cmd": str(data["cmd"]),
                "ext": normalize_ext(data.get("ext"), ".mp4"),
            }
    return presets


def load_presets(path):
    """Return (presets, source) where source describes what was read."""
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                presets = normalize_presets(json.load(fh))
            if presets:
                return presets, path
        except (OSError, ValueError):
            return dict(DEFAULT_PRESETS), "built-in"
    return dict(DEFAULT_PRESETS), "built-in"


def read_presets(path):
    """Strict read for import/export paths: {} when missing or invalid."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return normalize_presets(json.load(fh))
    except (OSError, ValueError):
        return {}


def save_presets(path, presets):
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(presets, fh, indent=4, ensure_ascii=False)
        fh.write("\n")


TOOLS = {"ffmpeg": None, "ffprobe": None}


def tool_path(name):
    if TOOLS.get(name) is None:
        TOOLS[name] = shutil.which(name) or ""
    return TOOLS[name]


def missing_tools():
    return [name for name in TOOLS if not tool_path(name)]


def open_path(path):
    """Open a file with the OS default application. Returns True when launched."""
    if not os.path.exists(path):
        return False
    try:
        if os.name == "nt":
            os.startfile(path)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
        return True
    except (OSError, AttributeError):
        return False



def probe_duration(path):
    ffprobe = tool_path("ffprobe")
    if not ffprobe:
        return 0.0
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15,
        ).stdout.decode("utf-8", "replace").strip()
        return max(0.0, float(out))
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0.0


_active_lock = threading.Lock()
_active_procs = set()


def cancel_all():
    with _active_lock:
        procs = list(_active_procs)
    for proc in procs:
        with contextlib.suppress(Exception):
            proc.terminate()


def build_command(input_path, output_path, args):
    return [
        tool_path("ffmpeg") or "ffmpeg",
        "-hide_banner", "-nostdin", "-y",
        "-i", input_path,
        *args,
        "-progress", "pipe:1", "-nostats", "-loglevel", "error",
        output_path,
    ]


def run_ffmpeg(input_path, output_path, args, on_progress=None, on_log=None):
    """Run one ffmpeg job. Returns (exit_code, error_text, seconds)."""
    if not tool_path("ffmpeg"):
        return 127, "ffmpeg was not found in PATH", 0.0

    duration = probe_duration(input_path)
    existed_before = os.path.exists(output_path)
    argv = build_command(input_path, output_path, args)

    creationflags = 0
    if os.name == "nt":
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

    started = time.monotonic()
    errors = []
    proc = subprocess.Popen(
        argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True,
        encoding="utf-8",
        errors="replace",
        creationflags=creationflags,
    )
    with _active_lock:
        _active_procs.add(proc)

    def drain_stderr():
        for line in proc.stderr:
            line = line.rstrip()
            if line:
                errors.append(line)
                if on_log:
                    on_log(line)

    reader = threading.Thread(target=drain_stderr, daemon=True)
    reader.start()

    try:
        for line in proc.stdout:
            key, _, value = line.strip().partition("=")
            if on_progress is None:
                continue
            if key == "out_time_us" and duration > 0:
                try:
                    seconds = int(value) / 1_000_000.0
                except ValueError:
                    continue
                on_progress(min(99.9, seconds / duration * 100.0), None)
            elif key == "speed":
                on_progress(None, None if value in ("N/A", "") else value)
    finally:
        code = proc.wait()
        reader.join(timeout=5)
        with _active_lock:
            _active_procs.discard(proc)

    elapsed = time.monotonic() - started
    if code != 0 and not existed_before and os.path.exists(output_path):
        with contextlib.suppress(OSError):
            os.remove(output_path)
    return code, "\n".join(errors[-8:]), elapsed
