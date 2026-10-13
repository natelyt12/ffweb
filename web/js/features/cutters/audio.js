/**
 * Audio cutter / waveform studio controller: zoomable waveform, fade effects and export format.
 */
import { formatTimecode, parseTimecode, triggerIcons } from '../../core/utils.js';
import { allFiles } from '../explorer.js';

export let audioDuration = 0;
export let audioInTime = 0;
export let audioOutTime = 0;
export let isAudioLooping = false;
export let isPlayingAudioRange = false;
export let audioPeaks = [];
export let audioZoom = 1;
export let audioActiveHandle = null; // 'in' | 'out' | 'scrub' | 'window'
export let audioDragStartIn = 0;
export let audioDragStartOut = 0;
export let audioDragStartX = 0;

export const audioEl = document.getElementById('audioCutterEl');
export const audioCanvasWrap = document.getElementById('audioCanvasWrap');
export const audioWaveformCanvas = document.getElementById('audioWaveformCanvas');

/** Wires every DOM event the audio cutter depends on. Called once from main.js. */
export function initAudioCutter() {
  if (audioEl) {
    audioEl.addEventListener('loadedmetadata', () => {
      audioDuration = audioEl.duration || 0;
      audioInTime = 0;
      audioOutTime = audioDuration;
      updateAudioTimelineUI();
      drawAudioWaveform();
    });

    audioEl.addEventListener('timeupdate', () => {
      const cur = audioEl.currentTime;
      if (isPlayingAudioRange && cur >= audioOutTime) {
        if (isAudioLooping) {
          audioEl.currentTime = audioInTime;
          audioEl.play();
        } else {
          audioEl.pause();
          audioEl.currentTime = audioInTime;
          isPlayingAudioRange = false;
        }
      }
      updateAudioPlayheadUI();
    });

    audioEl.addEventListener('play', () => {
      document.getElementById('audioPlayIcon')?.setAttribute('data-lucide', 'pause');
      triggerIcons();
    });

    audioEl.addEventListener('pause', () => {
      document.getElementById('audioPlayIcon')?.setAttribute('data-lucide', 'play');
      triggerIcons();
    });
  }

  // Pointer events on the grand waveform canvas
  if (audioCanvasWrap) {
    audioCanvasWrap.addEventListener('pointerdown', (e) => {
      if (!audioDuration) return;
      audioCanvasWrap.setPointerCapture(e.pointerId);
      const rect = audioCanvasWrap.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickRatio = Math.max(0, Math.min(1, clickX / rect.width));
      const clickTime = clickRatio * audioDuration;

      const inX = (audioInTime / audioDuration) * rect.width;
      const outX = (audioOutTime / audioDuration) * rect.width;

      if (Math.abs(clickX - inX) <= 16) {
        audioActiveHandle = 'in';
      } else if (Math.abs(clickX - outX) <= 16) {
        audioActiveHandle = 'out';
      } else if (clickX > inX && clickX < outX && e.shiftKey) {
        // Shift+click inside region to drag entire window
        audioActiveHandle = 'window';
        audioDragStartIn = audioInTime;
        audioDragStartOut = audioOutTime;
        audioDragStartX = clickX;
      } else {
        audioActiveHandle = 'scrub';
        audioEl.currentTime = clickTime;
      }
    });

    audioCanvasWrap.addEventListener('pointermove', (e) => {
      if (!audioDuration) return;
      const rect = audioCanvasWrap.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, curX / rect.width));
      const curTime = ratio * audioDuration;

      const tip = document.getElementById('audioTimelineTooltip');
      if (tip) {
        tip.style.left = `${Math.max(20, Math.min(rect.width - 20, curX))}px`;
        tip.style.opacity = '1';
        tip.innerText = formatTimecode(curTime);
      }

      if (!audioActiveHandle) return;

      if (audioActiveHandle === 'in') {
        audioInTime = Math.max(0, Math.min(curTime, audioOutTime - 0.05));
        audioEl.currentTime = audioInTime;
        updateAudioTimelineUI();
        drawAudioWaveform();
      } else if (audioActiveHandle === 'out') {
        audioOutTime = Math.min(audioDuration, Math.max(curTime, audioInTime + 0.05));
        audioEl.currentTime = audioOutTime;
        updateAudioTimelineUI();
        drawAudioWaveform();
      } else if (audioActiveHandle === 'window') {
        const deltaX = curX - audioDragStartX;
        const deltaTime = (deltaX / rect.width) * audioDuration;
        const dur = audioDragStartOut - audioDragStartIn;
        let newIn = Math.max(0, audioDragStartIn + deltaTime);
        let newOut = newIn + dur;
        if (newOut > audioDuration) {
          newOut = audioDuration;
          newIn = newOut - dur;
        }
        audioInTime = newIn;
        audioOutTime = newOut;
        updateAudioTimelineUI();
        drawAudioWaveform();
      } else if (audioActiveHandle === 'scrub') {
        audioEl.currentTime = curTime;
      }
    });

    const endAudioDrag = (e) => {
      if (audioActiveHandle) {
        try { audioCanvasWrap.releasePointerCapture(e.pointerId); } catch (_) {}
        audioActiveHandle = null;
      }
    };
    audioCanvasWrap.addEventListener('pointerup', endAudioDrag);
    audioCanvasWrap.addEventListener('pointercancel', endAudioDrag);
    audioCanvasWrap.addEventListener('pointerleave', () => {
      const tip = document.getElementById('audioTimelineTooltip');
      if (tip && !audioActiveHandle) tip.style.opacity = '0';
    });
  }
}

