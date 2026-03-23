/**
 * Google Maps URL export for a planned route.
 *
 * Uses the Google Maps Directions URL format:
 *   https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=…&travelmode=driving
 *
 * MAX_WAYPOINTS is the limit on intermediate waypoints in the `waypoints` param.
 * Google's documented limit is ~23; we use 23 to be safe.
 */

export const MAX_WAYPOINTS = 23;

export type GoogleMapsWarningCode =
  | 'TRUNCATED'
  | 'SKIPPED_NO_COORDS'
  | 'NO_STOPS'
  | 'NO_DEPOT';

export interface GoogleMapsExportParams {
  depot: { lat: number; lng: number } | null;
  stops: Array<{
    customerLat: number | null;
    customerLng: number | null;
    stopType: 'customer' | 'break';
  }>;
}

export interface GoogleMapsExportResult {
  url: string;
  warnings: GoogleMapsWarningCode[];
  /** Number of stops actually included in the URL (may be capped by MAX_WAYPOINTS) */
  includedStopCount: number;
  /** Number of customer stops with valid coordinates (before truncation) */
  validStopCount: number;
}

function roundCoord(n: number): number {
  return Number(n.toFixed(6));
}

function coordStr(lat: number, lng: number): string {
  return `${roundCoord(lat)},${roundCoord(lng)}`;
}

export function buildGoogleMapsUrl(params: GoogleMapsExportParams): GoogleMapsExportResult {
  const { depot, stops } = params;
  const warnings: GoogleMapsWarningCode[] = [];

  if (!depot) warnings.push('NO_DEPOT');

  // Keep only customer stops
  const customerStops = stops.filter(s => s.stopType === 'customer');
  const rawCustomerCount = customerStops.length;

  if (rawCustomerCount === 0) {
    warnings.push('NO_STOPS');
    return { url: '', warnings, includedStopCount: 0, validStopCount: 0 };
  }

  // Filter out null coords — note: 0 is a valid coordinate (explicit null check)
  const validStops = customerStops.filter(
    s => s.customerLat !== null && s.customerLng !== null,
  );

  if (validStops.length < rawCustomerCount) {
    warnings.push('SKIPPED_NO_COORDS');
  }

  if (validStops.length === 0) {
    warnings.push('NO_STOPS');
    return { url: '', warnings, includedStopCount: 0, validStopCount: 0 };
  }

  // Truncate to MAX_WAYPOINTS total customer stops included
  let includedStops = validStops;
  if (validStops.length > MAX_WAYPOINTS) {
    includedStops = validStops.slice(0, MAX_WAYPOINTS);
    warnings.push('TRUNCATED');
  }

  // Build URL params
  const base = 'https://www.google.com/maps/dir/?api=1';
  const parts: string[] = [];

  if (depot) {
    parts.push(`origin=${coordStr(depot.lat, depot.lng)}`);
    parts.push(`destination=${coordStr(depot.lat, depot.lng)}`);
    const waypointStr = includedStops
      .map(s => coordStr(s.customerLat!, s.customerLng!))
      .join('|');
    parts.push(`waypoints=${waypointStr}`);
  } else {
    const first = includedStops[0];
    const last = includedStops[includedStops.length - 1];
    parts.push(`origin=${coordStr(first.customerLat!, first.customerLng!)}`);
    parts.push(`destination=${coordStr(last.customerLat!, last.customerLng!)}`);
    const middle = includedStops.slice(1, -1);
    if (middle.length > 0) {
      const waypointStr = middle
        .map(s => coordStr(s.customerLat!, s.customerLng!))
        .join('|');
      parts.push(`waypoints=${waypointStr}`);
    }
  }

  parts.push('travelmode=driving');

  return {
    url: base + '&' + parts.join('&'),
    warnings,
    includedStopCount: includedStops.length,
    validStopCount: validStops.length,
  };
}
