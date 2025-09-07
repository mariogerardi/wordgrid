/* wordgrid • main.js (engine-driven)
   Uses static level JSON + engine modules (no backend).
   Loads ?level=001 by default, initializes state, validator, and UI.
*/

import { loadLevel, levelIdFromURL } from './engine/levelLoader.js';
import { initState, startLevel } from './engine/state.js';
import { makeValidatorFromLevel, applyValidatorToState } from './engine/validator.js';
// Use the patched initializer so the renderer does an immediate first render.
import { __patchRendererForShim as initUI } from './engine/renderer.js';

(async function boot() {
  try {
    const id = levelIdFromURL() || '001';
    const level = await loadLevel(id);          // loads ./levels/level-<id>.json

    const state = initState(level);             // create canonical state
    const validator = makeValidatorFromLevel(level);
    applyValidatorToState(state, validator);    // state.allow = Set(allowedWords)

    startLevel(state, level);                   // seed board + starting hand/deal

    // Initialize UI; renderer will handle controls and first render.
    initUI(state, level, {
      onWin: ({ state, level }) => {
        // stub for medals/progression; keep simple for now
        // e.g., localStorage.setItem(`best:${level.id}`, JSON.stringify({ turns: state.turn }));
      }
    });

    // Optional: quick dev tip in console
    console.log(`[wordgrid] loaded level ${level.id}: "${level.name}" (par ${level.par})`);
  } catch (err) {
    console.error('Failed to boot:', err);
    const msg = document.getElementById('messages');
    if (msg) msg.textContent = `Boot error: ${err.message}`;
  }
})();