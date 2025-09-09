/* griddl • main.js (mini SPA + engine + packs.json)
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

// DEV FORCE-UNLOCK (toggle for local testing)
// Location: public/main.js (top of file, near imports)
// Set to true to unlock ALL packs and ALL levels regardless of saved progress.
// Remember to set back to false before sharing builds.
const DEV_FORCE_UNLOCK_ALL = true;
import { initState, startLevel } from './engine/state.js';
import { makeValidatorFromLevel, applyValidatorToState } from './engine/validator.js';
import { __patchRendererForShim as initUI } from './engine/renderer.js';

/* ---------------- Packs data (fetched with fallback) ---------------- */

let PACKS_DB = null;
let PROGRESS = null; // { completed: Set<string>, unlockedPacks: Set<string>, unlockedLevels: Set<string> }

/* ---------------- Progress (localStorage) ---------------- */

const LS_KEY = 'griddl_progress_v1';

function loadProgress() {
  if (PROGRESS) return PROGRESS;
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw && raw.completed && raw.unlockedPacks && raw.unlockedLevels) {
      PROGRESS = {
        completed: new Set(raw.completed),
        unlockedPacks: new Set(raw.unlockedPacks),
        unlockedLevels: new Set(raw.unlockedLevels),
      };
      return PROGRESS;
    }
  } catch {}
  // Default: tutorial pack unlocked, first three tutorial levels unlocked, foundations unlocked
  PROGRESS = {
    completed: new Set(),
    unlockedPacks: new Set(['tutorial']),
    unlockedLevels: new Set(['101', '102', '103']),
  };
  saveProgress();
  return PROGRESS;
}

