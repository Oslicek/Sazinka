/**
 * Route export utilities for Google Maps and Mapy.cz.
 *
 * Google Maps Directions URL:
 *   https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=…&travelmode=driving
 *   Coordinates: lat,lng — waypoints pipe-separated — max 23 waypoints
 *
 * Mapy.cz Route URL:
 *   https://mapy.com/fnc/v1/route?start=…&end=…&waypoints=…&routeType=car_fast
 *   Coordinates: lng,lat (reversed!) — waypoints semicolon-separated — max 15 waypoints
 */

export const MAX_WAYPOINTS = 23;
export const MAPY_CZ_MAX_WAYPOINTS = 15;

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

function latLng(lat: number, lng: number): string {
  return `${roundCoord(lat)},${roundCoord(lng)}`;
}

function lngLat(lat: number, lng: number): string {
  return `${roundCoord(lng)},${roundCoord(lat)}`;
}

type ValidStop = { customerLat: number; customerLng: number };

function filterAndWarn(
  params: GoogleMapsExportParams,
  maxWaypoints: number,
): { validStops: ValidStop[]; includedStops: ValidStop[]; warnings: GoogleMapsWarningCode[] } | { earlyReturn: GoogleMapsExportResult } {
  const { depot, stops } = params;
  const warnings: GoogleMapsWarningCode[] = [];

  if (!depot) warnings.push('NO_DEPOT');

  const customerStops = stops.filter(s => s.stopType === 'customer');
  const rawCustomerCount = customerStops.length;

  if (rawCustomerCount === 0) {
    warnings.push('NO_STOPS');
    return { earlyReturn: { url: '', warnings, includedStopCount: 0, validStopCount: 0 } };
  }

  const validStops = customerStops.filter(
    (s): s is typeof s & { customerLat: number; customerLng: number } =>
      s.customerLat !== null && s.customerLng !== null,
  );

  if (validStops.length < rawCustomerCount) {
    warnings.push('SKIPPED_NO_COORDS');
  }

  if (validStops.length === 0) {
    warnings.push('NO_STOPS');
    return { earlyReturn: { url: '', warnings, includedStopCount: 0, validStopCount: 0 } };
  }

  let includedStops = validStops;
  if (validStops.length > maxWaypoints) {
    includedStops = validStops.slice(0, maxWaypoints);
    warnings.push('TRUNCATED');
  }

  return { validStops, includedStops, warnings };
}

export function buildGoogleMapsUrl(params: GoogleMapsExportParams): GoogleMapsExportResult {
  const result = filterAndWarn(params, MAX_WAYPOINTS);
  if ('earlyReturn' in result) return result.earlyReturn;

  const { validStops, includedStops, warnings } = result;
  const { depot } = params;
  const parts: string[] = [];

  if (depot) {
    parts.push(`origin=${latLng(depot.lat, depot.lng)}`);
    parts.push(`destination=${latLng(depot.lat, depot.lng)}`);
    parts.push(`waypoints=${includedStops.map(s => latLng(s.customerLat, s.customerLng)).join('|')}`);
  } else {
    const first = includedStops[0];
    const last = includedStops[includedStops.length - 1];
    parts.push(`origin=${latLng(first.customerLat, first.customerLng)}`);
    parts.push(`destination=${latLng(last.customerLat, last.customerLng)}`);
    const middle = includedStops.slice(1, -1);
    if (middle.length > 0) {
      parts.push(`waypoints=${middle.map(s => latLng(s.customerLat, s.customerLng)).join('|')}`);
    }
  }

  parts.push('travelmode=driving');

  return {
    url: 'https://www.google.com/maps/dir/?api=1&' + parts.join('&'),
    warnings,
    includedStopCount: includedStops.length,
    validStopCount: validStops.length,
  };
}

export function buildMapyCzUrl(params: GoogleMapsExportParams): GoogleMapsExportResult {
  const result = filterAndWarn(params, MAPY_CZ_MAX_WAYPOINTS);
  if ('earlyReturn' in result) return result.earlyReturn;

  const { validStops, includedStops, warnings } = result;
  const { depot } = params;
  const parts: string[] = [];

  if (depot) {
    parts.push(`start=${lngLat(depot.lat, depot.lng)}`);
    parts.push(`end=${lngLat(depot.lat, depot.lng)}`);
    parts.push(`waypoints=${includedStops.map(s => lngLat(s.customerLat, s.customerLng)).join(';')}`);
  } else {
    const first = includedStops[0];
    const last = includedStops[includedStops.length - 1];
    parts.push(`start=${lngLat(first.customerLat, first.customerLng)}`);
    parts.push(`end=${lngLat(last.customerLat, last.customerLng)}`);
    const middle = includedStops.slice(1, -1);
    if (middle.length > 0) {
      parts.push(`waypoints=${middle.map(s => lngLat(s.customerLat, s.customerLng)).join(';')}`);
    }
  }

  parts.push('routeType=car_fast');

  return {
    url: 'https://mapy.com/fnc/v1/route?' + parts.join('&'),
    warnings,
    includedStopCount: includedStops.length,
    validStopCount: validStops.length,
  };
}
