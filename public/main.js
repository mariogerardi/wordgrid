/* wordgrid • main.js (mini SPA + engine + packs.json)
   Routes:
     #/                     → Home menu
     #/play                 → Pack select
     #/play/tutorial        → Tutorial pack (10 puzzles; only #1 unlocked)
     #/play/level/001       → Launch current puzzle via engine

   Requires:
     - /packs.json
     - /levels/level-001.json  (and future levels)
*/

import { loadLevel } from './engine/levelLoader.js';
import { initState, startLevel } from './engine/state.js';
import { makeValidatorFromLevel, applyValidatorToState } from './engine/validator.js';
import { __patchRendererForShim as initUI } from './engine/renderer.js';

/* ---------------- Packs data (fetched with fallback) ---------------- */

let PACKS_DB = null;

async function loadPacks() {
  if (PACKS_DB) return PACKS_DB;
  try {
    const res = await fetch('./packs.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`packs.json ${res.status}`);
    const json = await res.json();
    PACKS_DB = normalizePacks(json);
  } catch (e) {
    console.warn('[packs] falling back due to:', e);
    PACKS_DB = normalizePacks({
      packs: [{
        id: 'tutorial',
        name: 'Tutorial',
        description: 'Learn the basics with guided puzzles.',
        puzzles: [
          { id: '001', name: 'Waste Not', unlocked: true },
          { id: '002', name: 'Coming soon', unlocked: false },
          { id: '003', name: 'Coming soon', unlocked: false },
          { id: '004', name: 'Coming soon', unlocked: false },
          { id: '005', name: 'Coming soon', unlocked: false },
          { id: '006', name: 'Coming soon', unlocked: false },
          { id: '007', name: 'Coming soon', unlocked: false },
          { id: '008', name: 'Coming soon', unlocked: false },
          { id: '009', name: 'Coming soon', unlocked: false },
          { id: '010', name: 'Coming soon', unlocked: false }
        ]
      }]
    });
  }
  return PACKS_DB;
}

function normalizePacks(raw) {
  const byId = {};
  const list = Array.isArray(raw?.packs) ? raw.packs : [];
  for (const p of list) byId[p.id] = p;
  return { list, byId };
}

/* ---------------- Tiny router ---------------- */

const routes = [
  { match: /^#\/?$/, view: HomeView },
  { match: /^#\/play\/?$/, view: PacksView },
  { match: /^#\/play\/([a-z0-9-]+)\/?$/, view: PackView },        // <— dynamic pack route
  { match: /^#\/play\/level\/(\d{3})\/?$/, view: GameView },
  { match: /^#\/how\/?$/, view: HowToPlayView }
];

function route() {
  const hash = location.hash || '#/';
  // Clean up any game-only listeners as we change screens
  disableResponsiveGrid();

  for (const r of routes) {
    const m = hash.match(r.match);
    if (m) { r.view(m); return; }
  }
  location.hash = '#/';
}


window.addEventListener('hashchange', route);
window.addEventListener('load', route);

/* ---------------- Shared DOM helpers ---------------- */

let _resizeHandler = null;

/** Set CSS variables for cell size/gap based on N and available width. */
function setGridCellSize(N) {
  // Base “nice” sizes by difficulty
  const basePx = (N <= 3) ? 96 : (N <= 5) ? 72 : 56;   // 3x3 biggest, 7x7 smallest
  const baseGap = (N <= 3) ? 10 : (N <= 5) ? 8 : 8;

  // Fit within the board mount width (minus padding/gaps) for responsiveness
  const mount = document.getElementById('boardMount');
  const vw = window.innerWidth || 1024;
  const mountWidth = (mount?.clientWidth || Math.min(920, vw - 48));
  // leave some breathing room for gaps and the board’s own padding
  const gap = baseGap;
  const maxCellFromWidth = Math.floor((mountWidth - (N + 1) * gap - 2 /*border fudge*/) / N);

  // Final cell = min(base, from width), but not below 44px
  const cellPx = Math.max(44, Math.min(basePx, maxCellFromWidth));

  document.documentElement.style.setProperty('--cell', `${cellPx}px`);
  document.documentElement.style.setProperty('--gap', `${gap}px`);
}

/** Attach a resize listener while in game view; detach on navigation. */
function enableResponsiveGrid(N) {
  disableResponsiveGrid(); // remove any prior
  _resizeHandler = () => setGridCellSize(N);
  window.addEventListener('resize', _resizeHandler, { passive: true });
}
function disableResponsiveGrid() {
  if (_resizeHandler) window.removeEventListener('resize', _resizeHandler);
  _resizeHandler = null;
}

const app = () => document.getElementById('app');
const hudRow = () => document.querySelector('header .hud');

function showHUD(on) {
  const row = hudRow();
  if (row) row.style.display = on ? '' : 'none';
}

/* ---------------- Views ---------------- */

function HomeView() {
  showHUD(false);
  app().innerHTML = `
    <section class="section" style="text-align:center; padding:28px 20px;">
      <h1 style="margin:0 0 8px;">wordgrid</h1>
      <p style="color:#475366; margin:0 0 18px;">Build words. Reach the goal.</p>
      <div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
        <a class="btn btn--primary" href="#/play">Play</a>
        <a class="btn" href="#/how">How to Play</a>
        <a class="btn" href="#/achievements">Achievements</a>
        <a class="btn" href="#/themes">Themes</a>
        <a class="btn" href="#/settings">Settings</a>
      </div>
    </section>
  `;
  injectButtonStylesOnce();
}

async function PacksView() {
  showHUD(false);
  const packs = await loadPacks();

  const htmlCard = (p) => `
    <a class="pack-card" href="#/play/${p.id}">
      <div class="pack-card__title">${p.name}</div>
      <div class="pack-card__desc">${p.description || ''}</div>
      <div class="pack-card__tag ${p.id==='tutorial' ? '' : 'pack-card__tag--unlocked'}">
        ${p.id==='tutorial' ? 'Guide' : 'Unlocked'}
      </div>
    </a>
  `;

  app().innerHTML = `
    <section class="section">
      <h2 style="margin:0 0 8px;">Choose a pack</h2>
      <div class="pack-grid">
        ${packs.list.map(htmlCard).join('')}
      </div>
      <div style="margin-top:12px;">
        <a class="link" href="#/">← Back</a>
      </div>
    </section>
  `;
  injectMenuCSSOnce();
}

async function PackView(match) {
  showHUD(false);
  const packId = match[1];
  const packs = await loadPacks();
  const pack = packs.byId[packId];

  if (!pack) {
    app().innerHTML = `
      <section class="section">
        <h2>Pack not found</h2>
        <p>Looks like “${packId}” doesn’t exist.</p>
        <p><a class="link" href="#/play">← Back to Packs</a></p>
      </section>
    `;
    return;
  }

  const tiles = (pack.puzzles || []).map((pz, i) => {
    const locked = !pz.unlocked;
    const label = String(i + 1).padStart(2, '0');
    const href = locked ? 'javascript:void(0)' : `#/play/level/${pz.id}`;
    return `
      <a class="puzzle-tile ${locked ? 'puzzle-tile--locked' : ''}" href="${href}" ${locked ? 'aria-disabled="true"' : ''}>
        <div class="puzzle-tile__num">${label}</div>
        <div class="puzzle-tile__name">${pz.name || 'Puzzle'}</div>
        <div class="puzzle-tile__status">${locked ? 'Locked' : 'Play'}</div>
      </a>
    `;
  }).join('');

  app().innerHTML = `
    <section class="section">
      <h2 style="margin:0 0 8px;">${pack.name}</h2>
      <p style="margin:0 0 16px; color:#66707a;">${pack.description || ''}</p>
      <div class="puzzles-grid">${tiles}</div>
      <div style="margin-top:12px;">
        <a class="link" href="#/play">← Back to Packs</a>
      </div>
    </section>
  `;
  injectMenuCSSOnce();
}

async function GameView(match) {
  showHUD(true);

  // Build engine shell
  app().innerHTML = `
    <div id="boardMount" class="placeholder">board will render here…</div>
    <hr />
    <section class="trays">
      <div class="tray tray--hand">
        <h2>Hand</h2>
        <div id="handMount" class="placeholder">hand will render here…</div>
      </div>
      <div class="tray tray--reserve">
        <h2>Reserve (max 2)</h2>
        <div id="reserveMount" class="placeholder">reserve will render here…</div>
      </div>
      <div class="tray tray--controls">
        <div class="controls">
          <button id="btnPlay" disabled>Submit</button>
          <button id="btnReset" disabled>Reset placement</button>
          <button id="btnRecall" disabled style="display:none">Recall</button>
          <button id="btnToggleDir" disabled style="display:none">Direction: H</button>
        </div>
        <p id="messages" style="min-height:1.5em; color:#444; margin-top:8px;"></p>
      </div>
    </section>
  `;

  const levelId = match[1]; // e.g. "001"
  const level = await loadLevel(levelId); // expects ./levels/level-<id>.json

  // 👉 Set cell size & responsive behavior based on level.size
  const N = Number(level.size || 7);
  setGridCellSize(N);
  enableResponsiveGrid(N);

  const state = initState(level);
  const validator = makeValidatorFromLevel(level);
  applyValidatorToState(state, validator);
  startLevel(state, level);

  initUI(state, level, {
    onWin: ({ state, level }) => {
      // TODO unlock next puzzle / record progress
    }
  });

  // Update header HUD
  const hudPar = document.getElementById('hudPar');
  const hudGoal = document.getElementById('hudGoal');
  if (hudPar) hudPar.textContent = String(level.meta?.par ?? state.par ?? '—');
  if (hudGoal) hudGoal.textContent = `(${state.goal.r}, ${state.goal.c})`;
}

function HowToPlayView() {
  showHUD(false);
  app().innerHTML = `
    <section class="section" style="max-width:720px; margin:auto; padding:20px;">
      <h2>How to Play</h2>
      <p class="lead">Place letter tiles on the grid to form words and reach the ★ goal cell.</p>

      <ol class="howto-list">
        <li><strong>Goal:</strong> Each puzzle has a fixed grid size (3×3, 5×5, or 7×7). Reach the ★ goal cell with a valid word.</li>
        <li><strong>Starting tiles:</strong> Some words or fragments are pre-placed as seeds. You must build from them.</li>
        <li><strong>Hand:</strong> You always have up to 4 tiles in your hand. Each tile is a fragment (1–5 letters).</li>
        <li><strong>Placement:</strong> On your turn, select a tile and click a grid cell to place it. You can place multiple tiles in one turn if they form a single continuous word.</li>
        <li><strong>Submit:</strong> Press <em>Submit</em> to commit your move. All new words formed must be in that puzzle’s allowlist.</li>
        <li><strong>Reserve:</strong> You can recall up to 2 committed tiles into your reserve for reuse later. Select a tile on the board and move it into your reserve, then <em>Submit</em> the recall.</li>
        <li><strong>Blocked cells:</strong> Blacked-out squares cannot be used.</li>
        <li><strong>Par:</strong> Each puzzle has a target number of turns (par). Try to finish at or under par!</li>
      </ol>

      <p style="margin-top:16px;">
        <a class="btn btn--primary" href="#/">Back to Menu</a>
      </p>
    </section>
  `;
  injectHowToCSSOnce();
}

/* ---------------- One-time menu CSS injectors ---------------- */

let _menuCSSInjected = false;
let _buttonCSSInjected = false;

function injectMenuCSSOnce() {
  if (_menuCSSInjected) return;
  _menuCSSInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .pack-grid{
      display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap:12px;
    }
    .pack-card{
      display:block; padding:14px 14px 12px; border:1px solid var(--line);
      border-radius:12px; background: var(--panel); text-decoration:none; color: var(--ink);
      box-shadow: var(--shadow);
      transition: transform .06s ease, background .15s ease, border-color .15s ease;
    }
    .pack-card:hover{ transform: translateY(-1px); background:#f7f9ff; border-color:#cbd5e1; }
    .pack-card--locked{ opacity: .6; pointer-events:none; }
    .pack-card__title{ font-weight:800; margin-bottom:4px; }
    .pack-card__desc{ color: var(--muted); font-size: 14px; }
    .pack-card__tag{
      display:inline-block; margin-top:8px; font-size:12px; padding:2px 8px;
      border-radius:999px; background:#eef3ff; color:#1f4dff; border:1px solid #b7c6ff;
    }
    .pack-card--locked .pack-card__tag{ background:#f2f4f7; color:#66707a; border-color:#e3e8ee; }

    .puzzles-grid{
      display:grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap:10px;
    }
    .puzzle-tile{
      display:block; padding:12px; border:1px solid var(--line); border-radius:12px;
      background:var(--panel); text-decoration:none; color:var(--ink); box-shadow: var(--shadow);
      transition: transform .06s ease, border-color .15s ease, background .15s ease;
    }
    .puzzle-tile:hover{ transform: translateY(-1px); background:#f7f9ff; border-color:#cbd5e1; }
    .puzzle-tile--locked{ pointer-events:none; opacity:.55; }
    .puzzle-tile__num{ font-weight:800; margin-bottom:4px; }
    .puzzle-tile__name{ color: var(--muted); font-size: 14px; }
    .puzzle-tile__status{ margin-top:8px; font-size: 12px; color: #1f4dff; }
    .puzzle-tile--locked .puzzle-tile__status{ color:#66707a; }
  `;
  document.head.appendChild(style);
  injectButtonStylesOnce();
}

function injectButtonStylesOnce() {
  if (_buttonCSSInjected) return;
  _buttonCSSInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .btn{
      display:inline-block; padding:10px 14px; border:1px solid var(--line);
      border-radius:12px; background:var(--panel); color:var(--ink); text-decoration:none; font-weight:700;
      transition: background .15s ease, border-color .15s ease, transform .06s ease;
    }
    .btn:hover{ background:#f0f4ff; transform: translateY(-1px); }
    .btn--primary{
      background: var(--accent); border-color: var(--accent); color:#fff; box-shadow: 0 2px 6px rgba(31,77,255,.28);
    }
    .btn--primary:hover{ filter: brightness(.96); }
    .link{ color:#1f4dff; text-decoration:none; }
    .link:hover{ text-decoration:underline; }
  `;
  document.head.appendChild(style);
}

let _howtoCSSInjected = false;
function injectHowToCSSOnce() {
  if (_howtoCSSInjected) return;
  _howtoCSSInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .lead { font-size:16px; margin-bottom:16px; color:var(--muted); }
    .howto-list { padding-left:20px; margin:0; }
    .howto-list li { margin-bottom:10px; line-height:1.45; }
  `;
  document.head.appendChild(style);
}