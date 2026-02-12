import type { BreakSettings } from '@shared/settings';
import type { SavedRouteStop } from '../services/routeService';

/**
 * Result of break position calculation
 */
export interface BreakPositionResult {
  /** Suggested position (0-based index where break should be inserted among customer stops) */
  position: number;
  /** Warnings if constraints cannot be fully satisfied */
  warnings: string[];
  /** Estimated time for the break (HH:MM) */
  estimatedTime: string | null;
  /** Estimated cumulative distance at break position (km) */
  estimatedDistanceKm: number | null;
}

export interface BreakConstraintOptions {
  /**
   * EU/CR driving-break rule:
   * insert break not later than maxDrivingMinutes cumulative driving.
   */
  enforceDrivingBreakRule?: boolean;
  maxDrivingMinutes?: number;
  requiredBreakMinutes?: number;
}

/** Parse "HH:MM" or "HH:MM:SS" to total minutes from midnight, or null. */
function parseMins(t: string | null | undefined): number | null {
  if (!t) return null;
  const p = t.split(':').map(Number);
  if (p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  return p[0] * 60 + p[1];
}

/** Format total minutes as "HH:MM". */
function fmtMins(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Calculate optimal position for a break in a route based on constraints.
 *
 * The algorithm considers the **gap** between consecutive stops (not just the
 * departure time of the preceding stop).  If the break time-window falls
 * within a gap — even if the gap starts earlier — the position is valid and
 * the break will start at `max(gapStart, breakWindowStart)`.
 *
 * @param stops - Current route stops (customer only, no break)
 * @param breakSettings - Break configuration
 * @param startTime - Route start time (HH:MM)
 * @returns Break position and warnings
 */
export function calculateBreakPosition(
  stops: SavedRouteStop[],
  breakSettings: BreakSettings,
  startTime: string = '08:00',
  options: BreakConstraintOptions = {}
): BreakPositionResult {
  const warnings: string[] = [];
  const enforceDrivingBreakRule = options.enforceDrivingBreakRule ?? false;
  const maxDrivingMinutes = options.maxDrivingMinutes ?? 270; // 4.5h
  const requiredBreakMinutes = options.requiredBreakMinutes ?? 45;

  // If no stops or break disabled, don't insert
  if (stops.length === 0 || !breakSettings.breakEnabled) {
    return { position: 0, warnings, estimatedTime: null, estimatedDistanceKm: null };
  }

  const breakWindowStart = parseMins(breakSettings.breakEarliestTime) ?? 690; // 11:30
  const breakWindowEnd = parseMins(breakSettings.breakLatestTime) ?? 780;   // 13:00
  const breakDuration = breakSettings.breakDurationMinutes;

  let cursor = parseMins(startTime) ?? 480; // route start
  let cumulativeKm = 0;
  let cumulativeDrivingMinutes = 0;

  interface PositionCandidate {
    position: number;           // 0-based insert index among customer stops
    breakStartMinutes: number;  // when the break would actually begin
    gapStart: number;           // when the gap opens (previous stop ends)
    gapEnd: number;             // when the gap closes (next stop starts)
    chronoFit: boolean;         // break start falls chronologically within the gap
    distanceKm: number;
    timeValid: boolean;
    kmValid: boolean;
    drivingValid: boolean;
    cumulativeDrivingMinutes: number;
  }

  const candidates: PositionCandidate[] = [];

  // Evaluate every gap: position 0 = before all stops, position i = after stop[i-1]
  for (let pos = 0; pos <= stops.length; pos++) {
    // ── Gap boundaries ──
    const gapStart = cursor;

    // Gap ends when the *next* stop needs to begin (its scheduledTimeStart)
    let gapEnd = Infinity;
    if (pos < stops.length) {
      const nextStart = parseMins(stops[pos].scheduledTimeStart);
      if (nextStart !== null) gapEnd = nextStart;
    }

    // The break would start at the later of: gap start or break-window open
    const breakStart = Math.max(gapStart, breakWindowStart);
    const breakEnd = breakStart + breakDuration;

    // Time-valid: break starts within the configured window AND fits before the next stop
    const fitsInGap = gapEnd === Infinity || breakEnd <= gapEnd;
    const timeValid = breakStart >= breakWindowStart && breakStart <= breakWindowEnd && fitsInGap;

    const kmValid = cumulativeKm >= breakSettings.breakMinKm && cumulativeKm <= breakSettings.breakMaxKm;
    const drivingValid = !enforceDrivingBreakRule || cumulativeDrivingMinutes <= maxDrivingMinutes;

    // Does the break start time fall chronologically within this gap?
    // e.g. break at 11:30 fits in gap 09:00–12:00, but NOT in gap 07:00–08:00.
    const chronoFit = breakStart >= gapStart && (gapEnd === Infinity || breakStart < gapEnd);

    candidates.push({
      position: pos,
      breakStartMinutes: breakStart,
      gapStart,
      gapEnd,
      chronoFit,
      distanceKm: cumulativeKm,
      timeValid,
      kmValid,
      drivingValid,
      cumulativeDrivingMinutes,
    });

    // ── Advance cursor past stop[pos] ──
    if (pos < stops.length) {
      const stop = stops[pos];

      // Travel
      if (stop.durationFromPreviousMinutes) {
        cumulativeDrivingMinutes += stop.durationFromPreviousMinutes;
      }
      if (stop.distanceFromPreviousKm) {
        cumulativeKm += stop.distanceFromPreviousKm;
      }

      // Determine when the stop ends
      const endMin = parseMins(stop.scheduledTimeEnd)
        ?? parseMins(stop.estimatedDeparture);
      if (endMin !== null && endMin > cursor) {
        cursor = endMin;
      } else {
        // Fallback: add travel + service estimate
        if (stop.durationFromPreviousMinutes) {
          cursor += stop.durationFromPreviousMinutes;
        }
        cursor += (stop.serviceDurationMinutes ?? 30);
      }
    }
  }

  // ── Select best position ──
  let bestCandidate = candidates.find((c) => c.timeValid && c.kmValid && c.drivingValid);

  if (!bestCandidate) {
    // Priority: time constraint > km constraint
    const timeValidCandidates = candidates.filter((c) => c.timeValid && c.drivingValid);
    if (timeValidCandidates.length > 0) {
      bestCandidate = timeValidCandidates.reduce((best, current) => {
        const bestKmDiff = Math.min(
          Math.abs(best.distanceKm - breakSettings.breakMinKm),
          Math.abs(best.distanceKm - breakSettings.breakMaxKm)
        );
        const currentKmDiff = Math.min(
          Math.abs(current.distanceKm - breakSettings.breakMinKm),
          Math.abs(current.distanceKm - breakSettings.breakMaxKm)
        );
        return currentKmDiff < bestKmDiff ? current : best;
      });
      warnings.push(`Pauza je mimo rozmezí km (nastaveno ${breakSettings.breakMinKm}-${breakSettings.breakMaxKm} km)`);
    } else {
      // No time-valid position — pick closest to break window,
      // preferring positions where the break chronologically fits in the gap.
      // Without this, a break at 11:30 could be placed before an 08:00 stop.
      const drivingCompliant = candidates.filter((c) => c.drivingValid);
      const pool = drivingCompliant.length > 0 ? drivingCompliant : candidates;
      bestCandidate = pool.reduce((best, current) => {
        // Prefer chronologically fitting positions over non-fitting ones
        if (current.chronoFit && !best.chronoFit) return current;
        if (!current.chronoFit && best.chronoFit) return best;

        const bestDiff = Math.min(
          Math.abs(best.breakStartMinutes - breakWindowStart),
          Math.abs(best.breakStartMinutes - breakWindowEnd)
        );
        const curDiff = Math.min(
          Math.abs(current.breakStartMinutes - breakWindowStart),
          Math.abs(current.breakStartMinutes - breakWindowEnd)
        );
        return curDiff < bestDiff ? current : best;
      });
      warnings.push(`Pauza je mimo časové rozmezí (nastaveno ${breakSettings.breakEarliestTime}-${breakSettings.breakLatestTime})`);

      if (!bestCandidate.kmValid) {
        warnings.push(`Pauza je mimo rozmezí km (nastaveno ${breakSettings.breakMinKm}-${breakSettings.breakMaxKm} km)`);
      }
    }
  }

  if (enforceDrivingBreakRule) {
    if (bestCandidate.cumulativeDrivingMinutes > maxDrivingMinutes) {
      warnings.push(
        `Pauza je pozdě vzhledem k pravidlu 4,5 h řízení (odhad ${Math.round(bestCandidate.cumulativeDrivingMinutes)} min řízení)`
      );
    }
    if (breakSettings.breakDurationMinutes < requiredBreakMinutes) {
      warnings.push(`Legislativní minimum pauzy je ${requiredBreakMinutes} minut`);
    }
  }

  return {
    position: bestCandidate.position,
    warnings,
    estimatedTime: fmtMins(bestCandidate.breakStartMinutes),
    estimatedDistanceKm: bestCandidate.distanceKm,
  };
}

/**
 * Create a break stop object.
 *
 * `estimatedTime` is always used for `estimatedArrival` / `estimatedDeparture`
 * so the timeline renders the break at the correct time even before the
 * backend recalculates.
 *
 * `scheduledTimeStart` / `scheduledTimeEnd` are also set to the calculated
 * break time so that the backend's sequential schedule pins the break at the
 * correct time instead of placing it immediately after the previous stop.
 *
 * For "floating" breaks, `breakTimeStart` is left null (meaning the break
 * is not user-pinned and can be repositioned by the next insertion).
 */
export function createBreakStop(
  routeId: string,
  stopOrder: number,
  breakSettings: BreakSettings,
  estimatedTime: string | null,
  options: { floating?: boolean } = {}
): Omit<SavedRouteStop, 'id'> {
  const isFloating = options.floating ?? true;
  const breakEnd = estimatedTime ? addMinutes(estimatedTime, breakSettings.breakDurationMinutes) : null;

  return {
    routeId,
    revisionId: null,
    stopOrder,
    estimatedArrival: estimatedTime,
    estimatedDeparture: breakEnd,
    distanceFromPreviousKm: null,
    durationFromPreviousMinutes: null,
    status: 'pending',
    stopType: 'break',
    customerId: null,
    customerName: 'Pauza',
    address: '',
    customerLat: null,
    customerLng: null,
    customerPhone: null,
    customerEmail: null,
    scheduledDate: null,
    // Set scheduled times so the backend pins the break at the correct time
    scheduledTimeStart: estimatedTime,
    scheduledTimeEnd: breakEnd,
    revisionStatus: null,
    breakDurationMinutes: breakSettings.breakDurationMinutes,
    breakTimeStart: isFloating ? null : estimatedTime,
  };
}

/**
 * Add minutes to a time string (HH:MM)
 */
function addMinutes(time: string, minutes: number): string {
  const [hour, min] = time.split(':').map(Number);
  const totalMinutes = hour * 60 + min + minutes;
  const newHour = Math.floor(totalMinutes / 60) % 24;
  const newMin = totalMinutes % 60;
  return `${String(newHour).padStart(2, '0')}:${String(newMin).padStart(2, '0')}`;
}

/**
 * Validate if a break violates constraints
 */
export function validateBreak(
  breakStop: SavedRouteStop,
  breakSettings: BreakSettings,
  cumulativeKm: number
): string[] {
  const warnings: string[] = [];

  if (!breakStop.breakTimeStart) {
    return warnings;
  }

  // Check time constraint
  const [breakHour, breakMin] = breakStop.breakTimeStart.split(':').map(Number);
  const breakMinutes = breakHour * 60 + breakMin;

  const [earliestHour, earliestMin] = breakSettings.breakEarliestTime.split(':').map(Number);
  const [latestHour, latestMin] = breakSettings.breakLatestTime.split(':').map(Number);
  const earliestMinutes = earliestHour * 60 + earliestMin;
  const latestMinutes = latestHour * 60 + latestMin;

  if (breakMinutes < earliestMinutes || breakMinutes > latestMinutes) {
    warnings.push(`Pauza je mimo časové rozmezí (nastaveno ${breakSettings.breakEarliestTime}-${breakSettings.breakLatestTime})`);
  }

  // Check km constraint
  if (cumulativeKm < breakSettings.breakMinKm || cumulativeKm > breakSettings.breakMaxKm) {
    warnings.push(`Pauza je mimo rozmezí km (nastaveno ${breakSettings.breakMinKm}-${breakSettings.breakMaxKm} km)`);
  }

  return warnings;
}
