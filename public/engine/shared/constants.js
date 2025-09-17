/* shared/constants.js
   Canonical numeric limits shared across the engine.
   Keep gameplay-affecting values centralized here so UI/state/rules stay in sync.
*/

export const BOARD_MIN = 1;
export const BOARD_MAX = 10;
export const DEFAULT_BOARD_SIZE = 7;
export const DEFAULT_PAR = 7;

export const HAND_SLOTS = 4;
export const RESERVE_SLOTS = 2;

// Persistence + routing helpers shared with the shell UI.
export const LS_KEY = 'gridl_progress_v1';
export const DAILY_EXCLUDE = ['101', '102', '103', '104', '105'];
export const DAILY_FALLBACK_LEVEL = '106';

// Grid sizing heuristics (UI only; gameplay unaffected).
export const GRID_MIN_CELL = 44;
export const GRID_BASE_CELL_AT_3 = 96;
export const GRID_BASE_CELL_AT_5 = 60;
export const GRID_BASE_CELL_AT_7 = 50; // historical anchor for 7×7 boards
export const GRID_BASE_START_ABOVE_FIVE = 56;
export const GRID_BASE_DECAY_PER_SIZE = 3; // px drop per +1 board size above 5
export const GRID_BASE_MIN = 46; // keep roomy enough even on 10×10
export const GRID_DEFAULT_GAP = 6;
export const GRID_WIDE_GAP = 8;
export const GRID_COMPACT_GAP = 4;
export const GRID_COMPACT_THRESHOLD = 54;
export const GRID_SPACIOUS_THRESHOLD = 84;
export const GRID_VERTICAL_MARGINS = 64;
export const GRID_MIN_AVAILABLE_HEIGHT = 160;
export const GRID_VIEWPORT_SIDE_PADDING = 48;
export const GRID_MAX_BOARD_WIDTH = 920;
