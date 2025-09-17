/* shared/geometry.js
   Board coordinate helpers shared by renderer/state/rules.
*/

/**
 * Convert 0-based row/col to an A1-style label (columns A..Z, AA..ZZ, ...).
 * Supports arbitrarily wide boards; current product limits are ≤ 10 columns.
 */
export function toA1(r, c) {
  let n = c + 1;
  let col = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return `${col}${r + 1}`;
}
