/* engine/rules.js — tile-per-cell (slots; no Recall button)
   Additions in this patch:
   - returnStagedToPool(): disallow returning staged tiles to reserve
   - cancelStagedRecall(): revert a staged recall by tileId
*/

import {
  fits, putWord, removeWord, extractRuns, boardValid,
  dealToHand, coversGoal, getPortalOverlayText, boardInvalidReason,
  runCellsA1, formatCellsList, toA1, groupCells
} from './state.js';
import { HAND_SLOTS, RESERVE_SLOTS } from './shared/constants.js';

export function toggleDir(state) { state.dir = state.dir === 'H' ? 'V' : 'H'; return state.dir; }
export function setMode(state, mode) { if (state.mode !== mode) rollbackTurn(state); state.mode = mode; }

/* -------------------- Staging actions -------------------- */

export function tryStagePlacement(state, tileId, r, c) {
  const found = findTileInPools(state, tileId);
  if (!found) return fail('Tile not in hand or reserve.');
  if (!fits(state, r, c)) return fail('That cell is outside the board.');
  if (isBlocked(state, r, c)) return fail('That cell is blocked.');
  if (getPortalOverlayText(state, r, c)) return fail('That cell is occupied by a portal projection.');
  if (state.grid[r][c].text) return fail('That cell already has a tile.');

  // Enforce "one straight line per turn" for staged placements
  const staged = state.turnPlacements.filter(a => a.type === 'place');
  if (staged.length > 0) {
    const axis = turnAxis(staged);
    if (!axis) {
      const a = staged[0];
      if (r !== a.r && c !== a.c) {
        const col = String.fromCharCode(65 + a.c);
        const a1 = toA1(a.r, a.c);
        const txt = String(a.tile?.text || '').toUpperCase();
        return fail(`Since you already placed "${txt}" on ${a1}, you must either continue on row ${a.r + 1} or column ${col}.`);
      }
    } else if (axis.kind === 'row' && r !== axis.r) {
      return fail(`This turn runs along row ${axis.r + 1}. Place on that row.`);
    } else if (axis.kind === 'col' && c !== axis.c) {
      const col = String.fromCharCode(65 + axis.c);
      return fail(`This turn runs along column ${col}. Place on that column.`);
    }
  }

  const { pool, index } = found;
  const tile = state[pool][index];

  putWord(state, r, c, state.dir, tile.text, tile.id, false);
  state.turnPlacements.push({ type: 'place', tile, r, c, origin: pool });
  state[pool].splice(index, 1);
  return ok();
}

export function moveStagedPlacement(state, tileId, toR, toC) {
  const act = state.turnPlacements.find(a => a.type === 'place' && a.tile.id === tileId);
  if (!act) return fail('That tile isn’t currently staged.');
  if (!fits(state, toR, toC)) return fail('That cell is outside the board.');
  if (isBlocked(state, toR, toC)) return fail('That cell is blocked.');
   // prevent moving onto a portal projection
  if (getPortalOverlayText(state, toR, toC)) return fail('That cell is occupied by a portal projection.');
  if (state.grid[toR][toC].text) return fail('That cell already has a tile.');

  // Enforce axis when moving a staged tile (relative to other staged placements)
  const stagedOthers = state.turnPlacements.filter(a => a.type === 'place' && a.tile.id !== tileId);
  if (stagedOthers.length > 0) {
    const axis = turnAxis(stagedOthers);
    if (!axis) {
      const a = stagedOthers[0];
      if (toR !== a.r && toC !== a.c) {
        const col = String.fromCharCode(65 + a.c);
        const a1 = toA1(a.r, a.c);
        const txt = String(a.tile?.text || '').toUpperCase();
        return fail(`Since you already placed "${txt}" on ${a1}, you must either continue on row ${a.r + 1} or column ${col}.`);
      }
    } else if (axis.kind === 'row' && toR !== axis.r) {
      return fail(`This turn runs along row ${axis.r + 1}. Place on that row.`);
    } else if (axis.kind === 'col' && toC !== axis.c) {
      const col = String.fromCharCode(65 + axis.c);
      return fail(`This turn runs along column ${col}. Place on that column.`);
    }
  }

  const from = state.grid[act.r][act.c];
  if (from && from.tileId === tileId) state.grid[act.r][act.c] = { text: null, tileId: null, seed: false };

  putWord(state, toR, toC, state.dir, act.tile.text, act.tile.id, false);
  act.r = toR; act.c = toC;
  return ok();
}

/** Return a STAGED placement to a pool slot. Staged → hand OK; staged → reserve NOT allowed. */
export function returnStagedToPool(state, r, c, pool) {
  if (pool !== 'hand' && pool !== 'reserve') return fail('Only hand or reserve slots are valid.');
  const cell = state.grid[r][c];
  if (!cell?.tileId) return fail('Nothing to return in that cell.');
  const tileId = cell.tileId;
  if (String(tileId).startsWith('__SEED__')) return fail('Seed tiles are fixed and cannot be moved.');
  if (state.placed.has(tileId)) return fail('Committed tiles must be recalled; they can’t be returned to hand.');

  // Disallow putting staged tiles into reserve
  if (pool === 'reserve') return fail('You can only add to reserve by recalling committed tiles.');

  const ix = state.turnPlacements.findIndex(a => a.type === 'place' && a.tile.id === tileId && a.r === r && a.c === c);
  if (ix < 0) return fail('Tile is not staged.');

  const act = state.turnPlacements.splice(ix, 1)[0];
  removeWord(state, { id: tileId, r, c, text: act.tile.text });
  state[pool].push(act.tile);
  return ok();
}

