# griddl

Build words. Reach the goal.

griddl is a compact, puzzle-forward word game. Each level gives you a grid, a target goal cell (★), some pre-placed fragments, and a curated deck of letter fragments. Your job: place fragments to form valid words that thread across the grid and cover the goal cell — ideally in as few turns as possible (par).

## Features

- Tutorial pack (10 puzzles) that gradually introduces all mechanics
- Clean, responsive UI that scales 3×3, 5×5, and 7×7 boards
- Status messages with per-level intros, live feedback, and par-aware win message
- Pack and level menus with titles and par displayed
- Back-to-pack and Next-puzzle navigation (Next appears after completing a puzzle)
- Light, static build — runs in any simple HTTP server

## How To Play

Objective: form valid words by placing letter fragments on the grid so that one of your words covers the ★ goal cell.

Turn flow:

1. Select a tile in your Hand or Reserve.
2. Click an empty cell to place the fragment. You can move a staged fragment to a different empty cell before submitting.
3. Form exactly one continuous word in a single direction (horizontal or vertical) with all fragments you place this turn. Single-fragment words are allowed if they’re explicitly permitted.
4. Click Submit to commit the turn. New words formed are validated against that level’s allowlist.

Additional rules and notes:

- Fragments occupy exactly one cell (not one letter). Longer runs are formed by connecting adjacent occupied cells.
- A board is valid if every occupied cell is either part of a valid multi-cell word or is itself an allowed single-fragment word.
- You may not place and recall in the same submit. Each submit is one action type: place OR recall.
- Reserve holds up to 2 tiles. You can stage recalls of committed tiles into Reserve and submit them to confirm.
- Some cells are blocked and cannot be used.
- Seeds are pre-placed fragments and cannot be moved.
- Win condition: after submitting, if any valid word covers the goal cell, the puzzle is complete.
- Par: the target number of turns. The completion message will tell you if you finished under, at, or over par.

## UI Overview

- Home Menu: large grid-style tiles (Play, How to Play, etc.).
- Pack Select: list of packs with names and descriptions.
- Pack Page: grid of puzzles showing title and Par. Locked puzzles appear disabled.
- Game Screen:
  - Grid panel with a centered ★ goal marker behind tile text
  - Status message under the grid (shows per-level intro, live guidance, and win summary)
  - Hand (4 slots) and Reserve (2 slots)
  - Submit and Reset buttons
  - “Back” on the left, and “Next” on the right (appears when you win and there is a next level in the pack)

Accessibility and layout:

- Responsive board sizing based on available width and board size
- Reduced motion supported for UI animation

## Packs and Levels

griddl ships with a tutorial pack of 10 stages:

1. Baby’s First Word — Create a simple word to reach the ★.
2. Branching Off — Build a branch to connect to the ★.
3. Going Backward — Advance first, then branch back when new tiles arrive.
4. U — Blocked tiles force a detour — shape a U to the ★.
5. Doughnut — The center is blocked — route around the hole.
6. Recall — Use Recall to reclaim tiles and reach the ★.
7. Stockpile — Stock the reserve, then spend wisely to finish.
8. All Grown Up — First 5×5; plan longer runs.
9. Obstacle Course — Blocked cells on a 5×5.
10. Final Exam — A full 5×5 with obstacles.

The Packs view and each Pack page are populated from `public/packs.json`. Level tiles on the Pack page load each level’s meta to display the in-level title and Par.

## Level JSON Format

Levels live in `public/levels/level-<id>.json`. They’re normalized by the engine into a consistent shape. Required fields are validated at load time.

Example:

```json
{
  "meta": { "id": "101", "name": "Baby's First Word", "par": 1, "intro": "Create a simple word to reach the ★ goal." },
  "board": {
    "size": 3,
    "goal": [1, 2],
    "seeds": [ { "text": "BEG", "r": 1, "c": 0, "dir": "H" } ],
    "specials": [ { "r": 0, "c": 1, "type": "blocked" } ]
  },
  "deck": ["INN", "ER", "UI", "LED"],
  "startingHand": ["INN", "ER", "UI", "LED"],
  "allowedWords": ["beg", "inner", "beguiled", "beginner"],
  "notes": "Optional designer notes for this puzzle."
}
```

Field reference:

