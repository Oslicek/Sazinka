import type { BreakSettings } from '@shared/settings';
import type { SavedRouteStop } from '../services/routeService';

/**
 * Result of break position calculation
 */
export interface BreakPositionResult {
  /** Suggested position (1-based index where break should be inserted) */
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

/**
 * Calculate optimal position for a break in a route based on constraints
 * 
 * @param stops - Current route stops (without break)
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

  // Parse start time
  const [startHour, startMin] = startTime.split(':').map(Number);
  let currentMinutes = startHour * 60 + startMin;
  let cumulativeKm = 0;

  // Calculate cumulative time and distance for each position
  interface PositionCandidate {
    position: number; // 1-based position (insert after stop[position-1])
    timeMinutes: number;
    distanceKm: number;
    timeValid: boolean;
    kmValid: boolean;
    drivingValid: boolean;
    cumulativeDrivingMinutes: number;
  }

  const candidates: PositionCandidate[] = [];
  let cumulativeDrivingMinutes = 0;

  // Position 0: before all stops (right after depot)
  candidates.push({
    position: 0,
    timeMinutes: currentMinutes,
    distanceKm: 0,
    timeValid: false, // Usually too early
    kmValid: cumulativeKm >= breakSettings.breakMinKm && cumulativeKm <= breakSettings.breakMaxKm,
    drivingValid: !enforceDrivingBreakRule,
    cumulativeDrivingMinutes,
  });

  // Calculate for each stop position
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    
    // Add travel time to this stop
    if (stop.durationFromPreviousMinutes) {
      currentMinutes += stop.durationFromPreviousMinutes;
      cumulativeDrivingMinutes += stop.durationFromPreviousMinutes;
    } else if (stop.distanceFromPreviousKm) {
      // Fallback estimate for cumulative driving time (40 km/h average)
      cumulativeDrivingMinutes += stop.distanceFromPreviousKm * 1.5;
    }
    
    // Add service time at this stop
    const serviceDuration = 30; // Default, could be from stop data
    currentMinutes += serviceDuration;
    
    // Add travel distance
    if (stop.distanceFromPreviousKm) {
      cumulativeKm += stop.distanceFromPreviousKm;
    }

    // Check if this position (after stop i) satisfies constraints
    const [earliestHour, earliestMin] = breakSettings.breakEarliestTime.split(':').map(Number);
    const [latestHour, latestMin] = breakSettings.breakLatestTime.split(':').map(Number);
    const earliestMinutes = earliestHour * 60 + earliestMin;
    const latestMinutes = latestHour * 60 + latestMin;

    const timeValid = currentMinutes >= earliestMinutes && currentMinutes <= latestMinutes;
    const kmValid = cumulativeKm >= breakSettings.breakMinKm && cumulativeKm <= breakSettings.breakMaxKm;
    const drivingValid = !enforceDrivingBreakRule || cumulativeDrivingMinutes <= maxDrivingMinutes;

    candidates.push({
      position: i + 1,
      timeMinutes: currentMinutes,
      distanceKm: cumulativeKm,
      timeValid,
      kmValid,
      drivingValid,
      cumulativeDrivingMinutes,
    });
  }

  // Find best position: all enabled constraints satisfied
  let bestCandidate = candidates.find((c) => c.timeValid && c.kmValid && c.drivingValid);

  if (!bestCandidate) {
    // No perfect match - find best compromise
    // Priority: time constraint > km constraint
    const timeValidCandidates = candidates.filter((c) => c.timeValid && c.drivingValid);
    if (timeValidCandidates.length > 0) {
      // Pick the one closest to km range
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
      // No time-valid position - pick closest to time range
      const drivingCompliant = candidates.filter((c) => c.drivingValid);
      const pool = drivingCompliant.length > 0 ? drivingCompliant : candidates;
      bestCandidate = pool.reduce((best, current) => {
        const [earliestHour, earliestMin] = breakSettings.breakEarliestTime.split(':').map(Number);
        const [latestHour, latestMin] = breakSettings.breakLatestTime.split(':').map(Number);
        const earliestMinutes = earliestHour * 60 + earliestMin;
        const latestMinutes = latestHour * 60 + latestMin;
        
        const bestTimeDiff = Math.min(
          Math.abs(best.timeMinutes - earliestMinutes),
          Math.abs(best.timeMinutes - latestMinutes)
        );
        const currentTimeDiff = Math.min(
          Math.abs(current.timeMinutes - earliestMinutes),
          Math.abs(current.timeMinutes - latestMinutes)
        );
        return currentTimeDiff < bestTimeDiff ? current : best;
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

  // Format time
  const hour = Math.floor(bestCandidate.timeMinutes / 60);
  const min = bestCandidate.timeMinutes % 60;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;

  return {
    position: bestCandidate.position,
    warnings,
    estimatedTime: timeStr,
    estimatedDistanceKm: bestCandidate.distanceKm,
  };
}

/**
 * Create a break stop object
 */
export function createBreakStop(
  routeId: string,
  stopOrder: number,
  breakSettings: BreakSettings,
  estimatedTime: string | null,
  options: { floating?: boolean } = {}
): Omit<SavedRouteStop, 'id'> {
  const isFloating = options.floating ?? true;
  const breakStart = isFloating ? null : estimatedTime;

  return {
    routeId,
    revisionId: null,
    stopOrder,
    estimatedArrival: breakStart,
    estimatedDeparture: breakStart ? addMinutes(breakStart, breakSettings.breakDurationMinutes) : null,
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
    scheduledTimeStart: null,
    scheduledTimeEnd: null,
    revisionStatus: null,
    breakDurationMinutes: breakSettings.breakDurationMinutes,
    breakTimeStart: breakStart,
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