export function onSwitchToAudioCutter() {
  if (!audioEl.src && document.getElementById('audioCutterSelect')?.value) {
    onSelectAudioCutterFile();
  } else {
    drawAudioWaveform();
  }
}

export function onSelectAudioCutterFile() {
  const select = document.getElementById('audioCutterSelect');
  const filename = select ? select.value : '';
  if (!filename) return;

  const fileObj = allFiles.find(f => f.name === filename);
  const meta = document.getElementById('audioCutterMeta');
  if (meta && fileObj) {
    meta.innerHTML = `<span class="badge badge-audio">${fileObj.ext}</span><span style="color: var(--text-muted);">${fileObj.size}</span>`;
  }

  // Default output name
  const ext = filename.substring(filename.lastIndexOf('.'));
  const baseName = filename.substring(0, filename.lastIndexOf('.'));
  const targetExt = (ext.toLowerCase() === '.mp3') ? '.mp3' : (ext.toLowerCase() === '.wav' ? '.wav' : '.mp3');
  document.getElementById('audioOutputName').value = `${baseName}_cut${targetExt}`;

  audioInTime = 0;
  audioOutTime = 0;
  audioDuration = 0;
  isPlayingAudioRange = false;

  document.getElementById('audioTrimProgressBox').style.display = 'none';
  document.getElementById('audioTrimResultBox').style.display = 'none';

  audioEl.src = `/api/preview?file=${encodeURIComponent(filename)}`;
  audioEl.load();

  loadAudioWaveform(filename);
}

export async function loadAudioWaveform(filename) {
  audioPeaks = [];
  drawAudioWaveform();
  try {
    const res = await fetch(`/api/waveform?file=${encodeURIComponent(filename)}`);
    const data = await res.json();
    if (data && data.peaks) {
      audioPeaks = data.peaks;
      if (data.duration && !audioDuration) {
        audioDuration = data.duration;
        audioOutTime = audioDuration;
        updateAudioTimelineUI();
      }
      drawAudioWaveform();
    }
  } catch (e) {
    console.warn("Audio waveform load error:", e);
  }
}

export function toggleAudioPlayback() {
  if (!audioEl || !audioEl.src) return;
  if (audioEl.paused) {
    if (isPlayingAudioRange && (audioEl.currentTime < audioInTime || audioEl.currentTime >= audioOutTime)) {
      audioEl.currentTime = audioInTime;
    }
    audioEl.play();
  } else {
    audioEl.pause();
  }
}

export function stepAudio(delta) {
  if (!audioEl || !audioDuration) return;
  audioEl.currentTime = Math.max(0, Math.min(audioDuration, audioEl.currentTime + delta));
}

export function playAudioRange() {
  if (!audioEl || !audioDuration) return;
  isPlayingAudioRange = true;
  audioEl.currentTime = audioInTime;
  audioEl.play();
}

export function toggleAudioLoop() {
  isAudioLooping = !isAudioLooping;
  const btn = document.getElementById('btnAudioLoop');
  if (btn) {
    if (isAudioLooping) {
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-secondary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-secondary');
    }
  }
}

