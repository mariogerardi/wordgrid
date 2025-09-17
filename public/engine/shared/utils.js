/* shared/utils.js
   Small shared helpers with no engine-state dependencies.
*/

/**
 * Count primitive occurrences in an array (used for deck/start hand audits, etc.).
 */
export function countBy(items) {
  const counts = Object.create(null);
  for (const item of items || []) {
    counts[item] = (counts[item] || 0) + 1;
  }
  return counts;
}
