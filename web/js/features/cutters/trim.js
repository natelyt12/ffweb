/**
 * Trim (cut) execution for both the video and the audio cutter, including live status polling.
 */
import { triggerIcons } from '../../core/utils.js';
import { loadFiles } from '../explorer.js';
import { previewMedia } from '../preview.js';
import { videoInTime, videoOutTime } from './video.js';
import { audioInTime, audioOutTime } from './audio.js';

export let trimPollInterval = null;
export let currentTrimType = null;
export let lastTrimmedOutput = '';

export async function startTrim(type) {
  currentTrimType = type;
  let filename = '';
  let outName = '';
  let startSec = 0;
  let endSec = 0;
  let mode = 'copy';
  let format = 'copy';
  let fadeIn = 0;
  let fadeOut = 0;

  if (type === 'video') {
    filename = document.getElementById('videoCutterSelect').value;
    outName = document.getElementById('videoOutputName').value.trim();
    startSec = videoInTime;
    endSec = videoOutTime;
    mode = document.getElementById('videoCutMode').value;
    format = (mode === 'audio_only') ? 'mp3' : 'copy';
  } else {
    filename = document.getElementById('audioCutterSelect').value;
    outName = document.getElementById('audioOutputName').value.trim();
    startSec = audioInTime;
    endSec = audioOutTime;
    format = document.getElementById('audioFormatSelect').value;
    fadeIn = parseFloat(document.getElementById('audioFadeInInput').value) || 0;
    fadeOut = parseFloat(document.getElementById('audioFadeOutInput').value) || 0;
    mode = (format === 'copy' && fadeIn === 0 && fadeOut === 0) ? 'copy' : 'encode';
  }

  if (!filename) {
    alert("Please select a media file to trim.");
    return;
  }
  if (!outName) {
    alert("Please enter an output file name.");
    return;
  }
  if (endSec <= startSec) {
    alert("The end point must be greater than the start point.");
    return;
  }

  // UI states
  const progBox = document.getElementById(type === 'video' ? 'videoTrimProgressBox' : 'audioTrimProgressBox');
  const resBox = document.getElementById(type === 'video' ? 'videoTrimResultBox' : 'audioTrimResultBox');
  const startBtn = document.getElementById(type === 'video' ? 'btnStartVideoTrim' : 'btnStartAudioTrim');

  progBox.style.display = 'block';
  resBox.style.display = 'none';
  startBtn.disabled = true;

  document.getElementById(type === 'video' ? 'videoTrimProgressBar' : 'audioTrimProgressBar').style.width = '0%';
  document.getElementById(type === 'video' ? 'videoTrimPct' : 'audioTrimPct').innerText = '0%';
  document.getElementById(type === 'video' ? 'videoTrimSpeed' : 'audioTrimSpeed').innerText = 'Speed: --';

  try {
    const res = await fetch('/api/trim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: filename,
        output_name: outName,
        start: startSec,
        end: endSec,
        mode: mode,
        type: type,
        format: format,
        fade_in: fadeIn,
        fade_out: fadeOut
      })
    });
    const data = await res.json();
    if (data.success) {
      lastTrimmedOutput = outName;
      startTrimPolling(type);
    } else {
      alert("Failed to start trimming: " + (data.error || "Unknown error"));
      progBox.style.display = 'none';
      startBtn.disabled = false;
    }
  } catch (err) {
    alert("Could not reach the server: " + err);
    progBox.style.display = 'none';
    startBtn.disabled = false;
  }
}

export function startTrimPolling(type) {
  if (trimPollInterval) clearInterval(trimPollInterval);
  trimPollInterval = setInterval(() => pollTrimStatus(type), 350);
  pollTrimStatus(type);
}

export async function pollTrimStatus(type) {
  try {
    const res = await fetch('/api/trim-status');
    const data = await res.json();

    const progBar = document.getElementById(type === 'video' ? 'videoTrimProgressBar' : 'audioTrimProgressBar');
    const pctText = document.getElementById(type === 'video' ? 'videoTrimPct' : 'audioTrimPct');
    const spdText = document.getElementById(type === 'video' ? 'videoTrimSpeed' : 'audioTrimSpeed');
    const progBox = document.getElementById(type === 'video' ? 'videoTrimProgressBox' : 'audioTrimProgressBox');
    const resBox = document.getElementById(type === 'video' ? 'videoTrimResultBox' : 'audioTrimResultBox');
    const startBtn = document.getElementById(type === 'video' ? 'btnStartVideoTrim' : 'btnStartAudioTrim');

    if (data.status === 'running') {
      const pct = Math.max(0, Math.min(99, data.progress || 0));
      progBar.style.width = `${pct}%`;
      pctText.innerText = `${pct.toFixed(0)}%`;
      spdText.innerText = `Speed: ${data.speed || '--'}`;
    } else if (data.status === 'done') {
      clearInterval(trimPollInterval);
      trimPollInterval = null;
      progBar.style.width = '100%';
      pctText.innerText = '100%';

      setTimeout(() => {
        progBox.style.display = 'none';
        resBox.style.display = 'block';
        startBtn.disabled = false;
        document.getElementById(type === 'video' ? 'videoTrimResultName' : 'audioTrimResultName').innerText = `File: ${data.output || lastTrimmedOutput}`;
        loadFiles(); // Refresh directory files!
        triggerIcons();
      }, 300);
    } else if (data.status === 'error') {
      clearInterval(trimPollInterval);
      trimPollInterval = null;
      progBox.style.display = 'none';
      startBtn.disabled = false;
      alert("Trimming failed: " + (data.msg || "The FFmpeg process failed"));
    } else if (data.status === 'cancelled') {
      clearInterval(trimPollInterval);
      trimPollInterval = null;
      progBox.style.display = 'none';
      startBtn.disabled = false;
    }
  } catch (e) {
    console.error("Trim poll error:", e);
  }
}

export async function cancelTrim() {
  try {
    await fetch('/api/cancel-trim', { method: 'POST' });
  } catch (e) {
    console.error("Cancel trim failed:", e);
  }
}

export function previewTrimmedResult(type) {
  if (!lastTrimmedOutput) return;
  const targetType = (type === 'video' && lastTrimmedOutput.endsWith('.mp3')) ? 'audio' : type;
  previewMedia(lastTrimmedOutput, targetType);
}
