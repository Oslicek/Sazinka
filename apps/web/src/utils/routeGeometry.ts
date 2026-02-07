/**
 * Route geometry utilities - shared between Planner and PlanningInbox.
 *
 * Provides:
 *  - splitGeometryIntoSegments: split Valhalla geometry into per-leg segments
 *  - buildStraightLineSegments: fallback straight-line geometry
 *  - getSegmentLabel: human-readable label for a segment (from → to)
 */

/** Minimal waypoint with coordinates */
export interface RouteWaypoint {
  coordinates: { lat: number; lng: number };
  name?: string;
}

/** Depot / start-end location */
export interface DepotCoord {
  lat: number;
  lng: number;
}

/**
 * Split a full route geometry (from Valhalla) into segments between
 * consecutive waypoints (depot → stop₁ → stop₂ → … → stopN → depot).
 *
 * Uses monotonic forward search to find the closest geometry point for
 * each waypoint, then slices the coordinate array.
 *
 * @returns Array of segments, each being an array of [lng, lat] coords.
 *          Length = stops.length + 1 (depot→s1, s1→s2, …, sN→depot)
 */
export function splitGeometryIntoSegments(
  geometry: [number, number][],
  stops: RouteWaypoint[],
  depot: DepotCoord,
): [number, number][][] {
  // Build waypoints: depot → stops → depot
  const waypoints: [number, number][] = [
    [depot.lng, depot.lat],
    ...stops.map((s) => [s.coordinates.lng, s.coordinates.lat] as [number, number]),
    [depot.lng, depot.lat],
  ];

  if (geometry.length === 0 || waypoints.length < 2) return [];

  // For each waypoint, find closest geometry point index (monotonically forward)
  const waypointIndices: number[] = [];
  let searchStart = 0;

  for (const wp of waypoints) {
    let minDist = Infinity;
    let minIdx = searchStart;

    for (let i = searchStart; i < geometry.length; i++) {
      const dx = geometry[i][0] - wp[0];
      const dy = geometry[i][1] - wp[1];
      const dist = dx * dx + dy * dy;
      if (dist < minDist) {
        minDist = dist;
        minIdx = i;
      }
    }

    waypointIndices.push(minIdx);
    searchStart = minIdx;
  }

  // Slice geometry into segments
  const segments: [number, number][][] = [];
  for (let i = 0; i < waypointIndices.length - 1; i++) {
    const start = waypointIndices[i];
    const end = waypointIndices[i + 1];
    if (end > start) {
      segments.push(geometry.slice(start, end + 1));
    } else {
      // Same index → create a minimal 2-point segment
      segments.push([
        geometry[start],
        geometry[Math.min(start + 1, geometry.length - 1)],
      ]);
    }
  }

  return segments;
}

/**
 * Build straight-line segments when no Valhalla geometry is available.
 * Each segment is simply [waypoint_i, waypoint_{i+1}].
 * If depot is null, segments connect only the stops without depot legs.
 */
export function buildStraightLineSegments(
  stops: RouteWaypoint[],
  depot: DepotCoord | null,
): [number, number][][] {
  const stopCoords = stops.map((s) => [s.coordinates.lng, s.coordinates.lat] as [number, number]);

  const waypoints: [number, number][] = depot
    ? [
        [depot.lng, depot.lat],
        ...stopCoords,
        [depot.lng, depot.lat],
      ]
    : stopCoords;

  if (waypoints.length < 2) return [];

  const segments: [number, number][][] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    segments.push([waypoints[i], waypoints[i + 1]]);
  }
  return segments;
}

/**
 * Get a human-readable label for a route segment.
 *
 * Segments are numbered 0..N where:
 *   segment 0 = depot → stop₁
 *   segment i = stopᵢ → stopᵢ₊₁
 *   segment N = stopN → depot
 */
export function getSegmentLabel(
  segmentIndex: number,
  stops: Array<{ name?: string }>,
  depotName: string = 'Depo',
): { fromName: string; toName: string } {
  const fromName =
    segmentIndex === 0
      ? depotName
      : stops[segmentIndex - 1]?.name || `Bod ${segmentIndex}`;

  const toName =
    segmentIndex >= stops.length
      ? depotName
      : stops[segmentIndex]?.name || `Bod ${segmentIndex + 1}`;

  return { fromName, toName };
}
