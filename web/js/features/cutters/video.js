/**
 * Video cutter controller: player, waveform timeline, in/out handles and cut mode settings.
 */
import { formatTimecode, parseTimecode, triggerIcons } from '../../core/utils.js';
import { allFiles } from '../explorer.js';

export let videoDuration = 0;
export let videoInTime = 0;
export let videoOutTime = 0;
export let isVideoLooping = false;
export let isPlayingVideoRange = false;
export let videoPeaks = [];
export let videoActiveHandle = null; // 'in' | 'out' | 'scrub'

export const videoEl = document.getElementById('videoCutterEl');
export const videoTrack = document.getElementById('videoTimelineTrack');
export const videoWaveformCanvas = document.getElementById('videoWaveformCanvas');

/** Wires every DOM event the video cutter depends on. Called once from main.js. */
export function initVideoCutter() {
  if (videoEl) {
    videoEl.addEventListener('loadedmetadata', () => {
      videoDuration = videoEl.duration || 0;
      videoInTime = 0;
      videoOutTime = videoDuration;
      updateVideoTimelineUI();
      renderVideoTimelineRuler();
      drawVideoWaveform();
    });

    videoEl.addEventListener('timeupdate', () => {
      const cur = videoEl.currentTime;
      if (isPlayingVideoRange && cur >= videoOutTime) {
        if (isVideoLooping) {
          videoEl.currentTime = videoInTime;
          videoEl.play();
        } else {
          videoEl.pause();
          videoEl.currentTime = videoInTime;
          isPlayingVideoRange = false;
        }
      }
      updateVideoPlayheadUI();
    });

    videoEl.addEventListener('play', () => {
      document.getElementById('videoPlayIcon')?.setAttribute('data-lucide', 'pause');
      document.getElementById('videoOverlayPlayBtn')?.style.setProperty('opacity', '0');
      triggerIcons();
    });

    videoEl.addEventListener('pause', () => {
      document.getElementById('videoPlayIcon')?.setAttribute('data-lucide', 'play');
      document.getElementById('videoOverlayPlayBtn')?.style.removeProperty('opacity');
      triggerIcons();
    });
  }

  // Pointer events on the timeline track for dragging & live preview
  if (videoTrack) {
    videoTrack.addEventListener('pointerdown', (e) => {
      if (!videoDuration) return;
      videoTrack.setPointerCapture(e.pointerId);
      const rect = videoTrack.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickRatio = Math.max(0, Math.min(1, clickX / rect.width));
      const clickTime = clickRatio * videoDuration;

      const inX = (videoInTime / videoDuration) * rect.width;
      const outX = (videoOutTime / videoDuration) * rect.width;

      if (Math.abs(clickX - inX) <= 14) {
        videoActiveHandle = 'in';
      } else if (Math.abs(clickX - outX) <= 14) {
        videoActiveHandle = 'out';
      } else {
        videoActiveHandle = 'scrub';
        videoEl.currentTime = clickTime;
      }
    });

    videoTrack.addEventListener('pointermove', (e) => {
      if (!videoDuration) return;
      const rect = videoTrack.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, curX / rect.width));
      const curTime = ratio * videoDuration;

      // Tooltip
      const tip = document.getElementById('videoTimelineTooltip');
      if (tip) {
        tip.style.left = `${Math.max(20, Math.min(rect.width - 20, curX))}px`;
        tip.style.opacity = '1';
        tip.innerText = formatTimecode(curTime);
      }

      if (!videoActiveHandle) return;

      if (videoActiveHandle === 'in') {
        videoInTime = Math.max(0, Math.min(curTime, videoOutTime - 0.05));
        videoEl.currentTime = videoInTime; // Live preview in-point!
        updateVideoTimelineUI();
      } else if (videoActiveHandle === 'out') {
        videoOutTime = Math.min(videoDuration, Math.max(curTime, videoInTime + 0.05));
        videoEl.currentTime = videoOutTime; // Live preview out-point!
        updateVideoTimelineUI();
      } else if (videoActiveHandle === 'scrub') {
        videoEl.currentTime = curTime; // Live scrub video!
      }
    });

    const endVideoDrag = (e) => {
      if (videoActiveHandle) {
        try { videoTrack.releasePointerCapture(e.pointerId); } catch (_) {}
        videoActiveHandle = null;
      }
    };
    videoTrack.addEventListener('pointerup', endVideoDrag);
    videoTrack.addEventListener('pointercancel', endVideoDrag);
    videoTrack.addEventListener('pointerleave', () => {
      const tip = document.getElementById('videoTimelineTooltip');
      if (tip && !videoActiveHandle) tip.style.opacity = '0';
    });
  }
}

