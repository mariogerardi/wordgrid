/* shared/layout.js
   Grid sizing + responsive helpers used by the shell UI and editor.
   Derived from the legacy heuristics in main.js; comments retained for context.
*/

import {
  GRID_MIN_CELL,
  GRID_BASE_CELL_AT_3,
  GRID_BASE_CELL_AT_5,
  GRID_BASE_START_ABOVE_FIVE,
  GRID_BASE_DECAY_PER_SIZE,
  GRID_BASE_MIN,
  GRID_DEFAULT_GAP,
  GRID_WIDE_GAP,
  GRID_COMPACT_GAP,
  GRID_COMPACT_THRESHOLD,
  GRID_SPACIOUS_THRESHOLD,
  GRID_VERTICAL_MARGINS,
  GRID_MIN_AVAILABLE_HEIGHT,
  GRID_VIEWPORT_SIDE_PADDING,
  GRID_MAX_BOARD_WIDTH
} from './constants.js';

let activeResizeHandler = null;

/**
 * Set CSS variables for cell size/gap based on rows/cols and available width/height.
 * Base size scales down as boards get larger. Previously 56 for 7×7 —
 * reduce ~10% and keep tapering down toward 10×10.
 * 3×N → 96, 5×N → 72, 7×N → ~50, 8–10×N → ~48–46.
 */
export function setGridCellSize(rows, cols, opts = {}) {
  const {
    documentElement = document.documentElement,
    mountSelector = '#boardMount',
    toolbarSelector = '.game-toolbar',
    metaSelector = '.level-meta',
    traysSelector = '.trays--in-panel'
  } = opts;

  const maxDim = Math.max(Number(rows || 7), Number(cols || 7));

  let basePx;
  if (maxDim <= 3) {
    basePx = GRID_BASE_CELL_AT_3;
  } else if (maxDim <= 5) {
    basePx = GRID_BASE_CELL_AT_5;
  } else {
    const delta = maxDim - 5;
    basePx = Math.round(GRID_BASE_START_ABOVE_FIVE - (delta * GRID_BASE_DECAY_PER_SIZE));
    basePx = Math.max(GRID_BASE_MIN, basePx);
  }

  const baseGap = maxDim <= 3 ? GRID_WIDE_GAP : GRID_DEFAULT_GAP;

  const mount = document.querySelector(mountSelector);
  const viewportWidth = window.innerWidth || 1024;
  const mountWidth = mount?.clientWidth || Math.min(GRID_MAX_BOARD_WIDTH, viewportWidth - GRID_VIEWPORT_SIDE_PADDING);

  const viewportHeight = window.innerHeight || 768;
  const toolbarEl = document.querySelector(toolbarSelector);
  const toolbarH = (toolbarEl && toolbarEl.classList.contains('game-toolbar--overlay')) ? 0 : (toolbarEl?.offsetHeight || 0);
  const metaH = document.querySelector(metaSelector)?.offsetHeight || 0;
  const traysH = document.querySelector(traysSelector)?.offsetHeight || 0;
  const availableHeight = Math.max(GRID_MIN_AVAILABLE_HEIGHT, viewportHeight - toolbarH - metaH - traysH - GRID_VERTICAL_MARGINS);

  let gap = baseGap;
  const colsCount = Number(cols) || 1;
  const rowsCount = Number(rows) || 1;
  const maxCellFromWidth = Math.floor((mountWidth - (colsCount + 1) * baseGap - 2) / colsCount);
  const maxCellFromHeight = Math.floor((availableHeight - (rowsCount + 1) * baseGap - 2) / rowsCount);
  const rawCell = Math.min(maxCellFromWidth, maxCellFromHeight);

  const cellPx = Math.max(GRID_MIN_CELL, Math.min(basePx, rawCell));
  if (cellPx < GRID_COMPACT_THRESHOLD) gap = GRID_COMPACT_GAP;

  documentElement.style.setProperty('--cell', `${cellPx}px`);
  documentElement.style.setProperty('--gap', `${gap}px`);
  documentElement.classList.toggle('cells-compact', cellPx < GRID_COMPACT_THRESHOLD);
  documentElement.classList.toggle('cells-spacious', cellPx > GRID_SPACIOUS_THRESHOLD);
  documentElement.classList.remove('layout-side');
}

/** Attach a resize listener while in game/editor view; detach on navigation. */
export function enableResponsiveGrid(rows, cols, onResize, opts) {
  disableResponsiveGrid();
  const handler = () => {
    setGridCellSize(rows, cols, opts);
    if (typeof onResize === 'function') onResize(rows, cols);
  };
  activeResizeHandler = handler;
  window.addEventListener('resize', handler, { passive: true });
}

export function disableResponsiveGrid() {
  if (activeResizeHandler) {
    window.removeEventListener('resize', activeResizeHandler);
    activeResizeHandler = null;
  }
}
