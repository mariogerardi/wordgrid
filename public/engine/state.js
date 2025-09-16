/* engine/state.js  (tile-per-cell model)
   Each grid cell holds an entire fragment (e.g., "ANT"), not a single letter.
   Word runs are formed by concatenating cell.text across contiguous cells.
*/

export function initState(level) {
  const rows = Number.isFinite(level.rows) ? level.rows : Number(level.size || 7);
  const cols = Number.isFinite(level.cols) ? level.cols : Number(level.size || 7);
  return {
    // level meta
    rows,
    cols,
    par: level.par ?? 7,
    goal: { r: level.goal.r, c: level.goal.c },

    // turn + mode
    turn: 1,
    mode: 'play',      // 'play' | 'recall'
    dir: 'H',          // 'H' | 'V' (orientation intent for staging multiple tiles)

    // grid cells: { text: string|null, tileId: string|null, seed: boolean }
    grid: Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ text: null, tileId: null, seed: false }))
    ),

    // committed tiles: id -> { id, text, r, c }
    placed: new Map(),

    // staged actions for the current turn
    turnPlacements: [],

    // deck/hand/reserve
    deck: (level.deck ?? []).map((t, i) => ({ id: `D${i}`, text: t })),
    hand: [],
    reserve: [],

    // UI selection
    selectedTileId: null,

    // allowlist (lowercased)
    allow: new Set((level.allowedWords ?? []).map(w => String(w).toLowerCase())),
  };
}

export function startLevel(state, level) {
  // initialize portal structures
  state.portalAt = Array.from({ length: state.rows }, () => Array.from({ length: state.cols }, () => null));
  state.portalGroups = new Map(); // groupId -> [{r,c}]
  // place seeds (each seed is a single cell with the full fragment)
  for (let i = 0; i < (level.seeds?.length ?? 0); i++) {
    const s = level.seeds[i];
    putWord(state, s.r, s.c, s.dir, s.text, `__SEED__${i}`, true); // dir unused here
  }

  // starting hand (optional): pull exact frags from deck to hand
  if (level.startingHand && level.startingHand.length) {
    for (const frag of level.startingHand) {
      const ix = state.deck.findIndex(t => t.text === frag);
      if (ix >= 0) state.hand.push(state.deck.splice(ix, 1)[0]);
    }
  }

  // apply specials (blocked cells)
  if (Array.isArray(level.board?.specials)) {
    for (const s of level.board.specials) {
      const cell = state.grid[s.r][s.c];
      cell.special = s.type; // 'blocked' | 'portal'
      if (s.type === 'portal') {
        const gid = String(s.group ?? '0');
        state.portalAt[s.r][s.c] = gid;
        if (!state.portalGroups.has(gid)) state.portalGroups.set(gid, []);
        state.portalGroups.get(gid).push({ r: s.r, c: s.c });
      }
    }
  }

  dealToHand(state, 4);
}

export function dealToHand(state, target = 4) {
  while (state.hand.length < target && state.deck.length) {
    state.hand.push(state.deck.shift());
  }
}

/* ---------- geometry / adjacency ---------- */

export function fits(state, r, c /*, dir, lenIgnored */) {
  // tile occupies exactly one cell; ignore length & dir
  return r >= 0 && r < state.rows && c >= 0 && c < state.cols;
}

export function inBounds(state, r, c) {
  return r >= 0 && r < state.rows && c >= 0 && c < state.cols;
}

export function touchesExisting(state, r, c /*, dir, textIgnored */) {
  // requires adjacency (or overlap) to any existing occupied cell
  const neigh = [
    [r, c], [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]
  ];
  return neigh.some(([nr, nc]) => inBounds(state, nr, nc) && !!state.grid[nr][nc].text);
}

/* ---------- write/remove single-cell tiles ---------- */

/** Place a tile fragment into ONE cell. dir is ignored (kept for API compatibility). */
export function putWord(state, r, c, /* dir */ _dir, text, tileId, seed = false) {
  const prev = state.grid[r][c] || {};
  state.grid[r][c] = {
    ...prev,
    text,
    tileId,
    seed: !!seed || !!prev.seed,
    special: prev.special || null
  };
}

/** Remove the exact tile (by id) from its one cell. */
export function removeWord(state, tile) {
  const { r, c, id } = tile;
  const cell = state.grid[r][c];
  if (cell && cell.tileId === id) {
    state.grid[r][c] = {
      ...cell,
      text: null,
      tileId: null,
      seed: false,
      special: cell.special || null
    };
  }
}

/* ---------- runs & validation ---------- */

