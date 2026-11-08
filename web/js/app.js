const $ = (id) => document.getElementById(id);

const ui = {
  fileName: $("fileName"),
  fileMeta: $("fileMeta"),
  quitBtn: $("quitBtn"),
  videoPane: $("videoPane"),
  videoPlayer: $("videoPlayer"),
  audioPane: $("audioPane"),
  audioPlayer: $("audioPlayer"),
  timeline: $("timeline"),
  waveCanvas: $("waveCanvas"),
  selection: $("selection"),
  inHandle: $("inHandle"),
  outHandle: $("outHandle"),
  cursor: $("cursor"),
  inInput: $("inInput"),
  outInput: $("outInput"),
  lengthText: $("lengthText"),
  modeField: $("modeField"),
  modeSelect: $("modeSelect"),
  formatField: $("formatField"),
  formatSelect: $("formatSelect"),
  fadeInField: $("fadeInField"),
  fadeInInput: $("fadeInInput"),
  fadeOutField: $("fadeOutField"),
  fadeOutInput: $("fadeOutInput"),
  outputName: $("outputName"),
  progressBar: $("progressBar"),
  statusText: $("statusText"),
  cancelBtn: $("cancelBtn"),
  cutBtn: $("cutBtn"),
  doneOverlay: $("doneOverlay"),
  doneText: $("doneText"),
  closeBtn: $("closeBtn"),
};

const state = {
  name: "",
  type: "video",
  ext: ".mp4",
  duration: 0,
  inTime: 0,
  outTime: 0,
  peaks: [],
  dragging: null,
  busy: false,
  done: false,
};

const pad = (value) => String(value).padStart(2, "0");