export function onSwitchToVideoCutter() {
  if (!videoEl.src && document.getElementById('videoCutterSelect')?.value) {
    onSelectVideoCutterFile();
  } else {
    onVideoResizeTimeline();
  }
}

export function onSelectVideoCutterFile() {
  const select = document.getElementById('videoCutterSelect');
  const filename = select ? select.value : '';
  if (!filename) return;

  const fileObj = allFiles.find(f => f.name === filename);
  const meta = document.getElementById('videoCutterMeta');
  if (meta && fileObj) {
    meta.innerHTML = `<span class="badge badge-video">${fileObj.ext}</span><span style="color: var(--text-muted);">${fileObj.size}</span>`;
  }

  // Default output name
  const ext = filename.substring(filename.lastIndexOf('.'));
  const baseName = filename.substring(0, filename.lastIndexOf('.'));
  document.getElementById('videoOutputName').value = `${baseName}_cut${ext}`;

  // Reset states
  videoInTime = 0;
  videoOutTime = 0;
  videoDuration = 0;
  isPlayingVideoRange = false;

  // Reset result and progress
  document.getElementById('videoTrimProgressBox').style.display = 'none';
  document.getElementById('videoTrimResultBox').style.display = 'none';

  // Load media
  videoEl.src = `/api/preview?file=${encodeURIComponent(filename)}`;
  videoEl.load();

  // Fetch waveform data for video audio track
  loadVideoWaveform(filename);
}

export async function loadVideoWaveform(filename) {
  videoPeaks = [];
  drawVideoWaveform();
  try {
    const res = await fetch(`/api/waveform?file=${encodeURIComponent(filename)}`);
    const data = await res.json();
    if (data && data.peaks) {
      videoPeaks = data.peaks;
      drawVideoWaveform();
    }
  } catch (e) {
    console.warn("Waveform load error:", e);
  }
}

export function toggleVideoPlayback() {
  if (!videoEl || !videoEl.src) return;
  if (videoEl.paused) {
    if (isPlayingVideoRange && (videoEl.currentTime < videoInTime || videoEl.currentTime >= videoOutTime)) {
      videoEl.currentTime = videoInTime;
    }
    videoEl.play();
  } else {
    videoEl.pause();
  }
}

export function stepVideo(delta) {
  if (!videoEl || !videoDuration) return;
  videoEl.currentTime = Math.max(0, Math.min(videoDuration, videoEl.currentTime + delta));
}

export function playVideoRange() {
  if (!videoEl || !videoDuration) return;
  isPlayingVideoRange = true;
  videoEl.currentTime = videoInTime;
  videoEl.play();
}

export function toggleVideoLoop() {
  isVideoLooping = !isVideoLooping;
  const btn = document.getElementById('btnVideoLoop');
  if (btn) {
    if (isVideoLooping) {
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-secondary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-secondary');
    }
  }
}

export function setVideoVolume(val) {
  if (videoEl) {
    videoEl.volume = parseFloat(val);
    videoEl.muted = false;
    const icon = document.getElementById('videoMuteIcon');
    if (icon) icon.setAttribute('data-lucide', val > 0 ? 'volume-2' : 'volume-x');
    triggerIcons();
  }
}

export function toggleVideoMute() {
  if (videoEl) {
    videoEl.muted = !videoEl.muted;
    const icon = document.getElementById('videoMuteIcon');
    if (icon) icon.setAttribute('data-lucide', videoEl.muted ? 'volume-x' : 'volume-2');
    triggerIcons();
  }
}

export function setVideoSpeed(spd) {
  if (videoEl) videoEl.playbackRate = parseFloat(spd) || 1.0;
}

export function setVideoInPoint() {
  if (!videoEl || !videoDuration) return;
  videoInTime = Math.max(0, Math.min(videoEl.currentTime, videoOutTime - 0.05));
  updateVideoTimelineUI();
}

export function setVideoOutPoint() {
  if (!videoEl || !videoDuration) return;
  videoOutTime = Math.min(videoDuration, Math.max(videoEl.currentTime, videoInTime + 0.05));
  updateVideoTimelineUI();
}

export function resetVideoRange() {
  videoInTime = 0;
  videoOutTime = videoDuration;
  updateVideoTimelineUI();
}

