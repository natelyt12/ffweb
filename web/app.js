let allFiles = [];
    let selectedFiles = new Set();
    let presets = {};
    let pollInterval = null;
    let currentMediaFilter = 'all';
    let currentCwd = '';

    // Batch status & visual indicators
    let activeRunningFiles = new Set();
    let freshOutputFiles = new Set();
    let fadeTimer = null;
    let latestJobData = null;

    function triggerIcons() {
      if (window.lucide) {
        window.lucide.createIcons();
      }
    }

    /* Tab Switching */
    function switchTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-tab-btn').forEach(el => el.classList.remove('active'));

      const target = document.getElementById(`tab-${tabId}`);
      const btn = document.getElementById(`navBtn-${tabId}`);
      if (target) target.classList.add('active');
      if (btn) btn.classList.add('active');

      triggerIcons();
    }

    /* Media Files Loading & Filtering */
    async function loadFiles() {
      try {
        const res = await fetch('/api/files');
        const data = await res.json();
        currentCwd = data.cwd || '';
        document.getElementById('cwdBadge').innerText = currentCwd;
        document.getElementById('cwdBadge').title = currentCwd;
        allFiles = data.files || [];
        document.getElementById('fileCountBadge').innerText = `${allFiles.length} files`;
        filterFiles();
      } catch (err) {
        console.error("Failed to load files", err);
      }
    }

    /* File Actions: Rename & Delete */
    async function promptRenameFile(oldName) {
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

    async function confirmDeleteFile(name) {
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

    function setMediaTypeFilter(type, el) {
      currentMediaFilter = type;
      document.querySelectorAll('.filter-pills .pill').forEach(p => p.classList.remove('active'));
      if (el) el.classList.add('active');
      filterFiles();
    }

    function getFilteredFiles() {
      const q = document.getElementById('searchInput').value.trim().toLowerCase();
      return allFiles.filter(f => {
        const matchesQuery = !q || f.name.toLowerCase().includes(q);
        const matchesType = (currentMediaFilter === 'all') || (f.type === currentMediaFilter);
        return matchesQuery && matchesType;
      });
    }

    function filterFiles() {
      renderFilesList(getFilteredFiles());
    }

    function renderFilesList(files) {
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

    function updateExplorerHighlightClasses() {
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

    function toggleFile(name) {
      if (selectedFiles.has(name)) {
        selectedFiles.delete(name);
      } else {
        selectedFiles.add(name);
      }
      filterFiles();
    }

    function toggleSelectAll() {
      const visible = getFilteredFiles();
      const allSelected = visible.length > 0 && visible.every(f => selectedFiles.has(f.name));
      if (allSelected) {
        visible.forEach(f => selectedFiles.delete(f.name));
      } else {
        visible.forEach(f => selectedFiles.add(f.name));
      }
      filterFiles();
    }

    function clearSelection() {
      selectedFiles.clear();
      filterFiles();
    }

    function updateSelectionState() {
      const visible = getFilteredFiles();
      const masterCheck = document.getElementById('masterSelectAllCheck');
      const allSelected = visible.length > 0 && visible.every(f => selectedFiles.has(f.name));
      masterCheck.checked = allSelected;
      masterCheck.indeterminate = (!allSelected && selectedFiles.size > 0 && visible.some(f => selectedFiles.has(f.name)));

      document.getElementById('selectedSummary').innerText = `${selectedFiles.size} of ${allFiles.length} selected`;
      document.getElementById('clearSelectionBtn').disabled = (selectedFiles.size === 0);
      document.getElementById('startBtn').disabled = (selectedFiles.size === 0);
    }

    /* Folder Selector */
    async function selectFolderDialog() {
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

    async function promptChangeFolder() {
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

    async function openFolder() {
      await fetch('/api/open-folder', { method: 'POST', body: '{}' });
    }

    /* Presets Handling */
    async function loadPresets() {
      try {
        const res = await fetch('/api/presets');
        const data = await res.json();
        presets = data.presets || {};

        // Populate dropdown in Converter Station
        const select = document.getElementById('presetSelect');
        select.innerHTML = Object.keys(presets).map(name => `
          <option value="${escapeHtml(name)}">${escapeHtml(name)} (${presets[name].ext})</option>
        `).join('');
        onPresetChange();

        // Populate dedicated Presets Tab
        filterPresets();
      } catch (err) {
        console.error("Failed to load presets", err);
      }
    }

    function onPresetChange() {
      const name = document.getElementById('presetSelect').value;
      if (presets[name]) {
        document.getElementById('cmdPreviewBox').innerText = `${presets[name].cmd} (Output: ${presets[name].ext})`;
        document.getElementById('customCmdInput').value = presets[name].cmd;
        document.getElementById('customExtInput').value = presets[name].ext;
      }
    }

    function toggleCustomCmd() {
      const isCustom = document.getElementById('customCmdToggle').checked;
      document.getElementById('customCmdFields').style.display = isCustom ? 'block' : 'none';
    }

    function filterPresets() {
      const q = document.getElementById('presetSearchInput').value.trim().toLowerCase();
      const keys = Object.keys(presets).filter(k => {
        return !q || k.toLowerCase().includes(q) || presets[k].cmd.toLowerCase().includes(q);
      });
      document.getElementById('presetCountBadge').innerText = `${Object.keys(presets).length} presets`;
      renderPresetsGrid(keys);
    }

    function renderPresetsGrid(keys) {
      const grid = document.getElementById('presetsGrid');
      if (!keys.length) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px 0; color: var(--text-muted);">No presets match your search.</div>`;
        return;
      }

      grid.innerHTML = keys.map(k => {
        const p = presets[k];
        return `
          <div class="preset-card">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div class="preset-name">${escapeHtml(k)}</div>
                <span class="badge badge-file">${p.ext}</span>
              </div>
              <div class="preset-cmd">${escapeHtml(p.cmd)}</div>
            </div>
            <div class="preset-actions">
              <button class="btn btn-primary btn-sm" onclick="usePresetInConverter('${escapeHtml(k)}')">
                <i data-lucide="play"></i> Use
              </button>
              <button class="btn btn-secondary btn-sm" onclick="openPresetModal('${escapeHtml(k)}')">
                <i data-lucide="edit-3"></i> Edit
              </button>
              <button class="btn btn-danger btn-sm" onclick="deletePreset('${escapeHtml(k)}')">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');
      triggerIcons();
    }

    function usePresetInConverter(name) {
      document.getElementById('presetSelect').value = name;
      onPresetChange();
      switchTab('media');
    }

    /* Modal for Add / Edit Preset */
    function openPresetModal(name) {
      const titleEl = document.getElementById('presetModalTitle');
      const nameInput = document.getElementById('modalPresetName');
      const cmdInput = document.getElementById('modalPresetCmd');
      const extInput = document.getElementById('modalPresetExt');
      const origInput = document.getElementById('editOriginalName');

      if (name && presets[name]) {
        titleEl.innerText = "Edit Preset";
        origInput.value = name;
        nameInput.value = name;
        cmdInput.value = presets[name].cmd;
        extInput.value = presets[name].ext;
      } else {
        titleEl.innerText = "Add New Preset";
        origInput.value = "";
        nameInput.value = "";
        cmdInput.value = "";
        extInput.value = "";
      }

      document.getElementById('presetModal').classList.add('active');
      triggerIcons();
    }

    function closePresetModal() {
      document.getElementById('presetModal').classList.remove('active');
    }

    async function saveModalPreset() {
      const name = document.getElementById('modalPresetName').value.trim();
      const cmd = document.getElementById('modalPresetCmd').value.trim();
      const ext = document.getElementById('modalPresetExt').value.trim();
      const orig = document.getElementById('editOriginalName').value.trim();

      if (!name || !cmd) {
        alert("Please enter preset name and options.");
        return;
      }

      if (orig && orig !== name) {
        // Renamed preset: delete old one first
        await fetch('/api/presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', name: orig })
        });
      }

      await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', name, cmd, ext: ext || '.mp4' })
      });

      closePresetModal();
      await loadPresets();
    }

    async function deletePreset(name) {
      if (!confirm(`Delete preset "${name}"?`)) return;
      await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', name })
      });
      await loadPresets();
    }

    /* Conversion Execution & Live Progress */
    async function startProcessing() {
      const files = Array.from(selectedFiles);
      if (!files.length) return;

      const isCustom = document.getElementById('customCmdToggle').checked;
      let cmd = "";
      let ext = "";

      if (isCustom) {
        cmd = document.getElementById('customCmdInput').value.trim();
        ext = document.getElementById('customExtInput').value.trim();
      } else {
        const pName = document.getElementById('presetSelect').value;
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

    function startPolling() {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(pollStatus, 450);
      pollStatus();
    }

    async function cancelSingleTask(filename) {
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

    function scheduleFadeOutHighlights() {
      if (fadeTimer) clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => {
        freshOutputFiles.clear();
        activeRunningFiles.clear();
        document.querySelectorAll('.file-item.done-output, .file-item.running').forEach(el => {
          el.classList.remove('done-output', 'running');
        });
      }, 5000);
    }

    async function pollStatus() {
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

        // 1. Render Task Queue List (Text-only with trailing status icon)
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

    /* Cancel All with Instant Visual Feedback & Output Rollback */
    async function cancelJob() {
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

    function dismissProgress() {
      document.getElementById('progressCard').style.display = 'none';
    }

    /* FFmpeg Process Log Modal */
    function viewFileLog(fileName) {
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

    function closeLogModal() {
      document.getElementById('logModal').classList.remove('active');
      const btn = document.getElementById('copyLogBtn');
      if (btn) {
        btn.innerHTML = `<i data-lucide="copy"></i> Copy Log`;
        triggerIcons();
      }
    }

    function copyLogContent() {
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

    /* Media Preview Lightbox */
    function previewMedia(filename, type) {
      const modal = document.getElementById('previewModal');
      const container = document.getElementById('previewContainer');
      const url = `/api/preview?file=${encodeURIComponent(filename)}`;

      if (type === 'video') {
        container.innerHTML = `
          <video controls autoplay playsinline style="max-width: 92vw; max-height: 88vh; width: auto; height: auto; outline: none; border-radius: 4px; box-shadow: 0 24px 70px rgba(0,0,0,0.9);">
            <source src="${url}">
            Your browser does not support video preview.
          </video>
        `;
      } else if (type === 'audio') {
        container.innerHTML = `
          <div style="background: var(--bg-card); padding: 24px 32px; border-radius: 4px; border: 1px solid var(--border-subtle); box-shadow: 0 20px 50px rgba(0,0,0,0.7); display: flex; flex-direction: column; align-items: center; gap: 14px;">
            <div style="font-weight: 600; font-size: 13.5px; color: var(--lavender);">${escapeHtml(filename)}</div>
            <audio controls autoplay style="width: 360px;"><source src="${url}">Your browser does not support audio preview.</audio>
          </div>
        `;
      } else if (type === 'image') {
        container.innerHTML = `
          <img src="${url}" style="max-width: 92vw; max-height: 88vh; object-fit: contain; border-radius: 4px; box-shadow: 0 24px 70px rgba(0,0,0,0.9);">
        `;
      }
      modal.classList.add('active');
      triggerIcons();
    }

    function closePreviewModal() {
      document.getElementById('previewModal').classList.remove('active');
      document.getElementById('previewContainer').innerHTML = '';
    }

    function onPreviewOverlayClick(e) {
      if (e.target.id === 'previewModal' || e.target.id === 'previewContainer') {
        closePreviewModal();
      }
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closePreviewModal();
        closePresetModal();
        closeLogModal();
      }
    });

    function escapeHtml(text) {
      if (!text) return "";
      return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    async function shutdownServer() {
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
        triggerIcons();
      } catch (err) {
        alert("Server stopped.");
      }
    }

    // Auto-refresh when tab gains focus or visibility
    window.addEventListener('focus', () => {
      loadFiles();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        loadFiles();
      }
    });

    // Background sync: automatically switch view if user typed ffweb in another Explorer folder
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

    // Init
    loadFiles();
    loadPresets();
    setTimeout(triggerIcons, 300);