/** Stage a RECALL of a COMMITTED tile by tileId (reserve cap enforced on submit UI). */
export function tryStageRecall(state, tileId) {
  const tile = state.placed.get(tileId);
  if (!tile) return fail('That tile is not committed on the board.');
  if (String(tileId).startsWith('__SEED__')) return fail('Seed tiles cannot be recalled.');

  // Visual remove now; validate on submit
  removeWord(state, tile);
  state.turnPlacements.push({ type: 'recall', tileSnapshot: { ...tile } });
  return ok();
}

/** Cancel a staged recall by clicking its ghost in reserve. */
export function cancelStagedRecall(state, tileId) {
  const ix = state.turnPlacements.findIndex(a => a.type === 'recall' && a.tileSnapshot.id === tileId);
  if (ix < 0) return fail('No staged recall found for that tile.');
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
  if (placements.length > 0 && recalls.length > 0) return fail('You can place or recall in a single submit, not both.');

  if (placements.length === 0) {
    return commitRecallTurn(state);
  }

  // Identify candidate carrier runs for this turn. A placement on a portal
  // may form its primary word via its projection, so consider portal group
  // cells as valid positions for containment.
  const carriers = extractRuns(state).filter(run => run.cells >= 2 && runContainsPlacements(state, run, placements));

  let primary = null;
  if (placements.length === 1) {
    // Single-tile turn: allow crossings. If one or more carrier runs exist,
    // they must all be allowed; otherwise fall back to single-tile rule.
    if (carriers.length >= 1) {
      const disallowed = carriers.find(r => !state.allow.has(r.text));
      if (disallowed) {
        const cells = runCellsA1(disallowed);
        return fail(`The word "${disallowed.text.toUpperCase()}" is not allowed (cells ${formatCellsList(cells)}).`);
      }
      primary = carriers[0]; // arbitrary; board validation will check all
    } else {
      // No multi-cell run; the tile must be allowed to stand alone
      const p = placements[0];
      const txt = String(p.tile.text).toLowerCase();
      if (!state.allow.has(txt)) {
        return fail(`The tile "${String(p.tile.text).toUpperCase()}" is not allowed to stand alone (cell ${toA1(p.r, p.c)}).`);
      }
      primary = { dir: 'H', r: p.r, c: p.c, cells: 1, text: txt };
    }
  } else {
    // Multi-tile turn: must be exactly one carrier run.
    if (carriers.length !== 1) {
      return fail('All tiles placed this turn must connect to form a single continuous word.');
    }
    primary = carriers[0];
    if (!state.allow.has(primary.text)) {
      const cells = runCellsA1(primary);
      return fail(`The word "${primary.text.toUpperCase()}" is not allowed (cells ${formatCellsList(cells)}).`);
    }
  }

  const reason = boardInvalidReason(state);
  if (reason) return fail(reason);

  for (const p of placements) {
    state.placed.set(p.tile.id, { id: p.tile.id, text: p.tile.text, r: p.r, c: p.c });
  }

  state.turnPlacements = [];
  state.turn += 1;
  dealToHand(state, HAND_SLOTS);
  return ok({ win: coversGoal(state) });
}

export function commitRecallTurn(state) {
  const recalls = state.turnPlacements.filter(a => a.type === 'recall');
  const placements = state.turnPlacements.filter(a => a.type === 'place');
  if (recalls.length === 0 && placements.length === 0) return fail('Nothing to submit.');
  if (recalls.length > 0 && placements.length > 0) return fail('You can place or recall in a single submit, not both.');

  // Enforce reserve cap at commit: current reserve + staged recalls ≤ 2
  if (state.reserve.length + recalls.length > RESERVE_SLOTS) return fail(`Reserve is full (max ${RESERVE_SLOTS}).`);

  const reason = boardInvalidReason(state);
  if (reason) {
    rollbackTurn(state);
    return fail(`Recall would leave an invalid board: ${reason}`);
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

function isBlocked(state, r, c) {
  const cell = state.grid?.[r]?.[c];
  return !!cell && cell.special === 'blocked';
}

function findTileInPools(state, tileId) {
  let ix = state.hand.findIndex(t => t.id === tileId);
  if (ix >= 0) return { pool: 'hand', index: ix };
  ix = state.reserve.findIndex(t => t.id === tileId);
  if (ix >= 0) return { pool: 'reserve', index: ix };
  return null;
}

function runContainsPlacements(state, run, placements) {
  const inRun = (r, c) => {
    if (run.dir === 'H') return r === run.r && c >= run.c && c <= run.c + run.cells - 1;
    return c === run.c && r >= run.r && r <= run.r + run.cells - 1;
  };
  for (const p of placements) {
    if (inRun(p.r, p.c)) continue;
    const gid = state.portalAt?.[p.r]?.[p.c];
    if (!gid) return false;
    const cells = groupCells(state, gid);
    let ok = false;
    for (const pos of cells) { if (inRun(pos.r, pos.c)) { ok = true; break; } }
    if (!ok) return false;
  }
  return true;
}

// Determine axis for current staged placements (all 'place' acts)
function turnAxis(staged) {
  if (staged.length < 2) return null;
  const sameRow = staged.every(p => p.r === staged[0].r);
  if (sameRow) return { kind: 'row', r: staged[0].r };
  const sameCol = staged.every(p => p.c === staged[0].c);
  if (sameCol) return { kind: 'col', c: staged[0].c };
  return null;
}

function ok(extra = {}) { return { ok: true, ...extra }; }
function fail(reason) { return { ok: false, reason }; }
