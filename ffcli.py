#!/usr/bin/env python3
"""ffcli - run ffmpeg presets or custom commands from a terminal menu.

`ffcli` in a folder opens the interactive menu: pick media, pick a preset (or
type your own FFmpeg options), run 1-4 conversions in parallel, and manage the
preset library.

Each audio/video row also offers View / Rename / Cut / Delete. Cut opens the
single-file cutter in `ffcli_web.py` - a focused page that trims just that file
and exits when it is done, writing `<name>_output.<ext>`.

Standard library only.
"""
from __future__ import annotations

import argparse
import concurrent.futures
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

MENU_REFRESH = "__refresh__"

ACTION_LABELS = {
    "view": "View",
    "rename": "Rename",
    "cut": "Cut",
    "delete": "Delete",
}

SORT_MODES = ("name", "added", "group")
SORT_LABELS = {
    "name": "name (A-Z)",
    "added": "date added (newest first)",
    "group": "file group (.ext)",
}


def file_actions(kind):
    """Row actions offered for a media kind, in display order."""
    if kind in ("video", "audio"):
        return ("view", "rename", "cut", "delete")
    if kind == "image":
        return ("view", "rename", "delete")
    return ()


class Option:
    """A menu row plus the metadata the filter, the sort and the row actions need."""

    __slots__ = ("label", "kind", "group", "sort_name", "sort_added", "payload", "actions")

    def __init__(self, label, kind=KIND_PLAIN, group="", sort_name=None,
                 sort_added=0.0, payload=None, actions=()):
        self.label = label
        self.kind = kind
        self.group = group
        self.sort_name = strip_ansi(label) if sort_name is None else sort_name
        self.sort_added = sort_added
        self.payload = payload
        self.actions = tuple(actions)

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
                     multi_select=False, enable_filter=False, sort_mode="name",
                     initial_selected=None, on_action=None):
    """Scrollable menu with multi-select and per-row actions.

    With `enable_filter` the first two rows are a live filter and a sort switch
    (name / date added / file group). Separator rows are never focusable, so the
    cursor cannot land on them and Enter can never pick one.

    Rows carrying `Option.actions` show them as buttons on the focused row; the
    right/left arrows focus them and Enter calls `on_action(option_index, name)`.
    When that callback returns True the menu stops and `MENU_REFRESH` is
    returned so the caller can rebuild the list.

    Returns the chosen option index (-1 when cancelled), the list of selected
    indices when `multi_select` is set, or `MENU_REFRESH`.
    """
    options = [_as_option(option) for option in options]
    if not INTERACTIVE:
        return _plain_menu(title, options, subtitle, multi_select)

    has_files = any(option.kind == KIND_FILE for option in options)
    query = ""
    sort = sort_mode if sort_mode in SORT_MODES else "name"
    cursor = 0
    selected = set(initial_selected or ())
    action_index = None
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
            sys.stdout.write(f" {marker}{prefix}{tint}{body_text}{UI.END}")
            if option.actions and focused:
                chips = []
                for position, action in enumerate(option.actions):
                    chip = f"[ {ACTION_LABELS.get(action, action)} ]"
                    chips.append(f"{UI.GREEN}{UI.BOLD}{chip}{UI.END}" if action_index == position
                                 else f"{UI.GRAY}{chip}{UI.END}")
                sys.stdout.write("  " + " ".join(chips))
            sys.stdout.write("\033[K\n")

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
        if has_files:
            help_text += " | →: Row actions"
        sys.stdout.write(f"{UI.CYAN}({help_text}){scroll}{UI.END}\033[K\n")
        sys.stdout.write("\033[J")
        sys.stdout.flush()

        key = get_key()
        if key == "up":
            action_index = None
            cursor = _move(rows, options, cursor, -1)
            continue
        if key == "down":
            action_index = None
            cursor = _move(rows, options, cursor, 1)
            continue
        if key in ("left", "right"):
            if total:
                entry = rows[cursor]
                if entry[0] == "option" and options[entry[1]].actions:
                    actions = options[entry[1]].actions
                    if key == "right":
                        action_index = 0 if action_index is None else min(action_index + 1, len(actions) - 1)
                    else:
                        action_index = None if action_index in (None, 0) else action_index - 1
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
        if key == "enter" and action_index is not None and total:
            entry = rows[cursor]
            if entry[0] == "option":
                option = options[entry[1]]
                if option.actions and on_action is not None:
                    if on_action(entry[1], option.actions[action_index]):
                        print()
                        sys.stdout.write(UI.SHOW_CURSOR)
                        return MENU_REFRESH
                    action_index = None
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

