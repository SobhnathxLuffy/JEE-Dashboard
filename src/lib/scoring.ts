// ─── Scoring config — the single source of truth for +4 / −1 / 0 ─────────────
// Every scoring site (Player, Results, analytics, future key-later self-mark)
// must derive its marks from here. JEE Main: MCQ and numerical alike.

export const MARKS = { CORRECT: 4, WRONG: -1, UNATTEMPTED: 0 } as const;

/**
 * Marks for one question under the NTA scheme.
 * - unattempted → 0 (even when a key exists)
 * - bonus (dropped question) → +4 for everyone, attempted or not
 * - correct === null (pending self-mark, key-later mode) → 0 until marked
 */
export function marksFor(
  attempted: boolean,
  correct: boolean | null,
  bonus = false
): number {
  if (!attempted) return MARKS.UNATTEMPTED;
  if (bonus) return MARKS.CORRECT;
  return correct === true ? MARKS.CORRECT : correct === false ? MARKS.WRONG : MARKS.UNATTEMPTED;
}
