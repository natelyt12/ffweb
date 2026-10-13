/**
 * Media explorer: directory browsing, filtering, selection and folder switching.
 */
import { escapeHtml, triggerIcons } from '../core/utils.js';
import { activeRunningFiles, freshOutputFiles, pollInterval } from './batch.js';
import { populateCutterFileLists } from './tabs.js';

export let allFiles = [];
export let selectedFiles = new Set();
export let currentMediaFilter = 'all';
export let currentCwd = '';
export let userPreferredConcurrency = 2;

const WORKER_OPTIONS = [
  { value: 1, text: '1 Worker (Sequential)' },
  { value: 2, text: '2 Workers (Parallel)' },
  { value: 3, text: '3 Workers (Parallel)' },
  { value: 4, text: '4 Workers (Max Parallel)' }
];

export async function loadFiles() {
  try {
    const res = await fetch('/api/files');
    const data = await res.json();
    currentCwd = data.cwd || '';
    document.getElementById('cwdBadge').innerText = currentCwd;
    document.getElementById('cwdBadge').title = currentCwd;
    allFiles = data.files || [];
    document.getElementById('fileCountBadge').innerText = `${allFiles.length} files`;
    filterFiles();
    populateCutterFileLists();
  } catch (err) {
    console.error("Failed to load files", err);
  }
}

export async function promptRenameFile(oldName) {
  const newName = prompt(`Enter new file name:`, oldName);
  if (!newName || !newName.trim() || newName.trim() === oldName) return;
  try {
    const res = await fetch('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_name: oldName, new_name: newName.trim() })
    });
    const data = await res.json();
    if (data.success) {
      if (selectedFiles.has(oldName)) {
        selectedFiles.delete(oldName);
        selectedFiles.add(newName.trim());
      }
      await loadFiles();
    } else {
      alert("Rename failed: " + (data.error || "Unknown error"));
    }
  } catch (err) {
    alert("Error renaming file: " + err);
  }
}

export async function confirmDeleteFile(name) {
  if (!confirm(`Are you sure you want to delete "${name}"?\nThis cannot be undone.`)) return;
  try {
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (data.success) {
      selectedFiles.delete(name);
      await loadFiles();
    } else {
      alert("Delete failed: " + (data.error || "Unknown error"));
    }
  } catch (err) {
    alert("Error deleting file: " + err);
  }
}

export function setMediaTypeFilter(type, el) {
  currentMediaFilter = type;
  document.querySelectorAll('.filter-pills .pill').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  filterFiles();
}

export function getFilteredFiles() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  return allFiles.filter(f => {
    const matchesQuery = !q || f.name.toLowerCase().includes(q);
    const matchesType = (currentMediaFilter === 'all') || (f.type === currentMediaFilter);
    return matchesQuery && matchesType;
  });
}

export function filterFiles() {
  renderFilesList(getFilteredFiles());
}