def execute_jobs(inputs, args, ext, jobs=1, delete_after=False):
    """Run ffmpeg over `inputs`. Returns (succeeded, failed)."""
    plan = [(source, ffcore.default_output(source, ext)) for source in inputs]
    if not plan:
        return 0, 0

    show_progress = INTERACTIVE
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

    summary = f"{UI.GREEN}{succeeded} succeeded{UI.END}"
    if failed:
        summary += f", {UI.RED}{failed} failed{UI.END}"
    print(summary)
    return succeeded, failed


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
        kind = ffcore.Media.kind(name)
        options.append(Option(
            f"{kind_color}{ffcore.Media.ext_label(name)}{UI.END} {name} "
            f"{UI.GRAY}({ffcore.Media.human_size(full_path)}){UI.END}",
            kind=KIND_FILE,
            group=os.path.splitext(name)[1].lower(),
            sort_name=name,
            sort_added=added,
            payload=full_path,
            actions=file_actions(kind),
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
    picked = set()
    options = []

    def perform(index, action):
        return file_action(directory, action, options[index].payload)

    while True:
        files = ffcore.Media.list_dir(directory)
        if not files:
            print(f"\n{UI.RED}No media files found in {directory}{UI.END}")
            pause()
            return

        options = build_file_menu(files, directory)
        chosen = interactive_menu(
            "SELECT MEDIA FILES", options,
            subtitle="Space: toggle | →: View / Rename / Cut / Delete | Enter: convert",
            multi_select=True, enable_filter=True,
            initial_selected=[i for i, o in enumerate(options)
                              if o.kind == KIND_FILE and o.payload in picked],
            on_action=perform,
        )
        if chosen == MENU_REFRESH:
            continue
        if not chosen:
            return

        selected = [options[index].payload for index in chosen]
        picked = set(selected)

        action = interactive_menu(f"PROCESS: {len(selected)} file(s) selected", [
            "Use a saved preset",
            "Enter a custom ffmpeg command",
            "---",
            "Back",
        ])
        if action in (-1, 3):
            continue

        if action == 0:
            name = choose_preset(presets)
            if not name:
                continue
            args = ffcore.parse_args(presets[name]["cmd"])
            ext = presets[name]["ext"]
            print(f"\n{UI.GRAY}Preset:{UI.END} {UI.CYAN}{name}{UI.END} {UI.GRAY}-> {ext}{UI.END}")
        else:
            default_ext = os.path.splitext(selected[0])[1].lower()
            manual = prompt_manual_command(default_ext)
            if not manual:
                continue
            args, ext = manual

        post = interactive_menu("AFTER A SUCCESSFUL RUN", [
            "Keep the original files (safe)",
            "Delete the originals",
            "---",
            "Back",
        ])
        if post in (-1, 3):
            continue
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
                continue
            jobs = concurrency + 1

        print("\033[2J\033[H", end="")
        print(f"{UI.HEADER}{UI.BOLD}=== PROCESSING {len(selected)} FILE(S) | {jobs} WORKER(S) ==={UI.END}")
        print(f"{UI.GRAY}{ffcore.format_args(args)}{UI.END}\n")
        execute_jobs(selected, args, ext, jobs=jobs, delete_after=delete_after)
        pause()
        return


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


def cut_in_web(path):
    """Open the single-file cutter for `path`; it exits when the cut is done."""
    launcher = os.path.join(ffcore.SCRIPT_DIR, "ffcli_web.py")
    if not os.path.exists(launcher):
        print(f"{UI.RED}Cutter not found: {launcher}{UI.END}")
        pause()
        return False

    print(f"\n{UI.GRAY}Opening the cutter for {os.path.basename(path)}"
          f" - the menu comes back when the cut finishes.{UI.END}\n")
    try:
        subprocess.call([sys.executable, launcher, path])
    except KeyboardInterrupt:
        print(f"\n{UI.GRAY}Cutter stopped.{UI.END}")
        return True
    except OSError as exc:
        print(f"{UI.RED}Could not start the cutter: {exc}{UI.END}")
        pause()
        return False
    return True


def file_action(directory, action, path):
    """Run a row action. Returns True when the caller should rebuild the list."""
    name = os.path.basename(path)

    if action == "view":
        if not ffcore.open_path(path):
            print(f"\n{UI.RED}Could not open {name}{UI.END}")
            pause()
        return False

    if action == "rename":
        new_name = interactive_input(f"{UI.BOLD}Rename{UI.END} {name} -> ", name)
        if new_name is None:
            return False
        new_name = new_name.strip()
        if not new_name or new_name == name:
            return False
        if os.path.basename(new_name) != new_name or new_name in (".", ".."):
            print(f"\n{UI.RED}A file name cannot contain a folder path.{UI.END}")
            pause()
            return False
        target = os.path.join(directory, new_name)
        if os.path.exists(target):
            print(f"\n{UI.RED}'{new_name}' already exists.{UI.END}")
            pause()
            return False
        try:
            os.rename(path, target)
        except OSError as exc:
            print(f"\n{UI.RED}Rename failed: {exc}{UI.END}")
            pause()
            return False
        print(f"\n{UI.GREEN}✓ Renamed to {new_name}{UI.END}")
        pause()
        return True

    if action == "cut":
        return cut_in_web(path)

    if action == "delete":
        confirm = interactive_menu(f"DELETE {name}", [
            "No, keep it",
            "Yes, delete it",
        ], subtitle="This cannot be undone.")
        if confirm != 1:
            return False
        try:
            os.remove(path)
        except OSError as exc:
            print(f"\n{UI.RED}Delete failed: {exc}{UI.END}")
            pause()
            return False
        print(f"\n{UI.GREEN}✓ Deleted {name}{UI.END}")
        pause()
        return True

    return False


def main_menu(config, directory):
    presets, _ = ffcore.load_presets(config)
    while True:
        choice = interactive_menu("FFCLI", [
            "Process media in this folder",
            "Manage presets",
            "Show preset file location",
            "---",
            "Exit",
        ], subtitle=f"{directory} | {len(presets)} preset(s)")
        if choice in (-1, 4):
            return 0
        if choice == 0:
            run_process_flow(presets, directory)
        elif choice == 1:
            manage_presets_flow(presets, config)
        elif choice == 2:
            show_preset_location(config)


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="ffcli",
        description="FFmpeg preset runner with a built-in web cutter.",
    )
    parser.add_argument("-V", "--version", action="version", version=f"ffcli {ffcore.VERSION}")
    parser.parse_args(argv)

    if not INTERACTIVE:
        print("ffcli is an interactive tool: run it from a terminal, inside the folder you want to work on.")
        return 1

    missing = ffcore.missing_tools()
    if missing:
        print(f"{UI.RED}Missing in PATH: {', '.join(missing)}{UI.END}")
        print(f"{UI.GRAY}Install FFmpeg (with ffprobe) and reopen the terminal.{UI.END}")
        pause()
        return 1

    return main_menu(ffcore.resolve_config_path(), os.getcwd())


if __name__ == "__main__":
    try:
        exit_code = main()
    except KeyboardInterrupt:
        exit_code = 130
    finally:
        sys.stdout.write(UI.SHOW_CURSOR)
        sys.stdout.flush()
    sys.exit(exit_code)
