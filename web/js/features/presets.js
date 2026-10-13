/**
 * Preset library: dropdown, dedicated presets tab and the add/edit modal.
 */
import { escapeHtml, triggerIcons } from '../core/utils.js';
import { updateStartBtnState } from './explorer.js';
import { switchTab } from './tabs.js';

export let presets = {};

export async function loadPresets() {
  try {
    const res = await fetch('/api/presets');
    const data = await res.json();
    presets = data.presets || {};

    // Populate dropdown in Converter Station
    const select = document.getElementById('presetSelect');
    const previousVal = select.value;

    const customOptionHtml = `<option value="__custom__">Custom Arguments (One-time draft)</option>`;
    const presetOptionsHtml = Object.keys(presets).map(name => `
      <option value="${escapeHtml(name)}">${escapeHtml(name)} (${presets[name].ext})</option>
    `).join('');

    select.innerHTML = customOptionHtml + presetOptionsHtml;

    // Default to __custom__ unless previousVal is a valid preset
    if (previousVal && presets[previousVal]) {
      select.value = previousVal;
    } else {
      select.value = '__custom__';
    }

    onPresetChange();

    // Populate dedicated Presets Tab
    filterPresets();
  } catch (err) {
    console.error("Failed to load presets", err);
  }
}

export function onPresetChange() {
  const select = document.getElementById('presetSelect');
  const val = select.value;
  const previewBox = document.getElementById('cmdPreviewBox');
  const customFields = document.getElementById('customCmdFields');

  if (val === '__custom__') {
    if (previewBox) previewBox.style.display = 'none';
    if (customFields) customFields.style.display = 'block';
  } else if (presets[val]) {
    if (previewBox) {
      previewBox.style.display = 'block';
      previewBox.innerText = `${presets[val].cmd} (Output: ${presets[val].ext})`;
    }
    if (customFields) customFields.style.display = 'none';
  }
  updateStartBtnState();
}

export function onCustomCmdInput() {
  updateStartBtnState();
}

export function filterPresets() {
  const q = document.getElementById('presetSearchInput').value.trim().toLowerCase();
  const keys = Object.keys(presets).filter(k => {
    return !q || k.toLowerCase().includes(q) || presets[k].cmd.toLowerCase().includes(q);
  });
  document.getElementById('presetCountBadge').innerText = `${Object.keys(presets).length} presets`;
  renderPresetsGrid(keys);
}

export function renderPresetsGrid(keys) {
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

export function usePresetInConverter(name) {
  document.getElementById('presetSelect').value = name;
  onPresetChange();
  switchTab('media');
}

export function openPresetModal(name) {
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

export function closePresetModal() {
  document.getElementById('presetModal').classList.remove('active');
}

export async function saveModalPreset() {
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

export async function deletePreset(name) {
  if (!confirm(`Delete preset "${name}"?`)) return;
  await fetch('/api/presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', name })
  });
  await loadPresets();
}
