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
  // #region agent log
  const _log = (msg: string, data: any, hyp: string) => {
    console.log(`[DEBUG] ${msg}`, data);
    fetch('http://127.0.0.1:7353/ingest/1d957424-b904-4bc5-af34-a37ca7963434',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'2ba648'},body:JSON.stringify({sessionId:'2ba648',location:'routeGeometry.ts',message:msg,data,timestamp:Date.now(),runId:'run1',hypothesisId:hyp})}).catch(()=>{});
  };
  // #endregion

  // Build waypoints: depot → stops → depot
  const waypoints: [number, number][] = [
    [depot.lng, depot.lat],
    ...stops.map((s) => [s.coordinates.lng, s.coordinates.lat] as [number, number]),
    [depot.lng, depot.lat],
  ];

  _log('splitGeometryIntoSegments called', { geometryLen: geometry.length, waypointsLen: waypoints.length, depot }, 'H2a,H2c');

  if (geometry.length === 0 || waypoints.length < 2) return [];

  // Threshold: if the geometry start/end is more than ~500m from the depot,
  // the geometry is missing the depot legs (e.g. VRP geometry without depot routing).
  const DEPOT_DISTANCE_THRESHOLD = 0.005; // ~500m in degrees

  const depotWp = waypoints[0];
  const geomStart = geometry[0];
  const geomEnd = geometry[geometry.length - 1];
  const startDistSq = (geomStart[0] - depotWp[0]) ** 2 + (geomStart[1] - depotWp[1]) ** 2;
  const endDistSq = (geomEnd[0] - depotWp[0]) ** 2 + (geomEnd[1] - depotWp[1]) ** 2;
  const startFarFromDepot = startDistSq > DEPOT_DISTANCE_THRESHOLD ** 2;
  const endFarFromDepot = endDistSq > DEPOT_DISTANCE_THRESHOLD ** 2;

  // #region agent log
  _log('splitGeometryIntoSegments: depot distance check', {
    startDistSq, endDistSq, startFarFromDepot, endFarFromDepot,
    depotWp, geomStart, geomEnd
  }, 'H5a');
  // #endregion

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

    // Keep enough points for remaining waypoints to preserve monotonicity.
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

  // If geometry doesn't start near the depot, prepend a straight line
  // from the depot to the geometry start as segment 0 (depot → first stop).
  if (startFarFromDepot && segments.length > 0) {
    const depotCoord: [number, number] = [depotWp[0], depotWp[1]];
    segments[0] = [depotCoord, ...segments[0]];
  }

  // Similarly, if geometry doesn't end near the depot, append a straight line
  // from the geometry end to the depot as the last segment.
  if (endFarFromDepot && segments.length > 0) {
    const depotCoord: [number, number] = [depotWp[0], depotWp[1]];
    segments[segments.length - 1] = [...segments[segments.length - 1], depotCoord];
  }

  // #region agent log
  _log('splitGeometryIntoSegments result', { 
    waypointIndices, 
    segmentsLen: segments.length,
    firstSegmentLen: segments[0]?.length,
    firstSegmentStart: segments[0]?.[0],
    firstSegmentEnd: segments[0]?.[segments[0]?.length - 1],
    depot,
    firstStop: waypoints[1]
  }, 'H2a,H2d');
  // #endregion

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