- meta.id: string level id (e.g., "101"), also used in the URL.
- meta.name: in-level title (displayed in the UI).
- meta.par: target number of turns (integer).
- meta.intro: optional short intro message shown at level start.
- board.size: grid size (3, 5, or 7).
- board.goal: [row, col] of the goal cell (0-indexed).
- board.seeds: array of pre-placed fragments. Each seed is a single-cell fragment: `{ text, r, c, dir }`. The `dir` is kept for backward compatibility.
- board.specials: optional array of `{ r, c, type }` where `type` currently supports only `"blocked"`.
- deck: array of fragment strings, used to deal into the hand.
- startingHand: optional array of fragment strings to seed the exact starting hand (they must also appear in the deck).
- allowedWords: array of allowed words (lowercased during normalization). This list is the ruleset for valid words in the puzzle.
- notes: optional designer string.

Normalization and validation happen in `public/engine/levelLoader.js`. Errors are surfaced with clear messages if required fields are missing or inconsistent.

## Packs JSON Format

Packs live in `public/packs.json`. Each pack has an id, name, description, and a puzzle list. Example:

```json
{
  "packs": [
    {
      "id": "tutorial",
      "name": "Tutorial",
      "description": "Ten guided stages that teach the mechanics.",
      "puzzles": [
        { "id": "101", "name": "Tutorial 1", "unlocked": true },
        { "id": "102", "name": "Tutorial 2", "unlocked": true }
      ]
    }
  ]
}
```

On the Pack view, each tile is enriched with the in-level title and Par by loading `level-<id>.json`.

## Mechanics Reference (Engine)

- Single-cell fragments: Every tile occupies exactly one cell. Longer strings are formed by contiguous occupied cells.
- Runs: The engine extracts all horizontal and vertical runs by concatenating cell.text across contiguous cells.
- Validity: A run of ≥2 cells must be in `allowedWords`. Single-cell words are allowed only if explicitly listed.
- Board validity: After a submit, every occupied cell must be covered by a valid multi-cell run or itself be a valid single-cell word.
- Submit rules: A submit contains only placements or only recalls, not both.
- Recall: Staged recalls remove committed tiles from the board; submitting the recall moves those tiles into Reserve (cap 2). Staged recalls show as ghosted tiles in the Reserve before submit.
- Seeds: Pre-placed fragments are fixed and cannot be moved or recalled.
- Goal: You win when a valid run covers the goal cell after submit.
- Par and turns: Turn count increments on each successful submit. The win message compares turns used to par.

Relevant code:

- `public/engine/state.js` — state shape, dealing, placement/removal helpers
- `public/engine/rules.js` — staging, movement, submit logic, validation hooks
- `public/engine/validator.js` — builds validator from level data
- `public/engine/renderer.js` — DOM UI for board/hand/reserve and messages

## Running Locally

This is a static site using ES Modules. You’ll need to serve it over HTTP (file:// won’t work for module imports).

Options:

- Python 3: `python3 -m http.server` (then open http://localhost:8000)
- Node (serve): `npx serve public` or any static server you prefer
- VS Code: Live Server extension on the `public/` folder

Open `public/index.html` in your browser via the local server. The app will fetch `packs.json` and `levels/level-<id>.json`.

## Project Structure

```
public/
  engine/
    levelLoader.js   # load + validate + normalize level JSON
    renderer.js      # UI rendering (board, hand, reserve, messages)
    rules.js         # staging, movement, submit rules
    state.js         # game state and helpers
    validator.js     # allows building a validator per level
  levels/            # level JSON files (e.g., level-101.json)
  packs.json         # pack metadata and puzzle lists
  main.js            # router + views + wiring to engine
  styles.css         # UI styles
  index.html         # app shell
README.md
```

## Adding New Levels or Packs

1. Create a new `levels/level-<id>.json` matching the schema above.
2. Add an entry to `packs.json` under your desired pack (or create a new pack).
3. Ensure the level’s `allowedWords` reflect exactly what you intend to permit.
4. Open the app and navigate to the pack — titles and Par are loaded automatically from each level’s meta.

## Roadmap Ideas

- Progress save + unlocks
- Achievements and scoring
- Daily challenge
- Keyboard controls and accessibility improvements
- Additional cell types and mechanics

—

Enjoy griddl! If you have ideas or spot rough edges, improvements are welcome.

Static MVP puzzle game.
