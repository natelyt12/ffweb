/**
 * Tab navigation and the media file pickers shared by both cutter tabs.
 */
import { escapeHtml, triggerIcons } from '../core/utils.js';
import { allFiles } from './explorer.js';
import { onSelectVideoCutterFile, onVideoResizeTimeline } from './cutters/video.js';
import { drawAudioWaveform, onSelectAudioCutterFile } from './cutters/audio.js';

export function switchTab(tabId) {
  // Pause any active cutter playback when switching tabs
  const v = document.getElementById('videoCutterEl');
  if (v && !v.paused) v.pause();
  const a = document.getElementById('audioCutterEl');
  if (a && !a.paused) a.pause();

  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab-btn').forEach(el => el.classList.remove('active'));

  const target = document.getElementById(`tab-${tabId}`);
  const btn = document.getElementById(`navBtn-${tabId}`);
  if (target) target.classList.add('active');
  if (btn) btn.classList.add('active');

  if (tabId === 'video-cutter') {
    populateCutterFileLists();
    setTimeout(onVideoResizeTimeline, 50);
  } else if (tabId === 'audio-cutter') {
    populateCutterFileLists();
    setTimeout(drawAudioWaveform, 50);
  }

  triggerIcons();
}

export function openInCutter(filename, type) {
  if (type === 'video') {
    switchTab('video-cutter');
    const sel = document.getElementById('videoCutterSelect');
    if (sel) {
      sel.value = filename;
      onSelectVideoCutterFile();
    }
  } else {
    switchTab('audio-cutter');
    const sel = document.getElementById('audioCutterSelect');
    if (sel) {
      sel.value = filename;
      onSelectAudioCutterFile();
    }
  }
}

export function populateCutterFileLists() {
  const vSelect = document.getElementById('videoCutterSelect');
  const aSelect = document.getElementById('audioCutterSelect');
  if (!vSelect || !aSelect) return;

  const currentV = vSelect.value;
  const currentA = aSelect.value;

  const videos = allFiles.filter(f => f.type === 'video');
  const audios = allFiles.filter(f => f.type === 'audio' || f.type === 'video');

  const vBadge = document.getElementById('videoCutterBadge');
  if (vBadge) vBadge.innerText = `${videos.length} video${videos.length !== 1 ? 's' : ''}`;

  const aBadge = document.getElementById('audioCutterBadge');
  if (aBadge) aBadge.innerText = `${audios.length} file${audios.length !== 1 ? 's' : ''}`;

  vSelect.innerHTML = `<option value="">-- Select a video from the working directory --</option>` +
    videos.map(f => `<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)} (${f.size})</option>`).join('');

  if (currentV && videos.some(f => f.name === currentV)) {
    vSelect.value = currentV;
  } else if (videos.length > 0 && !currentV) {
    vSelect.value = videos[0].name;
    onSelectVideoCutterFile();
  }

  aSelect.innerHTML = `<option value="">-- Select a song or video --</option>` +
    audios.map(f => `<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)} (${f.size}) [${f.type}]</option>`).join('');

  if (currentA && audios.some(f => f.name === currentA)) {
    aSelect.value = currentA;
  } else if (audios.length > 0 && !currentA) {
    aSelect.value = audios[0].name;
    onSelectAudioCutterFile();
  }
}