export function renderFilesList(files) {
  const container = document.getElementById('filesList');
  if (!files.length) {
    container.innerHTML = `
      <div style="text-align: center; padding: 44px 20px; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px dashed var(--border-subtle); margin-top: 8px;">
        <div style="margin-bottom: 12px; color: var(--text-muted); display: flex; justify-content: center;">
          <i data-lucide="folder-search" style="width: 44px; height: 44px; stroke-width: 1.5;"></i>
        </div>
        <div style="font-weight: 700; font-size: 15px; color: var(--text-main); margin-bottom: 6px;">No media files found</div>
        <div style="font-size: 13px; color: var(--text-sub); margin-bottom: 18px; max-width: 340px; margin-left: auto; margin-right: auto;">
          Select a directory containing videos, audios, or images to begin.
        </div>
        <div style="display: flex; justify-content: center; gap: 10px;">
          <button class="btn btn-primary btn-sm" onclick="selectFolderDialog()">
            <i data-lucide="folder-input"></i> Browse Folder...
          </button>
          <button class="btn btn-secondary btn-sm" onclick="promptChangeFolder()">
            <i data-lucide="edit-3"></i> Enter Path
          </button>
        </div>
      </div>
    `;
    updateSelectionState();
    triggerIcons();
    return;
  }

  container.innerHTML = files.map(f => {
    const isSel = selectedFiles.has(f.name);
    const isRunning = activeRunningFiles.has(f.name);
    const isFreshOutput = freshOutputFiles.has(f.name);

    let rowClass = 'file-item';
    if (isSel) rowClass += ' selected';
    if (isRunning) rowClass += ' running';
    if (isFreshOutput) rowClass += ' done-output';

    let badgeClass = 'badge-file';
    let iconName = 'file';
    if (f.type === 'video') { badgeClass = 'badge-video'; iconName = 'video'; }
    else if (f.type === 'audio') { badgeClass = 'badge-audio'; iconName = 'music'; }
    else if (f.type === 'image') { badgeClass = 'badge-image'; iconName = 'image'; }

    return `
      <div class="${rowClass}" data-filename="${escapeHtml(f.name)}" onclick="toggleFile('${escapeHtml(f.name)}')">
        <div class="file-info">
          <input type="checkbox" ${isSel ? 'checked' : ''} onclick="event.stopPropagation(); toggleFile('${escapeHtml(f.name)}')">
          <span class="badge ${badgeClass}"><i data-lucide="${iconName}"></i> ${f.type}</span>
          <span class="file-size">${f.size}</span>
          <span class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
        </div>
        <div class="file-actions">
          ${(f.type === 'video' || f.type === 'audio') ? `
          <button class="btn btn-secondary btn-sm" title="${f.type === 'video' ? 'Cut Video' : 'Cut Audio'}" onclick="event.stopPropagation(); openInCutter('${escapeHtml(f.name)}', '${f.type}')" style="color: ${f.type === 'video' ? 'var(--lavender)' : 'var(--teal)'};">
            <i data-lucide="scissors"></i> Cut
          </button>
          ` : ''}
          <button class="btn btn-secondary btn-sm" title="Preview Media" onclick="event.stopPropagation(); previewMedia('${escapeHtml(f.name)}', '${f.type}')">
            <i data-lucide="eye"></i> Preview
          </button>
          <button class="btn-icon btn-action-rename" title="Rename File" ${isRunning ? 'disabled' : ''} onclick="event.stopPropagation(); promptRenameFile('${escapeHtml(f.name)}')">
            <i data-lucide="edit-2"></i>
          </button>
          <button class="btn-icon btn-danger-icon btn-action-delete" title="Delete File" ${isRunning ? 'disabled' : ''} onclick="event.stopPropagation(); confirmDeleteFile('${escapeHtml(f.name)}')">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  updateSelectionState();
  triggerIcons();
}

export function updateExplorerHighlightClasses() {
  const container = document.getElementById('filesList');
  if (!container) return;
  const items = container.querySelectorAll('.file-item');
  items.forEach(el => {
    const fname = el.getAttribute('data-filename');
    if (!fname) return;

    if (activeRunningFiles.has(fname)) {
      el.classList.add('running');
      el.classList.remove('done-output');
      const renameBtn = el.querySelector('.btn-action-rename');
      const deleteBtn = el.querySelector('.btn-action-delete');
      if (renameBtn) renameBtn.disabled = true;
      if (deleteBtn) deleteBtn.disabled = true;
    } else {
      el.classList.remove('running');
      const renameBtn = el.querySelector('.btn-action-rename');
      const deleteBtn = el.querySelector('.btn-action-delete');
      if (renameBtn) renameBtn.disabled = false;
      if (deleteBtn) deleteBtn.disabled = false;

      if (freshOutputFiles.has(fname)) {
        el.classList.add('done-output');
      } else {
        el.classList.remove('done-output');
      }
    }
  });
}

export function toggleFile(name) {
  if (selectedFiles.has(name)) {
    selectedFiles.delete(name);
  } else {
    selectedFiles.add(name);
  }
  filterFiles();
}

export function toggleSelectAll() {
  const visible = getFilteredFiles();
  const allSelected = visible.length > 0 && visible.every(f => selectedFiles.has(f.name));
  if (allSelected) {
    visible.forEach(f => selectedFiles.delete(f.name));
  } else {
    visible.forEach(f => selectedFiles.add(f.name));
  }
  filterFiles();
}

export function updateConcurrencyOptions() {
  const count = selectedFiles.size;
  const select = document.getElementById('concurrencySelect');
  const hint = document.getElementById('concurrencyHint');
  if (!select) return;

  // Determine maximum allowed workers based on selection
  const maxAllowed = count > 0 ? Math.min(count, 4) : 4;

  // Populate options up to maxAllowed
  select.innerHTML = '';
  WORKER_OPTIONS.forEach(opt => {
    if (opt.value <= maxAllowed) {
      const optionEl = document.createElement('option');
      optionEl.value = String(opt.value);
      if (maxAllowed === 1 && opt.value === 1) {
        optionEl.textContent = '1 Worker (Single Task)';
      } else {
        optionEl.textContent = opt.text;
      }
      select.appendChild(optionEl);
    }
  });

  // Target selection clamped to maxAllowed
  const targetVal = Math.min(userPreferredConcurrency, maxAllowed);
  select.value = String(targetVal);

  if (hint) {
    if (count === 0) {
      hint.textContent = 'Batch Concurrency (1-4)';
      select.disabled = false;
      select.title = '';
    } else if (count === 1) {
      hint.textContent = 'Single task (1 Worker)';
      select.disabled = true;
      select.title = 'Only 1 file selected - concurrency disabled';
    } else {
      hint.textContent = `Batch Concurrency (1-${maxAllowed})`;
      select.disabled = false;
      select.title = '';
    }
  }
}

export function clearSelection() {
  selectedFiles.clear();
  filterFiles();
}

export function updateStartBtnState() {
  const count = selectedFiles.size;
  const startBtn = document.getElementById('startBtn');
  if (!startBtn) return;

  const pSelect = document.getElementById('presetSelect');
  const isCustom = (!pSelect || pSelect.value === '__custom__');
  const customCmd = (document.getElementById('customCmdInput')?.value || '').trim();

  const hasValidCommand = !isCustom || (customCmd.length > 0);
  const canStart = (count > 0) && hasValidCommand;

  startBtn.disabled = !canStart;

  if (count === 0) {
    startBtn.innerHTML = `<i data-lucide="zap"></i> Start Batch Processing`;
    startBtn.title = 'No files selected from directory';
  } else if (!hasValidCommand) {
    startBtn.innerHTML = `<i data-lucide="zap"></i> ${count === 1 ? 'Start Processing (1 file)' : `Start Batch Processing (${count} files)`}`;
    startBtn.title = 'Please enter custom FFmpeg arguments to start';
  } else if (count === 1) {
    startBtn.innerHTML = `<i data-lucide="zap"></i> Start Processing (1 file)`;
    startBtn.title = '';
  } else {
    startBtn.innerHTML = `<i data-lucide="zap"></i> Start Batch Processing (${count} files)`;
    startBtn.title = '';
  }

  triggerIcons();
}

export function updateSelectionState() {
  const visible = getFilteredFiles();
  const masterCheck = document.getElementById('masterSelectAllCheck');
  const allSelected = visible.length > 0 && visible.every(f => selectedFiles.has(f.name));
  masterCheck.checked = allSelected;
  masterCheck.indeterminate = (!allSelected && selectedFiles.size > 0 && visible.some(f => selectedFiles.has(f.name)));

  const count = selectedFiles.size;
  document.getElementById('selectedSummary').innerText = `${count} of ${allFiles.length} selected`;
  document.getElementById('clearSelectionBtn').disabled = (count === 0);

  updateConcurrencyOptions();
  updateStartBtnState();
}

export async function selectFolderDialog() {
  try {
    const res = await fetch('/api/select-folder', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      selectedFiles.clear();
      await loadFiles();
    }
  } catch (err) {
    promptChangeFolder();
  }
}

export async function promptChangeFolder() {
  const current = document.getElementById('cwdBadge').innerText;
  const newPath = prompt("Enter or paste directory path containing media:", current);
  if (newPath && newPath.trim() && newPath.trim() !== current) {
    try {
      const res = await fetch('/api/change-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: newPath.trim() })
      });
      const data = await res.json();
      if (data.success) {
        selectedFiles.clear();
        await loadFiles();
      } else {
        alert(data.error || "Could not access directory.");
      }
    } catch (err) {
      alert("Error: " + err);
    }
  }
}

export async function openFolder() {
  await fetch('/api/open-folder', { method: 'POST', body: '{}' });
}

/** Registers the folder watcher, the focus refresh and the concurrency preference listener. */
export function initExplorer() {
  // Auto-refresh when the tab gains focus or becomes visible again
  window.addEventListener('focus', () => {
    loadFiles();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadFiles();
    }
  });

  // Background sync: follow the directory if `ffweb` was launched from another Explorer folder
  setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    if (pollInterval) return; // Don't interrupt batch progress polling
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      if (data.cwd && currentCwd && data.cwd !== currentCwd) {
        currentCwd = data.cwd;
        document.getElementById('cwdBadge').innerText = currentCwd;
        document.getElementById('cwdBadge').title = currentCwd;
        allFiles = data.files || [];
        document.getElementById('fileCountBadge').innerText = `${allFiles.length} files`;
        selectedFiles.clear();
        filterFiles();
      }
    } catch (e) {}
  }, 2000);

  // Remember the concurrency preference picked by the user
  const concSelect = document.getElementById('concurrencySelect');
  if (concSelect) {
    concSelect.addEventListener('change', (e) => {
      const val = parseInt(e.target.value);
      if (val) userPreferredConcurrency = val;
    });
  }
}