export function setAudioVolume(val) {
  if (audioEl) {
    audioEl.volume = parseFloat(val);
    audioEl.muted = false;
    const icon = document.getElementById('audioMuteIcon');
    if (icon) icon.setAttribute('data-lucide', val > 0 ? 'volume-2' : 'volume-x');
    triggerIcons();
  }
}

export function toggleAudioMute() {
  if (audioEl) {
    audioEl.muted = !audioEl.muted;
    const icon = document.getElementById('audioMuteIcon');
    if (icon) icon.setAttribute('data-lucide', audioEl.muted ? 'volume-x' : 'volume-2');
    triggerIcons();
  }
}

export function setAudioInPoint() {
  if (!audioEl || !audioDuration) return;
  audioInTime = Math.max(0, Math.min(audioEl.currentTime, audioOutTime - 0.05));
  updateAudioTimelineUI();
  drawAudioWaveform();
}

export function setAudioOutPoint() {
  if (!audioEl || !audioDuration) return;
  audioOutTime = Math.min(audioDuration, Math.max(audioEl.currentTime, audioInTime + 0.05));
  updateAudioTimelineUI();
  drawAudioWaveform();
}

export function resetAudioRange() {
  audioInTime = 0;
  audioOutTime = audioDuration;
  updateAudioTimelineUI();
  drawAudioWaveform();
}

export function onAudioTimeInputChange(type) {
  if (!audioDuration) return;
  if (type === 'start') {
    const val = parseTimecode(document.getElementById('audioInputStart').value);
    audioInTime = Math.max(0, Math.min(val, audioOutTime - 0.05));
    audioEl.currentTime = audioInTime;
  } else {
    const val = parseTimecode(document.getElementById('audioInputEnd').value);
    audioOutTime = Math.min(audioDuration, Math.max(val, audioInTime + 0.05));
    audioEl.currentTime = audioOutTime;
  }
  updateAudioTimelineUI();
  drawAudioWaveform();
}

export function setAudioZoom(z) {
  audioZoom = z;
  [1, 2, 4, 8].forEach(lvl => {
    const btn = document.getElementById(`zoomBtn-${lvl}`);
    if (btn) btn.classList.toggle('active', lvl === z);
  });
  drawAudioWaveform();
}

export function onAudioFadeChange() {
  const fIn = parseFloat(document.getElementById('audioFadeInInput').value) || 0;
  const fOut = parseFloat(document.getElementById('audioFadeOutInput').value) || 0;
  document.getElementById('audioFadeInVal').innerText = `${fIn.toFixed(1)}s`;
  document.getElementById('audioFadeOutVal').innerText = `${fOut.toFixed(1)}s`;
  updateAudioFadeRamps();
}

export function updateAudioFadeRamps() {
  if (!audioDuration) return;
  const wrapRect = audioCanvasWrap.getBoundingClientRect();
  const totalW = wrapRect.width || 600;

  const fIn = parseFloat(document.getElementById('audioFadeInInput').value) || 0;
  const fOut = parseFloat(document.getElementById('audioFadeOutInput').value) || 0;

  const fInPx = (fIn / audioDuration) * totalW;
  const fOutPx = (fOut / audioDuration) * totalW;

  const inRamp = document.getElementById('audioFadeInRamp');
  const outRamp = document.getElementById('audioFadeOutRamp');
  if (inRamp) inRamp.style.width = `${fInPx}px`;
  if (outRamp) outRamp.style.width = `${fOutPx}px`;
}

export function onAudioFormatChange() {
  const fmt = document.getElementById('audioFormatSelect').value;
  const hint = document.getElementById('audioFormatHint');
  const outInput = document.getElementById('audioOutputName');
  const curOut = outInput.value;
  const base = curOut.substring(0, curOut.lastIndexOf('.')) || 'track_cut';

  if (fmt === 'copy') {
    hint.innerText = "Stream copy exports instantly, keeping the original format and 100% quality.";
    const origExt = document.getElementById('audioCutterSelect').value.split('.').pop() || 'mp3';
    outInput.value = `${base}.${origExt}`;
  } else {
    hint.innerText = `Exports a .${fmt.toUpperCase()} file with an optimized codec.`;
    outInput.value = `${base}.${fmt}`;
  }
}

