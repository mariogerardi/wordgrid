/* engine/renderer.js — slots (hand:4, reserve:2), select→move, slot-based recall
   Updates in this patch:
   - Staged tiles cannot be moved to Reserve (hand only).
   - Submit always clears selections (hand + board), success or error.
   - Clicking a ghosted reserve tile cancels the staged recall and restores the tile.
*/

import {
  tryStagePlacement,
  moveStagedPlacement,
  returnStagedToPool,
  tryStageRecall,
  cancelStagedRecall,
  commitPlayTurn,
  rollbackTurn
} from './rules.js';

let _el = null;
let _state = null;

/** Track selected board tile */
let _selectedBoard = null; // { r, c, tileId, kind: 'staged'|'committed'|'seed' }

const HAND_SLOTS = 4;
const RESERVE_SLOTS = 2;

export function initUI(state, level, { onWin } = {}) {
  _state = state;
  _el = bindDOM();

  // Hide legacy Direction & Recall buttons
  if (_el.btnToggleDir) _el.btnToggleDir.style.display = 'none';
  if (_el.btnRecall) _el.btnRecall.style.display = 'none';
  if (_el.btnPlay) _el.btnPlay.textContent = 'Submit';

  // HUD init
  _el.hudPar.textContent = String(state.par ?? 7);
  _el.hudGoal.textContent = `(${state.goal.r}, ${state.goal.c})`;

  // --- Hand events (select tile OR click empty slot to return staged)
  _el.hand.addEventListener('click', (e) => {
    const tileEl = e.target.closest('.tile[data-id]');
    const slotEl = e.target.closest('.slot');

    if (tileEl) {
      const id = tileEl.dataset.id;
      _selectedBoard = null;
      _state.selectedTileId = (_state.selectedTileId === id) ? null : id;
      renderAll();
      return say(_state.selectedTileId
        ? `Selected "${getTileText(id)}". Click any empty cell to place.`
        : 'Selection cleared.'
      );
    }

    if (slotEl && slotEl.classList.contains('slot--empty')) {
      // Empty hand slot: if a staged board tile is selected, return it to HAND
      if (_selectedBoard?.kind === 'staged') {
        const { r, c } = _selectedBoard;
        const res = returnStagedToPool(_state, r, c, 'hand');
        if (!res.ok) return say(res.reason);
        _selectedBoard = null;
        renderAll();
        return say('Returned tile to hand.');
      }
      if (_selectedBoard?.kind === 'committed') {
        return say('Committed tiles can only be recalled to reserve.');
      }
    }
  });

  // --- Reserve events (select tile OR click empty slot for recall / NOT for staged)
  _el.reserve.addEventListener('click', (e) => {
    const tileEl = e.target.closest('.tile[data-id]');
    const slotEl = e.target.closest('.slot');

    if (tileEl) {
      const id = tileEl.dataset.id;

      if (tileEl.classList.contains('tile--ghost')) {
        // Cancel a staged recall
        const res = cancelStagedRecall(_state, id);
        if (!res.ok) return say(res.reason);
        _selectedBoard = null;
        _state.selectedTileId = null;
        renderAll();
        return say('Recall canceled; tile restored to board.');
      }

      // Real reserve tile: select for placement
      _selectedBoard = null;
      _state.selectedTileId = (_state.selectedTileId === id) ? null : id;
      renderAll();
      return say(_state.selectedTileId
        ? `Selected "${getTileText(id)}" from reserve. Click any empty cell to place.`
        : 'Selection cleared.'
      );
    }

    if (slotEl && slotEl.classList.contains('slot--empty')) {
      // Empty reserve slot:
      if (_selectedBoard?.kind === 'staged') {
        // Disallow staged→reserve per your rule
        return say('Only committed tiles can go to reserve (via recall).');
      }
      if (_selectedBoard?.kind === 'committed') {
        // Stage a recall of the committed tile into reserve (ghost until Submit)
        // (Capacity ultimately enforced on commit; UI will still show ghost)
        const res = tryStageRecall(_state, _selectedBoard.tileId);
        if (!res.ok) return say(res.reason);
        _selectedBoard = null;
        renderAll();
        return say('Staged recall to reserve. Submit to confirm.');
      }
    }
  });

  // --- Board click: place / select / move
  _el.board.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell[data-r][data-c]');
    if (!cell) return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    const cellData = _state.grid[r][c];

    // If a hand/reserve tile is selected, try to place it on empty cell
    if (_state.selectedTileId) {
      if (cellData?.text) return say('Cell is occupied.');
      const res = tryStagePlacement(_state, _state.selectedTileId, r, c);
      if (!res.ok) return say(res.reason);
      _state.selectedTileId = null;
      _selectedBoard = { r, c, tileId: _state.grid[r][c].tileId, kind: 'staged' };
      renderAll();
      return say('Tile placed. Click empty cells to move, or use hand slots to return.');
    }

    // No hand/reserve selection: manage board selection & movement
    const kind = boardTileKind(r, c);
    if (!kind) {
      // Empty cell — move a selected staged tile here
      if (_selectedBoard?.kind === 'staged') {
        const res = moveStagedPlacement(_state, _selectedBoard.tileId, r, c);
        if (!res.ok) return say(res.reason);
        _selectedBoard = { r, c, tileId: _state.grid[r][c].tileId, kind: 'staged' };
        renderAll();
        return say('Moved staged tile.');
      }
      return;
    }

    // Clicked a non-empty cell
    const tileId = cellData.tileId;
    _state.selectedTileId = null;
    _selectedBoard = { r, c, tileId, kind };
    renderBoard();

    if (kind === 'staged') {
      return say(`Selected staged "${String(cellData.text).toUpperCase()}". Click an empty cell to move, or click a hand slot to return.`);
    }
    if (kind === 'committed') {
      return say(`Selected committed "${String(cellData.text).toUpperCase()}". Click a reserve slot to stage recall, then Submit.`);
    }
    if (kind === 'seed') {
      _selectedBoard = null;
      renderBoard();
      return say('Seed tiles are fixed and cannot be moved.');
    }
  });

  // --- Submit: commits play OR recall; always clears selections
  _el.btnPlay.addEventListener('click', () => {
    // Clear selections on every submit (requested behavior)
    _state.selectedTileId = null;
    _selectedBoard = null;

    const res = commitPlayTurn(_state); // will auto-delegate to recall if only recalls are staged
    renderAll();
    if (!res.ok) return say(res.reason); // staged state remains; selections already cleared
    if (res.win) {
      say('🎉 Puzzle complete!');
      disableControls(true);
      if (typeof onWin === 'function') onWin({ state: _state, level });
    } else {
      say('Move accepted.');
    }
  });

  // --- Reset staged actions (does not undo committed board)
  _el.btnReset.addEventListener('click', () => {
    _state.selectedTileId = null; _selectedBoard = null;
    rollbackTurn(_state);
    renderAll();
    say('Turn reset (staged placements/recalls cleared).');
  });

  renderAll();
  say('Select from hand/reserve to place; select a board tile to move; use hand slots to return or reserve slots to stage recalls.');
  return { rerender: renderAll, elements: _el };
}

