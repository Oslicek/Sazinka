import type { Visit } from '@shared/visit';
import type { VisitWorkItem } from '@shared/workItem';

/**
 * Extract and normalise the "last visit comment" from a completed visit.
 *
 * Collection order (deterministic, visit-level first then work items in array order):
 *   1. visit.resultNotes
 *   2. per work item: wi.resultNotes, wi.findings, wi.followUpReason (if requiresFollowUp)
 *
 * Returns null when there is nothing non-empty to show.
 * Truncation/clamping is a UI concern and is NOT performed here.
 */
export function extractLastVisitComment(
  visit: Visit | null,
  workItems: VisitWorkItem[],
): string | null {
  if (!visit) return null;

  const parts: string[] = [];

  const visitNotes = visit.resultNotes?.trim();
  if (visitNotes) parts.push(visitNotes);

  for (const wi of workItems) {
    const wiNotes = wi.resultNotes?.trim();
    if (wiNotes) parts.push(wiNotes);

    const findings = wi.findings?.trim();
    if (findings) parts.push(findings);

    if (wi.requiresFollowUp && wi.followUpReason?.trim()) {
      parts.push(`⚠ ${wi.followUpReason.trim()}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}
