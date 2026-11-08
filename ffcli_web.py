#!/usr/bin/env python3
"""ffcli_web.py - the single-file cutter page opened by ffcli's Cut action.

Usage:
    python ffcli_web.py <media file> [port]

Exactly one file is served and only trimming is exposed: no file list, no
presets, no batch. The process exits as soon as the cut finishes (or the page
asks it to stop) so the terminal UI gets its prompt back and can show the
`_output` file.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import struct
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import ffcore

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(HERE, "web")
DEFAULT_PORT = 8765

STATE_LOCK = threading.Lock()
STATE = {
    "status": "idle",      # idle | running | done | error | cancelled
    "progress": 0.0,
    "speed": "",
    "output": "",
    "message": "",
}

TARGET = ""
TARGET_TYPE = "video"
TARGET_EXT = ""
TARGET_STEM = ""
WAVEFORM = None


# --- helpers ---------------------------------------------------------------

def media_type(path):
    return "audio" if ffcore.Media.kind(path) == "audio" else "video"


def output_name(ext):
    return f"{TARGET_STEM}_output{ext}"


def build_cut_argv(payload):
    """Translate the page payload into a complete ffmpeg argv."""
    try:
        start = max(0.0, float(payload.get("start", 0) or 0))
        end = float(payload.get("end", 0) or 0)
        fade_in = max(0.0, float(payload.get("fade_in", 0) or 0))
        fade_out = max(0.0, float(payload.get("fade_out", 0) or 0))
    except (TypeError, ValueError):
        raise ValueError("start/end/fade values must be numbers")
    if end <= start:
        raise ValueError("the out point must be after the in point")

    span = end - start
    mode = str(payload.get("mode") or "copy")
    fmt = str(payload.get("format") or "mp3")
    seek = ["-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", TARGET]
    out_ext = TARGET_EXT

    if TARGET_TYPE == "video":
        if mode == "audio_only":
            args = seek + ["-vn", "-c:a", "libmp3lame", "-b:a", "320k"]
            out_ext = ".mp3"
        elif mode == "encode":
            args = seek + [
                "-c:v", "libx264", "-crf", "19", "-preset", "fast", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
            ]
            out_ext = ".mp4"
        else:
            args = seek + ["-c", "copy", "-avoid_negative_ts", "make_zero", "-map", "0"]
            out_ext = TARGET_EXT
    else:
        filters = []
        if fade_in > 0:
            filters.append(f"afade=t=in:ss=0:d={fade_in:.2f}")
        if fade_out > 0:
            filters.append(f"afade=t=out:st={max(0.0, span - fade_out):.2f}:d={fade_out:.2f}")
        args = list(seek)
        if filters:
            args += ["-af", ",".join(filters)]
        if fmt == "copy" and not filters:
            args += ["-c", "copy"]
            out_ext = TARGET_EXT
        else:
            codec, out_ext = {
                "mp3": (["-c:a", "libmp3lame", "-b:a", "320k"], ".mp3"),
                "wav": (["-c:a", "pcm_s16le"], ".wav"),
                "flac": (["-c:a", "flac"], ".flac"),
                "aac": (["-c:a", "aac", "-b:a", "256k"], ".m4a"),
            }.get(fmt, (["-c:a", "libmp3lame", "-b:a", "320k"], ".mp3"))
            args += codec

    name = output_name(out_ext)
    argv = [
        ffcore.tool_path("ffmpeg") or "ffmpeg",
        "-hide_banner", "-nostdin", "-y", *args,
        "-progress", "pipe:1", "-nostats", "-loglevel", "error",
        os.path.join(os.path.dirname(TARGET), name),
    ]
    return argv, name, span


def waveform_data():
    """Cached peak list for the audio pane."""
    global WAVEFORM
    if WAVEFORM is not None:
        return WAVEFORM

    duration = ffcore.probe_duration(TARGET)
    empty = {"success": True, "peaks": [], "duration": duration, "has_audio": False}
    if duration <= 0:
        WAVEFORM = empty
        return WAVEFORM

    argv = [
        ffcore.tool_path("ffmpeg") or "ffmpeg",
        "-v", "error", "-i", TARGET,
        "-vn", "-ac", "1", "-ar", "1000", "-f", "s16le", "-",
    ]
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) if os.name == "nt" else 0
    try:
        raw = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             timeout=40, creationflags=flags).stdout
    except (OSError, subprocess.SubprocessError):
        WAVEFORM = empty
        return WAVEFORM

    samples = len(raw) // 2
    if samples == 0:
        WAVEFORM = empty
        return WAVEFORM

    values = struct.unpack(f"<{samples}h", raw[:samples * 2])
    points = 1600
    chunk = max(1, samples // points)
    peaks = []
    for i in range(0, samples, chunk):
        piece = values[i:i + chunk]
        if piece:
            peaks.append(round(max(abs(v) for v in piece) / 32768.0, 3))
    loudest = max(peaks) if peaks else 0.0
    if loudest > 0.01:
        peaks = [round(min(1.0, p / loudest), 3) for p in peaks]

    WAVEFORM = {"success": True, "peaks": peaks, "duration": round(duration, 3), "has_audio": True}
    return WAVEFORM


def shutdown_later(delay):
    """Exit the process so the terminal UI regains control.

    Each call starts its own timer: whichever fires first wins, so an explicit
    `/api/finish` is not blocked by the post-cut safety timeout.
    """
    def stop():
        time.sleep(delay)
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(0)

    threading.Thread(target=stop, daemon=True).start()


def start_cut(payload):
    with STATE_LOCK:
        if STATE["status"] == "running":
            return False, "a cut is already running"
        STATE.update(status="running", progress=0.0, speed="", output="", message="")

    def work():
        try:
            argv, name, span = build_cut_argv(payload)
        except ValueError as exc:
            with STATE_LOCK:
                STATE.update(status="error", message=str(exc))
            return

        with STATE_LOCK:
            STATE["output"] = name

        def on_progress(pct, speed):
            with STATE_LOCK:
                if pct is not None:
                    STATE["progress"] = pct
                if speed:
                    STATE["speed"] = speed

        code, error, elapsed = ffcore.run_ffmpeg_argv(
            argv, argv[-1], span, on_progress=on_progress)

        with STATE_LOCK:
            if code == 0:
                STATE.update(status="done", progress=100.0, message=f"{name} ({elapsed:.1f}s)")
            elif STATE["status"] == "cancelled":
                STATE.update(message="cancelled")
            else:
                detail = ""
                if error:
                    detail = next((ln for ln in reversed(error.splitlines()) if ln.strip()), "")
                STATE.update(status="error", message=detail or "ffmpeg failed")
            finished = STATE["status"] == "done"

        if finished:
            shutdown_later(10.0)  # safety net if the page never reports back

    threading.Thread(target=work, daemon=True).start()
    return True, ""


# --- HTTP ------------------------------------------------------------------

class CutterHandler(BaseHTTPRequestHandler):
    server_version = "ffcli-cutter"

    def log_message(self, fmt, *args):
        pass

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, body, content_type):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/index.html"):
            return self.serve_static("index.html")
        if path == "/api/info":
            return self.send_json({
                "name": os.path.basename(TARGET),
                "type": TARGET_TYPE,
                "ext": TARGET_EXT,
                "duration": ffcore.probe_duration(TARGET),
                "output": output_name(TARGET_EXT),
            })
        if path == "/api/waveform":
            return self.send_json(waveform_data())
        if path == "/api/status":
            with STATE_LOCK:
                return self.send_json(dict(STATE))
        if path == "/api/media":
            return self.stream_file(TARGET)
        return self.serve_static(path.lstrip("/"))

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            body = json.loads(raw) if raw.strip() else {}
        except ValueError:
            body = {}

        if path == "/api/cut":
            ok, error = start_cut(body)
            return self.send_json({"success": ok, "error": error},
                                  HTTPStatus.OK if ok else HTTPStatus.CONFLICT)
        if path == "/api/cancel":
            with STATE_LOCK:
                if STATE["status"] == "running":
                    STATE.update(status="cancelled", message="cancelled")
            ffcore.cancel_all()
            return self.send_json({"success": True})
        if path in ("/api/finish", "/api/quit"):
            self.send_json({"success": True})
            return shutdown_later(0.4)
        self.send_error(HTTPStatus.NOT_FOUND)

    def serve_static(self, relative):
        safe = os.path.normpath(relative).replace("\\", "/")
        if safe.startswith("..") or os.path.isabs(safe):
            return self.send_error(HTTPStatus.FORBIDDEN)
        full = os.path.join(WEB_DIR, safe)
        if not os.path.isfile(full):
            return self.send_error(HTTPStatus.NOT_FOUND)
        ctype, _ = mimetypes.guess_type(full)
        with open(full, "rb") as fh:
            self.send_bytes(fh.read(), ctype or "application/octet-stream")

    def stream_file(self, filepath):
        try:
            size = os.path.getsize(filepath)
            ctype = mimetypes.guess_type(filepath)[0] or "application/octet-stream"
            match = re.match(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
            if not match:
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(size))
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()
                with open(filepath, "rb") as fh:
                    while True:
                        block = fh.read(65536)
                        if not block:
                            break
                        self.wfile.write(block)
                return

            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else size - 1
            if start >= size or end >= size:
                return self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            length = end - start + 1
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            with open(filepath, "rb") as fh:
                fh.seek(start)
                remaining = length
                while remaining > 0:
                    block = fh.read(min(65536, remaining))
                    if not block:
                        break
                    self.wfile.write(block)
                    remaining -= len(block)
        except (ConnectionResetError, BrokenPipeError):
            pass
        except OSError as exc:
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))


def open_browser(url):
    try:
        import shutil
        for opener in ("termux-open-url", "termux-open"):
            if shutil.which(opener):
                subprocess.Popen([opener, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
    except OSError:
        pass
    try:
        webbrowser.open(url)
    except Exception:
        pass


def main():
    global TARGET, TARGET_TYPE, TARGET_EXT, TARGET_STEM

    port = DEFAULT_PORT
    candidate = ""
    for arg in sys.argv[1:]:
        if arg.isdigit():
            port = int(arg)
        elif os.path.isfile(arg):
            candidate = os.path.abspath(arg)

    if not candidate:
        print("usage: ffcli_web.py <media file> [port]", file=sys.stderr)
        return 2
    if not ffcore.tool_path("ffmpeg"):
        print("[ffcli] ffmpeg was not found in PATH", file=sys.stderr)
        return 1

    TARGET = candidate
    TARGET_EXT = os.path.splitext(candidate)[1].lower()
    TARGET_STEM = os.path.splitext(os.path.basename(candidate))[0]
    TARGET_TYPE = media_type(candidate)

    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", port), CutterHandler)
    except OSError as exc:
        print(f"[ffcli] cannot bind port {port}: {exc}", file=sys.stderr)
        return 1
    httpd.daemon_threads = True

    url = f"http://127.0.0.1:{port}/"
    print(f"\n[ffcli] cutting {os.path.basename(TARGET)}")
    print(f"[ffcli] {url}   (Ctrl+C here to abort)")

    threading.Timer(0.3, lambda: open_browser(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
