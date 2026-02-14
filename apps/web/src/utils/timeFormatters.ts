/**
 * Format minutes as "Xh Ymm" (e.g. 125 → "2h 05min", 45 → "45min", 120 → "2h")
 */
export function formatMinutesHm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h ${mm.toString().padStart(2, '0')}min`;
}
