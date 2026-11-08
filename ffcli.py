#!/usr/bin/env python3
"""ffcli - run ffmpeg presets or custom commands, and summon the web cutter.

Two ways to use it:

  * interactive  - `ffcli` in a folder opens the terminal UI ported from the
                   original tool (multi-select, search, preset manager).
  * scriptable   - `ffcli run ...` / `ffcli presets ...` for pipelines.

Cutting (trim / waveform) is intentionally not reimplemented here: `ffcli cut`
starts the web dashboard, which owns that job.

Standard library only.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import glob
import json
import os
import re
import subprocess
import sys
import threading

import ffcore

IS_WINDOWS = os.name == "nt"
INTERACTIVE = sys.stdin.isatty() and sys.stdout.isatty()

ANSI_RE = re.compile(r"\033\[[0-9;?]*[a-zA-Z]")

last_manual_args = ""
last_manual_ext = ""


class UI:
    HEADER = "\033[38;2;205;180;219m"
    BLUE = "\033[38;2;162;210;255m"
    CYAN = "\033[38;2;162;210;255m"
    GREEN = "\033[38;2;168;230;207m"
    YELLOW = "\033[38;2;255;238;186m"
    RED = "\033[38;2;255;179;186m"
    WHITE = "\033[38;2;240;240;240m"
    GRAY = "\033[38;2;150;160;175m"
    SELECT = "\033[1m\033[38;2;162;210;255m"
    END = "\033[0m"
    BOLD = "\033[1m"
    HIDE_CURSOR = "\033[?25l"
    SHOW_CURSOR = "\033[?25h"
    HOME_CURSOR = "\033[H"
    CLEAR_LINE = "\r\033[K"


def strip_ansi(text):
    return ANSI_RE.sub("", text)


if not INTERACTIVE:
    for _attr in ("HEADER", "BLUE", "CYAN", "GREEN", "YELLOW", "RED", "WHITE", "GRAY",
                  "SELECT", "END", "BOLD", "CLEAR_LINE", "HOME_CURSOR",
                  "HIDE_CURSOR", "SHOW_CURSOR"):
        setattr(UI, _attr, "")

OK_MARK = "✓" if INTERACTIVE else "ok"
FAIL_MARK = "✗" if INTERACTIVE else "fail"


def pause(message="Press Enter to continue..."):
    try:
        input(f"\n{UI.GRAY}{message}{UI.END}")
    except (EOFError, KeyboardInterrupt):
        pass


# --- terminal input layer ---

def get_key():
    """Return a named key ('up', 'enter', 'esc', ...), a printable char or None."""
    if IS_WINDOWS:
        import msvcrt

        char = msvcrt.getwch()
        if char in ("\x00", "\xe0"):
            return {"H": "up", "P": "down", "K": "left", "M": "right"}.get(msvcrt.getwch())
        if char == "\r":
            return "enter"
        if char == "\x1b":
            return "esc"
        if char == " ":
            return "space"
        if char == "\x08":
            return "backspace"
        if char == "\x03":
            raise KeyboardInterrupt
        return char if char.isprintable() else None

    import select
    import termios
    import tty

    fd = sys.stdin.fileno()
    settings = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        char = sys.stdin.read(1)
        if char == "\x1b":
            if select.select([sys.stdin], [], [], 0.05)[0]:
                seq = sys.stdin.read(2)
                return {"[A": "up", "[B": "down", "[C": "right", "[D": "left"}.get(seq, "esc")
            return "esc"
        if char == "\r":
            return "enter"
        if char == " ":
            return "space"
        if char in ("\x08", "\x7f"):
            return "backspace"
        if char == "\x03":
            raise KeyboardInterrupt
        return char if char.isprintable() else None
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, settings)


def interactive_input(prompt, default=""):
    """Single-line editor with cursor movement. Returns None when cancelled."""
    text = list(default)
    cursor = len(text)

    while True:
        display = "".join(text)
        sys.stdout.write(f"\r\033[K{prompt}{display}")
        back = len(text) - cursor
        if back > 0:
            sys.stdout.write(f"\033[{back}D")
        sys.stdout.flush()

        key = get_key()
        if key == "enter":
            print()
            return "".join(text)
        if key == "esc":
            print()
            return None
        if key == "backspace":
            if cursor > 0:
                text.pop(cursor - 1)
                cursor -= 1
        elif key == "left":
            cursor = max(0, cursor - 1)
        elif key == "right":
            cursor = min(len(text), cursor + 1)
        elif key == "space":
            text.insert(cursor, " ")
            cursor += 1
        elif key and len(key) == 1:
            text.insert(cursor, key)
            cursor += 1


def _plain_menu(title, options, subtitle, multi_select):
    """Line-based fallback so the tool never hangs on a piped stdin."""
    labels = [option.label if isinstance(option, Option) else option for option in options]
    print(f"\n=== {title} ===")
    if subtitle:
        print(f"    {subtitle}")
    for index, label in enumerate(labels):
        if "---" in label:
            print("  " + "-" * 50)
        else:
            print(f"  {index}. {strip_ansi(label)}")

    hint = "indexes (comma separated, or 'all')" if multi_select else "index"
    try:
        raw = input(f"Select {hint} [blank = cancel]: ").strip().lower()
    except EOFError:
        return [] if multi_select else -1
    if not raw or raw in ("q", "esc", "exit"):
        return [] if multi_select else -1

    if multi_select and raw == "all":
        picks = [i for i, label in enumerate(labels) if "---" not in label]
    else:
        picks = []
        for chunk in re.split(r"[,\s]+", raw):
            if not chunk:
                continue
            if "-" in chunk[1:]:
                start, _, end = chunk.partition("-")
                if start.isdigit() and end.isdigit():
                    picks.extend(range(int(start), int(end) + 1))
            elif chunk.isdigit():
                picks.append(int(chunk))

    picks = [p for p in picks if 0 <= p < len(labels) and "---" not in labels[p]]
    if multi_select:
        return sorted(set(picks))
    return picks[0] if picks else -1


KIND_PLAIN = "plain"
KIND_ITEM = "item"
KIND_SEPARATOR = "separator"
KIND_TOGGLE = "toggle"
KIND_FILE = "file"

SORT_MODES = ("name", "added", "group")
SORT_LABELS = {
    "name": "name (A-Z)",
    "added": "date added (newest first)",
    "group": "file group (.ext)",
}


class Option:
    """A menu row plus the metadata the filter and the sort switches need."""

    __slots__ = ("label", "kind", "group", "sort_name", "sort_added", "payload")

    def __init__(self, label, kind=KIND_PLAIN, group="", sort_name=None,
                 sort_added=0.0, payload=None):
        self.label = label
        self.kind = kind
        self.group = group
        self.sort_name = strip_ansi(label) if sort_name is None else sort_name
        self.sort_added = sort_added
        self.payload = payload

    @property
    def selectable(self):
        return self.kind != KIND_SEPARATOR


def _as_option(item):
    if isinstance(item, Option):
        return item
    return Option(item, KIND_SEPARATOR if "---" in item else KIND_PLAIN)


def _sort_indices(options, indices, mode):
    if mode == "added":
        return sorted(indices, key=lambda i: (-options[i].sort_added, options[i].sort_name.casefold()))
    if mode == "group":
        return sorted(indices, key=lambda i: (options[i].group, options[i].sort_name.casefold()))
    return sorted(indices, key=lambda i: options[i].sort_name.casefold())


def _entry_selectable(rows, options, index):
    entry = rows[index]
    if entry[0] == "virtual":
        return True
    return options[entry[1]].selectable


def _move(rows, options, cursor, delta):
    """Next focusable row, wrapping around and skipping separators."""
    total = len(rows)
    if not total:
        return 0
    index = cursor
    for _ in range(total):
        index = (index + delta) % total
        if _entry_selectable(rows, options, index):
            return index
    return cursor


def _group_targets(options, group):
    return [i for i, o in enumerate(options) if o.kind == KIND_FILE and o.group == group]


def interactive_menu(title, options, subtitle=None, max_visible=None,
                     multi_select=False, enable_filter=False, sort_mode="name"):
    """Scrollable menu with multi-select.

    With `enable_filter` the first two rows are a live filter and a sort switch
    (name / date added / file group). Separator rows are never focusable, so the
    cursor cannot land on them and Enter can never pick one.

    Returns the chosen option index (-1 when cancelled), or the list of selected
    indices when `multi_select` is set.
    """
    options = [_as_option(option) for option in options]
    if not INTERACTIVE:
        return _plain_menu(title, options, subtitle, multi_select)

    query = ""
    sort = sort_mode if sort_mode in SORT_MODES else "name"
    cursor = 0
    selected = set()
    pinned = 2 if enable_filter else 0

    def rows_now():
        if not enable_filter:
            return [("option", i) for i in range(len(options))]
        rows = [("virtual", "filter"), ("virtual", "sort")]
        if not query:
            rows += [("option", i) for i, o in enumerate(options) if o.kind == KIND_TOGGLE]
        pool = [i for i, o in enumerate(options) if o.kind in (KIND_ITEM, KIND_FILE)]
        if query:
            pool = [i for i in pool if query.casefold() in options[i].sort_name.casefold()]
        rows += [("option", i) for i in _sort_indices(options, pool, sort)]
        rows += [("option", i) for i, o in enumerate(options) if o.kind == KIND_PLAIN]
        return rows

    print("\033[2J\033[H", end="")

    while True:
        rows = rows_now()
        total = len(rows)
        if total:
            cursor = min(cursor, total - 1)
            if not _entry_selectable(rows, options, cursor):
                cursor = _move(rows, options, cursor, 1)

        try:
            term_lines = os.get_terminal_size().lines
        except OSError:
            term_lines = 24

        body = rows[pinned:]
        body_len = len(body)
        limit = max_visible if max_visible is not None else max(body_len, 1)
        limit = max(5, min(limit, max(5, term_lines - 10)))
        start = end = 0
        if body_len:
            relative = max(0, cursor - pinned)
            start = max(0, relative - limit // 2)
            end = min(start + limit, body_len)
            start = max(0, end - limit)

        def draw(row_index, focused):
            entry = rows[row_index]
            marker = f"{UI.SELECT}➜  " if focused else "   "
            if entry[0] == "virtual":
                if entry[1] == "filter":
                    value = f"'{query}'" if query else "none"
                    text = f"{UI.YELLOW}Filter: {value}{UI.END} {UI.GRAY}(Enter to type){UI.END}"
                else:
                    text = f"{UI.YELLOW}Sort: {SORT_LABELS[sort]}{UI.END} {UI.GRAY}(Enter to change){UI.END}"
                sys.stdout.write(f" {marker}{text}{UI.END}\033[K\n")
                return

            option = options[entry[1]]
            if option.kind == KIND_SEPARATOR:
                sys.stdout.write(f" {UI.GRAY} {option.label}{UI.END}\033[K\n")
                return

            prefix = ""
            if multi_select:
                if option.kind == KIND_FILE:
                    prefix = f"{UI.GREEN}[x]{UI.END} " if entry[1] in selected else f"{UI.GRAY}[ ]{UI.END} "
                elif option.kind == KIND_TOGGLE:
                    targets = _group_targets(options, option.group)
                    marked = bool(targets) and all(t in selected for t in targets)
                    prefix = f"{UI.GREEN}[x]{UI.END} " if marked else f"{UI.GRAY}[ ]{UI.END} "

            tint = UI.SELECT if focused else UI.WHITE
            body_text = option.label.replace(UI.END, UI.END + tint) if UI.END in option.label else option.label
            sys.stdout.write(f" {marker}{prefix}{tint}{body_text}{UI.END}\033[K\n")

        sys.stdout.write(UI.HOME_CURSOR + UI.HIDE_CURSOR)
        sys.stdout.write(f"{UI.HEADER}{UI.BOLD}=== {title} ==={UI.END}\033[K\n")
        if subtitle:
            sys.stdout.write(f" {UI.GRAY}{subtitle}{UI.END}\033[K\n")

        for index in range(pinned):
            draw(index, cursor == index)

        if not body_len:
            sys.stdout.write(f"    {UI.GRAY}No matches found.{UI.END}\033[K\n")
        else:
            sys.stdout.write(f"    {UI.CYAN}▲{UI.END}\033[K\n" if start > 0 else "\033[K\n")
            for offset in range(start, end):
                draw(pinned + offset, cursor == pinned + offset)
            sys.stdout.write(f"    {UI.CYAN}▼{UI.END}\033[K\n" if end < body_len else "\033[K\n")

        scroll = f" | Showing {start + 1}-{end} of {body_len}" if limit < body_len else ""
        help_text = "↑/↓: Move | Enter: Confirm | Esc: Back"
        if multi_select:
            help_text += " | Space: Toggle"
        sys.stdout.write(f"{UI.CYAN}({help_text}){scroll}{UI.END}\033[K\n")
        sys.stdout.write("\033[J")
        sys.stdout.flush()

        key = get_key()
        if key == "up":
            cursor = _move(rows, options, cursor, -1)
            continue
        if key == "down":
            cursor = _move(rows, options, cursor, 1)
            continue
        if key == "esc":
            sys.stdout.write(UI.SHOW_CURSOR)
            return [] if multi_select else -1
        if key == "space" and total and multi_select:
            entry = rows[cursor]
            if entry[0] == "option":
                option = options[entry[1]]
                if option.kind == KIND_FILE:
                    selected.symmetric_difference_update({entry[1]})
                elif option.kind == KIND_TOGGLE:
                    targets = _group_targets(options, option.group)
                    if targets and all(t in selected for t in targets):
                        selected.difference_update(targets)
                    else:
                        selected.update(targets)
            continue
        if key != "enter" or not total:
            continue

        entry = rows[cursor]
        if entry[0] == "virtual":
            sys.stdout.write(UI.SHOW_CURSOR)
            if entry[1] == "filter":
                sys.stdout.write(f"\r\033[K{UI.HEADER}Filter by name{UI.END} "
                                 f"{UI.GRAY}(blank clears it, Esc cancels){UI.END}\n")
                typed = interactive_input(f"{UI.YELLOW}Keyword > {UI.END}", query)
                if typed is not None:
                    query = typed.strip()
                cursor = pinned
            else:
                sort = SORT_MODES[(SORT_MODES.index(sort) + 1) % len(SORT_MODES)]
            print("\033[2J\033[H", end="")
            continue

        option = options[entry[1]]
        if not option.selectable:
            continue
        if multi_select and not selected:
            continue

        print()
        sys.stdout.write(UI.HIDE_CURSOR)
        return sorted(selected) if multi_select else entry[1]


# --- job execution (shared by the menu and the subcommands) ---

def execute_jobs(inputs, args, ext, jobs=1, delete_after=False, output=None,
                 dry_run=False, quiet=False, skip_existing=False):
    """Run ffmpeg over `inputs`. Returns (succeeded, failed, skipped)."""
    plan = []
    skipped = 0
    for source in inputs:
        target = output if output else ffcore.default_output(source, ext)
        if skip_existing and os.path.exists(target):
            skipped += 1
            continue
        plan.append((source, target))

    if not plan:
        if not quiet:
            print(f"{UI.YELLOW}Nothing to do ({skipped} skipped).{UI.END}")
        return 0, 0, skipped

    if dry_run:
        for source, target in plan:
            print(ffcore.format_args(ffcore.build_command(source, target, args)))
        return 0, 0, skipped

    show_progress = INTERACTIVE and not quiet and len(plan) > 0
    state = {source: {"pct": 0.0, "speed": "", "running": False} for source, _ in plan}
    lock = threading.Lock()
    width = 0
    try:
        width = os.get_terminal_size().columns
    except OSError:
        width = 100

    def render(done_count):
        if not show_progress:
            return
        parts = []
        with lock:
            for source, info in state.items():
                if info["running"]:
                    speed = f" {info['speed']}" if info["speed"] else ""
                    parts.append(f"{os.path.basename(source)} {info['pct']:.0f}%{speed}")
        line = f"[{done_count}/{len(plan)}] " + " | ".join(parts[:2])
        sys.stdout.write(UI.CLEAR_LINE + line[: max(20, width - 1)])
        sys.stdout.flush()

    def report(source, target, code, error, elapsed):
        if show_progress:
            sys.stdout.write(UI.CLEAR_LINE)
        name = os.path.basename(source)
        if code == 0:
            print(f" {UI.GREEN}{OK_MARK}{UI.END} {name} -> {UI.YELLOW}{os.path.basename(target)}{UI.END}"
                  f" {UI.GRAY}({elapsed:.1f}s){UI.END}")
        else:
            detail = ""
            if error:
                detail = next((ln for ln in reversed(error.splitlines()) if ln.strip()), "")
            print(f" {UI.RED}{FAIL_MARK}{UI.END} {name} {UI.GRAY}{detail[:120]}{UI.END}")

    def job(source, target):
        with lock:
            state[source]["running"] = True

        def on_progress(pct, speed):
            with lock:
                if pct is not None:
                    state[source]["pct"] = pct
                if speed:
                    state[source]["speed"] = speed

        code, error, elapsed = ffcore.run_ffmpeg(source, target, args, on_progress=on_progress)
        with lock:
            state[source]["running"] = False
        if code == 0 and delete_after:
            try:
                os.remove(source)
            except OSError:
                pass
        return source, target, code, error, elapsed

    succeeded = failed = 0
    interrupted = False
    futures = {}
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=max(1, jobs))
    try:
        futures = {pool.submit(job, source, target): (source, target) for source, target in plan}
        pending = set(futures)
        finished = 0
        while pending:
            done, pending = concurrent.futures.wait(pending, timeout=0.15)
            for future in done:
                source, target, code, error, elapsed = future.result()
                finished += 1
                if code == 0:
                    succeeded += 1
                else:
                    failed += 1
                report(source, target, code, error, elapsed)
            render(finished)
    except KeyboardInterrupt:
        interrupted = True
        ffcore.cancel_all()
        for future in futures:
            future.cancel()
        if show_progress:
            sys.stdout.write(UI.CLEAR_LINE)
        print(f"\n{UI.RED}Cancelled - ffmpeg processes stopped.{UI.END}")
    finally:
        pool.shutdown(wait=not interrupted)
        if show_progress:
            sys.stdout.write(UI.CLEAR_LINE)
        sys.stdout.flush()

    if not quiet:
        summary = f"{UI.GREEN}{succeeded} succeeded{UI.END}"
        if failed:
            summary += f", {UI.RED}{failed} failed{UI.END}"
        if skipped:
            summary += f", {UI.GRAY}{skipped} skipped{UI.END}"
        print(summary)
    return succeeded, failed, skipped


# --- interactive flows ---

def choose_preset(presets):
    names = list(presets)
    if not names:
        print(f"{UI.RED}No presets yet. Add one from 'Manage presets'.{UI.END}")
        pause()
        return None
    options = [
        Option(f"{UI.CYAN}{name}{UI.END} {UI.GRAY}[{presets[name]['ext']}]{UI.END}",
               kind=KIND_ITEM, sort_name=name)
        for name in names
    ]
    options.append(Option("Back"))
    index = interactive_menu("SELECT PRESET", options, enable_filter=True,
                             subtitle="Use the Filter row to narrow a long list")
    if index in (-1, len(options) - 1):
        return None
    return names[index]


def build_file_menu(files, directory):
    options = []
    for ext in sorted({os.path.splitext(name)[1].lower() for name in files} - {""}):
        options.append(Option(f"{UI.YELLOW}Select ALL {ext}{UI.END}",
                              kind=KIND_TOGGLE, group=ext, sort_name=ext))

    for name in files:
        full_path = os.path.join(directory, name)
        try:
            added = os.path.getmtime(full_path)
        except OSError:
            added = 0.0
        kind_color = {"video": UI.HEADER, "audio": UI.BLUE, "image": UI.YELLOW}.get(
            ffcore.Media.kind(name), UI.GRAY)
        options.append(Option(
            f"{kind_color}{ffcore.Media.ext_label(name)}{UI.END} {name} "
            f"{UI.GRAY}({ffcore.Media.human_size(full_path)}){UI.END}",
            kind=KIND_FILE,
            group=os.path.splitext(name)[1].lower(),
            sort_name=name,
            sort_added=added,
            payload=name,
        ))
    return options


def prompt_manual_command(default_ext):
    global last_manual_args, last_manual_ext

    print(f"{UI.HEADER}{UI.BOLD}=== CUSTOM FFMPEG COMMAND ==={UI.END}")
    print(f"{UI.GRAY}Enter the options that follow the input file (-i).{UI.END}")
    print(f"{UI.GRAY}You can also paste a whole `ffmpeg -i in.mp4 ... out.mp4` line.{UI.END}")
    print(f"{UI.CYAN}(Esc to cancel){UI.END}\n")

    raw = interactive_input(f"{UI.BOLD}Arguments > {UI.END}", last_manual_args)
    if raw is None or raw.strip().lower() in ("", "exit"):
        return None

    args, detected_ext = ffcore.extract_pasted(raw, default_ext)
    if not args:
        print(f"{UI.RED}No ffmpeg options were recognised.{UI.END}")
        pause()
        return None
    if detected_ext and detected_ext != ffcore.normalize_ext(default_ext):
        print(f"{UI.GREEN}➜ output extension:{UI.END} {detected_ext}")

    ext = interactive_input(f"{UI.BOLD}Output extension{UI.END} {UI.GRAY}[{detected_ext or default_ext}]:{UI.END} ",
                            detected_ext or default_ext)
    if ext is None:
        return None
    ext = ffcore.normalize_ext(ext, detected_ext or default_ext or ".mp4")

    last_manual_args = ffcore.format_args(args)
    last_manual_ext = ext
    return args, ext


def run_process_flow(presets, directory):
    files = ffcore.Media.list_dir(directory)
    if not files:
        print(f"\n{UI.RED}No media files found in {directory}{UI.END}")
        pause()
        return

    options = build_file_menu(files, directory)
    chosen = interactive_menu(
        "SELECT MEDIA FILES", options,
        subtitle="Space: toggle a file | Enter: confirm | Filter/Sort rows on top",
        multi_select=True, enable_filter=True,
    )
    if not chosen:
        return

    selected = [os.path.join(directory, options[index].payload) for index in chosen]
    action = interactive_menu(f"PROCESS: {len(selected)} file(s) selected", [
        "Use a saved preset",
        "Enter a custom ffmpeg command",
        "---",
        "Back",
    ])
    if action in (-1, 3):
        return

    if action == 0:
        name = choose_preset(presets)
        if not name:
            return
        args = ffcore.parse_args(presets[name]["cmd"])
        ext = presets[name]["ext"]
        print(f"\n{UI.GRAY}Preset:{UI.END} {UI.CYAN}{name}{UI.END} {UI.GRAY}-> {ext}{UI.END}")
    else:
        default_ext = os.path.splitext(selected[0])[1].lower()
        manual = prompt_manual_command(default_ext)
        if not manual:
            return
        args, ext = manual

    post = interactive_menu("AFTER A SUCCESSFUL RUN", [
        "Keep the original files (safe)",
        "Delete the originals",
        "---",
        "Back",
    ])
    if post in (-1, 3):
        return
    delete_after = post == 1

    jobs = 1
    if len(selected) > 1:
        concurrency = interactive_menu("PARALLEL FFMPEG PROCESSES", [
            "Sequential (1 at a time)",
            "2 processes",
            "3 processes",
            "4 processes",
            "---",
            "Back",
        ])
        if concurrency in (-1, 5):
            return
        jobs = concurrency + 1

    print("\033[2J\033[H", end="")
    print(f"{UI.HEADER}{UI.BOLD}=== PROCESSING {len(selected)} FILE(S) | {jobs} WORKER(S) ==={UI.END}")
    print(f"{UI.GRAY}{ffcore.format_args(args)}{UI.END}\n")
    execute_jobs(selected, args, ext, jobs=jobs, delete_after=delete_after)
    pause()


def show_presets(presets, config):
    print(f"\n{UI.HEADER}{UI.BOLD}=== PRESET LIBRARY ({len(presets)}) ==={UI.END}")
    print(f"{UI.GRAY}{config}{UI.END}\n")
    if not presets:
        print(f" {UI.GRAY}Empty.{UI.END}")
    for index, (name, data) in enumerate(presets.items(), 1):
        print(f" {UI.CYAN}{UI.BOLD}{index}. {name}{UI.END} {UI.YELLOW}[{data['ext']}]{UI.END}")
        print(f"    {UI.GRAY}{data['cmd']}{UI.END}")


def add_preset_flow(presets, config):
    name = interactive_input("Preset name > ")
    if not name or not name.strip():
        return
    name = name.strip()
    if name in presets:
        print(f"{UI.RED}'{name}' already exists.{UI.END}")
        pause()
        return

    raw = interactive_input("FFmpeg arguments > ", "")
    if raw is None or not raw.strip():
        return
    args, detected = ffcore.extract_pasted(raw)
    if not args:
        print(f"{UI.RED}No ffmpeg options were recognised.{UI.END}")
        pause()
        return

    ext = interactive_input(f"Output extension {UI.GRAY}[{detected or '.mp4'}]:{UI.END} ", detected or ".mp4")
    if ext is None:
        return
    presets[name] = {"cmd": ffcore.format_args(args), "ext": ffcore.normalize_ext(ext, ".mp4")}
    ffcore.save_presets(config, presets)
    print(f"\n{UI.GREEN}✓ Saved preset '{name}'.{UI.END}")
    pause()


def edit_preset_flow(presets, config):
    name = choose_preset(presets)
    if not name:
        return

    current = presets[name]
    print(f"\n{UI.HEADER}{UI.BOLD}=== EDIT PRESET ==={UI.END}")
    print(f"{UI.GRAY}Enter keeps the current value, Esc cancels.{UI.END}\n")

    new_name = interactive_input(f"Name {UI.GRAY}[{name}]:{UI.END} ", name)
    if new_name is None:
        return
    new_cmd = interactive_input(f"Arguments {UI.GRAY}[{current['cmd'][:40]}...]:{UI.END} ", current["cmd"])
    if new_cmd is None:
        return
    new_ext = interactive_input(f"Extension {UI.GRAY}[{current['ext']}]:{UI.END} ", current["ext"])
    if new_ext is None:
        return

    args, detected = ffcore.extract_pasted(new_cmd, new_ext or current["ext"])
    final_name = new_name.strip() or name
    if final_name != name:
        del presets[name]
    presets[final_name] = {
        "cmd": ffcore.format_args(args),
        "ext": ffcore.normalize_ext(new_ext or detected, current["ext"]),
    }
    ffcore.save_presets(config, presets)
    print(f"\n{UI.GREEN}✓ Updated preset '{final_name}'.{UI.END}")
    pause()


def delete_preset_flow(presets, config):
    name = choose_preset(presets)
    if not name:
        return
    confirm = interactive_menu(f"DELETE PRESET: {name}", [
        "No, keep it",
        "Yes, delete it",
    ], subtitle="This cannot be undone.")
    if confirm != 1:
        return
    del presets[name]
    ffcore.save_presets(config, presets)
    print(f"\n{UI.GREEN}✓ Deleted preset '{name}'.{UI.END}")
    pause()


def manage_presets_flow(presets, config):
    while True:
        choice = interactive_menu("PRESET LIBRARY", [
            "List presets",
            "Add preset",
            "Edit preset",
            "Delete preset",
            "---",
            "Back",
        ], subtitle=f"{len(presets)} preset(s)")
        if choice in (-1, 5):
            return
        if choice == 0:
            show_presets(presets, config)
            pause()
        elif choice == 1:
            add_preset_flow(presets, config)
        elif choice == 2:
            edit_preset_flow(presets, config)
        elif choice == 3:
            delete_preset_flow(presets, config)


def show_preset_location(config):
    path = os.path.abspath(config)
    print(f"\n{UI.CYAN}Preset file:{UI.END} {path}")
    if os.path.exists(path):
        print(f"{UI.GRAY}{len(ffcore.read_presets(path))} preset(s), "
              f"{ffcore.Media.human_size(path)}{UI.END}")
    else:
        print(f"{UI.GRAY}Not created yet - it appears after the first save.{UI.END}")
    pause()


def summon_web(target, port=None):
    launcher = os.path.join(ffcore.SCRIPT_DIR, "ffcli_web.py")
    if not os.path.exists(launcher):
        print(f"{UI.RED}✗ Web UI not found: {launcher}{UI.END}")
        return 1
    if os.path.isfile(target):
        target = os.path.dirname(target)
    argv = [sys.executable, launcher]
    if port:
        argv.append(str(port))
    argv.append(target)
    print(f"{UI.GRAY}Starting the web cutter for {target} ...{UI.END}")
    try:
        return subprocess.call(argv)
    except KeyboardInterrupt:
        return 0


def main_menu(config, directory):
    presets, _ = ffcore.load_presets(config)
    while True:
        choice = interactive_menu("FFCLI", [
            "Process media in this folder",
            "Manage presets",
            "Open the web cutter",
            "Show preset file location",
            "---",
            "Exit",
        ], subtitle=f"{directory} | {len(presets)} preset(s)")
        if choice in (-1, 5):
            return 0
        if choice == 0:
            run_process_flow(presets, directory)
        elif choice == 1:
            manage_presets_flow(presets, config)
        elif choice == 2:
            summon_web(directory)
        elif choice == 3:
            show_preset_location(config)


# --- subcommands ---

def expand_inputs(raw_inputs, directory):
    resolved = []
    for item in raw_inputs:
        path = item if os.path.isabs(item) else os.path.join(directory, item)
        path = os.path.abspath(os.path.expanduser(path))
        if os.path.isdir(path):
            resolved.extend(os.path.join(path, name) for name in ffcore.Media.list_dir(path))
        elif any(ch in item for ch in "*?["):
            resolved.extend(sorted(p for p in glob.glob(path) if os.path.isfile(p)))
        elif os.path.isfile(path):
            resolved.append(path)
        else:
            raise FileNotFoundError(item)

    unique = []
    for path in resolved:
        if path not in unique:
            unique.append(path)
    if not unique:
        raise FileNotFoundError(", ".join(raw_inputs))
    return unique


def cmd_run(ns, config, directory):
    presets, _ = ffcore.load_presets(config)
    token_cmd = getattr(ns, "cmd_tokens", None)

    if bool(ns.preset) == (bool(ns.cmd) or token_cmd is not None):
        print("ffcli run: pass exactly one of --preset or --cmd/-- <args>", file=sys.stderr)
        return 2

    if ns.preset:
        if ns.preset not in presets:
            print(f"ffcli run: unknown preset '{ns.preset}'. Try: ffcli presets list", file=sys.stderr)
            return 2
        entry = presets[ns.preset]
        args = ffcore.parse_args(entry["cmd"])
        ext = ffcore.normalize_ext(ns.ext, entry["ext"])
    elif token_cmd is not None:
        args = list(token_cmd)
        ext = ffcore.normalize_ext(ns.ext, ".mp4")
    else:
        args, detected = ffcore.extract_pasted(ns.cmd)
        ext = ffcore.normalize_ext(ns.ext, detected or ".mp4")

    if not args:
        print("ffcli run: the command holds no ffmpeg options", file=sys.stderr)
        return 2

    inputs = expand_inputs(ns.inputs, directory)
    if ns.out and len(inputs) > 1:
        print("ffcli run: --out only works with a single input", file=sys.stderr)
        return 2

    output = None
    if ns.out:
        output = ns.out if os.path.isabs(ns.out) else os.path.join(directory, ns.out)
        output = os.path.abspath(output)

    if not ns.quiet and not ns.dry_run:
        print(f"{UI.GRAY}{len(inputs)} file(s) | {ffcore.format_args(args)} | -> {ext}{UI.END}")

    succeeded, failed, _ = execute_jobs(
        inputs, args, ext,
        jobs=ns.jobs, delete_after=ns.delete, output=output,
        dry_run=ns.dry_run, quiet=ns.quiet, skip_existing=ns.skip_existing,
    )
    return 0 if failed == 0 else 1


def cmd_presets(ns, config, directory):
    presets, source = ffcore.load_presets(config)
    action = ns.preset_action

    if action == "list":
        if ns.json:
            print(json.dumps(presets, indent=2, ensure_ascii=False))
            return 0
        if not presets:
            print("No presets. Add one with: ffcli presets add NAME --cmd \"...\" --ext .mp4")
            return 0
        width = max(len(name) for name in presets)
        for name, data in presets.items():
            print(f"{name.ljust(width)}  {data['ext'].ljust(6)}  {data['cmd']}")
        print(f"\n{len(presets)} preset(s) | {config}")
        return 0

    if action == "show":
        if ns.name not in presets:
            print(f"ffcli presets: unknown preset '{ns.name}'", file=sys.stderr)
            return 2
        entry = presets[ns.name]
        print(f"name: {ns.name}")
        print(f"ext:  {entry['ext']}")
        print(f"cmd:  {entry['cmd']}")
        return 0

    if action == "add":
        if ns.name in presets and not ns.force:
            print(f"ffcli presets: '{ns.name}' exists (use --force to replace)", file=sys.stderr)
            return 2
        args, detected = ffcore.extract_pasted(ns.cmd)
        if not args:
            print("ffcli presets: --cmd holds no ffmpeg options", file=sys.stderr)
            return 2
        presets[ns.name] = {
            "cmd": ffcore.format_args(args),
            "ext": ffcore.normalize_ext(ns.ext, detected or ".mp4"),
        }
        ffcore.save_presets(config, presets)
        print(f"saved '{ns.name}' -> {config}")
        return 0

    if action == "set":
        if ns.name not in presets:
            print(f"ffcli presets: unknown preset '{ns.name}'", file=sys.stderr)
            return 2
        entry = dict(presets[ns.name])
        if ns.cmd is not None:
            args, detected = ffcore.extract_pasted(ns.cmd, entry["ext"])
            if not args:
                print("ffcli presets: --cmd holds no ffmpeg options", file=sys.stderr)
                return 2
            entry["cmd"] = ffcore.format_args(args)
            if detected:
                entry["ext"] = detected
        if ns.ext:
            entry["ext"] = ffcore.normalize_ext(ns.ext, entry["ext"])
        final_name = ns.new_name or ns.name
        if final_name != ns.name:
            del presets[ns.name]
        presets[final_name] = entry
        ffcore.save_presets(config, presets)
        print(f"updated '{final_name}'")
        return 0

    if action == "rm":
        if ns.name not in presets:
            print(f"ffcli presets: unknown preset '{ns.name}'", file=sys.stderr)
            return 2
        del presets[ns.name]
        ffcore.save_presets(config, presets)
        print(f"removed '{ns.name}'")
        return 0

    if action == "import":
        imported = ffcore.read_presets(os.path.abspath(os.path.expanduser(ns.file)))
        if not imported:
            print(f"ffcli presets: nothing usable in {ns.file}", file=sys.stderr)
            return 2
        merged = {} if ns.replace else dict(presets)
        merged.update(imported)
        ffcore.save_presets(config, merged)
        print(f"imported {len(imported)} preset(s) | library now {len(merged)}")
        return 0

    if action == "export":
        target = os.path.abspath(os.path.expanduser(ns.file))
        ffcore.save_presets(target, presets)
        print(f"exported {len(presets)} preset(s) -> {target}")
        return 0

    print(f"ffcli presets: unknown action '{action}'", file=sys.stderr)
    return 2


def cmd_cut(ns, config, directory):
    target = directory if not ns.path else ns.path
    if not os.path.isabs(target):
        target = os.path.join(directory, target)
    return summon_web(os.path.abspath(target), ns.port)


def cmd_doctor(ns, config, directory):
    presets, source = ffcore.load_presets(config)
    print(f"ffcli {ffcore.VERSION}")
    print(f"python      {sys.version.split()[0]} ({sys.executable})")
    print(f"script dir  {ffcore.SCRIPT_DIR}")
    print(f"work dir    {directory}")
    print(f"presets     {config} [{len(presets)} preset(s), source: {source}]")

    ok, lines = ffcore.check_tools()
    for name, path, version in lines:
        print(f"{name:<11} {path or '-'}\n            {version}")
    if not os.path.exists(os.path.join(ffcore.SCRIPT_DIR, "ffcli_web.py")):
        ok = False
        print("web ui      MISSING ffcli_web.py")
    else:
        print(f"web ui      {os.path.join(ffcore.SCRIPT_DIR, 'ffcli_web.py')}")
    print("\nOK" if ok else "\nSome tools are missing - install ffmpeg and make sure it is in PATH.")
    return 0 if ok else 1


EPILOG = """examples:
  ffcli                                      # interactive menu for the current folder
  ffcli run movie.mkv -p "Max Compression (H.265 HEVC)"
  ffcli run *.mp4 -- "-c:v" libx264 -crf 23 "-c:a" aac
  ffcli run *.mp4 -c "-c:v libx264 -crf 23 -c:a aac" -e .mp4 -j 3
  ffcli run clips/ -p "Extract MP3 Audio (VBR High Quality)" --delete
  ffcli run movie.mp4 -p "Extract MP3 Audio (VBR High Quality)" --dry-run
  ffcli presets list
  ffcli presets add "GIF 15fps" --cmd '-vf "fps=15,scale=480:-1"' --ext .gif
  ffcli cut movie.mp4                        # open the web cutter in the browser

