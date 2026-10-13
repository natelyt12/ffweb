/**
 * Shared helpers for the whole dashboard UI.
 */

/** Re-renders every `<i data-lucide>` placeholder currently in the DOM. */
export function triggerIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

/** Escapes a string so it can be safely injected into HTML markup. */
export function escapeHtml(text) {
  if (!text) return "";
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/** Formats a number of seconds as `hh:mm:ss.mmm`. */
export function formatTimecode(sec) {
  if (isNaN(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** Parses `hh:mm:ss`, `mm:ss` or plain seconds into a number of seconds. */
export function parseTimecode(str) {
  if (!str) return 0;
  str = str.trim();
  const parts = str.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  } else if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1]) || 0;
    return m * 60 + s;
  } else {
    return parseFloat(str) || 0;
  }
}