function formatTime(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const whole = Math.floor(total);
  const ms = Math.min(999, Math.round((total - whole) * 1000));
  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor((whole % 3600) / 60))}:${pad(whole % 60)}.${String(ms).padStart(3, "0")}`;
}

function parseTime(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const full = raw.match(/^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (full) {
    const ms = full[4] ? Number(full[4].padEnd(3, "0")) / 1000 : 0;
    return Number(full[1]) * 3600 + Number(full[2]) * 60 + Number(full[3]) + ms;
  }
  const short = raw.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (short) {
    const ms = short[3] ? Number(short[3].padEnd(3, "0")) / 1000 : 0;
    return Number(short[1]) * 60 + Number(short[2]) + ms;
  }
  const plain = Number(raw);
  return Number.isFinite(plain) ? plain : null;
}

function player() {
  return state.type === "video" ? ui.videoPlayer : ui.audioPlayer;
}

function stem() {
  return state.name.replace(/\.[^.]+$/, "") || "output";
}

function fades() {
  if (state.type !== "audio") return 0;
  return (Number(ui.fadeInInput.value) || 0) + (Number(ui.fadeOutInput.value) || 0);
}

function outputExt() {
  if (state.type === "video") {
    const mode = ui.modeSelect.value;
    if (mode === "audio_only") return ".mp3";
    if (mode === "encode") return ".mp4";
    return state.ext;
  }
  const format = ui.formatSelect.value;
  if (format === "copy") return fades() > 0 ? ".mp3" : state.ext;
  return { mp3: ".mp3", wav: ".wav", flac: ".flac", aac: ".m4a" }[format] || ".mp3";
}

function updateOutputName() {
  ui.outputName.textContent = `${stem()}_output${outputExt()}`;
}

function percent(seconds) {
  if (!state.duration) return 0;
  return Math.min(100, Math.max(0, (seconds / state.duration) * 100));
}

function renderTimeline() {
  const startPct = percent(state.inTime);
  const endPct = percent(state.outTime);
  ui.selection.style.left = `${startPct}%`;
  ui.selection.style.width = `${Math.max(0, endPct - startPct)}%`;
  ui.inHandle.style.left = `${startPct}%`;
  ui.outHandle.style.left = `${endPct}%`;
  ui.inInput.value = formatTime(state.inTime);
  ui.outInput.value = formatTime(state.outTime);
  ui.lengthText.textContent = formatTime(Math.max(0, state.outTime - state.inTime));
  moveCursor();
}

function moveCursor() {
  const current = player().currentTime || 0;
  ui.cursor.style.left = `${percent(current)}%`;
}

function seek(seconds) {
  if (!state.duration) return;
  const target = Math.min(state.duration, Math.max(0, seconds));
  try {
    player().currentTime = target;
  } catch (err) {
    /* metadata not ready yet */
  }
  ui.cursor.style.left = `${percent(target)}%`;
}

function setStatus(message, isError = false) {
  ui.statusText.textContent = message;
  ui.statusText.classList.toggle("error", Boolean(isError));
}

function setBusy(busy) {
  state.busy = busy;
  ui.cutBtn.disabled = busy;
  ui.cancelBtn.hidden = !busy;
}

// --- waveform ---------------------------------------------------------------

function drawWaveform() {
  const canvas = ui.waveCanvas;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const peaks = state.peaks;
  if (!peaks.length) {
    ctx.fillStyle = "rgba(120, 113, 108, 0.35)";
    ctx.fillRect(0, rect.height / 2 - 0.5, rect.width, 1);
    return;
  }

  ctx.fillStyle = "rgba(168, 162, 158, 0.42)";
  const middle = rect.height / 2;
  const scale = rect.height * 0.44;
  for (let x = 0; x < rect.width; x += 1) {
    const peak = peaks[Math.floor((x / rect.width) * peaks.length)] || 0;
    const height = Math.max(1, peak * scale);
    ctx.fillRect(x, middle - height, 1, height * 2);
  }
}

// --- timeline interaction ---------------------------------------------------

function timeAt(event) {
  const rect = ui.timeline.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  return ratio * state.duration;
}

ui.timeline.addEventListener("pointerdown", (event) => {
  if (!state.duration || state.busy) return;
  const rect = ui.timeline.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const inX = (state.inTime / state.duration) * rect.width;
  const outX = (state.outTime / state.duration) * rect.width;

  if (Math.abs(x - inX) <= 10 && Math.abs(inX - outX) > 4) {
    state.dragging = "in";
  } else if (Math.abs(x - outX) <= 10) {
    state.dragging = "out";
  } else {
    state.dragging = "seek";
    seek(timeAt(event));
  }
  ui.timeline.setPointerCapture(event.pointerId);
});

ui.timeline.addEventListener("pointermove", (event) => {
  if (!state.dragging) {
    const rect = ui.timeline.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const inX = (state.inTime / state.duration) * rect.width;
    const outX = (state.outTime / state.duration) * rect.width;
    ui.timeline.style.cursor = Math.abs(x - inX) <= 10 || Math.abs(x - outX) <= 10 ? "ew-resize" : "crosshair";
    return;
  }
  const time = timeAt(event);
  if (state.dragging === "in") {
    state.inTime = Math.min(Math.max(0, time), Math.max(0, state.outTime - 0.05));
  } else if (state.dragging === "out") {
    state.outTime = Math.max(Math.min(state.duration, time), state.inTime + 0.05);
  } else {
    seek(time);
    return;
  }
  renderTimeline();
});

const stopDrag = () => {
  if (state.dragging && state.dragging !== "seek") {
    seek(state.dragging === "in" ? state.inTime : state.outTime);
  }
  state.dragging = null;
};
ui.timeline.addEventListener("pointerup", stopDrag);
ui.timeline.addEventListener("pointercancel", stopDrag);

// --- crop inputs ------------------------------------------------------------

function commitInput(which) {
  const input = which === "in" ? ui.inInput : ui.outInput;
  const parsed = parseTime(input.value);
  if (parsed === null) {
    renderTimeline();
    return;
  }
  if (which === "in") {
    state.inTime = Math.min(Math.max(0, parsed), Math.max(0, state.outTime - 0.05));
    seek(state.inTime);
  } else {
    state.outTime = Math.max(Math.min(state.duration, parsed), state.inTime + 0.05);
    seek(state.outTime);
  }
  renderTimeline();
}

ui.inInput.addEventListener("change", () => commitInput("in"));
ui.outInput.addEventListener("change", () => commitInput("out"));
ui.inInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") ui.inInput.blur();
});
ui.outInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") ui.outInput.blur();
});

for (const control of [ui.modeSelect, ui.formatSelect, ui.fadeInInput, ui.fadeOutInput]) {
  control.addEventListener("change", updateOutputName);
}

// --- cutting ----------------------------------------------------------------

async function startCut() {
  if (state.busy || !state.duration) return;
  if (state.outTime - state.inTime < 0.05) {
    setStatus("The out point must be after the in point", true);
    return;
  }
  setBusy(true);
  setStatus("Starting…");
  ui.progressBar.style.width = "0%";

  const payload = {
    start: state.inTime,
    end: state.outTime,
    mode: state.type === "video" ? ui.modeSelect.value : "encode",
    format: state.type === "audio" ? ui.formatSelect.value : "copy",
    fade_in: state.type === "audio" ? Number(ui.fadeInInput.value) || 0 : 0,
    fade_out: state.type === "audio" ? Number(ui.fadeOutInput.value) || 0 : 0,
  };

  try {
    const response = await fetch("/api/cut", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.error || "could not start");
  } catch (err) {
    setBusy(false);
    setStatus(String(err.message || err), true);
    return;
  }
  pollStatus();
}

function pollStatus() {
  setTimeout(async () => {
    let status;
    try {
      status = await (await fetch("/api/status")).json();
    } catch (err) {
      setBusy(false);
      setStatus("Lost the local server", true);
      return;
    }

    if (status.status === "running") {
      const pct = Math.min(100, status.progress || 0);
      ui.progressBar.style.width = `${pct}%`;
      setStatus(`Cutting ${Math.round(pct)}%${status.speed ? " · " + status.speed : ""}`);
      if (status.output) ui.outputName.textContent = status.output;
      pollStatus();
      return;
    }

    if (status.status === "done") {
      complete(status);
      return;
    }

    setBusy(false);
    setStatus(status.message || "Cancelled", status.status === "error");
    ui.progressBar.style.width = "0%";
  }, 300);
}

function complete(status) {
  state.done = true;
  setBusy(false);
  state.busy = true; // keep the controls locked
  ui.cutBtn.disabled = true;
  ui.progressBar.style.width = "100%";
  setStatus("Done");
  ui.doneText.textContent = status.output || ui.outputName.textContent;
  ui.doneOverlay.hidden = false;

  fetch("/api/finish", { method: "POST" }).catch(() => {});
  setTimeout(() => {
    window.close();
    setTimeout(() => {
      const hint = document.querySelector(".card .hint");
      if (hint) hint.textContent = "The terminal is ready again — close this tab.";
    }, 350);
  }, 120);
}

ui.cutBtn.addEventListener("click", startCut);
ui.cancelBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/cancel", { method: "POST" });
  } catch (err) {
    /* server may already be gone */
  }
});

ui.closeBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/quit", { method: "POST" });
  } catch (err) {
    /* ignore */
  }
  window.close();
});

ui.quitBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/quit", { method: "POST" });
  } catch (err) {
    /* ignore */
  }
  window.close();
});

player().addEventListener("timeupdate", () => {
  if (!state.dragging) moveCursor();
});

window.addEventListener("resize", () => {
  drawWaveform();
});

window.addEventListener("keydown", (event) => {
  if (event.code !== "Space") return;
  const tag = (event.target && event.target.tagName) || "";
  if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tag)) return;
  event.preventDefault();
  const media = player();
  if (media.paused) {
    media.play().catch(() => {});
  } else {
    media.pause();
  }
});

// --- boot -------------------------------------------------------------------

async function boot() {
  const info = await (await fetch("/api/info")).json();
  state.name = info.name;
  state.type = info.type;
  state.ext = info.ext || ".mp4";
  state.duration = info.duration || 0;
  state.inTime = 0;
  state.outTime = state.duration;

  ui.fileName.textContent = info.name;
  ui.fileMeta.textContent = `${info.type.toUpperCase()} ${info.ext} · ${formatTime(state.duration)}`;

  if (state.type === "video") {
    ui.videoPane.hidden = false;
    ui.modeField.hidden = false;
    ui.videoPlayer.src = "/api/media";
    ui.videoPlayer.addEventListener("loadedmetadata", () => {
      if (!state.duration && Number.isFinite(ui.videoPlayer.duration)) {
        state.duration = ui.videoPlayer.duration;
        state.outTime = state.duration;
      }
      renderTimeline();
    });
  } else {
    ui.audioPane.hidden = false;
    ui.formatField.hidden = false;
    ui.fadeInField.hidden = false;
    ui.fadeOutField.hidden = false;
    ui.audioPlayer.src = "/api/media";
  }

  ui.waveCanvas.hidden = false;
  const wave = await (await fetch("/api/waveform")).json();
  state.peaks = wave.peaks || [];
  if (!state.duration && wave.duration) {
    state.duration = wave.duration;
    state.outTime = state.duration;
  }

  renderTimeline();
  updateOutputName();
  requestAnimationFrame(drawWaveform);
  ui.cutBtn.disabled = !(state.duration > 0);
  if (!state.duration) setStatus("Could not read the duration of this file", true);
}

boot().catch((err) => setStatus(String(err.message || err), true));
