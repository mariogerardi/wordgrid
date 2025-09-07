/* engine/rules.js — tile-per-cell (slots; no Recall button)
   Additions in this patch:
   - returnStagedToPool(): disallow returning staged tiles to reserve
   - cancelStagedRecall(): revert a staged recall by tileId
*/

import {
  fits, putWord, removeWord, extractRuns, boardValid,
  dealToHand, coversGoal
} from './state.js';

export function toggleDir(state) { state.dir = state.dir === 'H' ? 'V' : 'H'; return state.dir; }
export function setMode(state, mode) { if (state.mode !== mode) rollbackTurn(state); state.mode = mode; }

/* -------------------- Staging actions -------------------- */

export function tryStagePlacement(state, tileId, r, c) {
  const found = findTileInPools(state, tileId);
  if (!found) return fail('Tile not in hand/reserve.');
  if (!fits(state, r, c)) return fail('Out of bounds.');
  if (state.grid[r][c].text) return fail('Cell is occupied.');

  const { pool, index } = found;
  const tile = state[pool][index];

  putWord(state, r, c, state.dir, tile.text, tile.id, false);
  state.turnPlacements.push({ type: 'place', tile, r, c, origin: pool });
  state[pool].splice(index, 1);
  return ok();
}

export function moveStagedPlacement(state, tileId, toR, toC) {
  const act = state.turnPlacements.find(a => a.type === 'place' && a.tile.id === tileId);
  if (!act) return fail('Tile is not staged.');
  if (!fits(state, toR, toC)) return fail('Out of bounds.');
  if (state.grid[toR][toC].text) return fail('Cell is occupied.');

  const from = state.grid[act.r][act.c];
  if (from && from.tileId === tileId) state.grid[act.r][act.c] = { text: null, tileId: null, seed: false };

  putWord(state, toR, toC, state.dir, act.tile.text, act.tile.id, false);
  act.r = toR; act.c = toC;
  return ok();
}

/** Return a STAGED placement to a pool slot. Staged → hand OK; staged → reserve NOT allowed. */
export function returnStagedToPool(state, r, c, pool) {
  if (pool !== 'hand' && pool !== 'reserve') return fail('Invalid slot.');
  const cell = state.grid[r][c];
  if (!cell?.tileId) return fail('Nothing to return here.');
  const tileId = cell.tileId;
  if (String(tileId).startsWith('__SEED__')) return fail('Seed tiles cannot be moved.');
  if (state.placed.has(tileId)) return fail('Committed tiles require recall.');

  // Disallow putting staged tiles into reserve
  if (pool === 'reserve') return fail('Only committed tiles can go to reserve (via recall).');

  const ix = state.turnPlacements.findIndex(a => a.type === 'place' && a.tile.id === tileId && a.r === r && a.c === c);
  if (ix < 0) return fail('Tile is not staged (unexpected).');

  const act = state.turnPlacements.splice(ix, 1)[0];
  removeWord(state, { id: tileId, r, c, text: act.tile.text });
  state[pool].push(act.tile);
  return ok();
}

/** Stage a RECALL of a COMMITTED tile by tileId (reserve cap enforced on submit UI). */
export function tryStageRecall(state, tileId) {
  const tile = state.placed.get(tileId);
  if (!tile) return fail('Tile is not committed.');
  if (String(tileId).startsWith('__SEED__')) return fail('Seed tiles cannot be recalled.');

  // Visual remove now; validate on submit
  removeWord(state, tile);
  state.turnPlacements.push({ type: 'recall', tileSnapshot: { ...tile } });
  return ok();
}

/** Cancel a staged recall by clicking its ghost in reserve. */
export function cancelStagedRecall(state, tileId) {
  const ix = state.turnPlacements.findIndex(a => a.type === 'recall' && a.tileSnapshot.id === tileId);
  if (ix < 0) return fail('No staged recall for that tile.');
  const t = state.turnPlacements[ix].tileSnapshot;
  // Put it back to original board coordinates
  putWord(state, t.r, t.c, state.dir, t.text, t.id, false);
  state.turnPlacements.splice(ix, 1);
  return ok();
}

/* -------------------- Submit (commit) -------------------- */

