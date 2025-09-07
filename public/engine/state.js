/* engine/state.js  (tile-per-cell model)
   Each grid cell holds an entire fragment (e.g., "ANT"), not a single letter.
   Word runs are formed by concatenating cell.text across contiguous cells.
*/

export function initState(level) {
  const size = level.size;
  return {
    // level meta
    size,
    par: level.par ?? 7,
    goal: { r: level.goal.r, c: level.goal.c },

    // turn + mode
    turn: 1,
    mode: 'play',      // 'play' | 'recall'
    dir: 'H',          // 'H' | 'V' (orientation intent for staging multiple tiles)

    // grid cells: { text: string|null, tileId: string|null, seed: boolean }
    grid: Array.from({ length: size }, () =>
      Array.from({ length: size }, () => ({ text: null, tileId: null, seed: false }))
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
      cell.special = s.type; // 'blocked'
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
  const N = state.size;
  return r >= 0 && r < N && c >= 0 && c < N;
}

export function inBounds(state, r, c) {
  const N = state.size;
  return r >= 0 && r < N && c >= 0 && c < N;
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
  state.grid[r][c] = { text, tileId, seed: !!seed };
}

/** Remove the exact tile (by id) from its one cell. */
export function removeWord(state, tile) {
  const { r, c, id } = tile;
  const cell = state.grid[r][c];
  if (cell && cell.tileId === id) {
    state.grid[r][c] = { text: null, tileId: null, seed: false };
  }
}

/* ---------- runs & validation ---------- */

/** Extract all horizontal & vertical runs by concatenating cell.text across contiguous cells. */
export function extractRuns(state) {
  const runs = [];
  const N = state.size;

  // horizontal
  for (let r = 0; r < N; r++) {
    let c = 0;
    while (c < N) {
      while (c < N && !state.grid[r][c].text) c++;
      const start = c;
      let s = '';
      let cells = 0;
      while (c < N && state.grid[r][c].text) {
        s += state.grid[r][c].text;
        c++;
        cells++;
      }
      if (s.length > 0) runs.push({ text: s.toLowerCase(), r, c: start, dir: 'H', cells });
    }
  }

  // vertical
  for (let c = 0; c < N; c++) {
    let r = 0;
    while (r < N) {
      while (r < N && !state.grid[r][c].text) r++;
      const start = r;
      let s = '';
      let cells = 0;
      while (r < N && state.grid[r][c].text) {
        s += state.grid[r][c].text;
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

  // Now every occupied cell must be covered OR be itself an allowed 1-cell word.
  for (let r = 0; r < state.size; r++) {
    for (let c = 0; c < state.size; c++) {
      const cell = state.grid[r][c];
      if (!cell.text) continue;

      const key = `${r},${c}`;
      if (covered.has(key)) continue; // part of a valid multi-cell word

      const lone = String(cell.text).toLowerCase();
      if (!allow.has(lone)) return false; // isolated fragment not allowed
    }
  }
  return true;
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