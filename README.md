# gridl

A lightweight single-page word-routing puzzle game where you arrange tile fragments on a grid to complete words, hit the starred goal cell, and chase par scores across handcrafted level packs.【F:public/main.js†L1-L214】【F:public/index.html†L1-L66】

## Table of contents
- [Overview](#overview)
- [Getting started](#getting-started)
- [Project structure](#project-structure)
- [Gameplay loop](#gameplay-loop)
- [Content and progression systems](#content-and-progression-systems)
- [Data formats](#data-formats)
- [Styling and theming](#styling-and-theming)
- [Level editor](#level-editor)
- [Troubleshooting and tips](#troubleshooting-and-tips)

## Overview
gridl ships as a purely static site: `public/index.html` bootstraps the UI shell (header, board mount, hand and reserve trays) and loads the main JavaScript entry point that drives all routing, rendering, and game logic.【F:public/index.html†L1-L66】 The app uses a hash-based router defined in `public/main.js` to switch between the daily puzzle, pack browser, how-to-play reference, experimental editor, and other placeholder views without reloading the page.【F:public/main.js†L219-L388】

The gameplay layer is implemented with a small engine in `public/engine/`, which exposes modules for state management, rules and turn validation, rendering, and level loading. Together they support tile-per-cell boards, multi-letter fragments, portals that mirror text, recall mechanics, and toast-driven celebration when you beat a level.【F:public/main.js†L523-L645】【F:public/engine/state.js†L6-L298】【F:public/engine/rules.js†L18-L195】【F:public/main.js†L607-L636】

## Getting started
1. **Serve the static files.** Any static HTTP server works. From the repository root you can run for example:
   ```bash
   npx serve public
   ```
   or
   ```bash
   python -m http.server --directory public 5173
   ```
   Then visit the reported URL in a modern browser.
2. **Optional: use the DEV unlock switch.** When iterating on content you can set `DEV_FORCE_UNLOCK_ALL` to `true` near the top of `public/main.js` to bypass all progression checks locally; remember to turn it off before shipping a build.【F:public/main.js†L15-L214】
3. **Resetting progress.** Player progression (completed levels, unlocked packs, best scores) is saved in `localStorage` under the `gridl_progress_v1` key. Clear it from your browser’s devtools or temporarily adjust `loadProgress()` if you need a clean slate.【F:public/main.js†L31-L139】

Because the app is bundle-free and uses relative paths for assets, you can deploy the `public/` directory directly to static hosts such as GitHub Pages, Netlify, or your own CDN.【F:public/index.html†L1-L66】【F:public/main.js†L1-L23】

## Project structure
- `public/index.html` – Minimal HTML shell and fallback styles; loads the SPA script and provides the board/hand/reserve mount points.【F:public/index.html†L1-L66】
- `public/main.js` – Hash router, view templates, progress storage, daily puzzle logic, and glue code that initializes the engine modules.【F:public/main.js†L219-L645】
- `public/engine/`
  - `state.js` – Core state container, deck/hand/reserve management, board validation (runs, connectivity, portals).【F:public/engine/state.js†L6-L298】
  - `rules.js` – Turn staging, axis enforcement, submit/recall handling, and win detection.【F:public/engine/rules.js†L18-L195】
  - `renderer.js` – DOM binding for the board, hand, and reserve (drag/drop, click interactions, toast messaging).【F:public/engine/renderer.js†L1-L120】
  - `levelLoader.js` – Fetches and normalizes level JSON, ensuring bounds, seed placement, and allowlists are valid before play.【F:public/engine/levelLoader.js†L1-L189】
  - `validator.js` – Normalizes word lists into a Set and exposes helper methods for quick lookups and run validation.【F:public/engine/validator.js†L1-L94】
- `public/packs.json` – Authoritative list of puzzle packs, sections, and puzzle IDs for the pack selector and progression flow.【F:public/packs.json†L1-L100】
- `public/levels/` – Library of level definitions grouped by numeric ID ranges (tutorial 101–110, core curriculum, theme packs, etc.).【F:public/levels/level-101.json†L1-L23】【F:public/levels/level-401.json†L1-L164】
- `public/styles.css` – Global layout, board, tray, and editor styles for the refreshed light theme.【F:public/styles.css†L1-L200】

## Gameplay loop
1. **Starting a level.** Navigating to `#/play/level/<id>` fetches the corresponding level JSON, draws the board shell, and initializes engine state with the allowlist, deck, and seed placements before handing control to the renderer.【F:public/main.js†L523-L645】
2. **Managing tiles.** The state module tracks deck, hand (4 slots), reserve (2 slots), and staged actions while keeping each grid cell tied to the tile fragment currently occupying it.【F:public/engine/state.js†L16-L84】 The renderer lets players pick tiles from hand or reserve, drop them on empty cells, move staged tiles, or return them to hand, while enforcing reserve rules through staged recalls.【F:public/engine/renderer.js†L21-L120】【F:public/engine/rules.js†L92-L134】
3. **Validating turns.** When the player submits, the rules module enforces the “one straight line per turn” constraint, checks that all runs created or crossed are allowed words, and disallows mixing placements with recalls in a single submit.【F:public/engine/rules.js†L18-L195】 Successful turns commit tiles to the board, refill the hand to four, increment the turn counter, and determine whether the goal cell is now covered to flag a win.【F:public/engine/rules.js†L188-L195】
4. **Board integrity.** After each commit the state module verifies that every multi-cell run spells an allowed word, isolated tiles are themselves allowed, and all occupied cells remain connected to at least one seed (portals bridge connectivity). Detailed error strings point players to the offending cells when validation fails.【F:public/engine/state.js†L203-L298】
5. **Completion feedback.** Upon victory the Game view updates progress, records best turn counts, applies tutorial unlock rules, and surfaces toast notifications summarizing performance while revealing the Next Level button if available.【F:public/main.js†L607-L637】

## Content and progression systems
- **Pack definitions.** `packs.json` organizes puzzles into curriculum, archetype, constraint, and variety sections. Each entry lists an identifier, display name, description, and array of puzzle metadata consumed by the pack selector and per-pack level lists.【F:public/packs.json†L1-L100】
- **Progress tracking.** Local progress is serialized to `localStorage`, capturing completed level IDs, unlocked packs, unlocked levels, and personal best scores. Defaults unlock the tutorial pack and first three tutorial puzzles; finishing certain tutorial milestones grants additional packs and levels.【F:public/main.js†L31-L139】
- **Curriculum gating.** `applyTutorialUnlocks()` and `normalizePacks()` compute unlock status dynamically based on completion history, while `DEV_FORCE_UNLOCK_ALL` offers a developer bypass for testing.【F:public/main.js†L122-L214】
- **Daily puzzle.** The home view hashes the current date to pick a repeatable non-tutorial puzzle from the available IDs, then launches it directly in game mode while marking the page as a “daily” variant for styling.【F:public/main.js†L330-L386】

## Data formats
- **Levels.** Levels are authored as JSON files with `meta` information (id, name, par, intro), `board` configuration (size, goal cell, seeds, specials), a `deck` array of tile fragments, optional `startingHand`, allowlisted words, and notes. The loader enforces bounds, seed placement, and that at least one word exists before converting into the engine’s normalized shape.【F:public/engine/levelLoader.js†L1-L189】【F:public/levels/level-101.json†L1-L23】 Specials support blocked cells and colored portal groups, enabling advanced layouts like the “Labyrinth” portal puzzle.【F:public/levels/level-401.json†L1-L164】
- **Packs.** Pack records link display metadata to numeric level IDs. Because the SPA enriches tiles with live level data (name, par, unlock/best/completion markers) at runtime, you can add new puzzles by creating a level JSON and referencing its ID inside the appropriate pack entry.【F:public/main.js†L449-L521】【F:public/packs.json†L1-L100】

## Styling and theming
`public/styles.css` defines the refreshed light theme, board layout, and responsive behavior. CSS variables control cell size and gaps, while media queries and utility classes (`cells-compact`, `cells-spacious`) let the router adjust board sizing per level dimensions. The stylesheet also includes tray, button, toast, and level editor styles so the entire SPA can render without inline style injection.【F:public/styles.css†L1-L200】【F:public/main.js†L263-L323】【F:public/main.js†L555-L645】

## Level editor
Navigate to `#/editor` to access the experimental in-browser editor. It provides tools for placing seeds, portals, blocked cells, and the goal, managing deck order, and editing metadata/allowlists. The editor reuses the responsive board sizing utilities and can export the current design as JSON ready to drop into `public/levels/`.【F:public/main.js†L792-L989】

## Troubleshooting and tips
- **Clearing mistakes mid-turn.** Use empty hand slots to return staged tiles or stage recalls from committed tiles into reserve; the UI prevents placing staged tiles directly into reserve to preserve the two-slot limit.【F:public/engine/renderer.js†L21-L120】【F:public/engine/rules.js†L92-L134】
- **Understanding validation errors.** Error messages include A1-style coordinates to help visualize invalid words or disconnected islands, generated by the helper utilities in `state.js` and `rules.js`.【F:public/engine/state.js†L246-L330】【F:public/engine/rules.js†L148-L195】
- **Sharing builds.** Before distribution, ensure `DEV_FORCE_UNLOCK_ALL` is `false` and consider clearing the local progress key so new players see the intended progression curve.【F:public/main.js†L15-L214】【F:public/main.js†L31-L139】

Enjoy designing and solving word grids!