function saveProgress() {
  try {
    const data = {
      completed: [...PROGRESS.completed],
      unlockedPacks: [...PROGRESS.unlockedPacks],
      unlockedLevels: [...PROGRESS.unlockedLevels],
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {}
}

function syncPacksUnlockedFromProgress() {
  if (!PACKS_DB || !PROGRESS) return;
  try {
    for (const p of PACKS_DB.list) {
      p.unlocked = PROGRESS.unlockedPacks.has(p.id) || !!p.unlocked;
    }
  } catch {}
}

/* ---------------- Small UI toasts for unlocks ---------------- */
function ensureToastRoot() {
  let root = document.getElementById('toastRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toastRoot';
    document.body.appendChild(root);
  }
  return root;
}
function showUnlockToast(message) {
  const root = ensureToastRoot();
  const n = document.createElement('div');
  n.className = 'toast';
  n.textContent = message;
  root.appendChild(n);
  // animate in
  requestAnimationFrame(() => n.classList.add('toast--in'));
  // auto-dismiss
  setTimeout(() => {
    n.classList.remove('toast--in');
    n.classList.add('toast--out');
    setTimeout(() => n.remove(), 350);
  }, 2600);
}

function unlockLevel(id) {
  PROGRESS.unlockedLevels.add(String(id));
}
function unlockPack(id) {
  PROGRESS.unlockedPacks.add(String(id));
}
function markCompleted(id) {
  PROGRESS.completed.add(String(id));
}

// Apply tutorial gating: start with 101-103; then completing 101-103 → unlock 104-105; completing 104-105 → unlock 106-107; completing 106-107 → unlock 108-110.
function applyTutorialUnlocks() {
  const c = PROGRESS.completed;
  // Ensure initial levels stay unlocked
  ['101','102','103'].forEach(unlockLevel);
  if (['101','102','103'].every(id => c.has(id))) {
    ['104','105'].forEach(unlockLevel);
    if (['104','105'].every(id => c.has(id))) {
      ['106','107'].forEach(unlockLevel);
      if (['106','107'].every(id => c.has(id))) {
        ['108','109','110'].forEach(unlockLevel);
      }
    }
  }
  // Pack unlocks from tutorial milestones
  if (c.has('105')) unlockPack('singles');
  if (c.has('110')) unlockPack('basics');
}

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
  const packs = Array.isArray(raw?.packs) ? raw.packs : [];
  const sections = Array.isArray(raw?.sections) ? raw.sections : [];
  const byId = Object.create(null);
  for (const p of packs) byId[p.id] = p;
  const sectionsById = Object.create(null);
  for (const s of sections) sectionsById[s.id] = s;
  // Merge in dynamic unlocks from progress
  loadProgress();
  applyTutorialUnlocks();
  // Pack unlocked flag defaults to PROGRESS; fallback to existing p.unlocked
  for (const p of packs) {
    p.unlocked = PROGRESS.unlockedPacks.has(p.id) || !!p.unlocked;
  }
  // DEV: force unlock everything for local testing
  if (DEV_FORCE_UNLOCK_ALL) {
    for (const p of packs) {
      p.unlocked = true;
      PROGRESS.unlockedPacks.add(p.id);
      for (const lvl of (p.puzzles || [])) {
        PROGRESS.unlockedLevels.add(String(lvl.id));
      }
    }
  }
  saveProgress();
  return { list: packs, byId, sections: { list: sections, byId: sectionsById } };
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

  // Ensure base theme is active (no-op; dark theme removed)

  for (const r of routes) {
    const m = hash.match(r.match);
    if (m) {
      r.view(m);
      // Mark app as ready to reveal content (prevents initial flash)
      document.documentElement.classList.add('app-ready');
      return;
    }
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
// HUD removed; no-op helpers deleted

/* ---------------- Views ---------------- */

function HomeView() {
  app().innerHTML = `
    <section class="section section--centered view">
      <h1 class="home-title">griddl</h1>
      <p class="home-tagline">Build words. Reach the goal.</p>
      <div class="menu-grid">
        <a class="menu-tile menu-tile--primary" href="#/play"><span class="menu-tile__label">Play</span></a>
        <a class="menu-tile" href="#/how"><span class="menu-tile__label">How to Play</span></a>
        <a class="menu-tile" href="#/achievements"><span class="menu-tile__label">Achievements</span></a>
        <a class="menu-tile" href="#/themes"><span class="menu-tile__label">Themes</span></a>
        <a class="menu-tile" href="#/settings"><span class="menu-tile__label">Settings</span></a>
      </div>
    </section>
  `;
}

async function PacksView() {
  const packs = await loadPacks();
  const htmlCard = (p) => {
    const unlocked = DEV_FORCE_UNLOCK_ALL || !!p.unlocked;
    const href = unlocked ? `#/play/${p.id}` : 'javascript:void(0)';
    const cardCls = `pack-card${unlocked ? '' : ' pack-card--locked'}`;
    const tagText = unlocked ? 'Unlocked' : 'Locked';
    return `
      <a class="${cardCls}" href="${href}" ${unlocked ? '' : 'aria-disabled="true"'}>
        <div class="pack-card__title">${p.name}</div>
        <div class="pack-card__desc">${p.description || ''}</div>
        <div class="pack-card__tag ${unlocked ? 'pack-card__tag--unlocked' : ''}">${tagText}</div>
      </a>
    `;
  };

  const bySection = new Map();
  for (const s of packs.sections.list) bySection.set(s.id, []);
  for (const p of packs.list) {
    const sid = p.section || 'variety';
    if (!bySection.has(sid)) bySection.set(sid, []);
    bySection.get(sid).push(p);
  }

  const sectionHTML = packs.sections.list.map((s) => {
    const items = bySection.get(s.id) || [];
    const grid = items.length
      ? `<div class="pack-grid">${items.map(htmlCard).join('')}</div>`
      : `<div class="pack-grid" style="opacity:.75"><div class="pack-card pack-card--locked" aria-disabled="true">
           <div class="pack-card__title">Coming soon</div>
           <div class="pack-card__desc">${s.description || ''}</div>
         </div></div>`;
    return `
      <section class="section packs-section">
        <h3 class="packs-section__title">${s.name}</h3>
        <p class="packs-section__desc">${s.description || ''}</p>
        ${grid}
      </section>
    `;
  }).join('');

  app().innerHTML = `
    <section class="section view">
      <h2 style="margin:0 0 8px;">Choose a pack</h2>
      ${sectionHTML}
      <div class="game-toolbar" style="margin: 12px 0 0;">
        <a class="btn" href="#/">← Back</a>
      </div>
    </section>
  `;
  // styles are in styles.css
}

async function PackView(match) {
  const packId = match[1];
  const packs = await loadPacks();
  const pack = packs.byId[packId];

  if (!pack) {
    app().innerHTML = `
      <section class="section view">
        <h2>Pack not found</h2>
        <p>Looks like “${packId}” doesn’t exist.</p>
        <div class="game-toolbar" style="margin: 12px 0 0;">
          <a class="btn" href="#/play">← Back</a>
        </div>
      </section>
    `;
    return;
  }

  // Enrich puzzle tiles with level meta (title + par) for all packs.
  let puzzles = pack.puzzles || [];
  try {
    puzzles = await Promise.all(puzzles.map(async (pz) => {
      try {
        const lvl = await loadLevel(pz.id);
        // unlocked based on progress + tutorial gating (or DEV override)
        const unlocked = DEV_FORCE_UNLOCK_ALL || PROGRESS.unlockedLevels.has(String(pz.id)) || pack.id !== 'tutorial';
        return { ...pz, name: (lvl.name || pz.name), par: (lvl.par ?? pz.par), unlocked };
      } catch {
        return { ...pz, unlocked: (DEV_FORCE_UNLOCK_ALL || PROGRESS.unlockedLevels.has(String(pz.id)) || pack.id !== 'tutorial') };
      }
    }));
  } catch {
    // ignore enrichment errors and use existing data
  }

  const tiles = puzzles.map((pz, i) => {
    const locked = !pz.unlocked;
    const label = String(i + 1).padStart(2, '0');
    const href = locked ? 'javascript:void(0)' : `#/play/level/${pz.id}`;
    return `
      <a class="puzzle-tile ${locked ? 'puzzle-tile--locked' : ''}" href="${href}" ${locked ? 'aria-disabled="true"' : ''}>
        <div class="puzzle-tile__num">${label}</div>
        <div class="puzzle-tile__row">
          <div class="puzzle-tile__name">${pz.name || 'Puzzle'}</div>
          <div class="puzzle-tile__par">Par ${pz.par != null ? pz.par : '—'}</div>
        </div>
        <div class="puzzle-tile__status">${locked ? 'Locked' : 'Play'}</div>
      </a>
    `;
  }).join('');

  app().innerHTML = `
    <section class="section view">
      <h2 style="margin:0 0 8px;">${pack.name}</h2>
      <p style="margin:0 0 16px; color:#66707a;">${pack.description || ''}</p>
      <div class="puzzles-grid" data-pack="${pack.id}">${tiles}</div>
      <div class="game-toolbar" style="margin: 12px 0 0;">
        <a class="btn" href="#/play">← Back</a>
      </div>
    </section>
  `;
  // styles are in styles.css
}

async function GameView(match) {

  const levelId = match[1]; // e.g. "001"

  // Find the pack that contains this level for a back link and potential next link
  let backHref = '#/play';
  let nextHref = '';
  try {
    const packs = await loadPacks();
    const found = packs.list.find(pk => (pk.puzzles || []).some(pz => String(pz.id) === String(levelId)));
    if (found) {
      backHref = `#/play/${found.id}`;
      const ix = (found.puzzles || []).findIndex(pz => String(pz.id) === String(levelId));
      const next = ix >= 0 ? (found.puzzles || [])[ix + 1] : null;
      if (next && next.id) nextHref = `#/play/level/${next.id}`;
    }
  } catch {}

  // Build engine shell (board + trays inside one panel)
  app().innerHTML = `
    <section class="section view">
      <div class="game-toolbar" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div><a class="btn" href="${backHref}">← Back</a></div>
        <div>${nextHref ? `<a id=\"btnNext\" class=\"btn btn--primary\" href=\"${nextHref}\" style=\"display:none\">Next →</a>` : ''}</div>
      </div>
      <div id="boardMount">
        <div id="boardRoot" class="placeholder">board will render here…</div>
        <p id="messages" class="game-messages" style="min-height:1.5em; margin-top:10px;"></p>
        <div class="trays trays--in-panel" style="margin-top:14px;">
          <div class="tray tray--hand">
            <h2>Hand</h2>
            <div id="handMount" class="placeholder">hand will render here…</div>
          </div>
          <div class="tray tray--reserve">
            <h2>Reserve</h2>
            <div id="reserveMount" class="placeholder">reserve will render here…</div>
          </div>
          <div class="tray tray--controls">
            <div class="controls">
              <button id="btnPlay" disabled>Submit</button>
              <button id="btnReset" disabled>Reset placement</button>
              <button id="btnRecall" disabled style="display:none">Recall</button>
              <button id="btnToggleDir" disabled style="display:none">Direction: H</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
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
    onWin: () => {
      // Reveal Next button (if present) when the puzzle is completed
      const nextBtn = document.getElementById('btnNext');
      if (nextBtn) nextBtn.style.display = '';
      // Update progress & unlocks
      loadProgress();
      // snapshot before applying new unlocks
      const prevLevels = new Set(PROGRESS.unlockedLevels);
      const prevPacks = new Set(PROGRESS.unlockedPacks);
      const id = String(level.id || match[1]);
      markCompleted(id);
      if (level.meta?.id) markCompleted(String(level.meta.id));
      applyTutorialUnlocks();
      saveProgress();
      // Update cached packs so navigating back reflects unlocks immediately
      syncPacksUnlockedFromProgress();

      // Compute diffs and announce
      const newlyUnlockedLevels = [...PROGRESS.unlockedLevels].filter(v => !prevLevels.has(v));
      const newlyUnlockedPacks = [...PROGRESS.unlockedPacks].filter(v => !prevPacks.has(v));
      // Announce tutorial level unlocks only
      const tutLevelGain = newlyUnlockedLevels.filter(id => /^10\d$/.test(id));
      if (tutLevelGain.length > 0) {
        const word = tutLevelGain.length === 2 ? 'two' : (tutLevelGain.length === 3 ? 'three' : String(tutLevelGain.length));
        showUnlockToast(`You just unlocked the next ${word} levels in this pack!`);
      }
      for (const pid of newlyUnlockedPacks) {
        // Nice name from DB if we have it
        const pk = PACKS_DB?.byId?.[pid];
        const label = pk?.name ? pk.name : pid;
        showUnlockToast(`You unlocked the ${label} pack!`);
      }
    }
  });

  // HUD removed
}

function HowToPlayView() {
  app().innerHTML = `
    <section class="section view" style="max-width:720px; margin:auto; padding:20px;">
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
  // styles are in styles.css
}

// Removed on-the-fly CSS injectors; all styles live in styles.css
