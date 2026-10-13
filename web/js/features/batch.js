/**
 * Batch conversion: job dispatch, live progress polling, cancellation and the FFmpeg log modal.
 */
import { escapeHtml, triggerIcons } from '../core/utils.js';
import { loadFiles, selectedFiles, updateExplorerHighlightClasses } from './explorer.js';
import { presets } from './presets.js';

export let pollInterval = null;
export let latestJobData = null;
export let fadeTimer = null;
export let activeRunningFiles = new Set();
export let freshOutputFiles = new Set();

export async function startProcessing() {
  const files = Array.from(selectedFiles);
  if (!files.length) return;

  const pSelect = document.getElementById('presetSelect');
  const isCustom = (!pSelect || pSelect.value === '__custom__');
  let cmd = "";
  let ext = "";

  if (isCustom) {
    cmd = (document.getElementById('customCmdInput')?.value || '').trim();
    ext = (document.getElementById('customExtInput')?.value || '.mp4').trim();
    if (!cmd) {
      alert("Please enter custom FFmpeg arguments.");
      return;
    }
    if (!ext.startsWith('.')) ext = '.' + ext;
  } else {
    const pName = pSelect.value;
    if (presets[pName]) {
      cmd = presets[pName].cmd;
      ext = presets[pName].ext;
    }
  }

  const deleteAfter = document.getElementById('deleteAfterCheck').checked;
  const concurrency = parseInt(document.getElementById('concurrencySelect').value) || 2;

  // Reset highlights and timers
  if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
  activeRunningFiles.clear();
  freshOutputFiles.clear();
  updateExplorerHighlightClasses();

  // Reset progress card UI
  const card = document.getElementById('progressCard');
  card.className = "progress-card";
  card.style.display = 'block';
  document.getElementById('cancelBtn').style.display = 'inline-flex';
  document.getElementById('cancelBtn').disabled = false;
  document.getElementById('cancelBtn').innerHTML = `<i data-lucide="square"></i> Cancel All`;
  document.getElementById('dismissBtn').style.display = 'none';
  document.getElementById('progressWorkersBadge').innerText = `${concurrency} Worker${concurrency > 1 ? 's' : ''}`;

  try {
    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, cmd, ext, delete_after: deleteAfter, concurrency })
    });
    const data = await res.json();
    if (data.success) {
      startPolling();
    } else {
      alert("Error: " + data.error);
    }
  } catch (err) {
    alert("Failed to start processing: " + err);
  }
  triggerIcons();
}

export function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(pollStatus, 450);
  pollStatus();
}

export async function cancelSingleTask(filename) {
  try {
    await fetch('/api/cancel-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: filename })
    });
  } catch (err) {
    console.error("Cancel task failed", err);
  }
}

export function scheduleFadeOutHighlights() {
  if (fadeTimer) clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => {
    freshOutputFiles.clear();
    activeRunningFiles.clear();
    document.querySelectorAll('.file-item.done-output, .file-item.running').forEach(el => {
      el.classList.remove('done-output', 'running');
    });
  }, 5000);
}

