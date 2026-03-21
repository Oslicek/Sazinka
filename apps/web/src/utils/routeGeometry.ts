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

  // For each waypoint, find closest geometry point index (monotonically forward).
  // Anchor depot to geometry boundaries (index 0 and last index).
  const waypointIndices: number[] = [];
  let searchStart = 0;
  const lastGeometryIndex = geometry.length - 1;

  for (let wpIndex = 0; wpIndex < waypoints.length; wpIndex += 1) {
    const wp = waypoints[wpIndex];
    if (wpIndex === 0) {
      waypointIndices.push(0);
      searchStart = 0;
      continue;
    }
    if (wpIndex === waypoints.length - 1) {
      waypointIndices.push(lastGeometryIndex);
      continue;
    }

    const remainingWaypoints = waypoints.length - 1 - wpIndex;
    const searchEnd = Math.max(searchStart, lastGeometryIndex - remainingWaypoints);
    let minDist = Infinity;
    let minIdx = searchStart;

    for (let i = searchStart; i <= searchEnd; i++) {
      const dx = geometry[i][0] - wp[0];
      const dy = geometry[i][1] - wp[1];
      const dist = dx * dx + dy * dy;
      if (dist < minDist) {
        minDist = dist;
        minIdx = i;
      }
    }

    waypointIndices.push(minIdx);
    searchStart = Math.min(lastGeometryIndex, Math.max(searchStart, minIdx + 1));
  }

  // Slice geometry into segments
  const segments: [number, number][][] = [];
  for (let i = 0; i < waypointIndices.length - 1; i++) {
    const start = waypointIndices[i];
    const end = waypointIndices[i + 1];
    if (end > start) {
      segments.push(geometry.slice(start, end + 1));
    } else {
      segments.push([
        geometry[start],
        geometry[Math.min(start + 1, geometry.length - 1)],
      ]);
    }
  }

  return segments;
}

/**
 * Split VRP geometry that lacks depot legs: use the road geometry for
 * stop-to-stop segments, and prepend/append straight-line depot legs.
 *
 * VRP geometry typically covers stop₁ → stop₂ → … → stopN (round trip
 * between stops only). This function splits that geometry between stop
 * waypoints, then adds straight lines for depot → stop₁ and stopN → depot.
 */
export function splitVrpGeometryWithDepotLegs(
  geometry: [number, number][],
  stops: RouteWaypoint[],
  depot: DepotCoord,
): [number, number][][] {
  if (geometry.length === 0 || stops.length === 0) return [];

  const depotCoord: [number, number] = [depot.lng, depot.lat];
  const stopCoords = stops.map((s) => [s.coordinates.lng, s.coordinates.lat] as [number, number]);

  // Find closest geometry point for each stop (monotonic forward search)
  const stopIndices: number[] = [];
  let searchStart = 0;
  const lastIdx = geometry.length - 1;

  for (let si = 0; si < stopCoords.length; si++) {
    const wp = stopCoords[si];
    const remaining = stopCoords.length - 1 - si;
    const searchEnd = Math.max(searchStart, lastIdx - remaining);
    let minDist = Infinity;
    let minIdx = searchStart;
    for (let i = searchStart; i <= searchEnd; i++) {
      const dx = geometry[i][0] - wp[0];
      const dy = geometry[i][1] - wp[1];
      const dist = dx * dx + dy * dy;
      if (dist < minDist) { minDist = dist; minIdx = i; }
    }
    stopIndices.push(minIdx);
    searchStart = Math.min(lastIdx, Math.max(searchStart, minIdx + 1));
  }

  const segments: [number, number][][] = [];

  // Segment 0: straight line from depot to first stop
  segments.push([depotCoord, geometry[stopIndices[0]]]);

  // Middle segments: road geometry between consecutive stops
  for (let i = 0; i < stopIndices.length - 1; i++) {
    const start = stopIndices[i];
    const end = stopIndices[i + 1];
    if (end > start) {
      segments.push(geometry.slice(start, end + 1));
    } else {
      segments.push([geometry[start], geometry[Math.min(start + 1, lastIdx)]]);
    }
  }

  // Last segment: straight line from last stop to depot
  segments.push([geometry[stopIndices[stopIndices.length - 1]], depotCoord]);

  return segments;
}

/**
 * Check whether the geometry includes depot legs by measuring the distance
 * from the geometry start/end to the depot coordinate. VRP optimizer geometry
 * typically omits depot→first-stop and last-stop→depot road segments, while
 * Valhalla geometry includes them.
 *
 * @returns true if geometry appears to include depot legs (starts/ends near depot)
 */
export function geometryIncludesDepotLegs(
  geometry: [number, number][],
  depot: DepotCoord,
): boolean {
  if (geometry.length < 2) return false;
  // ~5 km threshold — Valhalla road-snaps are typically <1km,
  // while VRP geometry starts at the first stop (often 10+ km away).
  const THRESHOLD_SQ = 0.05 ** 2; // 0.05 degrees ≈ 5 km
  const depotLng = depot.lng;
  const depotLat = depot.lat;
  const startDist = (geometry[0][0] - depotLng) ** 2 + (geometry[0][1] - depotLat) ** 2;
  const endDist = (geometry[geometry.length - 1][0] - depotLng) ** 2 + (geometry[geometry.length - 1][1] - depotLat) ** 2;
  return startDist <= THRESHOLD_SQ && endDist <= THRESHOLD_SQ;
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