tip: ffmpeg options start with '-', so use `-- <args>` (or `--cmd="..."`) to
pass them without the shell/parser eating them.
"""


def common_options():
    """Options accepted both before and after the subcommand."""
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--config", default=argparse.SUPPRESS,
                        help="preset JSON (default: ffmpeg_commands.json next to ffcli.py)")
    common.add_argument("-C", "--dir", default=argparse.SUPPRESS,
                        help="folder holding the inputs (default: cwd)")
    return common


def build_parser():
    common = common_options()
    parser = argparse.ArgumentParser(
        prog="ffcli",
        description="ffmpeg preset runner with a built-in web cutter.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=EPILOG,
    )
    parser.add_argument("-V", "--version", action="version", version=f"ffcli {ffcore.VERSION}")
    parser.add_argument("--config", help="preset JSON (default: ffmpeg_commands.json next to ffcli.py)")
    parser.add_argument("-C", "--dir", default=".", help="folder holding the inputs (default: cwd)")
    sub = parser.add_subparsers(dest="command")

    run = sub.add_parser("run", parents=[common], help="convert files with a preset or a custom command")
    run.add_argument("inputs", nargs="+", help="files, glob patterns or folders")
    run.add_argument("-p", "--preset", help="preset name")
    run.add_argument("-c", "--cmd", help="custom ffmpeg options (everything after -i)")
    run.add_argument("-e", "--ext", help="output extension (default: from the preset)")
    run.add_argument("-o", "--out", help="exact output path (single input only)")
    run.add_argument("-j", "--jobs", type=int, default=1, help="parallel ffmpeg processes (default 1)")
    run.add_argument("--delete", action="store_true", help="delete the source after a successful run")
    run.add_argument("--skip-existing", action="store_true", help="skip inputs whose output exists")
    run.add_argument("--dry-run", action="store_true", help="print the ffmpeg commands only")
    run.add_argument("-q", "--quiet", action="store_true", help="no progress output")

    presets = sub.add_parser("presets", parents=[common], help="manage the preset library")
    actions = presets.add_subparsers(dest="preset_action", required=True)

    listing = actions.add_parser("list", help="print every preset")
    listing.add_argument("--json", action="store_true", help="machine readable output")

    show = actions.add_parser("show", help="print one preset")
    show.add_argument("name")

    add = actions.add_parser("add", help="create a preset")
    add.add_argument("name")
    add.add_argument("--cmd", required=True, help="ffmpeg options after -i")
    add.add_argument("--ext", help="output extension (default: taken from --cmd, else .mp4)")
    add.add_argument("--force", action="store_true", help="replace an existing preset")

    set_ = actions.add_parser("set", help="update a preset")
    set_.add_argument("name")
    set_.add_argument("--name", dest="new_name", help="rename it")
    set_.add_argument("--cmd", help="new ffmpeg options")
    set_.add_argument("--ext", help="new output extension")

    remove = actions.add_parser("rm", help="delete a preset")
    remove.add_argument("name")

    imp = actions.add_parser("import", help="import presets from a JSON file")
    imp.add_argument("file")
    imp.add_argument("--replace", action="store_true", help="drop the current library")

    exp = actions.add_parser("export", help="write the preset library to a JSON file")
    exp.add_argument("file")

    cut = sub.add_parser("cut", aliases=["web"], parents=[common],
                         help="open the web cutter (trim / waveform UI)")
    cut.add_argument("path", nargs="?", help="file or folder to open (default: work dir)")
    cut.add_argument("--port", type=int, help="server port (default 8765)")

    sub.add_parser("doctor", parents=[common], help="check ffmpeg, ffprobe and the preset file")
    return parser


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]
    argv = list(argv)

    trailing_cmd = None
    if "--" in argv:
        split = argv.index("--")
        trailing_cmd = argv[split + 1:]
        argv = argv[:split]

    parser = build_parser()
    ns = parser.parse_args(argv)

    if trailing_cmd is not None:
        if not hasattr(ns, "cmd"):
            print("ffcli: '--' is only valid for `ffcli run`", file=sys.stderr)
            return 2
        if ns.cmd:
            print("ffcli run: use either -c/--cmd or '-- <args>', not both", file=sys.stderr)
            return 2
        ns.cmd_tokens = trailing_cmd

    directory = os.path.abspath(os.path.expanduser(ns.dir))
    if not os.path.isdir(directory):
        print(f"ffcli: not a folder: {directory}", file=sys.stderr)
        return 2
    config = ffcore.resolve_config_path(ns.config)

    if ns.command is None:
        if not INTERACTIVE:
            parser.print_help()
            return 0
        return main_menu(config, directory)

    handlers = {
        "run": cmd_run,
        "presets": cmd_presets,
        "cut": cmd_cut,
        "web": cmd_cut,
        "doctor": cmd_doctor,
    }
    try:
        return handlers[ns.command](ns, config, directory)
    except FileNotFoundError as exc:
        print(f"ffcli: no such file or folder: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        ffcore.cancel_all()
        print("\nCancelled.")
        return 130


if __name__ == "__main__":
    try:
        exit_code = main()
    except KeyboardInterrupt:
        exit_code = 130
    finally:
        sys.stdout.write(UI.SHOW_CURSOR)
        sys.stdout.flush()
    sys.exit(exit_code)