/* Back-compat for main.js */
export const __patchRendererForShim = initUI;

/* ---------- DOM helpers & renderers ---------- */

function bindDOM() {
  const get = (id) => {
    const n = document.getElementById(id);
    if (!n) throw new Error(`Missing DOM node #${id}`);
    return n;
  };
  return {
    board: get('boardMount'),
    hand: get('handMount'),
    reserve: get('reserveMount'),
    btnPlay: get('btnPlay'),
    btnRecall: get('btnRecall'),
    btnReset: get('btnReset'),
    btnToggleDir: get('btnToggleDir'),
    msg: get('messages'),
    hudTurn: get('hudTurn'),
    hudPar: get('hudPar'),
    hudGoal: get('hudGoal'),
  };
}

function renderAll() {
  renderBoard();
  renderHand();
  renderReserve();
  renderHUD();
  disableControls(false);
}

function renderBoard() {
  const N = _state.size;
  const root = document.createElement('div');
  root.className = 'board';
  root.style.setProperty('--cols', N);
  root.style.setProperty('--rows', N);

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cellEl = document.createElement('div');
      cellEl.className = 'cell';
      cellEl.dataset.r = r;
      cellEl.dataset.c = c;

      const cur = _state.grid[r][c];
      if (r === _state.goal.r && c === _state.goal.c) cellEl.classList.add('cell--goal');
      if (cur.seed) cellEl.classList.add('cell--seed');

      if (_selectedBoard && _selectedBoard.r === r && _selectedBoard.c === c) {
        cellEl.classList.add('cell--selected');
      }

      if (cur.special === 'blocked') cellEl.classList.add('cell--blocked');

      cellEl.textContent = cur.text ? String(cur.text).toUpperCase() : '';
      root.appendChild(cellEl);
    }
  }
  _el.board.replaceChildren(root);
}

