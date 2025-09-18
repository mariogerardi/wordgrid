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

import { loadLevel, normalizeLevel } from './engine/levelLoader.js';
import { initState, startLevel } from './engine/state.js';
import { makeValidatorFromLevel, applyValidatorToState } from './engine/validator.js';
import { __patchRendererForShim as initUI } from './engine/renderer.js';
import { toA1 } from './engine/shared/geometry.js';
import { LS_KEY, DAILY_EXCLUDE, DAILY_FALLBACK_LEVEL } from './engine/shared/constants.js';
import { hashStr, showToast, safeJSONParse } from './engine/shared/utils.js';
import { setGridCellSize, enableResponsiveGrid, disableResponsiveGrid } from './engine/shared/layout.js';

// DEV FORCE-UNLOCK (toggle for local testing)
// Location: public/main.js (top of file, near imports)
// Set to true to unlock ALL packs and ALL levels regardless of saved progress.
// Remember to set back to false before sharing builds.
const DEV_FORCE_UNLOCK_ALL = false;

console.info('[gridl/main] bootstrap • routing + layout modules active');

/* ---------------- Theme system ---------------- */

const THEME_UNLOCK_TYPES = {
  ALWAYS: 'always',
  LEVEL: 'level',
  ACHIEVEMENT: 'achievement'
};

const THEMES = [
  {
    id: 'light',
    name: 'Light',
    description: 'Bright, friendly default look with airy blues and crisp edges.',
    preview: {
      background: 'linear-gradient(135deg, #f8fbff 0%, #cfe5ff 55%, #9dc5ff 100%)',
      foreground: '#1b335f'
    },
    colorScheme: 'light',
    unlock: {
      type: THEME_UNLOCK_TYPES.ALWAYS,
      tag: 'Always available',
      description: 'Default theme for every player.'
    }
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Deep midnight hues with luminous text for night sessions.',
    preview: {
      background: 'linear-gradient(135deg, #0b1224 0%, #1a2a4a 60%, #3b82f6 100%)',
      foreground: '#e0f2ff'
    },
    colorScheme: 'dark',
    unlock: {
      type: THEME_UNLOCK_TYPES.ALWAYS,
      tag: 'Always available',
      description: 'Ideal for low-light play.'
    }
  },
  {
    id: 'contrast',
    name: 'Contrast',
    description: 'High-contrast palette that emphasizes clarity and legibility.',
    preview: {
      background: 'linear-gradient(135deg, #000000 0%, #202020 55%, #00d5ff 100%)',
      foreground: '#ffffff'
    },
    colorScheme: 'dark',
    unlock: {
      type: THEME_UNLOCK_TYPES.ALWAYS,
      tag: 'Always available',
      description: 'Designed for maximum readability.'
    }
  },
  {
    id: 'fruitger-aero',
    name: 'Fruitger Aero',
    description: 'Placeholder for glossy gradients and floating glass vibes.',
    preview: {
      background: 'linear-gradient(135deg, #00e4ff 0%, #0b5dff 55%, #ff9de2 100%)',
      foreground: '#ffffff'
    },
    colorScheme: 'light',
    unlock: {
      type: THEME_UNLOCK_TYPES.ACHIEVEMENT,
      tag: 'Achievement unlock',
      description: 'Unlock by completing a future achievement (coming soon).',
      available: false,
      achievementIds: []
    }
  },
  {
    id: 'vaporwave',
    name: 'Vaporwave',
    description: 'A neon nostalgia palette inspired by outrun sunsets.',
    preview: {
      background: 'linear-gradient(135deg, #ff71c1 0%, #6c5ce7 100%)',
      foreground: '#ffffff'
    },
    colorScheme: 'light',
    unlock: {
      type: THEME_UNLOCK_TYPES.ACHIEVEMENT,
      tag: 'Achievement unlock',
      description: 'Earn a future collection achievement to unlock (coming soon).',
      available: false,
      achievementIds: []
    }
  },
  {
    id: 'solarpunk',
    name: 'Solarpunk',
    description: 'Sunlit greens and optimistic copper accents.',
    preview: {
      background: 'linear-gradient(135deg, #87f985 0%, #3ddad7 100%)',
      foreground: '#0f2d2d'
    },
    colorScheme: 'light',
    unlock: {
      type: THEME_UNLOCK_TYPES.LEVEL,
      tag: 'Level unlock',
      description: 'Complete an upcoming Solarpunk milestone (coming soon).',
      available: false,
      levelIds: []
    }
  },
  {
    id: 'cottagecore',
    name: 'Cottagecore',
    description: 'Warm sunlight, soft florals, and cozy parchment textures.',
    preview: {
      background: 'linear-gradient(135deg, #f2d7b3 0%, #c5e6a0 100%)',
      foreground: '#5b3a24'
    },
    colorScheme: 'light',
    unlock: {
      type: THEME_UNLOCK_TYPES.LEVEL,
      tag: 'Level unlock',
      description: 'Reach a future story checkpoint to unlock (coming soon).',
      available: false,
      levelIds: []
    }
  },
  {
    id: 'liminal',
    name: 'Liminal',
    description: 'Dreamy gradients inspired by empty hallways and in-between spaces.',
    preview: {
      background: 'linear-gradient(135deg, #5a5ce0 0%, #cbbcff 100%)',
      foreground: '#ffffff'
    },
    colorScheme: 'dark',
    unlock: {
      type: THEME_UNLOCK_TYPES.ACHIEVEMENT,
      tag: 'Achievement unlock',
      description: 'Unlock through a future exploration achievement (coming soon).',
      available: false,
      achievementIds: []
    }
  },
  {
    id: 'y2k',
    name: 'Y2K',
    description: 'Chromed gradients and iridescent highlights straight from 2001.',
    preview: {
      background: 'linear-gradient(135deg, #f7f3ff 0%, #ff9ff3 50%, #1dd1a1 100%)',
      foreground: '#1a1a1a'
    },
    colorScheme: 'light',
    unlock: {
      type: THEME_UNLOCK_TYPES.ACHIEVEMENT,
      tag: 'Achievement unlock',
      description: 'Collect a retro achievement in a future update (coming soon).',
      available: false,
      achievementIds: []
    }
  },
  {
    id: 'brutalism',
    name: 'Brutalism',
    description: 'Bold blocks, heavy lines, and unapologetic contrast.',
    preview: {
      background: 'linear-gradient(135deg, #2d2d2d 0%, #ffdd33 100%)',
      foreground: '#0f0f0f'
    },
    colorScheme: 'dark',
    unlock: {
      type: THEME_UNLOCK_TYPES.LEVEL,
      tag: 'Level unlock',
      description: 'Clear a future precision challenge to unlock (coming soon).',
      available: false,
      levelIds: []
    }
  },
  {
    id: 'pastel',
    name: 'Pastel',
    description: 'Delicate sherbets and airy candy tones.',
    preview: {
      background: 'linear-gradient(135deg, #fcd5ce 0%, #f8edeb 50%, #ffe5ec 100%)',
      foreground: '#563a3d'
    },
    colorScheme: 'light',
    unlock: {
      type: THEME_UNLOCK_TYPES.LEVEL,
      tag: 'Level unlock',
      description: 'Complete a future puzzle gauntlet to unlock (coming soon).',
      available: false,
      levelIds: []
    }
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    description: 'A stark black and white presentation for a minimalist feel.',
    preview: {
      background: 'linear-gradient(135deg, #111111 0%, #ffffff 100%)',
      foreground: '#000000'
    },
    colorScheme: 'dark',
    unlock: {
      type: THEME_UNLOCK_TYPES.LEVEL,
      tag: 'Level unlock',
      description: 'Beat an upcoming endurance route to unlock (coming soon).',
      available: false,
      levelIds: []
    }
  },
  {
    id: 'surrealist',
    name: 'Surrealist',
    description: 'A vibrant collision of impossible colors.',
    preview: {
      background: 'linear-gradient(135deg, #8a2387 0%, #e94057 50%, #f27121 100%)',
      foreground: '#ffffff'
    },
    colorScheme: 'dark',
    unlock: {
      type: THEME_UNLOCK_TYPES.ACHIEVEMENT,
      tag: 'Achievement unlock',
      description: 'Unlock through a future creativity achievement (coming soon).',
      available: false,
      achievementIds: []
    }
  },
  {
    id: 'parallax',
    name: 'Parallax',
    description: 'Layered blues and violets with floating depth.',
    preview: {
      background: 'linear-gradient(135deg, #3b82f6 0%, #9333ea 100%)',
      foreground: '#f1f5ff'
    },
    colorScheme: 'dark',
    unlock: {
      type: THEME_UNLOCK_TYPES.ACHIEVEMENT,
      tag: 'Achievement unlock',
      description: 'Earn a future mastery achievement to unlock (coming soon).',
      available: false,
      achievementIds: []
    }
  },
  {
    id: 'retrofuture',
    name: 'Retrofuture',
    description: 'Bright synth tones with holo-flecked gradients.',
    preview: {
      background: 'linear-gradient(135deg, #0ea5e9 0%, #f472b6 100%)',
      foreground: '#101828'
    },
    colorScheme: 'light',
    unlock: {
      type: THEME_UNLOCK_TYPES.LEVEL,
      tag: 'Level unlock',
      description: 'Finish a future time-trial challenge to unlock (coming soon).',
      available: false,
      levelIds: []
    }
  },
  {
    id: 'hypnagogic',
    name: 'Hypnagogic',
    description: 'A twilight gradient between waking and dreaming.',
    preview: {
      background: 'linear-gradient(135deg, #1f005c 0%, #5b0060 55%, #870160 100%)',
      foreground: '#f6e1ff'
    },
    colorScheme: 'dark',
    unlock: {
      type: THEME_UNLOCK_TYPES.ACHIEVEMENT,
      tag: 'Achievement unlock',
      description: 'Unlock via a future nightly achievement (coming soon).',
      available: false,
      achievementIds: []
    }
  },
  {
    id: 'biomorphic',
    name: 'Biomorphic',
    description: 'Flowing greens inspired by living architecture.',
    preview: {
      background: 'linear-gradient(135deg, #a3e635 0%, #22c55e 100%)',
      foreground: '#0f3f20'
    },
    colorScheme: 'light',
    unlock: {
      type: THEME_UNLOCK_TYPES.LEVEL,
      tag: 'Level unlock',
      description: 'Defeat a future organic labyrinth to unlock (coming soon).',
      available: false,
      levelIds: []
    }
  },
  {
    id: 'infrared',
    name: 'Infrared',
    description: 'A heat-map palette with molten reds and magenta.',
    preview: {
      background: 'linear-gradient(135deg, #ff512f 0%, #dd2476 100%)',
      foreground: '#ffffff'
    },
    colorScheme: 'dark',
    unlock: {
      type: THEME_UNLOCK_TYPES.LEVEL,
      tag: 'Level unlock',
      description: 'Master a future expert route to unlock (coming soon).',
      available: false,
      levelIds: []
    }
  },
  {
    id: 'ultraviolet',
    name: 'Ultraviolet',
    description: 'Glowing purples and electric indigo lines.',
    preview: {
      background: 'linear-gradient(135deg, #5b21b6 0%, #9f7aea 100%)',
      foreground: '#fdf4ff'
    },
    colorScheme: 'dark',
    unlock: {
      type: THEME_UNLOCK_TYPES.ACHIEVEMENT,
      tag: 'Achievement unlock',
      description: 'Unlock through a future spectrum achievement (coming soon).',
      available: false,
      achievementIds: []
    }
  }
];

