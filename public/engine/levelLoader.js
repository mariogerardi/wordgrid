/* engine/levelLoader.js
   Loads a level JSON and normalizes it into a strict shape for the engine.

   Usage:
     import { loadLevel, levelIdFromURL } from './engine/levelLoader.js';
     const id = levelIdFromURL() || '001';
     const level = await loadLevel(id); // fetches ./levels/level-<id>.json

   Output shape (normalized):
     {
       id: string,
       name: string,
       rows: number,                       // board rows (min 2, max 10)
       cols: number,                       // board cols (min 2, max 10)
       // size: number,                   // (legacy) kept for back-compat when rows==cols
       par: number,                        // target turns
       goal: { r: number, c: number },     // 0-index
       seeds: [ { text, r, c, dir: 'H'|'V' }, ... ],
       deck: string[],                     // tile fragments in draw order
       startingHand: string[] | null,      // optional exact starting tiles
       allowedWords: string[],             // allowlist (lowercasing handled later)
       notes: string
     }
*/

export async function loadLevel(levelId, opts = {}) {
  const basePath = opts.basePath ?? './levels';
  const url = `${basePath}/level-${levelId}.json`;

  let raw;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    raw = await res.json();
  } catch (err) {
    throw new Error(`Failed to load level "${levelId}" from ${url}: ${err.message}`);
  }

  return normalizeLevel(raw, levelId);
}