function renderHand() {
  const wrap = document.createElement('div');
  wrap.className = 'tiles tiles--with-slots';
  const tiles = _state.hand;

  for (let i = 0; i < HAND_SLOTS; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    if (i < tiles.length) {
      const t = tiles[i];
      const div = document.createElement('div');
      div.className = 'tile';
      div.dataset.id = t.id;
      if (_state.selectedTileId === t.id) div.classList.add('tile--selected');
      div.textContent = t.text.toUpperCase();
      slot.appendChild(div);
    } else {
      slot.classList.add('slot--empty');
      slot.textContent = '—';
    }
    wrap.appendChild(slot);
  }
  _el.hand.replaceChildren(wrap);
}

function renderReserve() {
  const wrap = document.createElement('div');
  wrap.className = 'tiles tiles--with-slots';

  const real = [..._state.reserve];
  const ghosts = _state.turnPlacements
    .filter(a => a.type === 'recall')
    .map(a => a.tileSnapshot);

  const items = [...real, ...ghosts];

  for (let i = 0; i < RESERVE_SLOTS; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    const t = items[i];

    if (t) {
      const div = document.createElement('div');
      div.className = 'tile';
      div.dataset.id = t.id; // give an id for both real and ghost
      if (i >= real.length) div.classList.add('tile--ghost'); // staged recall ghost
      if (_state.selectedTileId === t.id) div.classList.add('tile--selected'); // selecting real reserves
      div.textContent = String(t.text).toUpperCase();
      slot.appendChild(div);
    } else {
      slot.classList.add('slot--empty');
      slot.textContent = '—';
    }
    wrap.appendChild(slot);
  }

  _el.reserve.replaceChildren(wrap);
}

function renderHUD() { _el.hudTurn.textContent = String(_state.turn); }

function disableControls(yes) {
  _el.btnPlay.disabled = !!yes;
  if (_el.btnRecall) _el.btnRecall.disabled = true;
  _el.btnReset.disabled = !!yes;
}

function say(msg) { _el.msg.textContent = msg || ''; }

/* ---------- helpers ---------- */

function boardTileKind(r, c) {
  const cell = _state.grid[r][c];
  if (!cell?.tileId) return '';
  if (String(cell.tileId).startsWith('__SEED__')) return 'seed';
  const staged = _state.turnPlacements.some(
    a => a.type === 'place' && a.tile.id === cell.tileId && a.r === r && a.c === c
  );
  if (staged) return 'staged';
  if (_state.placed.has(cell.tileId)) return 'committed';
  return '';
}

function getTileText(id) {
  const inHand = _state.hand.find(x => x.id === id);
  if (inHand) return inHand.text.toUpperCase();
  const inRes = _state.reserve.find(x => x.id === id);
  return inRes ? inRes.text.toUpperCase() : '';
}