const THEMES_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));
const DEFAULT_THEME_ID = 'light';
const ALWAYS_AVAILABLE_THEME_IDS = THEMES
  .filter((theme) => (theme.unlock?.type === THEME_UNLOCK_TYPES.ALWAYS))
  .map((theme) => theme.id);

function getThemeById(id) {
  return THEMES_BY_ID.get(String(id));
}

function createDefaultThemeState() {
  return {
    active: DEFAULT_THEME_ID,
    unlocked: new Set(ALWAYS_AVAILABLE_THEME_IDS)
  };
}

/* ---------------- Packs data (fetched with fallback) ---------------- */

let PACKS_DB = null;
let PROGRESS = null; // { completed: Set<string>, unlockedPacks: Set<string>, unlockedLevels: Set<string>, bestScores: Record<string, number>, achievements: Set<string>, themes: { active: string, unlocked: Set<string> } }
let progressSaveWarned = false;

/* ---------------- Progress (localStorage) ---------------- */

const INITIAL_UNLOCKED_PACKS = ['tutorial'];
const INITIAL_UNLOCKED_LEVELS = ['101', '102', '103'];

function createDefaultProgress() {
  return {
    completed: new Set(),
    unlockedPacks: new Set(INITIAL_UNLOCKED_PACKS),
    unlockedLevels: new Set(INITIAL_UNLOCKED_LEVELS),
    bestScores: Object.create(null),
    achievements: new Set(),
    themes: createDefaultThemeState()
  };
}

function collectIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value === 'object') return Object.keys(value).filter((key) => Boolean(value[key]));
  return [];
}

function migrateThemeState(raw, baseState = createDefaultThemeState()) {
  const fallback = baseState || createDefaultThemeState();
  const unlocked = new Set([
    ...fallback.unlocked,
    ...collectIds(raw?.unlocked).map((id) => String(id))
  ]);
  let active = typeof raw?.active === 'string' ? raw.active : fallback.active;
  if (!unlocked.has(active)) {
    if (unlocked.has(DEFAULT_THEME_ID)) {
      active = DEFAULT_THEME_ID;
    } else {
      const first = unlocked.values().next().value;
      active = first ? String(first) : DEFAULT_THEME_ID;
      unlocked.add(active);
    }
  }
  return { active, unlocked };
}

function migrateProgress(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = createDefaultProgress();
  const completed = new Set([...base.completed, ...collectIds(raw.completed).map(String)]);
  const unlockedPacks = new Set([...base.unlockedPacks, ...collectIds(raw.unlockedPacks).map(String)]);
  const unlockedLevels = new Set([...base.unlockedLevels, ...collectIds(raw.unlockedLevels).map(String)]);
  const bestScores = Object.create(null);
  const srcBest = (raw.bestScores && typeof raw.bestScores === 'object') ? raw.bestScores : {};
  for (const [key, value] of Object.entries(srcBest)) {
    const turns = Number(value);
    if (Number.isFinite(turns) && turns > 0) {
      bestScores[String(key)] = turns;
    }
  }
  const achievements = new Set([...base.achievements, ...collectIds(raw.achievements).map(String)]);
  const themes = migrateThemeState(raw.themes, base.themes);
  return { completed, unlockedPacks, unlockedLevels, bestScores, achievements, themes };
}

function ensureThemeState(progress = PROGRESS) {
  if (!progress) return createDefaultThemeState();
  if (!progress.themes || typeof progress.themes !== 'object') {
    progress.themes = createDefaultThemeState();
    return progress.themes;
  }
  const state = progress.themes;
  if (!(state.unlocked instanceof Set)) {
    state.unlocked = new Set(collectIds(state.unlocked).map((id) => String(id)));
  }
  ALWAYS_AVAILABLE_THEME_IDS.forEach((id) => state.unlocked.add(id));
  if (typeof state.active !== 'string') {
    state.active = DEFAULT_THEME_ID;
  }
  if (!state.unlocked.has(state.active)) {
    if (state.unlocked.has(DEFAULT_THEME_ID)) {
      state.active = DEFAULT_THEME_ID;
    } else {
      const first = state.unlocked.values().next().value;
      if (first) {
        state.active = String(first);
      } else {
        state.unlocked.add(DEFAULT_THEME_ID);
        state.active = DEFAULT_THEME_ID;
      }
    }
  }
  return state;
}

function getThemeState(progress = PROGRESS) {
  const state = ensureThemeState(progress);
  return {
    active: state.active,
    unlocked: new Set(state.unlocked)
  };
}

function applyThemeById(themeId) {
  const theme = getThemeById(themeId) || getThemeById(DEFAULT_THEME_ID);
  if (!theme) return;
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  if (theme.colorScheme) {
    root.style.setProperty('color-scheme', theme.colorScheme);
  } else {
    root.style.removeProperty('color-scheme');
  }
}

function syncThemeUnlocks(progress = PROGRESS) {
  if (!progress) return [];
  const state = ensureThemeState(progress);
  const before = new Set(state.unlocked);
  const completed = progress.completed instanceof Set
    ? progress.completed
    : new Set(collectIds(progress.completed).map(String));
  const achievements = progress.achievements instanceof Set
    ? progress.achievements
    : new Set(collectIds(progress.achievements).map(String));

  for (const theme of THEMES) {
    const unlock = theme.unlock || {};
    if (unlock.type === THEME_UNLOCK_TYPES.ALWAYS) {
      state.unlocked.add(theme.id);
      continue;
    }
    if (unlock.available === false) continue;
    if (unlock.type === THEME_UNLOCK_TYPES.LEVEL) {
      const ids = Array.isArray(unlock.levelIds) && unlock.levelIds.length
        ? unlock.levelIds
        : (unlock.levelId ? [unlock.levelId] : []);
      if (!ids.length) continue;
      const match = unlock.mode === 'any'
        ? ids.some((id) => completed.has(String(id)))
        : ids.every((id) => completed.has(String(id)));
      if (match) state.unlocked.add(theme.id);
    } else if (unlock.type === THEME_UNLOCK_TYPES.ACHIEVEMENT) {
      const ids = Array.isArray(unlock.achievementIds) && unlock.achievementIds.length
        ? unlock.achievementIds
        : (unlock.achievementId ? [unlock.achievementId] : []);
      if (!ids.length) continue;
      const match = unlock.mode === 'any'
        ? ids.some((id) => achievements.has(String(id)))
        : ids.every((id) => achievements.has(String(id)));
      if (match) state.unlocked.add(theme.id);
    }
  }

  const unlockedNow = state.unlocked;
  return [...unlockedNow].filter((id) => !before.has(id));
}

function ensureThemesInitialized(progress = PROGRESS) {
  if (!progress) return { active: DEFAULT_THEME_ID, activeChanged: false, unlocked: [] };
  const state = ensureThemeState(progress);
  const newlyUnlocked = syncThemeUnlocks(progress);
  const beforeActive = state.active;
  if (!state.unlocked.has(state.active)) {
    if (state.unlocked.has(DEFAULT_THEME_ID)) {
      state.active = DEFAULT_THEME_ID;
    } else {
      const first = state.unlocked.values().next().value;
      state.active = first ? String(first) : DEFAULT_THEME_ID;
      state.unlocked.add(state.active);
    }
  }
  applyThemeById(state.active);
  return { active: state.active, activeChanged: state.active !== beforeActive, unlocked: newlyUnlocked };
}

function setActiveTheme(themeId, opts = {}) {
  const progress = opts.progress || loadProgress();
  const state = ensureThemeState(progress);
  const before = state.active;
  let target = String(themeId);
  if (!state.unlocked.has(target)) {
    if (opts.allowFallback === false) {
      return { changed: false, active: before };
    }
    if (state.unlocked.has(before)) {
      target = before;
    } else if (state.unlocked.has(DEFAULT_THEME_ID)) {
      target = DEFAULT_THEME_ID;
    } else {
      const first = state.unlocked.values().next().value;
      target = first ? String(first) : DEFAULT_THEME_ID;
      state.unlocked.add(target);
    }
  }
  state.active = target;
  applyThemeById(target);
  const changed = target !== before;
  if (!opts.skipSave && changed) saveProgress();
  return { changed, active: target };
}