export function onVideoTimeInputChange(type) {
  if (!videoDuration) return;
  if (type === 'start') {
    const val = parseTimecode(document.getElementById('videoInputStart').value);
    videoInTime = Math.max(0, Math.min(val, videoOutTime - 0.05));
    videoEl.currentTime = videoInTime;
  } else {
    const val = parseTimecode(document.getElementById('videoInputEnd').value);
    videoOutTime = Math.min(videoDuration, Math.max(val, videoInTime + 0.05));
    videoEl.currentTime = videoOutTime;
  }
  updateVideoTimelineUI();
}

export function updateVideoTimelineUI() {
  if (!videoDuration) return;
  const inPct = (videoInTime / videoDuration) * 100;
  const outPct = (videoOutTime / videoDuration) * 100;

  const handleIn = document.getElementById('videoHandleIn');
  const handleOut = document.getElementById('videoHandleOut');
  const cutRegion = document.getElementById('videoCutRegion');

  if (handleIn) handleIn.style.left = `${inPct}%`;
  if (handleOut) handleOut.style.left = `${outPct}%`;
  if (cutRegion) {
    cutRegion.style.left = `${inPct}%`;
    cutRegion.style.width = `${Math.max(0, outPct - inPct)}%`;
  }

  document.getElementById('videoInputStart').value = formatTimecode(videoInTime);
  document.getElementById('videoInputEnd').value = formatTimecode(videoOutTime);
  document.getElementById('videoTrimDurationBadge').innerText = formatTimecode(videoOutTime - videoInTime);

  updateVideoPlayheadUI();
}

export function updateVideoPlayheadUI() {
  if (!videoDuration) return;
  const cur = videoEl.currentTime || 0;
  const curPct = (cur / videoDuration) * 100;
  const playhead = document.getElementById('videoPlayhead');
  if (playhead) playhead.style.left = `${curPct}%`;

  const badge = document.getElementById('videoTimecodeBadge');
  if (badge) badge.innerText = `${formatTimecode(cur)} / ${formatTimecode(videoDuration)}`;
}

export function renderVideoTimelineRuler() {
  const ruler = document.getElementById('videoTimelineRuler');
  if (!ruler || !videoDuration) return;
  ruler.innerHTML = '';
  const count = 6;
  for (let i = 0; i <= count; i++) {
    const t = (videoDuration / count) * i;
    const pct = (i / count) * 100;
    const tick = document.createElement('div');
    tick.className = 'ruler-tick';
    tick.style.left = `${pct}%`;
    tick.innerText = formatTimecode(t).substring(3, 8); // mm:ss
    ruler.appendChild(tick);
  }
}

export function drawVideoWaveform() {
  if (!videoWaveformCanvas || !videoTrack) return;
  const rect = videoTrack.getBoundingClientRect();
  const w = Math.floor(rect.width) || 600;
  const h = 56;
  videoWaveformCanvas.width = w;
  videoWaveformCanvas.height = h;

  const ctx = videoWaveformCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  if (!videoPeaks || !videoPeaks.length) return;

  const peaksCount = videoPeaks.length;
  const barWidth = Math.max(1.5, w / peaksCount);
  const mid = h / 2;

  ctx.fillStyle = 'rgba(180, 190, 250, 0.45)';
  for (let i = 0; i < peaksCount; i++) {
    const x = (i / peaksCount) * w;
    const peak = videoPeaks[i];
    const barHeight = Math.max(2, peak * mid * 0.9);
    ctx.fillRect(x, mid - barHeight, barWidth - 0.5, barHeight * 2);
  }
}

export function onVideoResizeTimeline() {
  renderVideoTimelineRuler();
  drawVideoWaveform();
  updateVideoTimelineUI();
}

export function onVideoCutModeChange() {
  const mode = document.getElementById('videoCutMode').value;
  const hint = document.getElementById('videoCutModeHint');
  const outInput = document.getElementById('videoOutputName');
  const curOut = outInput.value;
  const base = curOut.substring(0, curOut.lastIndexOf('.')) || 'clip_cut';

  if (mode === 'copy') {
    hint.innerText = "Stream copy exports in about a second without re-encoding. Keeps 100% of the original video & audio quality.";
    const origExt = document.getElementById('videoCutterSelect').value.split('.').pop() || 'mp4';
    outInput.value = `${base}.${origExt}`;
  } else if (mode === 'encode') {
    hint.innerText = "Re-encode MP4 (H.264/AAC): frame-accurate cutting with maximum compatibility on every device.";
    outInput.value = `${base}.mp4`;
  } else if (mode === 'audio_only') {
    hint.innerText = "Extract the selected audio range from the video as high quality 320kbps MP3.";
    outInput.value = `${base}.mp3`;
  }
}
