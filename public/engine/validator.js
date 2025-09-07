/* engine/validator.js
   Pure allowlist-based validation (no network).
   Levels define which words may legally appear at ANY time on the board.
   This module normalizes that list and provides simple helpers.

   Typical use:
     import { makeValidatorFromLevel, applyValidatorToState } from './validator.js';
     const validator = makeValidatorFromLevel(level);
     applyValidatorToState(state, validator);   // state.allow becomes the Set

   Exposed API:
     - makeValidatorFromLevel(level)
     - createValidator(words)
     - applyValidatorToState(state, validator)
     - isValid(word, validator)
     - areAllValid(runs, validator)
*/

function normalizeWord(w) {
  if (typeof w !== 'string') return '';
  // Keep letters only; lowercase
  const s = w.trim().toLowerCase();
  // If you ever allow apostrophes/hyphens, relax this:
  return /^[a-z]+$/.test(s) ? s : '';
}

/** Build a validator object from a raw array of words. */
export function createValidator(words = []) {
  const allow = new Set();
  for (const w of words) {
    const n = normalizeWord(w);
    if (n) allow.add(n);
  }
  return {
    /** underlying Set (read-only by convention) */
    set: allow,

    /** check a single word string */
    has(word) {
      const n = normalizeWord(word);
      return n ? allow.has(n) : false;
    },

    /** check an array of run objects: [{text, r, c, dir}, ...] */
    all(runs = []) {
      return runs.every(r => {
        const n = normalizeWord(r?.text ?? '');
        return n && allow.has(n);
      });
    },

    /** mutate: add words (string or array of strings) */
    add(wordsLike) {
      const arr = Array.isArray(wordsLike) ? wordsLike : [wordsLike];
      for (const w of arr) {
        const n = normalizeWord(w);
        if (n) allow.add(n);
      }
      return this;
    },

    /** mutate: remove words */
    remove(wordsLike) {
      const arr = Array.isArray(wordsLike) ? wordsLike : [wordsLike];
      for (const w of arr) {
        const n = normalizeWord(w);
        if (n) allow.delete(n);
      }
      return this;
    },

    /** list all words (array) — useful for debugging */
    list() { return Array.from(allow.values()); }
  };
}

/** Convenience: build from a level object with `allowedWords`. */
export function makeValidatorFromLevel(level) {
  return createValidator(level?.allowedWords ?? []);
}

/** Sync validator into state (state.allow is the canonical Set used by rules/state). */
export function applyValidatorToState(state, validator) {
  state.allow = validator.set;
}

/** Standalone helpers (if you prefer functions over the object methods) */
export function isValid(word, validator) {
  return validator.has(word);
}

export function areAllValid(runs, validator) {
  return validator.all(runs);
}