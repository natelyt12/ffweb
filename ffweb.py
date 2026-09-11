# ffweb.py - Standalone local server for ffmpeg in the web
# Zero external dependencies (Python standard library only)
import json
import mimetypes
import os
import queue
import re
import shlex
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler

PORT = 8765
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(SCRIPT_DIR, "web")
PRESETS_FILE = os.path.join(SCRIPT_DIR, "ffmpeg_commands.json")
current_working_dir = os.getcwd()


# --- Media Helpers ---
class Media:
    VIDEO = {'.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp', '.ts'}
    AUDIO = {'.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus', '.wma', '.mka'}
    IMAGE = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg', '.heic', '.heif'}
    ALL = VIDEO | AUDIO | IMAGE

    @staticmethod
    def get_size_str(filepath):
        try:
            size_bytes = os.path.getsize(filepath)
            if size_bytes < 1024:
                return f"{size_bytes} B"
            elif size_bytes < 1024 * 1024:
                return f"{size_bytes / 1024:.1f} KB"
            elif size_bytes < 1024 * 1024 * 1024:
                return f"{size_bytes / (1024 * 1024):.1f} MB"
            else:
                return f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"
        except Exception:
            return "N/A"


# --- Preset Helpers ---
def normalize_commands(raw):
    commands = {}
    if not isinstance(raw, dict):
        return commands
    for name, data in raw.items():
        if isinstance(data, str):
            commands[name] = {"cmd": data, "ext": ".mp4"}
        elif isinstance(data, dict) and "cmd" in data:
            ext = str(data.get("ext") or ".mp4")
            if not ext.startswith('.'):
                ext = '.' + ext
            commands[name] = {"cmd": str(data["cmd"]), "ext": ext}
    return commands


def load_commands():
    if not os.path.exists(PRESETS_FILE):
        return {}
    try:
        with open(PRESETS_FILE, "r", encoding='utf-8') as f:
            return normalize_commands(json.load(f))
    except Exception:
        return {}


def save_commands(commands):
    try:
        with open(PRESETS_FILE, "w", encoding='utf-8') as f:
            json.dump(commands, f, indent=4, ensure_ascii=False)
        return True
    except Exception:
        return False


# Global job state
job_lock = threading.Lock()
current_job = {
    "status": "idle",       # idle | running | completed | cancelled
    "total_files": 0,
    "completed_count": 0,
    "concurrency": 1,
    "file_order": [],
    "files": {},
    "created_outputs": [],  # absolute paths of all created/in-progress output files
    "cancel_requested": False,
}
active_subprocesses = {}

def get_media_duration(file_path):
    """Uses ffprobe to obtain media duration in seconds for progress calculation."""
    try:
        cmd = [
            'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', file_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=5)
        return float(res.stdout.strip())
    except Exception:
        return 0.0