/** Extract all horizontal & vertical runs by concatenating cell.text across contiguous cells. */
export function extractRuns(state) {
  const runs = [];
  const R = state.rows;
  const C = state.cols;

  // horizontal
  for (let r = 0; r < R; r++) {
    let c = 0;
    while (c < C) {
      while (c < C && !cellHasTextOrProjection(state, r, c)) c++;
      const start = c;
      let s = '';
      let cells = 0;
      while (c < C && cellHasTextOrProjection(state, r, c)) {
        s += getCellTextOrProjection(state, r, c).toLowerCase();
        c++;
        cells++;
      }
      if (s.length > 0) runs.push({ text: s.toLowerCase(), r, c: start, dir: 'H', cells });
    }
  }

  // vertical
  for (let c = 0; c < C; c++) {
    let r = 0;
    while (r < R) {
      while (r < R && !cellHasTextOrProjection(state, r, c)) r++;
      const start = r;
      let s = '';
      let cells = 0;
      while (r < R && cellHasTextOrProjection(state, r, c)) {
        s += getCellTextOrProjection(state, r, c).toLowerCase();
        r++;
        cells++;
      }
      if (s.length > 0) runs.push({ text: s.toLowerCase(), r: start, c, dir: 'V', cells });
    }
  }

  return runs;
}

/** Return only the runs impacted by newly placed cells this turn. */
export function collectAffectedLines(state, placements) {
  const coords = new Set(placements.map(p => `${p.r},${p.c}`));
  const all = extractRuns(state);
  return all.filter(run => runIncludesAny(run, coords));
}

function runIncludesAny(run, coordSet) {
  if (run.dir === 'H') {
    for (let cc = run.c; cc <= run.c + run.cells - 1; cc++) {
      if (coordSet.has(`${run.r},${cc}`)) return true;
    }
  } else {
    for (let rr = run.r; rr <= run.r + run.cells - 1; rr++) {
      if (coordSet.has(`${rr},${run.c}`)) return true;
    }
  }
  return false;
}

export function runsValid(state, runs) {
  return runs.every(r => state.allow.has(r.text));
}

// Require: every occupied cell is covered by a valid multi-cell word,
// or (if it stands alone) its own text is an allowed word.
export function boardValid(state) {
  const runs = extractRuns(state);
  const allow = state.allow;

  // First, immediately reject if ANY multi-cell run forms a disallowed word.
  // This prevents cases like placing adjacent allowed singles that concatenate
  // into a disallowed longer word (e.g., "UP" + "UP" => "UPUP").
  for (const r of runs) {
    if (r.cells >= 2 && !allow.has(r.text)) return false;
  }

  // First, collect coverage from valid multi-cell runs.
  const covered = new Set();
  for (const r of runs) {
    if (r.cells >= 2 && allow.has(r.text)) {
      if (r.dir === 'H') {
        for (let c = r.c; c < r.c + r.cells; c++) covered.add(`${r.r},${c}`);
      } else {
        for (let rr = r.r; rr < r.r + r.cells; rr++) covered.add(`${rr},${r.c}`);
      }
    }
  }

  // Now every occupied cell with a REAL tile must be covered OR be itself an
  // allowed 1-cell word. Pure portal projections are allowed to stand alone.
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = state.grid[r][c];
      const cellText = cell.text; // only real tiles considered for lone check
      if (!cellText) continue; // skip empty and projection-only cells

      const key = `${r},${c}`;
      if (covered.has(key)) continue; // part of a valid multi-cell word

      const lone = String(cellText).toLowerCase();
      if (!allow.has(lone)) return false; // isolated fragment not allowed
    }
  }
  return true;
}

/**
 * Return a user-facing reason string if the board is invalid; otherwise null.
 * Mirrors boardValid logic but reports what is wrong.
 */
export function boardInvalidReason(state) {
  const runs = extractRuns(state);
  const allow = state.allow;

  // 1) Any disallowed multi-cell word?
  for (const r of runs) {
    if (r.cells >= 2 && !allow.has(r.text)) {
      const word = String(r.text).toUpperCase();
      const cells = runCellsA1(r);
      return `The word "${word}" is not allowed (cells ${formatCellsList(cells)}).`;
    }
  }

  // 2) Coverage check: every occupied cell with a REAL tile must be in a
  //    valid multi-cell run or be itself an allowed 1-cell word. Pure portal
  //    projections are allowed to stand alone.
  const covered = new Set();
  for (const r of runs) {
    if (r.cells >= 2 && allow.has(r.text)) {
      if (r.dir === 'H') {
        for (let c = r.c; c < r.c + r.cells; c++) covered.add(`${r.r},${c}`);
      } else {
        for (let rr = r.r; rr < r.r + r.cells; rr++) covered.add(`${rr},${r.c}`);
      }
    }
  }
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = state.grid[r][c];
      const cellText = cell.text; // only real tiles considered here
      if (!cellText) continue; // skip empty & projection-only cells
      const key = `${r},${c}`;
      if (covered.has(key)) continue;
      const lone = String(cellText).toLowerCase();
      if (!allow.has(lone)) {
        return `The tile "${String(cellText).toUpperCase()}" is not allowed to stand alone (cell ${toA1(r, c)}).`;
      }
    }
  }

  // 3) Connectivity: all occupied cells (including portal projections) must be
  // connected to at least one seed tile. Portals bridge connectivity: a tile
  // on any portal connects to all cells in its portal group (its projections).
  const disc = findDisconnectedComponent(state);
  if (disc && disc.length) {
    return `All tiles must connect to the seed (portals included). Disconnected group at cells ${formatCellsList(disc)}.`;
  }
  return null;
}

/* ---------- A1 utilities (exported for messaging) ---------- */