/** Read ?level=<id> from the URL (returns string or null). */
export function levelIdFromURL() {
  try {
    const params = new URLSearchParams(location.search);
    const id = params.get('level');
    return id && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/* -------------------- Normalization & validation -------------------- */

export function normalizeLevel(raw, fallbackId = 'unknown') {
  const errors = [];

  // ---- meta ----
  const id = (raw?.meta?.id ?? fallbackId) + '';
  const name = (raw?.meta?.name ?? `Level ${id}`) + '';
  const par = toInt(raw?.meta?.par, 7, 'meta.par', errors);
  const intro = (raw?.meta?.intro ?? raw?.intro ?? '') + '';

  // ---- board ----
  const board = raw?.board ?? {};
  // Accept board.size as number (NxN), [rows,cols] tuple, or explicit board.rows/board.cols
  let rows = 0, cols = 0;
  if (Array.isArray(board.size) && board.size.length === 2) {
    rows = toInt(board.size[0], 7, 'board.size[0]', errors);
    cols = toInt(board.size[1], 7, 'board.size[1]', errors);
  } else if (typeof board.size === 'number') {
    const n = toInt(board.size, 7, 'board.size', errors);
    rows = n; cols = n;
  } else if (typeof board.rows === 'number' && typeof board.cols === 'number') {
    rows = toInt(board.rows, 7, 'board.rows', errors);
    cols = toInt(board.cols, 7, 'board.cols', errors);
  } else {
    // fallback to 7x7
    rows = 7; cols = 7;
  }
  // Clamp/validate bounds per product requirements (allow 1 in either dimension)
  if (rows < 1 || cols < 1 || rows > 10 || cols > 10) {
    errors.push('board size must be between 1 and 10 in each dimension.');
  }

  const goalArr = Array.isArray(board.goal) ? board.goal : null;
  if (!goalArr || goalArr.length !== 2) errors.push('board.goal must be [row, col].');
  const goal = {
    r: toInt(goalArr?.[0], 0, 'board.goal[0]', errors),
    c: toInt(goalArr?.[1], 0, 'board.goal[1]', errors),
  };

  // seeds (single-cell tiles now)
  const seedsRaw = Array.isArray(board.seeds) ? board.seeds : [];
  const seeds = seedsRaw.map((s, i) => {
    const text = mustString(s?.text, `board.seeds[${i}].text`, errors);
    const r = toInt(s?.r, 0, `board.seeds[${i}].r`, errors);
    const c = toInt(s?.c, 0, `board.seeds[${i}].c`, errors);
    // dir is now irrelevant for placement; keep it for backward compatibility
    const dir = (s?.dir === 'V' || s?.dir === 'H') ? s.dir : 'H';
    return { text, r, c, dir };
  });

  // specials (blocked cells, etc.)
  const specials = validateSpecials(board, rows, cols);

  // ---- deck / words ----
  const deck = toStringArray(raw?.deck, 'deck', errors);
  const startingHand = raw?.startingHand == null ? null : toStringArray(raw.startingHand, 'startingHand', errors);
  const allowedWords = toStringArray(raw?.allowedWords, 'allowedWords', errors);
  const notes = (raw?.notes ?? '') + '';

  // ---- bounds sanity ----
  if (rows <= 0 || cols <= 0) errors.push('board size must be > 0.');
  if (goal.r < 0 || goal.c < 0 || goal.r >= rows || goal.c >= cols) {
    errors.push(`board.goal out of bounds for size ${rows}×${cols}.`);
  }

  // Single-cell bounds check for seeds only (no multi-letter fit check)
  seeds.forEach((s, i) => {
    if (!s.text || !/^[A-Za-z]+$/.test(s.text)) {
      errors.push(`board.seeds[${i}].text must be letters A–Z.`);
    }
    if (s.r < 0 || s.c < 0 || s.r >= rows || s.c >= cols) {
      errors.push(`board.seeds[${i}] is out of bounds for the ${rows}×${cols} board.`);
    }
  });

  if (allowedWords.length === 0) {
    errors.push('allowedWords must contain at least one entry.');
  }

  // Warn if startingHand items aren’t present in deck (non-fatal)
  if (startingHand) {
    const deckCounts = countBy(deck);
    for (const frag of startingHand) {
      if (!deckCounts[frag]) {
        console.warn(`[level ${id}] startingHand contains "${frag}" which is not found in deck.`);
      } else {
        deckCounts[frag]--;
      }
    }
  }

  if (errors.length) {
    const msg = errors.map((e) => `• ${e}`).join('\n');
    throw new Error(`Level "${id}" failed validation:\n${msg}`);
  }

  // Return flat shape (what the engine expects) + nested board for specials
  const legacySize = rows === cols ? rows : undefined;
  return {
    id, name, rows, cols, ...(legacySize ? { size: legacySize } : {}), par, goal, seeds, deck, startingHand, allowedWords, notes,
    intro,
    board: { specials }  // <-- used by state.startLevel(...) to mark blocked cells
  };
}

/* -------------------- helpers -------------------- */

function toInt(v, fallback, label, errors) {
  const n = Number.parseInt(v, 10);
  if (Number.isFinite(n)) return n;
  if (!w(fallback)) {
    errors.push(`${label} must be an integer.`);
    return 0;
  }
  return Number.parseInt(fallback, 10);
}

function mustString(v, label, errors) {
  if (typeof v === 'string' && v.length > 0) return v;
  errors.push(`${label} must be a non-empty string.`);
  return '';
}

function toStringArray(v, label, errors) {
  if (!Array.isArray(v)) {
    errors.push(`${label} must be an array of strings.`);
    return [];
  }
  const out = [];
  for (let i = 0; i < v.length; i++) {
    const s = v[i];
    if (typeof s !== 'string' || s.length === 0) {
      errors.push(`${label}[${i}] must be a non-empty string.`);
      continue;
    }
    out.push(s);
  }
  return out;
}

function normalizeDir(dir, label, errors) {
  const d = String(dir || '').toUpperCase();
  if (d === 'H' || d === 'V') return d;
  errors.push(`${label} must be "H" or "V".`);
  return 'H';
}

function fitsRowsCols(rows, cols, r, c, dir, len) {
  if (dir === 'H') return r >= 0 && r < rows && c >= 0 && c + len - 1 < cols;
  return c >= 0 && c < cols && r >= 0 && r + len - 1 < rows;
}

function countBy(arr) {
  const m = Object.create(null);
  for (const x of arr) m[x] = (m[x] || 0) + 1;
  return m;
}

function w(x) { return x || x === 0; }

function validateSpecials(board, rows, cols) {
  const specials = Array.isArray(board.specials) ? board.specials : [];
  for (const s of specials) {
    if (typeof s.r !== 'number' || typeof s.c !== 'number' || typeof s.type !== 'string') {
      throw new Error('board.specials entries must be { r, c, type }.');
    }
    if (s.r < 0 || s.c < 0 || s.r >= rows || s.c >= cols) {
      throw new Error(`board.specials out of bounds at [${s.r},${s.c}].`);
    }
    if (s.type !== 'blocked' && s.type !== 'portal') {
      throw new Error(`board.specials unsupported type "${s.type}".`);
    }
  }
  // No overlap with goal
  if (Array.isArray(board.goal)) {
    const [gr, gc] = board.goal;
    if (specials.some(s => s.r === gr && s.c === gc)) {
      throw new Error('board.specials cannot overlap the goal.');
    }
  }
  // No overlap with seeds
  for (const sd of (board.seeds || [])) {
    if (specials.some(s => s.r === sd.r && s.c === sd.c)) {
      throw new Error('board.specials cannot overlap seeds.');
    }
  }
  return specials;
}
