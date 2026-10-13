/**
 * Application bootstrap: exposes the module API globally (index.html uses inline
 * `onclick` handlers), wires the global listeners and starts the dashboard.
 */
import * as utils from './core/utils.js';
import * as explorer from './features/explorer.js';
import * as tabs from './features/tabs.js';
import * as presets from './features/presets.js';
import * as batch from './features/batch.js';
import * as preview from './features/preview.js';
import * as videoCutter from './features/cutters/video.js';
import * as audioCutter from './features/cutters/audio.js';
import * as trim from './features/cutters/trim.js';

/** Stops the local server and replaces the page with a farewell screen. */
export async function shutdownServer() {
  if (!confirm("Stop the local FFWEB server?")) return;
  try {
    await fetch('/api/shutdown', { method: 'POST' });
    document.body.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; width: 100vw; text-align: center; background: #10121a; color: #9ea8c7; font-family: inherit;">
        <div style="margin-bottom: 16px; color: var(--mint);">
          <i data-lucide="check-circle-2" style="width: 48px; height: 48px;"></i>
        </div>
        <h2 style="color: #e8edfa; margin-bottom: 8px; font-size: 22px;">Server Stopped</h2>
        <p style="font-size: 14px; max-width: 400px; line-height: 1.5;">The local server has been shut down cleanly. You can safely close this browser tab.</p>
      </div>
    `;
    utils.triggerIcons();
  } catch (err) {
    alert("Server stopped.");
  }
}

/**
 * Every function referenced from an inline HTML attribute has to live on `window`,
 * so all module exports are mirrored onto the global scope.
 */
[utils, explorer, tabs, presets, batch, preview, videoCutter, audioCutter, trim]
  .forEach(module => Object.assign(window, module));
window.shutdownServer = shutdownServer;

// Closing a modal with Esc
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    preview.closePreviewModal();
    presets.closePresetModal();
    batch.closeLogModal();
  }
});

// Keyboard shortcuts for the video & audio cutters
document.addEventListener('keydown', (e) => {
  // Ignore if user is currently typing in an input, textarea or select
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

  const isVideoActive = document.getElementById('tab-video-cutter')?.classList.contains('active');
  const isAudioActive = document.getElementById('tab-audio-cutter')?.classList.contains('active');

  if (isVideoActive) {
    if (e.code === 'Space') {
      e.preventDefault();
      videoCutter.toggleVideoPlayback();
    } else if (e.code === 'KeyI') {
      e.preventDefault();
      videoCutter.setVideoInPoint();
    } else if (e.code === 'KeyO') {
      e.preventDefault();
      videoCutter.setVideoOutPoint();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      videoCutter.stepVideo(e.shiftKey ? -5 : -1);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      videoCutter.stepVideo(e.shiftKey ? 5 : 1);
    } else if (e.code === 'KeyL') {
      e.preventDefault();
      videoCutter.playVideoRange();
    }
  } else if (isAudioActive) {
    if (e.code === 'Space') {
      e.preventDefault();
      audioCutter.toggleAudioPlayback();
    } else if (e.code === 'KeyI') {
      e.preventDefault();
      audioCutter.setAudioInPoint();
    } else if (e.code === 'KeyO') {
      e.preventDefault();
      audioCutter.setAudioOutPoint();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      audioCutter.stepAudio(e.shiftKey ? -5 : -0.1);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      audioCutter.stepAudio(e.shiftKey ? 5 : 0.1);
    } else if (e.code === 'KeyL') {
      e.preventDefault();
      audioCutter.playAudioRange();
    }
  }
});

// Keep the cutter timelines in sync with the window size
window.addEventListener('resize', () => {
  videoCutter.onVideoResizeTimeline();
  audioCutter.drawAudioWaveform();
});

// Init
videoCutter.initVideoCutter();
audioCutter.initAudioCutter();
explorer.initExplorer();

explorer.loadFiles();
presets.loadPresets();
explorer.updateConcurrencyOptions();
setTimeout(utils.triggerIcons, 300);