export function updateAudioTimelineUI() {
  if (!audioDuration) return;
  document.getElementById('audioInputStart').value = formatTimecode(audioInTime);
  document.getElementById('audioInputEnd').value = formatTimecode(audioOutTime);
  document.getElementById('audioTrimDurationBadge').innerText = formatTimecode(audioOutTime - audioInTime);

  const inPct = (audioInTime / audioDuration) * 100;
  const outPct = (audioOutTime / audioDuration) * 100;

  const handleIn = document.getElementById('audioHandleIn');
  const handleOut = document.getElementById('audioHandleOut');
  const cutRegion = document.getElementById('audioCutRegion');

  if (handleIn) handleIn.style.left = `${inPct}%`;
  if (handleOut) handleOut.style.left = `${outPct}%`;
  if (cutRegion) {
    cutRegion.style.left = `${inPct}%`;
    cutRegion.style.width = `${Math.max(0, outPct - inPct)}%`;
  }

  updateAudioFadeRamps();
  updateAudioPlayheadUI();
}

export function updateAudioPlayheadUI() {
  if (!audioDuration) return;
  const cur = audioEl.currentTime || 0;
  const curPct = (cur / audioDuration) * 100;
  const playhead = document.getElementById('audioPlayhead');
  if (playhead) playhead.style.left = `${curPct}%`;

  const badge = document.getElementById('audioTimecodeBadge');
  if (badge) badge.innerText = `${formatTimecode(cur)} / ${formatTimecode(audioDuration)}`;
}

export function drawAudioWaveform() {
  if (!audioWaveformCanvas || !audioCanvasWrap) return;
  const viewport = document.getElementById('audioWaveformViewport');
  const baseW = viewport ? viewport.clientWidth : 700;
  const totalW = Math.max(baseW, baseW * audioZoom);
  const h = 190;

  audioCanvasWrap.style.width = `${totalW}px`;
  audioWaveformCanvas.width = totalW;
  audioWaveformCanvas.height = h;

  const ctx = audioWaveformCanvas.getContext('2d');
  ctx.clearRect(0, 0, totalW, h);

  // Render ruler on top
  const ruler = document.getElementById('audioWaveformRuler');
  if (ruler && audioDuration) {
    ruler.style.width = `${totalW}px`;
    ruler.innerHTML = '';
    const tickCount = Math.floor(10 * audioZoom);
    for (let i = 0; i <= tickCount; i++) {
      const t = (audioDuration / tickCount) * i;
      const pct = (i / tickCount) * 100;
      const tick = document.createElement('div');
      tick.className = 'ruler-tick';
      tick.style.left = `${pct}%`;
      tick.innerText = formatTimecode(t).substring(3, 8);
      ruler.appendChild(tick);
    }
  }

  // Draw center baseline
  const mid = h / 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(totalW, mid);
  ctx.stroke();

  if (!audioPeaks || !audioPeaks.length) {
    // Draw placeholder waveform wave if data not yet loaded
    ctx.strokeStyle = 'rgba(130, 218, 205, 0.25)';
    ctx.beginPath();
    for (let x = 0; x < totalW; x += 5) {
      const y = mid + Math.sin(x * 0.05) * 20;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    updateAudioTimelineUI();
    return;
  }

  const peaksCount = audioPeaks.length;
  const barWidth = Math.max(1.8, totalW / peaksCount);
  const inX = audioDuration ? (audioInTime / audioDuration) * totalW : 0;
  const outX = audioDuration ? (audioOutTime / audioDuration) * totalW : totalW;

  for (let i = 0; i < peaksCount; i++) {
    const x = (i / peaksCount) * totalW;
    const peak = audioPeaks[i];
    const barHeight = Math.max(2, peak * (mid - 12));

    const isInsideCut = (x >= inX && x <= outX);

    if (isInsideCut) {
      // Vibrant teal gradient for the cut region
      const grad = ctx.createLinearGradient(x, mid - barHeight, x, mid + barHeight);
      grad.addColorStop(0, '#82dacd');
      grad.addColorStop(0.5, '#b4befa');
      grad.addColorStop(1, '#82dacd');
      ctx.fillStyle = grad;
    } else {
      // Dimmed color outside the cut region
      ctx.fillStyle = 'rgba(98, 107, 138, 0.35)';
    }

    ctx.fillRect(x, mid - barHeight, barWidth - 0.6, barHeight * 2);
  }

  updateAudioTimelineUI();
}