// Convert r,c (0-based) → A1 (A..Z, AA..ZZ, then AAA..)
export function toA1(r, c) {
  let n = c + 1;
  let col = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return `${col}${r + 1}`;
}

export function runCellsA1(run) {
  const arr = [];
  if (run.dir === 'H') {
    for (let c = run.c; c < run.c + run.cells; c++) arr.push(toA1(run.r, c));
  } else {
    for (let r = run.r; r < run.r + run.cells; r++) arr.push(toA1(r, run.c));
  }
  return arr;
}

export function formatCellsList(cells) {
  const a = Array.from(cells);
  if (a.length === 0) return '';
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(', ')}, and ${a[a.length - 1]}`;
}

/* Return an array of A1 cells for one disconnected component, or [] if all connected. */
function findDisconnectedComponent(state) {
  const R = state.rows, C = state.cols;
  const occupied = [];
  // A node is present if there is a real tile OR a portal projection overlay
  const isNode = (r, c) => !!(state.grid[r][c]?.text || getPortalOverlayText(state, r, c));
  const isSeed = (r, c) => !!state.grid[r][c]?.seed;

  // Collect all occupied coords
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) if (isNode(r, c)) occupied.push([r, c]);
  }
  if (occupied.length === 0) return [];

  // Start BFS from all seeds (if any). If no seeds exist, skip connectivity check.
  const seeds = [];
  for (const [r, c] of occupied) { if (isSeed(r, c)) seeds.push([r, c]); }
  if (seeds.length === 0) return [];

  const q = [];
  const seen = new Set();
  for (const [r, c] of seeds) { q.push([r, c]); seen.add(`${r},${c}`); }

  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  while (q.length) {
    const [r, c] = q.shift();
    // Explore 4-neighborhood
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
      if (!isNode(nr, nc)) continue;
      const key = `${nr},${nc}`;
      if (!seen.has(key)) { seen.add(key); q.push([nr, nc]); }
    }
    // Portal bridging: connect to all cells in the same portal group
    const gid = (state.portalAt?.[r]?.[c]) || null;
    if (gid) {
      const cells = state.portalGroups?.get?.(gid) || [];
      for (const pos of cells) {
        const nr = pos.r, nc = pos.c;
        if (!isNode(nr, nc)) continue; // only nodes participate
        const key = `${nr},${nc}`;
        if (!seen.has(key)) { seen.add(key); q.push([nr, nc]); }
      }
    }
  }

  // If any occupied cell is not seen, return that component (limited list for readability)
  const first = occupied.find(([r, c]) => !seen.has(`${r},${c}`));
  if (!first) return [];

  // Gather its component cells to report
  const compSeen = new Set([`${first[0]},${first[1]}`]);
  const comp = [first];
  const q2 = [first];
  while (q2.length) {
    const [r, c] = q2.shift();
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
      if (!isNode(nr, nc)) continue;
      const key = `${nr},${nc}`;
      if (!compSeen.has(key)) { compSeen.add(key); q2.push([nr, nc]); comp.push([nr, nc]); }
    }
    const gid = (state.portalAt?.[r]?.[c]) || null;
    if (gid) {
      const cells = state.portalGroups?.get?.(gid) || [];
      for (const pos of cells) {
        const nr = pos.r, nc = pos.c;
        if (!isNode(nr, nc)) continue;
        const key = `${nr},${nc}`;
        if (!compSeen.has(key)) { compSeen.add(key); q2.push([nr, nc]); comp.push([nr, nc]); }
      }
    }
  }

  // Convert to A1 labels and cap length to keep message short
  const labels = comp.map(([r, c]) => toA1(r, c));
  const MAX = 6;
  if (labels.length > MAX) return [...labels.slice(0, MAX - 1), `…`, labels[labels.length - 1]];
  return labels;
}

export function coversGoal(state) {
  const g = state.goal;
  const runs = extractRuns(state);
  return runs.some(run => {
    if (run.dir === 'H' && run.r === g.r && g.c >= run.c && g.c <= run.c + run.cells - 1) return true;
    if (run.dir === 'V' && run.c === g.c && g.r >= run.r && g.r <= run.r + run.cells - 1) return true;
    return false;
  });
}

/* ---------- portal overlay helpers ---------- */
export function groupCells(state, gid) {
  return state.portalGroups?.get?.(gid) || [];
}
export function portalGroupAt(state, r, c) {
  return (state.portalAt?.[r]?.[c]) || null;
}
export function getPortalOverlayText(state, r, c) {
  const gid = portalGroupAt(state, r, c);
  if (!gid) return '';
  // if real text exists, no overlay needed
  if (state.grid[r][c]?.text) return '';
  const cells = groupCells(state, gid);
  for (const pos of cells) {
    const t = state.grid[pos.r][pos.c]?.text;
    if (t) return String(t);
  }
  return '';
}
export function cellHasTextOrProjection(state, r, c) {
  return !!(state.grid[r][c]?.text || getPortalOverlayText(state, r, c));
}
export function getCellTextOrProjection(state, r, c) {
  return state.grid[r][c]?.text || getPortalOverlayText(state, r, c) || '';
}
