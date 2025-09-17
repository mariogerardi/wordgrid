/* shared/utils.js
   Small shared helpers with no engine-state dependencies.
*/

/**
 * Count primitive occurrences in an array (used for deck/start hand audits, etc.).
 */
export function countBy(items) {
  const counts = Object.create(null);
  for (const item of items || []) {
    counts[item] = (counts[item] || 0) + 1;
  }
  return counts;
}

/** djb2-ish hash used for deterministic daily picks (stable across sessions). */
export function hashStr(text = '') {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return hash >>> 0; // force unsigned
}

/** Ensure a toast root exists for lightweight notifications. */
export function ensureToastRoot(id = 'toastRoot') {
  let root = document.getElementById(id);
  if (!root) {
    root = document.createElement('div');
    root.id = id;
    document.body.appendChild(root);
  }
  return root;
}

/** Generic toast helper; callers can wrap this for contextual phrasing. */
export function showToast(message, opts = {}) {
  const { duration = 2600, className = 'toast', rootId = 'toastRoot' } = opts;
  if (!message) return;
  const root = ensureToastRoot(rootId);
  const node = document.createElement('div');
  node.className = className;
  node.textContent = message;
  root.appendChild(node);

  requestAnimationFrame(() => node.classList.add(`${className}--in`));
  const exitDelay = Math.max(0, duration);
  setTimeout(() => {
    node.classList.remove(`${className}--in`);
    node.classList.add(`${className}--out`);
    setTimeout(() => node.remove(), 350);
  }, exitDelay);
}

/** Safe JSON parse with fallback to avoid runtime exceptions. */
export function safeJSONParse(text, fallback = null) {
  if (typeof text !== 'string') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