function formatThemeNames(ids) {
  const names = ids.map((id) => {
    const theme = getThemeById(id);
    return theme ? theme.name : String(id);
  });
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  const last = names.pop();
  return `${names.join(', ')} and ${last}`;
}

function loadProgress() {
  if (PROGRESS) return PROGRESS;
  let stored = null;
  try {
    stored = safeJSONParse(localStorage.getItem(LS_KEY), null);
  } catch {
    stored = null;
  }
  const migrated = migrateProgress(stored);
  PROGRESS = migrated ?? createDefaultProgress();
  const tutorialUnlocksChanged = applyTutorialUnlocks(PROGRESS);
  const themeInit = ensureThemesInitialized(PROGRESS);
  if (!migrated || tutorialUnlocksChanged || themeInit.activeChanged || themeInit.unlocked.length) saveProgress();
  return PROGRESS;
}

function saveProgress() {
  if (!PROGRESS) return;
  try {
    const achievements = PROGRESS.achievements instanceof Set
      ? PROGRESS.achievements
      : new Set(collectIds(PROGRESS.achievements).map(String));
    const themeState = ensureThemeState(PROGRESS);
    const data = {
      completed: [...PROGRESS.completed],
      unlockedPacks: [...PROGRESS.unlockedPacks],
      unlockedLevels: [...PROGRESS.unlockedLevels],
      bestScores: { ...PROGRESS.bestScores },
      achievements: [...achievements],
      themes: {
        active: themeState.active,
        unlocked: [...themeState.unlocked]
      }
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (err) {
    if (!progressSaveWarned) {
      console.warn('[progress] save failed; continuing without persistence', err);
      progressSaveWarned = true;
    }
  }
}

function syncPacksUnlockedFromProgress(progress = PROGRESS, packsDb = PACKS_DB) {
  if (!progress || !packsDb) return;
  try {
    for (const pack of packsDb.list) {
      pack.unlocked = progress.unlockedPacks.has(pack.id) || Boolean(pack.unlocked);
    }
  } catch {}
}

/* ---------------- Small UI toasts for unlocks ---------------- */
function showUnlockToast(message, opts) {
  showToast(message, opts);
}

function unlockLevel(id, progress = PROGRESS) {
  if (!progress) return;
  progress.unlockedLevels.add(String(id));
}
function unlockPack(id, progress = PROGRESS) {
  if (!progress) return;
  progress.unlockedPacks.add(String(id));
}
function markCompleted(id, progress = PROGRESS) {
  if (!progress) return;
  progress.completed.add(String(id));
}

function recordBest(id, turns, progress = PROGRESS) {
  if (!progress) return;
  const key = String(id);
  const t = Math.max(1, Number(turns || 0));
  const prev = progress.bestScores[key];
  if (!prev || t < prev) progress.bestScores[key] = t;
}

// Apply tutorial gating: start with 101-103; then completing 101-103 → unlock 104-105; completing 104-105 → unlock 106-107; completing 106-107 → unlock 108-110.
function applyTutorialUnlocks(progress = PROGRESS) {
  if (!progress) return false;
  const beforeLevels = progress.unlockedLevels.size;
  const beforePacks = progress.unlockedPacks.size;
  const completed = progress.completed;

  INITIAL_UNLOCKED_LEVELS.forEach((id) => unlockLevel(id, progress));
  if (INITIAL_UNLOCKED_LEVELS.every((id) => completed.has(id))) {
    ['104', '105'].forEach((id) => unlockLevel(id, progress));
    if (['104', '105'].every((id) => completed.has(id))) {
      ['106', '107'].forEach((id) => unlockLevel(id, progress));
      if (['106', '107'].every((id) => completed.has(id))) {
        ['108', '109', '110'].forEach((id) => unlockLevel(id, progress));
      }
    }
  }

  if (completed.has('105')) unlockPack('singles', progress);
  if (completed.has('110')) unlockPack('basics', progress);

  return progress.unlockedLevels.size !== beforeLevels || progress.unlockedPacks.size !== beforePacks;
}

function applyDevOverrides(progress, packsDb) {
  if (!DEV_FORCE_UNLOCK_ALL || !progress || !packsDb) return;
  for (const pack of packsDb.list) {
    pack.unlocked = true;
    progress.unlockedPacks.add(String(pack.id));
    for (const level of pack.puzzles || []) {
      if (level?.id != null) progress.unlockedLevels.add(String(level.id));
    }
  }
}

async function loadPacks() {
  if (PACKS_DB) return PACKS_DB;
  try {
    const res = await fetch('./packs.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`packs.json ${res.status}`);
    const text = await res.text();
    const json = safeJSONParse(text, null);
    if (!json) throw new Error('packs.json parse failed');
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
  const progress = loadProgress();
  const packsInput = Array.isArray(raw?.packs) ? raw.packs : [];
  const packs = [];
  const byId = Object.create(null);

  for (const entry of packsInput) {
    if (!entry) continue;
    const rawId = entry.id != null ? String(entry.id).trim() : '';
    if (!rawId) continue;
    const puzzles = Array.isArray(entry.puzzles)
      ? entry.puzzles.map((pz) => {
          if (!pz || pz.id == null) return null;
          const id = String(pz.id).trim();
          if (!id) return null;
          return { ...pz, id };
        }).filter(Boolean)
      : [];
    const sectionId = entry.section ? String(entry.section) : 'variety';
    const pack = {
      ...entry,
      id: rawId,
      section: sectionId,
      puzzles,
      unlocked: progress?.unlockedPacks.has(rawId) || Boolean(entry.unlocked)
    };
    packs.push(pack);
    byId[rawId] = pack;
  }

  const sectionsById = Object.create(null);
  const sectionsList = [];
  const sourceSections = Array.isArray(raw?.sections) ? raw.sections : [];

  const ensureSection = (section) => {
    if (!section) return;
    const id = section.id != null ? String(section.id).trim() : '';
    if (!id || sectionsById[id]) return;
    const name = section.name || id.replace(/[-_]/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()).trim() || 'Packs';
    const description = section.description || '';
    const normalized = { id, name, description };
    sectionsById[id] = normalized;
    sectionsList.push(normalized);
  };

  sourceSections.forEach((section) => ensureSection(section));
  for (const pack of packs) {
    if (!sectionsById[pack.section]) {
      ensureSection({ id: pack.section });
    }
  }
  if (sectionsList.length === 0) {
    ensureSection({ id: 'variety', name: 'Packs', description: 'More puzzles coming soon.' });
  }

  applyTutorialUnlocks(progress);

  for (const pack of packs) {
    pack.unlocked = progress.unlockedPacks.has(pack.id) || Boolean(pack.unlocked);
  }

  try {
    const curriculum = packs.filter((pack) => pack.section === 'curriculum');
    for (let i = 0; i < curriculum.length; i += 1) {
      const pack = curriculum[i];
      let unlocked = false;
      if (i === 0) {
        unlocked = true;
      } else {
        const prev = curriculum[i - 1];
        const prevIds = (prev.puzzles || []).map((pz) => String(pz.id));
        const allPrevCompleted = prevIds.length === 0 || prevIds.every((id) => progress.completed.has(id));
        unlocked = allPrevCompleted;
      }
      pack.unlocked = unlocked;
      if (unlocked) progress.unlockedPacks.add(pack.id); else progress.unlockedPacks.delete(pack.id);
    }
  } catch {}

  const packsDb = { list: packs, byId, sections: { list: sectionsList, byId: sectionsById } };
  applyDevOverrides(progress, packsDb);
  saveProgress();
  return packsDb;
}

/* ---------------- Tiny router ---------------- */

const routes = [
  { match: /^#\/?$/, view: HomeView },
  { match: /^#\/play\/?$/, view: PacksView },
  { match: /^#\/play\/([a-z0-9-]+)\/?$/, view: PackView },        // <— dynamic pack route
  { match: /^#\/play\/level\/(\d{3})\/?$/, view: GameView },
  { match: /^#\/how\/?$/, view: HowToPlayView },
  { match: /^#\/editor\/test\/?$/, view: EditorTestView },
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

// Prime progress/theme state before routing to avoid flashes when loading stored themes.
loadProgress();

window.addEventListener('hashchange', route);
window.addEventListener('load', route);

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
  const exclude = new Set(DAILY_EXCLUDE.map(String));
  return ids.filter((id) => !exclude.has(id));
}

async function renderDailyGame(){
  const packs = await loadPacks();
  const ids = getAllLevelIds(packs);
  const key = new Date().toLocaleDateString('en-CA');
  const pick = ids.length ? ids[ hashStr(key) % ids.length ] : DAILY_FALLBACK_LEVEL;
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
    const disabledAttrs = unlocked ? '' : 'aria-disabled="true" tabindex="-1"';
    return `
      <a class="${cardCls}" href="${href}" ${disabledAttrs}>
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
    const disabledAttrs = locked ? 'aria-disabled=\"true\" tabindex=\"-1\"' : '';
    return `
      <a class="puzzle-tile ${locked ? 'puzzle-tile--locked' : ''}" href="${href}" ${disabledAttrs}>
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

async function GameView(match, opts = {}) {
  document.documentElement.classList.remove('is-daily');

  const levelOverride = opts.levelData || null;
  const matchId = Array.isArray(match) && match.length > 1 ? String(match[1]) : '';
  const resolvedLevelId = levelOverride?.id != null ? String(levelOverride.id) : (matchId || '001');

  let backHref = opts.backHrefOverride || '#/play';
  let nextHref = opts.nextHrefOverride || '';
  if (!levelOverride && !opts.nextHrefOverride) {
    try {
      const packs = await loadPacks();
      const found = packs.list.find(pk => (pk.puzzles || []).some(pz => String(pz.id) === String(resolvedLevelId)));
      if (found) {
        backHref = `#/play/${found.id}`;
        const ix = (found.puzzles || []).findIndex(pz => String(pz.id) === String(resolvedLevelId));
        const next = ix >= 0 ? (found.puzzles || [])[ix + 1] : null;
        if (next && next.id) nextHref = `#/play/level/${next.id}`;
      }
    } catch {}
  }

  const level = levelOverride || await loadLevel(resolvedLevelId);

  const parCount = Math.max(0, Math.min(10, Number(level.par || 0)));
  const bestTurns = (!opts.skipProgress && !levelOverride)
    ? (PROGRESS?.bestScores?.[String(resolvedLevelId)] || null)
    : null;
  const trackHTML = Array.from({ length: 10 }, (_, i) => {
    const isFill = i < parCount;
    const isBest = bestTurns && bestTurns >= 1 && bestTurns <= 10 && i === (bestTurns - 1);
    const cls = `par-square${isFill ? ' par-square--anim' : ''}${isBest ? ' par-square--best' : ''}`;
    const style = isFill ? ` style=\"--i:${i}\"` : '';
    return `<span class=\"${cls}\"${style}></span>`;
  }).join('');

  const showNextButton = Boolean(nextHref) && !opts.disableNextButton;
  const backLabel = opts.backLabel || '← Back';
  const nextLabel = opts.nextButtonLabel || 'Next →';
  const levelTitle = level.name || (levelOverride ? 'Editor Test' : `Level ${resolvedLevelId}`);

  app().innerHTML = `
    <section class="section view">
      <div class="game-toolbar game-toolbar--overlay" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div><a class="btn" href="${backHref}">${backLabel}</a></div>
        <div>${showNextButton ? `<a id=\"btnNext\" class=\"btn btn--primary\" href=\"${nextHref}\" style=\"display:none\">${nextLabel}</a>` : ''}</div>
      </div>
      <div class="level-meta">
        <div class="level-meta__title">${levelTitle}</div>
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
      if (showNextButton) {
        const nextBtn = document.getElementById('btnNext');
        if (nextBtn) nextBtn.style.display = '';
      }
      if (opts.skipProgress) {
        const usedTurns = Math.max(1, (finalState?.turn || 1) - 1);
        showUnlockToast(`✅ Test run complete in ${usedTurns} turn${usedTurns === 1 ? '' : 's'}.`);
        if (typeof opts.onWin === 'function') opts.onWin({ state: finalState });
        return;
      }

      loadProgress();
      const prevLevels = new Set(PROGRESS.unlockedLevels);
      const prevPacks = new Set(PROGRESS.unlockedPacks);
      const id = String(level.id || resolvedLevelId);
      markCompleted(id);
      const used = Math.max(1, (finalState?.turn || 1) - 1);
      recordBest(id, used);
      if (level.meta?.id) markCompleted(String(level.meta.id));
      applyTutorialUnlocks();
      const newlyUnlockedThemes = syncThemeUnlocks(PROGRESS);
      saveProgress();
      syncPacksUnlockedFromProgress();

      const newlyUnlockedLevels = [...PROGRESS.unlockedLevels].filter(v => !prevLevels.has(v));
      const newlyUnlockedPacks = [...PROGRESS.unlockedPacks].filter(v => !prevPacks.has(v));
      const usedTurns = Math.max(1, (finalState?.turn || 1) - 1);
      const par = Number(level.par || 0);
      const diff = usedTurns - par;
      let perf = par ? (diff < 0 ? `Under par by ${Math.abs(diff)}!` : diff === 0 ? `Right at par.` : `Over par by ${diff}.`) : '';
      showUnlockToast(`🎉 Nice! You finished in ${usedTurns}. ${perf}`.trim());
      if (newlyUnlockedThemes.length) {
        const themeNames = formatThemeNames(newlyUnlockedThemes);
        showUnlockToast(`🎨 Theme unlocked: ${themeNames}.`);
      }
      if (typeof opts.onWin === 'function') opts.onWin({ state: finalState });
    }
  });

  const restartOptions = levelOverride ? { ...opts, levelData: levelOverride } : { ...opts };
  document.getElementById('btnHardReset')?.addEventListener('click', () => {
    GameView(['', resolvedLevelId], restartOptions);
  });
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

function renderThemeCard(theme, themeState) {
  const unlocked = themeState.unlocked.has(theme.id);
  const active = themeState.active === theme.id;
  const comingSoon = theme.unlock?.available === false;
  const classes = ['theme-card'];
  if (active) classes.push('theme-card--active');
  if (!unlocked) classes.push('theme-card--locked');
  if (comingSoon) classes.push('theme-card--placeholder');
  const previewVars = [];
  if (theme.preview?.background) previewVars.push(`--theme-preview:${theme.preview.background}`);
  if (theme.preview?.foreground) previewVars.push(`--theme-preview-text:${theme.preview.foreground}`);
  const previewStyle = previewVars.length ? ` style="${previewVars.join('; ')}"` : '';
  const unlockTag = theme.unlock?.tag || (theme.unlock?.type === THEME_UNLOCK_TYPES.ACHIEVEMENT
    ? 'Achievement unlock'
    : theme.unlock?.type === THEME_UNLOCK_TYPES.LEVEL
      ? 'Level unlock'
      : 'Unlock');
  const unlockDescription = theme.unlock?.description || '';
  let badgeHTML = '';
  if (active) badgeHTML = '<span class="theme-card__badge theme-card__badge--active">Active</span>';
  else if (!unlocked) badgeHTML = '<span class="theme-card__badge theme-card__badge--locked">Locked</span>';
  let actionHTML = '';
  if (unlocked) {
    const buttonClasses = ['btn', 'theme-card__action'];
    if (!active) buttonClasses.push('btn--primary');
    const disabledAttrs = active ? ' disabled aria-disabled="true"' : '';
    actionHTML = `<button class="${buttonClasses.join(' ')}" data-theme-id="${theme.id}"${disabledAttrs}>${active ? 'Active' : 'Use Theme'}</button>`;
  } else {
    const label = comingSoon ? 'Coming soon' : 'Locked';
    actionHTML = `<button class="btn theme-card__action" disabled aria-disabled="true">${label}</button>`;
  }
  return `
    <article class="${classes.join(' ')}"${previewStyle}>
      <div class="theme-card__preview" aria-hidden="true">
        <div class="theme-card__preview-grid">
          <span class="theme-card__preview-text">Aa</span>
        </div>
      </div>
      <div class="theme-card__body">
        <div class="theme-card__header">
          <h3 class="theme-card__name">${theme.name}</h3>
          ${badgeHTML}
        </div>
        <p class="theme-card__desc">${theme.description}</p>
        <div class="theme-card__unlock">
          <span class="theme-card__tag">${unlockTag}</span>
          <span class="theme-card__unlock-text">${unlockDescription}</span>
        </div>
      </div>
      <div class="theme-card__footer">
        ${actionHTML}
      </div>
    </article>
  `;
}

function ThemesView(){
  document.documentElement.classList.remove('is-daily');
  const mount = app();
  if (!mount) return;
  const progress = loadProgress();
  const themeState = getThemeState(progress);
  const activeTheme = getThemeById(themeState.active) || getThemeById(DEFAULT_THEME_ID);
  const cardsHtml = THEMES.map((theme) => renderThemeCard(theme, themeState)).join('');
  mount.innerHTML = `
    <section class="section view theme-view" style="max-width:900px; margin:auto; padding:20px;">
      <h2>Themes</h2>
      <p class="lead">Choose a look for Wordgrid. Unlock additional themes by completing future levels and achievements.</p>
      <div class="theme-current">Current theme: <span class="theme-current__name">${activeTheme ? activeTheme.name : themeState.active}</span></div>
      <div class="theme-grid">
        ${cardsHtml}
      </div>
      <div class="game-toolbar" style="margin: 24px 0 0;">
        <a class="btn" href="#/">← Back</a>
      </div>
    </section>
  `;

  mount.querySelectorAll('.theme-card__action[data-theme-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const themeId = btn.getAttribute('data-theme-id');
      const { changed, active } = setActiveTheme(themeId);
      if (changed) {
        const theme = getThemeById(active);
        showUnlockToast(`Theme switched to ${theme ? theme.name : active}.`);
        ThemesView();
      }
    });
  });
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

let EDITOR_DRAFT = null;
let EDITOR_TEST_LEVEL = null;

function createEmptyEditorDraft() {
  return {
    rows: 5,
    cols: 5,
    goal: { r: 0, c: 0 },
    seeds: [],
    specials: [],
    deck: [],
    startingHand: [],
    allowedWords: [],
    allowedWordsText: '',
    notes: '',
    meta: { id: '', name: '', par: 7, intro: '' },
    seedText: 'CAT',
    portalGroup: 'A',
    lastTool: 'seed'
  };
}

function getEditorDraft() {
  if (!EDITOR_DRAFT) EDITOR_DRAFT = createEmptyEditorDraft();
  return EDITOR_DRAFT;
}

function parseAllowedWordsInput(text) {
  return (text || '')
    .split(/[\n,]/)
    .map((w) => w.trim())
    .filter(Boolean);
}

function pruneDraftToBounds(draft) {
  draft.seeds = draft.seeds.filter((s) => s.r < draft.rows && s.c < draft.cols);
  draft.specials = draft.specials.filter((s) => s.r < draft.rows && s.c < draft.cols);
  if (draft.goal.r >= draft.rows || draft.goal.c >= draft.cols) {
    draft.goal = { r: 0, c: 0 };
  }
}

function buildEditorRawLevel(draft) {
  const rows = Math.max(1, Math.min(10, Number(draft.rows || 5)));
  const cols = Math.max(1, Math.min(10, Number(draft.cols || 5)));
  const specials = draft.specials.map((s) => (
    s.type === 'portal'
      ? { r: s.r, c: s.c, type: 'portal', group: s.group }
      : { r: s.r, c: s.c, type: 'blocked' }
  ));
  return {
    meta: {
      id: String(draft.meta?.id || ''),
      name: (draft.meta?.name || '').trim() || 'Custom Level',
      par: Math.max(0, Number.parseInt(draft.meta?.par, 10) || 0),
      intro: draft.meta?.intro || ''
    },
    board: {
      size: [rows, cols],
      goal: [draft.goal?.r ?? 0, draft.goal?.c ?? 0],
      seeds: (draft.seeds || []).map((s) => ({ text: s.text, r: s.r, c: s.c, dir: s.dir || 'H' })),
      specials
    },
    deck: [...(draft.deck || [])],
    startingHand: [...(draft.startingHand || [])],
    allowedWords: [...(draft.allowedWords || [])],
    notes: draft.notes || ''
  };
}

function EditorView() {
  const E = getEditorDraft();

  app().innerHTML = `
    <section class="section view" style="max-width:1080px; margin:auto;">
      <div class="editor-toolbar">
        <div><a class="btn" href="#/">← Back</a></div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button id="btnTest" class="btn">Test</button>
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
            <div class="field"><label for="metaPar">Par</label><input id="metaPar" type="number" min="0" style="width:100px"></div>
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
            <label>Seed text</label><input id="seedText" type="text">
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

  const byId = (id) => document.getElementById(id);
  const rowsEl = byId('edRows');
  const colsEl = byId('edCols');
  const seedTextEl = byId('seedText');
  const portalGroupEl = byId('portalGroup');
  const allowTA = byId('allowTA');
  const notesTA = byId('notesTA');
  const deckInput = byId('deckInput');
  const deckList = byId('deckList');
  const btnAddDeck = byId('btnAddDeck');
  const btnTest = byId('btnTest');
  const btnExport = byId('btnExport');
  const metaIdEl = byId('metaId');
  const metaNameEl = byId('metaName');
  const metaParEl = byId('metaPar');
  const metaIntroEl = byId('metaIntro');

  rowsEl.value = E.rows;
  colsEl.value = E.cols;
  seedTextEl.value = E.seedText || '';
  portalGroupEl.value = E.portalGroup || 'A';
  metaIdEl.value = E.meta?.id || '';
  metaNameEl.value = E.meta?.name || '';
  metaParEl.value = E.meta?.par ?? 7;
  metaIntroEl.value = E.meta?.intro || '';
  allowTA.value = E.allowedWordsText || (E.allowedWords?.join('\n') || '');
  notesTA.value = E.notes || '';

  let tool = E.lastTool || 'seed';
  let portalGroup = portalGroupEl.value || 'A';

  function specialAt(r, c) { return E.specials.find((s) => s.r === r && s.c === c); }
  function seedAt(r, c) { return E.seeds.find((s) => s.r === r && s.c === c); }

  function edSay(msg) {
    byId('edMsg').textContent = msg || '';
  }

  function renderDeck() {
    deckList.innerHTML = E.deck.map((t, i) => `
      <div style="display:flex; align-items:center; gap:6px; margin:4px 0;">
        <code style="font-weight:800;">${t.toUpperCase()}</code>
        <button class="btn" data-up="${i}">↑</button>
        <button class="btn" data-down="${i}">↓</button>
        <button class="btn" data-del="${i}">×</button>
      </div>
    `).join('');
  }

  function setTool(t) {
    tool = t;
    E.lastTool = t;
    byId('seedControls').style.display = (t === 'seed') ? '' : 'none';
    byId('portalControls').style.display = (t === 'portal') ? '' : 'none';
    document.querySelectorAll('[data-tool]').forEach((b) => {
      b.classList.toggle('btn--primary', b.dataset.tool === tool);
    });
    edSay(`Tool: ${tool}`);
  }

  function onCellClick(r, c) {
    const sp = specialAt(r, c);
    const sd = seedAt(r, c);
    if (tool === 'erase') {
      if (sp) E.specials = E.specials.filter((x) => x !== sp);
      if (sd) E.seeds = E.seeds.filter((x) => x !== sd);
      if (E.goal.r === r && E.goal.c === c) E.goal = { r: 0, c: 0 };
      renderBoard();
      return;
    }
    if (tool === 'blocked') {
      if (sp?.type === 'blocked') E.specials = E.specials.filter((x) => x !== sp); else E.specials.push({ r, c, type: 'blocked' });
      if (E.goal.r === r && E.goal.c === c) E.goal = { r: 0, c: 0 };
      if (sd) E.seeds = E.seeds.filter((x) => x !== sd);
      renderBoard();
      return;
    }
    if (tool === 'portal') {
      if (sp?.type === 'portal' && sp.group === portalGroup) {
        E.specials = E.specials.filter((x) => x !== sp);
      } else {
        if (sp) E.specials = E.specials.filter((x) => x !== sp);
        if (sd) E.seeds = E.seeds.filter((x) => x !== sd);
        E.specials.push({ r, c, type: 'portal', group: portalGroup });
      }
      renderBoard();
      return;
    }
    if (tool === 'goal') {
      const spx = specialAt(r, c);
      if (spx?.type === 'blocked') {
        edSay('Goal cannot be on a blocked cell.');
        return;
      }
      E.goal = { r, c };
      renderBoard();
      return;
    }
    if (tool === 'seed') {
      const t = (seedTextEl.value || '').trim();
      if (!t) {
        edSay('Enter seed text first.');
        return;
      }
      if (sp?.type === 'blocked') {
        edSay('Cannot place seed on a blocked cell.');
        return;
      }
      if (sd) sd.text = t; else E.seeds.push({ r, c, text: t, dir: 'H' });
      renderBoard();
      return;
    }
  }

  function renderBoard() {
    pruneDraftToBounds(E);
    const R = E.rows;
    const C = E.cols;
    const root = document.getElementById('editorBoard');
    root.className = 'board';
    root.style.setProperty('--cols', C);
    root.style.setProperty('--rows', R);
    setGridCellSize(R, C);
    root.innerHTML = '';
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        const sp = specialAt(r, c);
        const sd = seedAt(r, c);
        if (E.goal.r === r && E.goal.c === c) cell.classList.add('cell--goal');
        if (sp?.type === 'blocked') cell.classList.add('cell--blocked');
        if (sp?.type === 'portal') {
          cell.classList.add('cell--portal');
          if (sp.group) cell.classList.add(`cell--portal-${sp.group}`);
        }
        if (sd) {
          cell.classList.add('cell--seed', 'cell--filled');
          const t = document.createElement('span');
          t.className = 'cell__text';
          t.textContent = String(sd.text).toUpperCase();
          cell.appendChild(t);
        }
        const coord = document.createElement('span');
        coord.className = 'cell__coord';
        coord.textContent = toA1(r, c);
        cell.appendChild(coord);
        cell.addEventListener('click', () => onCellClick(r, c));
        root.appendChild(cell);
      }
    }
  }

  function syncEditorFromInputs() {
    const rowVal = Number(rowsEl.value);
    const colVal = Number(colsEl.value);
    E.rows = Math.max(1, Math.min(10, Number.isFinite(rowVal) ? rowVal : E.rows || 5));
    E.cols = Math.max(1, Math.min(10, Number.isFinite(colVal) ? colVal : E.cols || 5));
    rowsEl.value = E.rows;
    colsEl.value = E.cols;
    E.seedText = seedTextEl.value || '';
    E.portalGroup = portalGroupEl.value || 'A';
    E.meta.id = metaIdEl.value.trim();
    E.meta.name = metaNameEl.value;
    const parsedPar = Number.parseInt(metaParEl.value, 10);
    if (Number.isFinite(parsedPar) && parsedPar >= 0) {
      E.meta.par = parsedPar;
    }
    metaParEl.value = E.meta.par ?? 7;
    E.meta.intro = metaIntroEl.value;
    E.allowedWordsText = allowTA.value;
    E.allowedWords = parseAllowedWordsInput(E.allowedWordsText);
    E.notes = notesTA.value;
    pruneDraftToBounds(E);
  }

  deckList.addEventListener('click', (e) => {
    const up = e.target.getAttribute('data-up');
    const down = e.target.getAttribute('data-down');
    const del = e.target.getAttribute('data-del');
    if (up != null) {
      const i = +up;
      if (i > 0) {
        const t = E.deck[i];
        E.deck[i] = E.deck[i - 1];
        E.deck[i - 1] = t;
        renderDeck();
      }
    }
    if (down != null) {
      const i = +down;
      if (i < E.deck.length - 1) {
        const t = E.deck[i];
        E.deck[i] = E.deck[i + 1];
        E.deck[i + 1] = t;
        renderDeck();
      }
    }
    if (del != null) {
      const i = +del;
      E.deck.splice(i, 1);
      renderDeck();
    }
  });

  btnAddDeck.addEventListener('click', () => {
    const t = (deckInput.value || '').trim();
    if (!t) return;
    E.deck.push(t);
    deckInput.value = '';
    renderDeck();
  });

  rowsEl.addEventListener('change', () => {
    const val = Math.max(1, Math.min(10, Number(rowsEl.value || E.rows || 5)));
    E.rows = val;
    rowsEl.value = val;
    renderBoard();
  });
  colsEl.addEventListener('change', () => {
    const val = Math.max(1, Math.min(10, Number(colsEl.value || E.cols || 5)));
    E.cols = val;
    colsEl.value = val;
    renderBoard();
  });
  document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  portalGroupEl.addEventListener('change', () => {
    portalGroup = portalGroupEl.value;
    E.portalGroup = portalGroup;
  });
  seedTextEl.addEventListener('input', () => {
    E.seedText = seedTextEl.value;
  });
  allowTA.addEventListener('input', () => {
    E.allowedWordsText = allowTA.value;
    E.allowedWords = parseAllowedWordsInput(E.allowedWordsText);
  });
  notesTA.addEventListener('input', () => {
    E.notes = notesTA.value;
  });
  metaIdEl.addEventListener('input', () => {
    E.meta.id = metaIdEl.value.trim();
  });
  metaNameEl.addEventListener('input', () => {
    E.meta.name = metaNameEl.value;
  });
  metaParEl.addEventListener('change', () => {
    const parsed = Number.parseInt(metaParEl.value, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      E.meta.par = parsed;
    }
    metaParEl.value = E.meta.par ?? 7;
  });
  metaIntroEl.addEventListener('input', () => {
    E.meta.intro = metaIntroEl.value;
  });

  btnTest.addEventListener('click', () => {
    syncEditorFromInputs();
    try {
      const raw = buildEditorRawLevel(E);
      const normalized = normalizeLevel(raw, raw.meta?.id || 'editor-test');
      EDITOR_TEST_LEVEL = normalized;
      edSay('');
      location.hash = '#/editor/test';
    } catch (err) {
      console.error('Editor test launch failed', err);
      const msg = err?.message ? String(err.message).replace(/\n/g, ' ') : 'Unable to start test.';
      edSay(msg);
    }
  });

  btnExport.addEventListener('click', async () => {
    syncEditorFromInputs();
    const raw = buildEditorRawLevel(E);
    const json = JSON.stringify(raw, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      edSay('Copied level JSON to clipboard.');
      showUnlockToast('Level JSON copied to clipboard');
    } catch {
      edSay('Unable to copy. JSON printed to console.');
      console.log(json);
    }
  });

  pruneDraftToBounds(E);
  renderBoard();
  renderDeck();
  setTool(tool);
}

function EditorTestView() {
  if (!EDITOR_TEST_LEVEL) {
    app().innerHTML = `
      <section class="section view" style="max-width:640px; margin:auto; padding:20px;">
        <h2>No test level ready</h2>
        <p>Build a level in the editor and click “Test” to try it out.</p>
        <div class="game-toolbar" style="margin-top:12px;">
          <a class="btn" href="#/editor">← Back to Editor</a>
        </div>
      </section>
    `;
    return;
  }

  const levelId = EDITOR_TEST_LEVEL.id || 'custom';
  return GameView(['', levelId], {
    levelData: EDITOR_TEST_LEVEL,
    backHrefOverride: '#/editor',
    backLabel: '← Back to Editor',
    disableNextButton: true,
    skipProgress: true,
    mode: 'editor-test'
  });
}