export async function pollStatus() {
  try {
    const res = await fetch('/api/status');
    const job = await res.json();
    const card = document.getElementById('progressCard');

    if (!job || !job.files) return;
    latestJobData = job;

    const filesMap = job.files || {};
    const fileOrder = job.file_order || Object.keys(filesMap);

    // Track running files and fresh output files
    const currentlyRunning = new Set();
    let hasNewDone = false;

    fileOrder.forEach(fName => {
      const fInfo = filesMap[fName];
      if (!fInfo) return;
      if (fInfo.status === 'running') {
        currentlyRunning.add(fName);
      } else if (fInfo.status === 'done' && fInfo.output) {
        if (!freshOutputFiles.has(fInfo.output)) {
          freshOutputFiles.add(fInfo.output);
          hasNewDone = true;
        }
      }
    });

    activeRunningFiles = currentlyRunning;

    // If a new output file was completed, reload file list so it appears in explorer
    if (hasNewDone) {
      await loadFiles();
    } else {
      updateExplorerHighlightClasses();
    }

    // 1. Render Task Queue List (text-only with trailing status icon)
    const queueContainer = document.getElementById('taskQueueList');
    if (queueContainer) {
      queueContainer.innerHTML = fileOrder.map(fName => {
        const fInfo = filesMap[fName] || { status: 'pending' };
        let iconHtml = '<i data-lucide="circle-dashed" style="opacity: 0.4;"></i>';
        let itemClass = 'task-queue-item pending';

        if (fInfo.status === 'running') {
          itemClass = 'task-queue-item running';
          iconHtml = '<i data-lucide="loader-2" class="spin-icon" style="color: var(--yellow);"></i>';
        } else if (fInfo.status === 'done') {
          itemClass = 'task-queue-item done';
          iconHtml = '<i data-lucide="check" style="color: var(--mint);"></i>';
        } else if (fInfo.status === 'cancelled') {
          itemClass = 'task-queue-item cancelled';
          iconHtml = '<i data-lucide="minus-circle" style="opacity: 0.5;"></i>';
        } else if (fInfo.status === 'error') {
          itemClass = 'task-queue-item error';
          iconHtml = '<i data-lucide="alert-circle" style="color: var(--rose);"></i>';
        }

        const tooltip = fInfo.msg ? `${fName} (${fInfo.msg})\nClick to view FFmpeg log` : `${fName}\nClick to view FFmpeg log`;
        return `
          <div class="${itemClass}" title="${escapeHtml(tooltip)}" onclick="viewFileLog('${escapeHtml(fName)}')">
            <span class="queue-name">${escapeHtml(fName)}</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 10px; opacity: 0.55;">Log</span>
              ${iconHtml}
            </div>
          </div>
        `;
      }).join('');
    }

    // 2. Render Active Workers Progress Bars
    const workersContainer = document.getElementById('activeWorkersList');
    const runningItems = fileOrder.filter(fName => filesMap[fName] && filesMap[fName].status === 'running');

    if (workersContainer) {
      if (runningItems.length === 0 && job.status === 'running') {
        workersContainer.innerHTML = `<div style="font-size: 11px; color: var(--text-muted); font-style: italic; padding: 4px;">Preparing tasks...</div>`;
      } else {
        workersContainer.innerHTML = runningItems.map((fName, idx) => {
          const fInfo = filesMap[fName];
          const pct = fInfo.progress || 0;
          const spd = fInfo.speed || '--';
          const fps = fInfo.fps || '--';

          return `
            <div class="worker-card">
              <div class="worker-header">
                <span class="worker-name" title="${escapeHtml(fName)}">#${idx + 1}: ${escapeHtml(fName)}</span>
                <button class="btn btn-secondary btn-xs" onclick="cancelSingleTask('${escapeHtml(fName)}')" title="Skip / Cancel this task">
                  <i data-lucide="x"></i> Skip
                </button>
              </div>
              <div class="progress-bar-container" style="margin: 3px 0 2px 0;">
                <div class="progress-bar-fill" style="width: ${pct}%;"></div>
              </div>
              <div class="worker-meta">
                <span>${pct}%</span>
                <span>Speed: ${spd} | FPS: ${fps}</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 3. Status updates & termination handling
    if (job.status === 'running') {
      card.className = "progress-card";
      document.getElementById('progressStatusText').innerHTML = `<i data-lucide="loader-2" class="spin-icon"></i> Batch Processing (${job.completed_count}/${job.total_files})`;
      document.getElementById('progressCountText').innerText = `${job.completed_count}/${job.total_files} completed`;
      document.getElementById('progressWorkersBadge').innerText = `${job.concurrency} Worker${job.concurrency > 1 ? 's' : ''}`;
    } else if (job.status === 'cancelled') {
      clearInterval(pollInterval);
      pollInterval = null;
      card.className = "progress-card cancelled";
      document.getElementById('progressStatusText').innerHTML = `<i data-lucide="x-circle" style="color: var(--rose);"></i> Batch Cancelled (Outputs Cleaned)`;
      document.getElementById('cancelBtn').style.display = 'none';
      document.getElementById('dismissBtn').style.display = 'inline-flex';
      activeRunningFiles.clear();
      freshOutputFiles.clear();
      await loadFiles();
      scheduleFadeOutHighlights();
    } else if (job.status === 'completed') {
      clearInterval(pollInterval);
      pollInterval = null;
      card.className = "progress-card";
      document.getElementById('progressStatusText').innerHTML = `<i data-lucide="check-circle-2" style="color: var(--mint);"></i> Batch Completed!`;
      document.getElementById('progressCountText').innerText = `${job.completed_count}/${job.total_files} completed`;
      document.getElementById('cancelBtn').style.display = 'none';
      document.getElementById('dismissBtn').style.display = 'inline-flex';
      activeRunningFiles.clear();
      await loadFiles();
      scheduleFadeOutHighlights();
    }
    triggerIcons();
  } catch (err) {
    console.error("Polling error", err);
  }
}

/** Cancels the whole batch with instant visual feedback (outputs are rolled back by the server). */
export async function cancelJob() {
  const card = document.getElementById('progressCard');
  card.className = "progress-card stopping";

  const cancelBtn = document.getElementById('cancelBtn');
  cancelBtn.disabled = true;
  cancelBtn.innerHTML = `Stopping...`;

  document.getElementById('progressStatusText').innerHTML = `<i data-lucide="loader-2" class="spin-icon" style="color: var(--rose);"></i> Cancelling all tasks & deleting outputs...`;

  try {
    await fetch('/api/cancel', { method: 'POST' });
  } catch (err) {
    console.error("Cancel request failed", err);
  }
  triggerIcons();
}

export function dismissProgress() {
  document.getElementById('progressCard').style.display = 'none';
}

/** Opens the FFmpeg stderr log modal for a single task. */
export function viewFileLog(fileName) {
  if (!latestJobData || !latestJobData.files || !latestJobData.files[fileName]) {
    alert("No log available for this file yet.");
    return;
  }
  const fInfo = latestJobData.files[fileName];
  document.getElementById('logModalTitle').innerText = `FFmpeg Output Log - ${fileName}`;
  document.getElementById('logModalCmd').innerText = fInfo.cmd ? `$ ${fInfo.cmd}` : 'Command not recorded';
  document.getElementById('logModalContent').innerText = fInfo.log || (fInfo.status === 'running' ? 'Process is currently running...' : 'No stderr output recorded.');
  document.getElementById('logModal').classList.add('active');
  triggerIcons();
}

export function closeLogModal() {
  document.getElementById('logModal').classList.remove('active');
  const btn = document.getElementById('copyLogBtn');
  if (btn) {
    btn.innerHTML = `<i data-lucide="copy"></i> Copy Log`;
    triggerIcons();
  }
}

export function copyLogContent() {
  const content = document.getElementById('logModalContent').innerText;
  const btn = document.getElementById('copyLogBtn');

  const setCopied = () => {
    if (btn) {
      btn.innerHTML = `<i data-lucide="check" style="color: var(--mint);"></i> Copied!`;
      triggerIcons();
      setTimeout(() => {
        if (btn) {
          btn.innerHTML = `<i data-lucide="copy"></i> Copy Log`;
          triggerIcons();
        }
      }, 2000);
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(content).then(setCopied).catch(() => {
      fallbackCopy(content, setCopied);
    });
  } else {
    fallbackCopy(content, setCopied);
  }
}

function fallbackCopy(text, callback) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand('copy');
    callback();
  } catch (err) {
    prompt("Copy log:", text);
  }
  document.body.removeChild(textarea);
}