def run_conversion_task(files, cmd_template, output_ext, delete_after, concurrency=1):
    global current_job, active_subprocesses, current_working_dir
    with job_lock:
        current_job["status"] = "running"
        current_job["total_files"] = len(files)
        current_job["completed_count"] = 0
        current_job["concurrency"] = concurrency
        current_job["file_order"] = list(files)
        current_job["files"] = {}
        current_job["created_outputs"] = []
        current_job["cancel_requested"] = False

        for f in files:
            filename, old_ext = os.path.splitext(f)
            cur_out_ext = output_ext if output_ext else old_ext
            if cur_out_ext and not cur_out_ext.startswith('.'):
                cur_out_ext = '.' + cur_out_ext
            out_name = f"{filename}_output{cur_out_ext}"
            current_job["files"][f] = {
                "status": "pending",
                "progress": 0.0,
                "speed": "--",
                "fps": "--",
                "output": out_name,
                "msg": "",
                "cmd": "",
                "log": ""
            }
        active_subprocesses.clear()

    task_queue = queue.Queue()
    for f in files:
        task_queue.put(f)

    def worker_loop():
        while True:
            try:
                input_file = task_queue.get_nowait()
            except queue.Empty:
                break

            with job_lock:
                if current_job["cancel_requested"]:
                    task_queue.task_done()
                    break
                current_job["files"][input_file]["status"] = "running"
                current_job["files"][input_file]["progress"] = 0.0
                out_name = current_job["files"][input_file]["output"]
                output_abs_path = os.path.join(current_working_dir, out_name)
                if output_abs_path not in current_job["created_outputs"]:
                    current_job["created_outputs"].append(output_abs_path)

            input_abs_path = os.path.join(current_working_dir, input_file)
            total_duration = get_media_duration(input_abs_path)

            cmd_args = ['ffmpeg', '-y', '-i', input_abs_path]
            try:
                extra_args = shlex.split(cmd_template)
                cmd_args.extend(extra_args)
            except Exception:
                cmd_args.extend(cmd_template.split())
            cmd_args.extend(['-progress', 'pipe:1', output_abs_path])

            full_cmd_str = ' '.join(cmd_args)
            with job_lock:
                current_job["files"][input_file]["cmd"] = full_cmd_str

            print(f"\n[FFmpeg Task Started] {input_file}\nCommand: {full_cmd_str}")

            creationflags = 0
            if os.name == 'nt':
                creationflags = getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)

            proc = None
            was_cancelled = False
            stderr_lines = []
            try:
                proc = subprocess.Popen(
                    cmd_args,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    cwd=current_working_dir,
                    universal_newlines=True,
                    creationflags=creationflags
                )
                with job_lock:
                    active_subprocesses[input_file] = proc

                def read_stderr():
                    try:
                        for s_line in proc.stderr:
                            s_line = s_line.rstrip()
                            if s_line:
                                stderr_lines.append(s_line)
                                print(f"[{input_file}] {s_line}")
                                if len(stderr_lines) > 200:
                                    stderr_lines.pop(0)
                    except Exception:
                        pass

                t_err = threading.Thread(target=read_stderr, daemon=True)
                t_err.start()

                for line in proc.stdout:
                    line = line.strip()
                    if not line:
                        continue
                    if '=' in line:
                        k, v = line.split('=', 1)
                        k = k.strip()
                        v = v.strip()
                        with job_lock:
                            if current_job["cancel_requested"] or current_job["files"][input_file]["status"] == "cancelled":
                                break
                            if k == 'out_time_ms':
                                try:
                                    cur_sec = float(v) / 1000000.0
                                    if total_duration > 0:
                                        pct = min(99.0, (cur_sec / total_duration) * 100.0)
                                        current_job["files"][input_file]["progress"] = round(pct, 1)
                                except Exception:
                                    pass
                            elif k == 'speed':
                                current_job["files"][input_file]["speed"] = v
                            elif k == 'fps':
                                current_job["files"][input_file]["fps"] = v

                proc.wait()
                t_err.join(timeout=1.0)
            except Exception as e:
                stderr_lines.append(str(e))
            finally:
                with job_lock:
                    if input_file in active_subprocesses:
                        del active_subprocesses[input_file]
                    was_cancelled = (current_job["cancel_requested"] or current_job["files"][input_file]["status"] == "cancelled")

            with job_lock:
                current_job["files"][input_file]["log"] = "\n".join(stderr_lines)

                if was_cancelled:
                    current_job["files"][input_file]["status"] = "cancelled"
                    try:
                        if os.path.exists(output_abs_path):
                            os.remove(output_abs_path)
                    except Exception:
                        pass
                    if not current_job["cancel_requested"]:
                        if output_abs_path in current_job["created_outputs"]:
                            current_job["created_outputs"].remove(output_abs_path)
                    task_queue.task_done()
                    if current_job["cancel_requested"]:
                        break
                    continue

                success = (proc is not None and proc.returncode == 0)
                if success:
                    current_job["files"][input_file]["status"] = "done"
                    current_job["files"][input_file]["progress"] = 100.0
                    current_job["files"][input_file]["msg"] = "Success"
                    if delete_after:
                        try:
                            os.remove(input_abs_path)
                        except Exception:
                            pass
                else:
                    err_msg = ""
                    for s_l in reversed(stderr_lines):
                        if any(w in s_l.lower() for w in ["error", "invalid", "does not contain", "could not", "failed", "unsupported"]):
                            err_msg = s_l
                            break
                    if not err_msg and stderr_lines:
                        err_msg = stderr_lines[-1]
                    if not err_msg:
                        err_msg = f"FFmpeg exited with code {proc.returncode if proc else 'failed'}"

                    current_job["files"][input_file]["status"] = "error"
                    current_job["files"][input_file]["msg"] = err_msg

                current_job["completed_count"] += 1
                task_queue.task_done()

    threads = []
    worker_count = max(1, min(concurrency, len(files), 4))
    for _ in range(worker_count):
        t = threading.Thread(target=worker_loop, daemon=True)
        t.start()
        threads.append(t)

    for t in threads:
        t.join()

    with job_lock:
        if current_job["cancel_requested"]:
            current_job["status"] = "cancelled"
            for f_name, f_info in current_job["files"].items():
                if f_info["status"] in ("pending", "running"):
                    f_info["status"] = "cancelled"
        else:
            current_job["status"] = "completed"


class DashboardHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_json(self, data, status=200):
        content = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(content)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/api/files":
            files_data = []
            try:
                for f in sorted(os.listdir(current_working_dir)):
                    full_p = os.path.join(current_working_dir, f)
                    if os.path.isfile(full_p):
                        ext = os.path.splitext(f)[1].lower()
                        if ext in Media.ALL:
                            size_str = Media.get_size_str(full_p)
                            mtype = "file"
                            if ext in Media.VIDEO:
                                mtype = "video"
                            elif ext in Media.AUDIO:
                                mtype = "audio"
                            elif ext in Media.IMAGE:
                                mtype = "image"

                            files_data.append({
                                "name": f,
                                "ext": ext,
                                "type": mtype,
                                "size": size_str,
                                "bytes": os.path.getsize(full_p)
                            })
            except Exception:
                pass

            self.send_json({
                "cwd": current_working_dir,
                "files": files_data,
                "count": len(files_data)
            })
            return

        if path == "/api/presets":
            commands = load_commands()
            self.send_json({"presets": commands})
            return

        if path == "/api/status":
            with job_lock:
                self.send_json(current_job)
            return

        if path == "/api/preview":
            filename = query.get("file", [""])[0]
            if not filename:
                self.send_error(400, "Missing file parameter")
                return

            filepath = os.path.abspath(os.path.join(current_working_dir, filename))
            if not os.path.isfile(filepath):
                self.send_error(404, "File not found")
                return

            self.stream_file_range(filepath)
            return

        req_file = path.lstrip('/')
        if not req_file or req_file == '/':
            req_file = "index.html"

        target_path = os.path.join(WEB_DIR, req_file)
        if not os.path.isfile(target_path):
            target_path = os.path.join(WEB_DIR, "index.html")

        mime_type, _ = mimetypes.guess_type(target_path)
        if not mime_type:
            mime_type = "text/html"

        try:
            with open(target_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", f"{mime_type}; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.end_headers()
            self.wfile.write(content)
        except Exception:
            self.send_error(404, "File not found")

    def stream_file_range(self, filepath):
        try:
            file_size = os.path.getsize(filepath)
            mime_type, _ = mimetypes.guess_type(filepath)
            if not mime_type:
                mime_type = "application/octet-stream"

            range_header = self.headers.get("Range")
            if not range_header:
                self.send_response(200)
                self.send_header("Content-Type", mime_type)
                self.send_header("Content-Length", str(file_size))
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()
                with open(filepath, "rb") as f:
                    while chunk := f.read(65536):
                        self.wfile.write(chunk)
                return

            match = re.match(r"bytes=(\d+)-(\d*)", range_header)
            if not match:
                self.send_error(416, "Requested Range Not Satisfiable")
                return

            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else file_size - 1
            if start >= file_size or end >= file_size:
                self.send_error(416, "Requested Range Not Satisfiable")
                return

            length = end - start + 1
            self.send_response(206)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()

            with open(filepath, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    read_size = min(65536, remaining)
                    chunk = f.read(read_size)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (ConnectionResetError, BrokenPipeError):
            pass
        except Exception as e:
            self.send_error(500, str(e))

    def do_POST(self):
        global current_working_dir
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            body = json.loads(post_data)
        except Exception:
            body = {}

        if path == "/api/presets":
            action = body.get("action")
            name = body.get("name", "").strip()
            commands = load_commands()

            if action == "save":
                cmd = body.get("cmd", "").strip()
                ext = body.get("ext", ".mp4").strip()
                if not ext.startswith('.'):
                    ext = '.' + ext
                if name and cmd:
                    commands[name] = {"cmd": cmd, "ext": ext}
                    save_commands(commands)
                    self.send_json({"success": True, "presets": commands})
                    return
                self.send_json({"success": False, "error": "Name and command options are required."}, status=400)
                return

            elif action == "delete":
                if name in commands:
                    del commands[name]
                    save_commands(commands)
                    self.send_json({"success": True, "presets": commands})
                    return
                self.send_json({"success": False, "error": "Preset not found."}, status=404)
                return

        if path == "/api/process":
            files = body.get("files", [])
            cmd_template = body.get("cmd", "").strip()
            output_ext = body.get("ext", "").strip()
            delete_after = bool(body.get("delete_after", False))
            concurrency = int(body.get("concurrency", 1))
            concurrency = max(1, min(4, concurrency))

            if not files:
                self.send_json({"success": False, "error": "No files selected."}, status=400)
                return

            with job_lock:
                if current_job["status"] == "running":
                    self.send_json({"success": False, "error": "A job is already running."}, status=409)
                    return

            thread = threading.Thread(
                target=run_conversion_task,
                args=(files, cmd_template, output_ext, delete_after, concurrency),
                daemon=True
            )
            thread.start()
            self.send_json({"success": True, "message": f"Started processing {len(files)} files with {concurrency} workers."})
            return

        if path == "/api/cancel-task":
            target_file = body.get("file", "").strip()
            proc = None
            with job_lock:
                if target_file in current_job["files"]:
                    current_job["files"][target_file]["status"] = "cancelled"
                proc = active_subprocesses.get(target_file)
            if proc:
                try:
                    proc.kill()
                except Exception:
                    pass
            self.send_json({"success": True, "message": f"Cancelled task {target_file}"})
            return

        if path == "/api/cancel":
            with job_lock:
                current_job["cancel_requested"] = True
                current_job["status"] = "cancelled"
                for f_name, f_info in current_job["files"].items():
                    if f_info["status"] in ("pending", "running"):
                        f_info["status"] = "cancelled"
            for proc in list(active_subprocesses.values()):
                try:
                    proc.kill()
                except Exception:
                    pass
            with job_lock:
                active_subprocesses.clear()
                # Rollback: Delete all generated output files from this batch run
                for out_path in list(current_job["created_outputs"]):
                    try:
                        if os.path.exists(out_path):
                            os.remove(out_path)
                    except Exception:
                        pass
                current_job["created_outputs"].clear()
            self.send_json({"success": True, "message": "All batch tasks cancelled and generated outputs deleted."})
            return

        if path == "/api/rename":
            old_name = body.get("old_name", "").strip()
            new_name = body.get("new_name", "").strip()
            if not old_name or not new_name:
                self.send_json({"success": False, "error": "Old and new file names are required."}, status=400)
                return
            if os.path.sep in old_name or '/' in old_name or os.path.sep in new_name or '/' in new_name:
                self.send_json({"success": False, "error": "Invalid file name."}, status=400)
                return
            old_abs = os.path.abspath(os.path.join(current_working_dir, old_name))
            new_abs = os.path.abspath(os.path.join(current_working_dir, new_name))
            if not os.path.isfile(old_abs):
                self.send_json({"success": False, "error": f"File '{old_name}' not found."}, status=404)
                return
            if os.path.exists(new_abs):
                self.send_json({"success": False, "error": f"File '{new_name}' already exists."}, status=409)
                return
            try:
                os.rename(old_abs, new_abs)
                self.send_json({"success": True, "old_name": old_name, "new_name": new_name})
            except Exception as e:
                self.send_json({"success": False, "error": str(e)}, status=500)
            return

        if path == "/api/delete":
            name = body.get("name", "").strip()
            if not name or os.path.sep in name or '/' in name:
                self.send_json({"success": False, "error": "Invalid file name."}, status=400)
                return
            target_abs = os.path.abspath(os.path.join(current_working_dir, name))
            if not os.path.isfile(target_abs):
                self.send_json({"success": False, "error": f"File '{name}' not found."}, status=404)
                return
            try:
                os.remove(target_abs)
                self.send_json({"success": True, "name": name})
            except Exception as e:
                self.send_json({"success": False, "error": str(e)}, status=500)
            return

        if path == "/api/select-folder":
            selected = None
            try:
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes("-topmost", True)
                selected = filedialog.askdirectory(
                    initialdir=current_working_dir,
                    title="Select Folder containing Media"
                )
                root.destroy()
            except Exception:
                selected = None

            if selected and os.path.isdir(selected):
                current_working_dir = os.path.abspath(selected)
                self.send_json({"success": True, "cwd": current_working_dir})
            else:
                self.send_json({
                    "success": False,
                    "unsupported": (not selected and not os.environ.get("DISPLAY") and os.name != 'nt'),
                    "cancelled": True,
                    "cwd": current_working_dir
                })
            return

        if path == "/api/change-folder":
            new_folder = body.get("folder", "").strip()
            if new_folder and os.path.isdir(new_folder):
                current_working_dir = os.path.abspath(new_folder)
                self.send_json({"success": True, "cwd": current_working_dir})
            else:
                self.send_json({"success": False, "error": f"Directory not found: {new_folder}"}, status=400)
            return

        if path == "/api/open-folder":
            folder = body.get("folder") or current_working_dir
            try:
                if os.name == 'nt':
                    os.startfile(folder)
                elif sys.platform == 'darwin':
                    subprocess.Popen(['open', folder])
                else:
                    import shutil
                    if shutil.which('termux-open'):
                        subprocess.Popen(['termux-open', folder])
                    elif shutil.which('xdg-open'):
                        subprocess.Popen(['xdg-open', folder])
                self.send_json({"success": True})
            except Exception as e:
                self.send_json({"success": False, "error": str(e)})
            return

        if path == "/api/shutdown":
            self.send_json({"success": True, "message": "Server shutting down."})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return

        self.send_error(404, "Endpoint not found")


class ReusableThreadingServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = (os.name != 'nt')
    daemon_threads = True


def open_browser(url):
    """Opens browser across Windows, macOS, Linux, and Android (Termux)."""
    try:
        import shutil
        if shutil.which("termux-open-url"):
            subprocess.Popen(["termux-open-url", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        elif shutil.which("termux-open"):
            subprocess.Popen(["termux-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
    except Exception:
        pass
    try:
        webbrowser.open(url)
    except Exception:
        pass


def try_connect_and_switch(port, target_dir):
    """If another ffweb instance is already running on this port, switch its active folder and exit."""
    try:
        import urllib.request
        data = json.dumps({"folder": target_dir}).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/change-folder",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            if resp.status == 200:
                res_body = json.loads(resp.read().decode("utf-8"))
                if res_body.get("success"):
                    print("\n" + "=" * 45)
                    print("           ffmpeg in the web")
                    print("=" * 45)
                    print(f" -> Connected to existing server at: http://127.0.0.1:{port}")
                    print(f" -> Switched active folder to:       {target_dir}")
                    print(f" -> Opening browser dashboard...\n")
                    open_browser(f"http://127.0.0.1:{port}")
                    return True
    except Exception:
        pass
    return False


def start_server(port=PORT, auto_open=True, initial_dir=None):
    global current_working_dir
    if initial_dir and os.path.isdir(initial_dir):
        current_working_dir = os.path.abspath(initial_dir)
    else:
        current_working_dir = os.path.abspath(os.getcwd())

    os.makedirs(WEB_DIR, exist_ok=True)
    server_address = ("127.0.0.1", port)

    try:
        httpd = ReusableThreadingServer(server_address, DashboardHandler)
    except OSError as e:
        print(f"\n[Error] Could not bind to port {port}: {e}")
        print("Another process is using this port. You can specify a different port: ffweb <port>\n")
        return

    url = f"http://127.0.0.1:{port}"
    
    print("\n" + "=" * 45)
    print("           ffmpeg in the web")
    print("=" * 45)
    print(f" -> Local Dashboard:   {url}")
    print(f" -> Active Directory:  {current_working_dir}")
    print(f" -> Press Ctrl+C or click 'Exit' in browser to stop.\n")

    if auto_open:
        threading.Timer(0.3, lambda: open_browser(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.shutdown()
        httpd.server_close()


if __name__ == "__main__":
    p = PORT
    initial_d = None
    for arg in sys.argv[1:]:
        if arg.isdigit():
            p = int(arg)
        elif os.path.isdir(arg):
            initial_d = os.path.abspath(arg)

    target_d = initial_d or os.path.abspath(os.getcwd())

    # If an instance is already running on this port, connect and switch its directory
    if try_connect_and_switch(p, target_d):
        sys.exit(0)

    start_server(port=p, auto_open=True, initial_dir=target_d)