export function commitPlayTurn(state) {
  const placements = state.turnPlacements.filter(a => a.type === 'place');
  const recalls = state.turnPlacements.filter(a => a.type === 'recall');
  if (placements.length === 0 && recalls.length === 0) return fail('Nothing to submit.');
  if (placements.length > 0 && recalls.length > 0) return fail('Place OR recall in one submit, not both.');

  if (placements.length === 0) {
    return commitRecallTurn(state);
  }

  const placedSet = new Set(placements.map(p => `${p.r},${p.c}`));
  const carriers = extractRuns(state).filter(run => run.cells >= 2 && runContainsAll(run, placedSet));

  let primary = null;
  if (carriers.length === 1) {
    primary = carriers[0];
    if (!state.allow.has(primary.text)) return fail('Invalid word for this level.');
  } else if (carriers.length === 0 && placements.length === 1) {
    const txt = String(placements[0].tile.text).toLowerCase();
    if (!state.allow.has(txt)) return fail('Invalid word for this level.');
    primary = { dir: 'H', r: placements[0].r, c: placements[0].c, cells: 1, text: txt };
  } else {
    return fail('All tiles in a turn must form ONE continuous word.');
  }

  if (!boardValid(state)) return fail('Board contains an invalid word.');

  for (const p of placements) {
    state.placed.set(p.tile.id, { id: p.tile.id, text: p.tile.text, r: p.r, c: p.c });
  }

  state.turnPlacements = [];
  state.turn += 1;
  dealToHand(state, 4);
  return ok({ win: coversGoal(state) });
}

export function commitRecallTurn(state) {
  const recalls = state.turnPlacements.filter(a => a.type === 'recall');
  const placements = state.turnPlacements.filter(a => a.type === 'place');
  if (recalls.length === 0 && placements.length === 0) return fail('Nothing to submit.');
  if (recalls.length > 0 && placements.length > 0) return fail('Place OR recall in one submit, not both.');

  // Enforce reserve cap at commit: current reserve + staged recalls ≤ 2
  if (state.reserve.length + recalls.length > 2) return fail('Reserve full (2).');

  if (!boardValid(state)) {
    rollbackTurn(state);
    return fail('Recall would leave invalid board.');
  }

  for (const rec of recalls) {
    const t = rec.tileSnapshot;
    state.placed.delete(t.id);
    state.reserve.push({ id: t.id, text: t.text });
  }

  state.turnPlacements = [];
  state.turn += 1;
  return ok();
}

/** Reset all staged actions (used by Reset). */
export function rollbackTurn(state) {
  const staged = [...state.turnPlacements];
  state.turnPlacements = [];

  for (const a of staged) {
    if (a.type === 'recall' && a.tileSnapshot) {
      const t = a.tileSnapshot;
      putWord(state, t.r, t.c, state.dir, t.text, t.id, false);
    }
  }
  for (const a of staged) {
    if (a.type === 'place') {
      const { r, c, tile, origin } = a;
      const cell = state.grid[r][c];
      if (cell && cell.tileId === tile.id) {
        state.grid[r][c] = { text: null, tileId: null, seed: false };
      }
      state[origin].push(tile);
    }
  }
}

/* -------------------- helpers -------------------- */

function findTileInPools(state, tileId) {
  let ix = state.hand.findIndex(t => t.id === tileId);
  if (ix >= 0) return { pool: 'hand', index: ix };
  ix = state.reserve.findIndex(t => t.id === tileId);
  if (ix >= 0) return { pool: 'reserve', index: ix };
  return null;
}

function runContainsAll(run, placedSet) {
  if (run.dir === 'H') {
    for (const key of placedSet) {
      const [rr, cc] = key.split(',').map(Number);
      if (rr !== run.r || cc < run.c || cc > run.c + run.cells - 1) return false;
    }
    return true;
  } else {
    for (const key of placedSet) {
      const [rr, cc] = key.split(',').map(Number);
      if (cc !== run.c || rr < run.r || rr > run.r + run.cells - 1) return false;
    }
    return true;
  }
}

function ok(extra = {}) { return { ok: true, ...extra }; }
function fail(reason) { return { ok: false, reason }; }