/**
 * Media preview lightbox shared by the explorer and both cutters.
 */
import { escapeHtml, triggerIcons } from '../core/utils.js';

export function previewMedia(filename, type) {
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

export function closePreviewModal() {
  document.getElementById('previewModal').classList.remove('active');
  document.getElementById('previewContainer').innerHTML = '';
}

export function onPreviewOverlayClick(e) {
  if (e.target.id === 'previewModal' || e.target.id === 'previewContainer') {
    closePreviewModal();
  }
}
