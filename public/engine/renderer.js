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
let _dragPayload = null; // fallback payload for dragover
let _dragImageEl = null; // temporary ghost element for nicer cursor image

/** Track selected board tile */
let _selectedBoard = null; // { r, c, tileId, kind: 'staged'|'committed'|'seed' }
let _boardEl = null;       // persistent grid element to avoid re-creating cells
let _cellRefs = [];        // 2D array of cell elements [r][c]

const HAND_SLOTS = 4;
const RESERVE_SLOTS = 2;

export function initUI(state, level, { onWin } = {}) {
  _state = state;
  _el = bindDOM();
  // Ensure no lingering selections from previous puzzles carry over
  _selectedBoard = null;
  _state.selectedTileId = null;
  // Reset cached board DOM so re-entering a puzzle mounts correctly
  _boardEl = null;
  _cellRefs = [];

  // Hide legacy Direction & Recall buttons
  if (_el.btnToggleDir) _el.btnToggleDir.style.display = 'none';
  if (_el.btnRecall) _el.btnRecall.style.display = 'none';
  if (_el.btnPlay) _el.btnPlay.textContent = 'Submit';

  // No HUD (removed)
  _dragPayload = null;
  if (_dragImageEl) { try { _dragImageEl.remove(); } catch {} _dragImageEl = null; }
  window.addEventListener('dragend', () => {
    _dragPayload = null;
    if (_dragImageEl) { try { _dragImageEl.remove(); } catch {} _dragImageEl = null; }
  }, { passive: true });

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

  // Hand DnD: allow dropping staged board tile back into hand
  _el.hand.addEventListener('dragover', (e) => {
    const slotEl = e.target.closest('.slot');
    const data = getDrag();
    if (!slotEl || !data) return;
    if (data.origin === 'board-staged') {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch {}
    }
  });
  _el.hand.addEventListener('drop', (e) => {
    const slotEl = e.target.closest('.slot');
    const data = getDragData(e);
    if (!slotEl || !data) return;
    if (data.origin === 'board-staged') {
      const res = returnStagedToPool(_state, data.r, data.c, 'hand');
      if (!res.ok) return say(res.reason);
      _selectedBoard = null; _state.selectedTileId = null;
      renderAll();
      say('Returned tile to hand.');
      e.preventDefault();
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

  // Reserve DnD: drop committed board tile to stage recall
  _el.reserve.addEventListener('dragover', (e) => {
    const slotEl = e.target.closest('.slot');
    const data = getDrag();
    if (!slotEl || !data) return;
    if (data.origin === 'board-committed') { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch {} }
    if (data.origin === 'board-staged') { e.preventDefault(); try { e.dataTransfer.dropEffect = 'none'; } catch {} }
  });
  _el.reserve.addEventListener('drop', (e) => {
    const slotEl = e.target.closest('.slot');
    const data = getDragData(e);
    if (!slotEl || !data) return;
    if (data.origin === 'board-staged') { return say('Only committed tiles can go to reserve (via recall).'); }
    if (data.origin === 'board-committed') {
      const res = tryStageRecall(_state, data.tileId);
      if (!res.ok) return say(res.reason);
      _selectedBoard = null; _state.selectedTileId = null;
      renderAll();
      say('Staged recall to reserve. Submit to confirm.');
      e.preventDefault();
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

  // Board DnD: place from hand/reserve, or move staged
  _el.board.addEventListener('dragover', (e) => {
    const cell = e.target.closest('.cell[data-r][data-c]');
    const data = getDrag();
    if (!cell || !data) return;
    if (data.origin === 'hand' || data.origin === 'reserve' || data.origin === 'board-staged') {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = (data.origin === 'board-staged') ? 'move' : 'copy'; } catch {}
    }
  });
  _el.board.addEventListener('drop', (e) => {
    const cell = e.target.closest('.cell[data-r][data-c]');
    const data = getDragData(e);
    if (!cell || !data) return;
    const r = Number(cell.dataset.r), c = Number(cell.dataset.c);
    if (data.origin === 'hand' || data.origin === 'reserve') {
      const res = tryStagePlacement(_state, data.tileId, r, c);
      if (!res.ok) return say(res.reason);
      _state.selectedTileId = null;
      _selectedBoard = { r, c, tileId: _state.grid[r][c].tileId, kind: 'staged' };
      renderAll();
      say('Tile placed.');
      e.preventDefault();
      return;
    }
    if (data.origin === 'board-staged') {
      const res = moveStagedPlacement(_state, data.tileId, r, c);
      if (!res.ok) return say(res.reason);
      _selectedBoard = { r, c, tileId: _state.grid[r][c].tileId, kind: 'staged' };
      renderAll();
      say('Moved staged tile.');
      e.preventDefault();
      return;
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
      // Completion message based on par performance
      // state.turn is incremented on commit, so subtract 1 to get attempts used
      const used = Math.max(1, _state.turn - 1);
      const par = _state.par ?? 0;
      let perf = '';
      if (par > 0) {
        const diff = used - par;
        if (diff < 0) perf = `Under par by ${Math.abs(diff)}!`;
        else if (diff === 0) perf = `Right at par (${par}).`;
        else perf = `Over par by ${diff}.`;
      }
      say(`🎉 Puzzle complete! ${perf}`.trim());
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
  // Intro status: prefer level.intro if provided, else show generic guidance
  const introMsg = (level?.intro || '').trim();
  if (introMsg) {
    say(introMsg);
  } else {
    say('Select from hand/reserve to place; select a board tile to move; use hand slots to return or reserve slots to stage recalls.');
  }
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
    board: get('boardRoot'),
    hand: get('handMount'),
    reserve: get('reserveMount'),
    btnPlay: get('btnPlay'),
    btnRecall: get('btnRecall'),
    btnReset: get('btnReset'),
    btnToggleDir: get('btnToggleDir'),
    msg: get('messages'),
  };
}

function renderAll() {
  renderBoard();
  renderHand();
  renderReserve();
  disableControls(false);
}

function renderBoard() {
  const R = _state.rows, C = _state.cols;
  const scaleClass = `board--${Math.max(R, C)}`;

  // Build once (or on size change) so CSS animations on cells don't restart
  const mustBuild = !_boardEl || Number(_boardEl.dataset.rows || 0) !== R || Number(_boardEl.dataset.cols || 0) !== C;
  if (mustBuild) {
    _boardEl = document.createElement('div');
    _boardEl.className = `board ${scaleClass}`;
    _boardEl.dataset.rows = String(R);
    _boardEl.dataset.cols = String(C);
    _boardEl.style.setProperty('--cols', C);
    _boardEl.style.setProperty('--rows', R);

    _cellRefs = Array.from({ length: R }, () => Array.from({ length: C }, () => null));
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const cellEl = document.createElement('div');
        cellEl.className = 'cell';
        cellEl.dataset.r = r;
        cellEl.dataset.c = c;
        _cellRefs[r][c] = cellEl;
        _boardEl.appendChild(cellEl);
      }
    }
    _el.board.replaceChildren(_boardEl);
  } else {
    // Update board container scale/vars if needed
    _boardEl.className = `board ${scaleClass}`;
    _boardEl.style.setProperty('--cols', C);
    _boardEl.style.setProperty('--rows', R);
  }

  // Update each cell in-place
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const cellEl = _cellRefs[r][c];
      const cur = _state.grid[r][c];

      // Reset base class
      cellEl.className = 'cell';
      if (r === _state.goal.r && c === _state.goal.c) cellEl.classList.add('cell--goal');
      if (cur.seed) cellEl.classList.add('cell--seed');
      if (cur.text && !cur.seed) cellEl.classList.add('cell--filled');
      if (_selectedBoard && _selectedBoard.r === r && _selectedBoard.c === c) cellEl.classList.add('cell--selected');
      if (cur.special === 'blocked') cellEl.classList.add('cell--blocked');
      if (cur.special === 'portal') {
        cellEl.classList.add('cell--portal');
        const gid = _state.portalAt?.[r]?.[c];
        if (gid) cellEl.classList.add(`cell--portal-${gid}`);
      }

      // Clear existing children and draggable attributes
      cellEl.textContent = '';
      cellEl.removeAttribute('draggable');
      cellEl.ondragstart = null;
      cellEl.ondragend = null;

      // Text content or projection
      const overlayText = (!cur.text && _state.portalAt?.[r]?.[c]) ? getPortalOverlayTextLocal(_state, r, c) : '';
      if (cur.text || overlayText) {
        const span = document.createElement('span');
        span.className = 'cell__text';
        span.textContent = String(cur.text || overlayText).toUpperCase();
        cellEl.appendChild(span);
        const kind = boardTileKind(r, c);
        if (cur.text && (kind === 'staged' || kind === 'committed')) {
          cellEl.setAttribute('draggable', 'true');
          cellEl.ondragstart = (ev) => {
            setDragData(ev, {
              origin: (kind === 'staged') ? 'board-staged' : 'board-committed',
              tileId: cur.tileId,
              r, c
            });
          };
          cellEl.ondragend = () => { renderAll(); };
        }
        if (!cur.text && overlayText) cellEl.classList.add('cell--projection');
      }

      // A1 coordinate label for non-blocked cells
      if (cur.special !== 'blocked') {
        const coordEl = document.createElement('span');
        coordEl.className = 'cell__coord';
        coordEl.textContent = toA1(r, c);
        cellEl.appendChild(coordEl);
      }
    }
  }
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
      // DnD from hand to board
      div.setAttribute('draggable', 'true');
      div.addEventListener('dragstart', (ev) => {
        useTileDragImage(ev, t.text);
        setDragData(ev, { origin: 'hand', tileId: t.id });
        // Hide origin while dragging so it looks like you picked it up
        div.classList.add('tile--dragging');
      });
      div.addEventListener('dragend', () => {
        div.classList.remove('tile--dragging');
        // If drop was canceled, ensure UI restores
        renderAll();
      });
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
      // DnD from reserve (real only)
      if (i < real.length) {
        div.setAttribute('draggable', 'true');
        div.addEventListener('dragstart', (ev) => {
          useTileDragImage(ev, t.text);
          setDragData(ev, { origin: 'reserve', tileId: t.id });
          div.classList.add('tile--dragging');
        });
        div.addEventListener('dragend', () => {
          div.classList.remove('tile--dragging');
          renderAll();
        });
      }
      slot.appendChild(div);
    } else {
      slot.classList.add('slot--empty');
      slot.textContent = '—';
    }
    wrap.appendChild(slot);
  }

  _el.reserve.replaceChildren(wrap);
}

// HUD removed

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

function getPortalOverlayTextLocal(state, r, c) {
  const gid = state.portalAt?.[r]?.[c];
  if (!gid) return '';
  if (state.grid[r][c]?.text) return '';
  const cells = state.portalGroups?.get?.(gid) || [];
  for (const pos of cells) {
    const t = state.grid[pos.r][pos.c]?.text;
    if (t) return String(t);
  }
  return '';
}

// Convert r,c (0-based) → A1-style label (columns A–Z, rows 1..)
function toA1(r, c){
  // Supports up to 26 columns; product currently ≤10
  const col = String.fromCharCode(65 + c);
  return `${col}${r + 1}`;
}
// DnD helpers
function setDragData(ev, data) {
  _dragPayload = data;
  try { ev.dataTransfer.setData('application/json', JSON.stringify(data)); } catch {}
  try { ev.dataTransfer.setData('text/plain', JSON.stringify(data)); } catch {}
  ev.dataTransfer.effectAllowed = 'copyMove';
}
function getDragData(ev) {
  try {
    const s = ev.dataTransfer.getData('application/json') || ev.dataTransfer.getData('text/plain');
    return s ? JSON.parse(s) : _dragPayload;
  } catch { return _dragPayload; }
}
function getDrag() { return _dragPayload; }

function useTileDragImage(ev, text) {
  try {
    // Clean any prior ghost
    if (_dragImageEl) { _dragImageEl.remove(); _dragImageEl = null; }
    const g = document.createElement('div');
    g.className = 'tile tile--drag-ghost';
    g.textContent = String(text || '').toUpperCase();
    document.body.appendChild(g);
    // Ensure it's laid out so we can center the drag hotspot
    const rect = g.getBoundingClientRect();
    const ox = Math.floor(rect.width / 2);
    const oy = Math.floor(rect.height / 2);
    ev.dataTransfer.setDragImage(g, ox, oy);
    _dragImageEl = g;
  } catch {}
}
