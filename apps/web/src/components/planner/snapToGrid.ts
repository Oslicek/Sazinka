/**
 * snapToGrid — snaps a raw drop position (minutes from midnight) to the
 * nearest 15-minute boundary that fits the item within the gap.
 *
 * Returns the snapped start time in minutes, or null if the gap is too
 * small to fit the item at any 15-minute boundary.
 */

/**
 * @param rawMinutes   Raw drop position in minutes from midnight.
 * @param itemDuration Duration of the item being placed (minutes).
 * @param gapStart     Gap start in minutes from midnight (inclusive).
 * @param gapEnd       Gap end in minutes from midnight (exclusive).
 * @returns            Snapped start time in minutes, or null if no valid slot.
 */
export function snapToGrid(
  rawMinutes: number,
  itemDuration: number,
  gapStart: number,
  gapEnd: number,
): number | null {
  // Earliest valid start: first 15-min boundary at or after gapStart
  const earliestStart = Math.ceil(gapStart / 15) * 15;
  // Latest valid start: last 15-min boundary where item still fits before gapEnd
  const latestStart = Math.floor((gapEnd - itemDuration) / 15) * 15;

  if (earliestStart > latestStart) {
    // Gap too small to fit the item at any 15-min boundary
    return null;
  }

  // Snap raw position to nearest 15-min boundary
  const snapped = Math.round(rawMinutes / 15) * 15;

  // Clamp to valid range
  return Math.max(earliestStart, Math.min(latestStart, snapped));
}

/**
 * Format minutes from midnight as "HH:MM".
 */
export function minutesToHm(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(totalMinutes, 24 * 60 - 1));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
