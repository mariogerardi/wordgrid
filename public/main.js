/* gridl • main.js (mini SPA + engine + packs.json)
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
const DEV_FORCE_UNLOCK_ALL = false;
import { initState, startLevel } from './engine/state.js';
import { makeValidatorFromLevel, applyValidatorToState } from './engine/validator.js';
import { __patchRendererForShim as initUI } from './engine/renderer.js';

/* ---------------- Packs data (fetched with fallback) ---------------- */

let PACKS_DB = null;
let PROGRESS = null; // { completed: Set<string>, unlockedPacks: Set<string>, unlockedLevels: Set<string>, bestScores: Record<string, number> }

/* ---------------- Progress (localStorage) ---------------- */

const LS_KEY = 'gridl_progress_v1';

function loadProgress() {
  if (PROGRESS) return PROGRESS;
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw && raw.completed && raw.unlockedPacks && raw.unlockedLevels) {
      PROGRESS = {
        completed: new Set(raw.completed),
        unlockedPacks: new Set(raw.unlockedPacks),
        unlockedLevels: new Set(raw.unlockedLevels),
        bestScores: Object.assign({}, raw.bestScores || {})
      };
      return PROGRESS;
    }
  } catch {}
  // Default: tutorial pack unlocked, first three tutorial levels unlocked, foundations unlocked
  PROGRESS = {
    completed: new Set(),
    unlockedPacks: new Set(['tutorial']),
    unlockedLevels: new Set(['101', '102', '103']),
    bestScores: {}
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
      bestScores: PROGRESS.bestScores || {}
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

function recordBest(id, turns) {
  const key = String(id);
  const t = Math.max(1, Number(turns || 0));
  const prev = PROGRESS.bestScores[key];
  if (!prev || t < prev) PROGRESS.bestScores[key] = t;
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
  // Curriculum progression: strictly compute unlocking based on previous pack completion
  try {
    const curriculum = packs.filter(p => p.section === 'curriculum');
    // Ensure order is preserved as declared in packs.json
    for (let i = 0; i < curriculum.length; i++) {
      const pk = curriculum[i];
      let unlocked = false;
      if (i === 0) unlocked = true; // first curriculum pack always unlocked
      else {
        const prev = curriculum[i - 1];
        const prevIds = (prev.puzzles || []).map(z => String(z.id));
        const allPrevCompleted = prevIds.length === 0 || prevIds.every(id => PROGRESS.completed.has(id));
        unlocked = allPrevCompleted;
      }
      pk.unlocked = unlocked;
      if (unlocked) PROGRESS.unlockedPacks.add(pk.id); else PROGRESS.unlockedPacks.delete(pk.id);
    }
  } catch {}
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
  { match: /^#\/how\/?$/, view: HowToPlayView },
  { match: /^#\/editor\/?$/, view: EditorView },
  { match: /^#\/settings\/?$/, view: SettingsView },
  { match: /^#\/themes\/?$/, view: ThemesView },
  { match: /^#\/achievements\/?$/, view: AchievementsView }
];

function route() {
  const hash = location.hash || '#/';
  // Clean up any game-only listeners as we change screens
  disableResponsiveGrid();

  // Render header nav on every navigation
  renderHeaderNav();

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

/** Set CSS variables for cell size/gap based on rows/cols and available width/height. */
function setGridCellSize(rows, cols) {
  const N = Math.max(Number(rows || 7), Number(cols || 7));
  // Base sizes by overall grid scale
  // Base size scales down as boards get larger. Previously 56 for 7×7 —
  // reduce ~10% and keep tapering down toward 10×10.
  // 3×N → 96, 5×N → 72, 7×N → ~50, 8–10×N → ~48–46
  let basePx;
  if (N <= 3) basePx = 96;
  else if (N <= 5) basePx = 60; // 5×5 should feel closer to ~60px
  else {
    basePx = Math.round(56 - (N - 5) * 3); // N=6→53, 7→50, 8→47, 9→44, 10→41
    basePx = Math.max(46, basePx); // don’t go below ~46 via base; minCell guards further
  }
  const baseGap = (N <= 3) ? 8 : (N <= 5) ? 6 : 6;

  // Fit within the board mount width (minus padding/gaps)
  const mount = document.getElementById('boardMount');
  const vw = window.innerWidth || 1024;
  const mountWidth = (mount?.clientWidth || Math.min(920, vw - 48));
  // Compute available height for the board (viewport minus header/meta/trays)
  const vh = window.innerHeight || 768;
  const toolbarEl = document.querySelector('.game-toolbar');
  const toolbarH = (toolbarEl && toolbarEl.classList.contains('game-toolbar--overlay')) ? 0 : (toolbarEl?.offsetHeight || 0);
  const metaH = document.querySelector('.level-meta')?.offsetHeight || 0;
  const traysH = document.querySelector('.trays--in-panel')?.offsetHeight || 0;
  const verticalMargins = 64; // breathing room + section padding
  const availableHeight = Math.max(160, vh - toolbarH - metaH - traysH - verticalMargins);

  // Choose gap smaller when cells are compact
  let gap = baseGap;
  // Max cell from width and height
  const maxCellFromWidth = Math.floor((mountWidth - (Number(cols) + 1) * baseGap - 2) / Number(cols));
  const maxCellFromHeight = Math.floor((availableHeight - (Number(rows) + 1) * baseGap - 2) / Number(rows));
  const rawCell = Math.min(maxCellFromWidth, maxCellFromHeight);

  // Final cell bounded by min/max
  const minCell = 44;
  const maxCell = basePx;
  const cellPx = Math.max(minCell, Math.min(maxCell, rawCell));
  if (cellPx < 54) gap = 4;

  document.documentElement.style.setProperty('--cell', `${cellPx}px`);
  document.documentElement.style.setProperty('--gap', `${gap}px`);
  // Toggle compact/spacious helpers for CSS fine-tuning
  document.documentElement.classList.toggle('cells-compact', cellPx < 54);
  document.documentElement.classList.toggle('cells-spacious', cellPx > 84);
  // Force single-column layout on all devices (no side-by-side)
  document.documentElement.classList.remove('layout-side');
}

/** Attach a resize listener while in game view; detach on navigation. */
function enableResponsiveGrid(rows, cols) {
  disableResponsiveGrid(); // remove any prior
  _resizeHandler = () => setGridCellSize(rows, cols);
  window.addEventListener('resize', _resizeHandler, { passive: true });
}
function disableResponsiveGrid() {
  if (_resizeHandler) window.removeEventListener('resize', _resizeHandler);
  _resizeHandler = null;
}

const app = () => document.getElementById('app');
// HUD removed; no-op helpers deleted

/* ---------------- Views ---------------- */

function HomeView() { renderDailyGame(); }

function renderHeaderNav(){
  const hdr = document.querySelector('header');
  if (!hdr) return;
  hdr.innerHTML = `
    <div class="header-inner">
      <h1><a href="#/" style="color:inherit; text-decoration:none;">gridl</a></h1>
      <nav class="header-actions" id="headerActions">
        <a class="btn btn--daily" href="#/">Daily</a>
        <a class="btn" href="#/play">Packs</a>
        <a class="btn" href="#/how">How&nbsp;to&nbsp;Play</a>
        <a class="btn" href="#/themes">Themes</a>
        <a class="btn" href="#/achievements">Achievements</a>
        <a class="btn" href="#/editor">Editor</a>
        <a class="btn" href="#/settings">Settings</a>
      </nav>
      <button class="header-menu" id="btnHeaderMenu" aria-label="Menu" title="Menu" style="padding:0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1"/>
          <rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/>
          <rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
      </button>
    </div>`;

  // Restore open state and wire up toggle
  const open = localStorage.getItem('hdr_open') === '1';
  if (open) hdr.classList.add('header--open'); else hdr.classList.remove('header--open');
  const btn = document.getElementById('btnHeaderMenu');
  if (btn) btn.addEventListener('click', () => {
    hdr.classList.toggle('header--open');
    localStorage.setItem('hdr_open', hdr.classList.contains('header--open') ? '1' : '0');
  });
}

function getAllLevelIds(packs){
  const ids = [];
  for (const p of packs.list){
    for (const z of (p.puzzles||[])) ids.push(String(z.id));
  }
  // Exclude tutorial 101–105
  return ids.filter(id => !(id >= '101' && id <= '105'));
}

function hashStr(s){ let h=5381; for(let i=0;i<s.length;i++){ h=((h<<5)+h) ^ s.charCodeAt(i);} return (h>>>0); }

async function renderDailyGame(){
  const packs = await loadPacks();
  const ids = getAllLevelIds(packs);
  const key = new Date().toLocaleDateString('en-CA');
  const pick = ids.length ? ids[ hashStr(key) % ids.length ] : '106';
  document.documentElement.classList.add('is-daily');
  await GameView(['', pick]);
  document.documentElement.classList.add('is-daily');
}

async function PacksView() {
  document.documentElement.classList.remove('is-daily');
  const packs = await loadPacks();
  const htmlCard = (p) => {
    const unlocked = DEV_FORCE_UNLOCK_ALL || !!p.unlocked;
    const href = unlocked ? `#/play/${p.id}` : 'javascript:void(0)';
    const sectCls = p.section ? ` pack-card--${p.section}` : '';
    const cardCls = `pack-card pack-card--series${sectCls}${unlocked ? '' : ' pack-card--locked'}`;
    const tagText = unlocked ? 'Unlocked' : 'Locked';
    const status = unlocked
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0"/><rect x="5" y="10" width="14" height="10" rx="2"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/></svg>';
    return `
      <a class="${cardCls}" href="${href}" ${unlocked ? '' : 'aria-disabled="true"'}>
        <div class="pack-card__body">
          <div class="pack-card__title">${p.name}</div>
          <div class="pack-card__desc">${p.description || ''}</div>
          <div class="pack-card__tag ${unlocked ? 'pack-card__tag--unlocked' : ''}">${tagText}</div>
        </div>
        <div class="pack-card__status" aria-hidden="true">${status}</div>
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
      : `<div class="pack-grid" style="opacity:.75"><div class="pack-card pack-card--series pack-card--locked" aria-disabled="true">
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
        const best = PROGRESS.bestScores?.[String(pz.id)] || null;
        const completed = PROGRESS.completed.has(String(pz.id));
        return { ...pz, name: (lvl.name || pz.name), par: (lvl.par ?? pz.par), unlocked, best, completed };
      } catch {
        const best = PROGRESS.bestScores?.[String(pz.id)] || null;
        const completed = PROGRESS.completed.has(String(pz.id));
        return { ...pz, unlocked: (DEV_FORCE_UNLOCK_ALL || PROGRESS.unlockedLevels.has(String(pz.id)) || pack.id !== 'tutorial'), best, completed };
      }
    }));
  } catch {
    // ignore enrichment errors and use existing data
  }

  const tiles = puzzles.map((pz, i) => {
    const locked = !pz.unlocked;
    const label = String(i + 1).padStart(2, '0');
    const href = locked ? 'javascript:void(0)' : `#/play/level/${pz.id}`;
    const best = (pz.best != null) ? `<div class=\"puzzle-tile__best\">Best ${pz.best}</div>` : '';
    const check = pz.completed ? '<div class="puzzle-tile__check" aria-hidden="true">✓</div>' : '';
    return `
      <a class="puzzle-tile ${locked ? 'puzzle-tile--locked' : ''}" href="${href}" ${locked ? 'aria-disabled=\"true\"' : ''}>
        ${check}
        <div class="puzzle-tile__num">${label}</div>
        <div class="puzzle-tile__row">
          <div class="puzzle-tile__name">${pz.name || 'Puzzle'}</div>
          <div class="puzzle-tile__right">
            <div class="puzzle-tile__par">Par ${pz.par != null ? pz.par : '—'}</div>
            ${best}
          </div>
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
  document.documentElement.classList.remove('is-daily');

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

  const level = await loadLevel(levelId); // expects ./levels/level-<id>.json

  // Build par meter HTML (always 10 pips) with animated fill and best marker
  const parCount = Math.max(0, Math.min(10, Number(level.par || 0)));
  const bestTurns = PROGRESS?.bestScores?.[String(levelId)] || null;
  const trackHTML = Array.from({ length: 10 }, (_, i) => {
    const isFill = i < parCount;
    const isBest = bestTurns && bestTurns >= 1 && bestTurns <= 10 && i === (bestTurns - 1);
    const cls = `par-square${isFill ? ' par-square--anim' : ''}${isBest ? ' par-square--best' : ''}`;
    const style = isFill ? ` style=\"--i:${i}\"` : '';
    return `<span class=\"${cls}\"${style}></span>`;
  }).join('');
  
  // Build engine shell (board + trays inside one panel)
  app().innerHTML = `
    <section class="section view">
      <div class="game-toolbar game-toolbar--overlay" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div><a class="btn" href="${backHref}">← Back</a></div>
        <div>${nextHref ? `<a id=\"btnNext\" class=\"btn btn--primary\" href=\"${nextHref}\" style=\"display:none\">Next →</a>` : ''}</div>
      </div>
      <div class="level-meta">
        <div class="level-meta__title">${level.name || `Level ${levelId}`}</div>
        <div class="level-meta__stats">
          <div class="par-meter" title="Par ${level.par}">
            <div class="par-meter__track">${trackHTML}</div>
          </div>
        </div>
      </div>
      <div id="boardMount">
        <div id="boardRoot" class="placeholder">board will render here…</div>
        <p id="messages" class="game-messages level-intro" style="min-height:1.5em; margin-top:10px;"></p>
        <div class="trays trays--in-panel">
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
              <button id="btnReset" disabled>Clear</button>
              <button id="btnHardReset">Reset</button>
              <button id="btnRecall" disabled style="display:none">Recall</button>
              <button id="btnToggleDir" disabled style="display:none">Direction: H</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  // 👉 Set cell size & responsive behavior based on level rows/cols
  const rows = Number(level.rows || level.size || 7);
  const cols = Number(level.cols || level.size || 7);
  setGridCellSize(rows, cols);
  enableResponsiveGrid(rows, cols);

  const state = initState(level);
  const validator = makeValidatorFromLevel(level);
  applyValidatorToState(state, validator);
  startLevel(state, level);

  initUI(state, level, {
    onWin: ({ state: finalState }) => {
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
      const used = Math.max(1, (finalState?.turn || 1) - 1);
      recordBest(id, used);
      if (level.meta?.id) markCompleted(String(level.meta.id));
      applyTutorialUnlocks();
      saveProgress();
      // Update cached packs so navigating back reflects unlocks immediately
      syncPacksUnlockedFromProgress();

      // Compute diffs and announce
      const newlyUnlockedLevels = [...PROGRESS.unlockedLevels].filter(v => !prevLevels.has(v));
      const newlyUnlockedPacks = [...PROGRESS.unlockedPacks].filter(v => !prevPacks.has(v));
      // Daily/game completion toast with par context
      const usedTurns = Math.max(1, (finalState?.turn || 1) - 1);
      const par = Number(level.par || 0);
      const diff = usedTurns - par;
      let perf = par ? (diff < 0 ? `Under par by ${Math.abs(diff)}!` : diff === 0 ? `Right at par.` : `Over par by ${diff}.`) : '';
      showUnlockToast(`🎉 Nice! You finished in ${usedTurns}. ${perf}`.trim());
    }
  });

  // Hard reset button: reload the same level fresh
  document.getElementById('btnHardReset')?.addEventListener('click', () => {
    GameView(['', levelId]);
  });

  // HUD removed
}

function HowToPlayView() {
  document.documentElement.classList.remove('is-daily');
  app().innerHTML = `
    <section class="section view" style="max-width:760px; margin:auto; padding:20px;">
      <h2 style="text-align:center; margin-bottom:8px;">How to Play</h2>
      <p class="lead" style="text-align:center;">Build words with tile fragments, connect to the seed, and cover the ★ goal.</p>

      <div class="howto-block">
        <h3>1) The Objective</h3>
        <p>Every board has a goal cell (★). Win by submitting a move where a valid word covers that cell.</p>
        <div class="howto-example">
          <div class="board board--mini" style="--cols:3; --rows:1; --cell:32px; --gap:4px;">
            <div class="cell cell--seed"><span class="cell__text">CA</span></div>
            <div class="cell"><span class="cell__text">T</span></div>
            <div class="cell cell--goal"></div>
          </div>
          <div class="howto-caption">Place <em>T</em> to complete <strong>CAT</strong> across the ★.</div>
        </div>
      </div>

      <div class="howto-block">
        <h3>2) Tiles &amp; words</h3>
        <ul class="howto-list">
          <li>Tiles are <em>fragments</em> (single letters or multi‑letter chunks).</li>
          <li>When you <strong>Submit</strong>, every multi‑cell run that formed must be an <em>allowed word</em>.</li>
          <li>Real, single tiles that stand alone must also be allowed (projections are exempt).</li>
        </ul>
        <div class="howto-examples-flex">
          <div class="howto-example">
            <div class="board board--mini" style="--cols:3; --rows:1; --cell:28px; --gap:4px;">
              <div class="cell"><span class="cell__text">UP</span></div>
              <div class="cell"><span class="cell__text">SET</span></div>
              <div class="cell"></div>
            </div>
            <div class="howto-caption">Runs read across or down. <strong>UP+SET → UPSET</strong>.</div>
          </div>
          <div class="howto-example">
            <div class="board board--mini" style="--cols:2; --rows:2; --cell:28px; --gap:4px;">
              <div class="cell"><span class="cell__text">A</span></div>
              <div class="cell"></div>
              <div class="cell"></div>
              <div class="cell"></div>
            </div>
            <div class="howto-caption">A single, isolated <strong>A</strong> must be allowed in that level.</div>
          </div>
        </div>
      </div>

      <div class="howto-block">
        <h3>3) Your turn</h3>
        <ul class="howto-list">
          <li><strong>Place:</strong> Click a tile in Hand or Reserve, then click a cell.</li>
          <li><strong>One line per turn:</strong> If you place multiple tiles, they must lie on the <em>same row or column</em> and connect to form a single word.</li>
          <li><strong>Crossings:</strong> Placing a single tile that completes words <em>both ways</em> is allowed (both must be valid).</li>
          <li><strong>Recall:</strong> You may recall committed tiles to Reserve (max two) by staging a recall and submitting.</li>
        </ul>
      </div>

      <div class="howto-block">
        <h3>4) Seeds, blocks, and portals</h3>
        <ul class="howto-list">
          <li><strong>Seeds</strong> are fixed fragments you build from.</li>
          <li><strong>Blocked</strong> cells can’t hold tiles.</li>
          <li><strong>Portals</strong> project the text on one portal cell onto all linked cells of the same color group. Projections can form words; they don’t block placements on their own cells.</li>
        </ul>
        <div class="howto-examples-flex">
          <div class="howto-example">
            <div class="board board--mini" style="--cols:3; --rows:2; --cell:26px; --gap:4px;">
              <div class="cell cell--seed"><span class="cell__text">RE</span></div>
              <div class="cell cell--portal cell--portal-A"><span class="cell__text"></span></div>
              <div class="cell"></div>
              <div class="cell"></div>
              <div class="cell cell--portal cell--portal-A"></div>
              <div class="cell"><span class="cell__text">ACT</span></div>
            </div>
            <div class="howto-caption">The portal mirrors the nearest text in its group; <strong>RE</strong> projects across and combines with <strong>ACT</strong>.</div>
          </div>
          <div class="howto-example">
            <div class="board board--mini" style="--cols:3; --rows:2; --cell:26px; --gap:4px;">
              <div class="cell cell--blocked"></div>
              <div class="cell"></div>
              <div class="cell cell--goal"></div>
              <div class="cell"></div>
              <div class="cell cell--seed"><span class="cell__text">CAT</span></div>
              <div class="cell"></div>
            </div>
            <div class="howto-caption">Blocked squares behave like walls; seeds are fixed.</div>
          </div>
        </div>
      </div>

      <div class="howto-block">
        <h3>5) Valid boards (what the game checks)</h3>
        <ul class="howto-list">
          <li>Every multi‑cell run on the board must be an allowed word.</li>
          <li>Any real tile that stands alone must be allowed by itself.</li>
          <li>Everything must be <strong>connected to the seed</strong> (portals count as bridges).</li>
        </ul>
      </div>

      <div class="howto-block">
        <h3>6) Par &amp; scoring</h3>
        <p>Try to finish at or under <em>par</em>. Your best score for each level is saved — improve routes by using crossings, recalls, and portals efficiently.</p>
      </div>

      <p style="margin-top:18px; text-align:center;">
        <a class="btn btn--primary" href="#/">Back to Menu</a>
      </p>
    </section>
  `;
  // styles are in styles.css
}

function SettingsView(){
  document.documentElement.classList.remove('is-daily');
  app().innerHTML = `
    <section class="section view" style="max-width:640px; margin:auto; padding:20px;">
      <h2>Settings</h2>
      <p>Coming soon.</p>
    </section>
  `;
}

function ThemesView(){
  document.documentElement.classList.remove('is-daily');
  app().innerHTML = `
    <section class="section view" style="max-width:640px; margin:auto; padding:20px;">
      <h2>Themes</h2>
      <p>Coming soon.</p>
    </section>
  `;
}

function AchievementsView(){
  document.documentElement.classList.remove('is-daily');
  app().innerHTML = `
    <section class="section view" style="max-width:640px; margin:auto; padding:20px;">
      <h2>Achievements</h2>
      <p>Coming soon.</p>
    </section>
  `;
}

// Removed on-the-fly CSS injectors; all styles live in styles.css

/* ---------------- Simple Level Editor (experimental) ---------------- */

function EditorView() {
  const E = {
    rows: 5,
    cols: 5,
    goal: { r: 0, c: 0 },
    seeds: [], // [{text,r,c,dir:'H'}]
    specials: [], // [{r,c,type:'blocked'|'portal',group?:'A'}]
    deck: [],
    startingHand: [],
    allowedWords: [],
    notes: ''
  };

  app().innerHTML = `
    <section class="section view" style="max-width:1080px; margin:auto;">
      <div class="editor-toolbar">
        <div><a class="btn" href="#/">← Back</a></div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button id="btnExport" class="btn btn--primary">Copy Level JSON</button>
        </div>
      </div>

      <div class="editor-grid" style="margin-top:12px;">
        <!-- Left column: Board + Metadata stacked -->
        <div class="editor-col">
          <div class="editor-card" id="editorBoardWrap">
            <div id="boardMount" style="padding:0; background:transparent; box-shadow:none; border:0;">
              <div id="editorBoard" class="board"></div>
            </div>
            <p id="edMsg" class="game-messages" style="text-align:center; min-height:1.4em; margin-top:8px;"></p>
          </div>
          <div class="editor-card">
            <h3>Metadata</h3>
            <div class="field"><label for="metaId">Level ID</label><input id="metaId" type="text" placeholder="e.g., 999"></div>
            <div class="field"><label for="metaName">Name</label><input id="metaName" type="text" placeholder="Custom Level"></div>
            <div class="field"><label for="metaPar">Par</label><input id="metaPar" type="number" value="7" min="0" style="width:100px"></div>
            <div class="field"><label for="metaIntro">Intro</label><input id="metaIntro" type="text" placeholder="Optional intro"></div>
          </div>
        </div>

        <!-- Right column: Tools + Deck + Allowed + Notes -->
        <div class="editor-card">
          <h3>Board</h3>
          <div class="field"><label>Rows</label><input id="edRows" type="number" min="1" max="10" value="${E.rows}" style="width:120px">
            <label>Columns</label><input id="edCols" type="number" min="1" max="10" value="${E.cols}" style="width:120px"></div>

          <div class="tools">
            <button class="btn" data-tool="seed">Seed</button>
            <button class="btn" data-tool="blocked">Blocked</button>
            <button class="btn" data-tool="portal">Portal</button>
            <button class="btn" data-tool="goal">Goal</button>
            <button class="btn" data-tool="erase">Erase</button>
          </div>
          <div id="seedControls" class="field">
            <label>Seed text</label><input id="seedText" type="text" value="CAT">
            <span class="muted">(click a cell to place/edit)</span>
          </div>
          <div id="portalControls" class="field" style="display:none;">
            <label>Portal group</label>
            <select id="portalGroup"><option>A</option><option>B</option><option>C</option><option>D</option></select>
          </div>

          <h3>Deck (stacked)</h3>
          <div id="deckList" style="margin-bottom:6px;"></div>
          <div class="field">
            <input id="deckInput" type="text" placeholder="e.g., UP" style="max-width:200px">
            <button class="btn" id="btnAddDeck">Add</button>
          </div>
          <div class="muted">Click ↑ / ↓ to reorder; × to remove.</div>

          <h3 style="margin-top:16px;">Allowed Words</h3>
          <div class="field"><textarea id="allowTA" rows="6" style="width:100%;" placeholder="Comma or newline separated words..."></textarea></div>

          <h3>Notes</h3>
          <div class="field"><textarea id="notesTA" rows="4" style="width:100%;" placeholder="Designer notes (optional)"></textarea></div>
        </div>
      </div>
    </section>
  `;

  // stateful locals
  let tool = 'seed';
  let portalGroup = 'A';

  // wire controls
  const byId = (id) => document.getElementById(id);
  const rowsEl = byId('edRows');
  const colsEl = byId('edCols');
  const seedTextEl = byId('seedText');
  const portalGroupEl = byId('portalGroup');
  const allowTA = byId('allowTA');
  const notesTA = byId('notesTA');
  const deckInput = byId('deckInput');
  const deckList = byId('deckList');

  function toA1(r, c){
    let n = c + 1, col = '';
    while(n>0){ const rem=(n-1)%26; col = String.fromCharCode(65+rem)+col; n=Math.floor((n-1)/26);} 
    return `${col}${r+1}`;
  }

  function specialAt(r,c){ return E.specials.find(s=>s.r===r && s.c===c); }
  function seedAt(r,c){ return E.seeds.find(s=>s.r===r && s.c===c); }

  function renderDeck(){
    deckList.innerHTML = E.deck.map((t, i) => `
      <div style="display:flex; align-items:center; gap:6px; margin:4px 0;">
        <code style="font-weight:800;">${t.toUpperCase()}</code>
        <button class="btn" data-up="${i}">↑</button>
        <button class="btn" data-down="${i}">↓</button>
        <button class="btn" data-del="${i}">×</button>
      </div>
    `).join('');
  }

  function setTool(t){
    tool = t;
    byId('seedControls').style.display = (t==='seed')?'' : 'none';
    byId('portalControls').style.display = (t==='portal')?'' : 'none';
    document.querySelectorAll('[data-tool]').forEach(b=>{
      b.classList.toggle('btn--primary', b.dataset.tool===tool);
    });
    edSay(`Tool: ${tool}`);
  }

  function edSay(msg){ byId('edMsg').textContent = msg || '' }

  function onCellClick(r,c){
    const sp = specialAt(r,c);
    const sd = seedAt(r,c);
    if (tool==='erase'){
      if (sp) E.specials = E.specials.filter(x=>x!==sp);
      if (sd) E.seeds = E.seeds.filter(x=>x!==sd);
      if (E.goal.r===r && E.goal.c===c) E.goal = { r: 0, c: 0 };
      renderBoard(); return;
    }
    if (tool==='blocked'){
      if (sp?.type==='blocked') E.specials = E.specials.filter(x=>x!==sp); else E.specials.push({ r,c,type:'blocked' });
      // cannot block goal or seed — silently un-set them
      if (E.goal.r===r && E.goal.c===c) E.goal = { r: 0, c: 0 };
      if (sd) E.seeds = E.seeds.filter(x=>x!==sd);
      renderBoard(); return;
    }
    if (tool==='portal'){
      if (sp?.type==='portal' && sp.group===portalGroup) E.specials = E.specials.filter(x=>x!==sp);
      else {
        // remove blocked if present; also remove seed to avoid overlap errors
        if (sp) E.specials = E.specials.filter(x=>x!==sp);
        if (sd) E.seeds = E.seeds.filter(x=>x!==sd);
        E.specials.push({ r,c,type:'portal', group: portalGroup });
      }
      renderBoard(); return;
    }
    if (tool==='goal'){
      // forbid blocking
      const spx = specialAt(r,c); if (spx?.type==='blocked') { edSay('Goal cannot be on a blocked cell.'); return; }
      E.goal = { r, c }; renderBoard(); return;
    }
    if (tool==='seed'){
      const t = (seedTextEl.value || '').trim();
      if (!t){ edSay('Enter seed text first.'); return; }
      // cannot overlap blocked
      if (sp?.type==='blocked'){ edSay('Cannot place seed on a blocked cell.'); return; }
      if (sd) sd.text = t; else E.seeds.push({ r,c,text:t,dir:'H' });
      renderBoard(); return;
    }
  }

  function renderBoard(){
    const R = E.rows, C = E.cols;
    const root = document.getElementById('editorBoard');
    root.className = 'board';
    root.style.setProperty('--cols', C);
    root.style.setProperty('--rows', R);
    setGridCellSize(R, C);
    root.innerHTML='';
    for(let r=0;r<R;r++){
      for(let c=0;c<C;c++){
        const cell = document.createElement('div');
        cell.className = 'cell';
        const sp = specialAt(r,c);
        const sd = seedAt(r,c);
        if (E.goal.r===r && E.goal.c===c) cell.classList.add('cell--goal');
        if (sp?.type==='blocked') cell.classList.add('cell--blocked');
        if (sp?.type==='portal') { cell.classList.add('cell--portal'); if (sp.group) cell.classList.add(`cell--portal-${sp.group}`); }
        if (sd){ cell.classList.add('cell--seed','cell--filled');
          const t = document.createElement('span'); t.className='cell__text'; t.textContent = String(sd.text).toUpperCase(); cell.appendChild(t);
        }
        // No group letter badge in editor; color indicates group
        const coord = document.createElement('span'); coord.className='cell__coord'; coord.textContent = toA1(r,c); cell.appendChild(coord);
        cell.addEventListener('click', ()=> onCellClick(r,c));
        root.appendChild(cell);
      }
    }
  }

  // deck operations
  deckList.addEventListener('click', (e)=>{
    const up = e.target.getAttribute('data-up');
    const down = e.target.getAttribute('data-down');
    const del = e.target.getAttribute('data-del');
    if (up!=null){ const i=+up; if(i>0){ const t=E.deck[i]; E.deck[i]=E.deck[i-1]; E.deck[i-1]=t; renderDeck(); } }
    if (down!=null){ const i=+down; if(i<E.deck.length-1){ const t=E.deck[i]; E.deck[i]=E.deck[i+1]; E.deck[i+1]=t; renderDeck(); } }
    if (del!=null){ const i=+del; E.deck.splice(i,1); renderDeck(); }
  });
  byId('btnAddDeck').addEventListener('click', ()=>{
    const t = (deckInput.value||'').trim(); if(!t) return;
    E.deck.push(t); deckInput.value=''; renderDeck();
  });

  // general controls
  rowsEl.addEventListener('change', ()=>{ E.rows = Math.max(1, Math.min(10, Number(rowsEl.value||5))); renderBoard(); });
  colsEl.addEventListener('change', ()=>{ E.cols = Math.max(1, Math.min(10, Number(colsEl.value||5))); renderBoard(); });
  document.querySelectorAll('[data-tool]').forEach(b=> b.addEventListener('click', ()=> setTool(b.dataset.tool)));
  portalGroupEl.addEventListener('change', ()=>{ portalGroup = portalGroupEl.value; });

  // export JSON
  byId('btnExport').addEventListener('click', async ()=>{
    const id = (byId('metaId').value||'').trim();
    const name = (byId('metaName').value||'').trim() || 'Custom Level';
    const par = Math.max(0, Number(byId('metaPar').value||'7'));
    const intro = (byId('metaIntro').value||'').trim();
    // process allowed words from textarea
    const allowRaw = allowTA.value || '';
    E.allowedWords = allowRaw.split(/[\,\n]/).map(s=>s.trim()).filter(Boolean);
    E.notes = notesTA.value || '';
    // build specials (blocked/portal) from E.specials
    const specials = E.specials.map(s=> s.type==='portal' ? { r:s.r, c:s.c, type:'portal', group: s.group } : { r:s.r, c:s.c, type:'blocked' });
    const level = {
      meta: { id: String(id), name, par, intro },
      board: { size: [E.rows, E.cols], goal: [E.goal.r, E.goal.c], seeds: E.seeds.map(s=>({ text:s.text, r:s.r, c:s.c, dir:'H' })), specials },
      deck: [...E.deck],
      startingHand: [...E.startingHand],
      allowedWords: [...E.allowedWords],
      notes: E.notes
    };
    const json = JSON.stringify(level, null, 2);
    try{
      await navigator.clipboard.writeText(json);
      edSay('Copied level JSON to clipboard.');
      showUnlockToast('Level JSON copied to clipboard');
    }catch{
      edSay('Unable to copy. JSON printed to console.');
      console.log(json);
    }
  });

  // initial render
  setTool('seed');
  renderBoard();
  renderDeck();
}
