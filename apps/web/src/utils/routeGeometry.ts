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

  // For each waypoint, find closest geometry point index (monotonically forward).
  // Force first/last waypoint to geometry boundaries so the route always starts
  // and ends exactly at the rendered geometry endpoints.
  const waypointIndices: number[] = [];
  let searchStart = 0;
  const lastGeometryIndex = geometry.length - 1;

  for (let wpIndex = 0; wpIndex < waypoints.length; wpIndex += 1) {
    const wp = waypoints[wpIndex];
    if (wpIndex === 0) {
      // Find the actual closest point for the depot near the start of the geometry
      // Don't just blindly use 0, as the route might start slightly off the exact depot coordinate
      let minDist = Infinity;
      let minIdx = 0;
      // Search the first 20% of the route for the start point
      // Ensure we search at least a few points even for very short routes
      const searchEnd = Math.max(1, Math.min(lastGeometryIndex, Math.floor(geometry.length * 0.2)));
      for (let i = 0; i <= searchEnd; i++) {
        const dx = geometry[i][0] - wp[0];
        const dy = geometry[i][1] - wp[1];
        const latRad = wp[1] * Math.PI / 180;
        const cosLat = Math.cos(latRad);
        const dxWeighted = dx * cosLat;
        const dist = dxWeighted * dxWeighted + dy * dy;
        if (dist < minDist) {
          minDist = dist;
          minIdx = i;
        }
      }
      
      // #region agent log
      _log('splitGeometryIntoSegments: finding start point', { 
        depot: wp, 
        searchEnd, 
        minIdx, 
        minDist,
        firstGeomPoint: geometry[0],
        foundGeomPoint: geometry[minIdx]
      }, 'H4a');
      // #endregion
      
      waypointIndices.push(minIdx);
      // DO NOT set searchStart = minIdx here. 
      // If the depot is slightly "further" along the geometry line than the first stop,
      // setting searchStart = minIdx forces the first stop to be found AFTER the depot,
      // which can cause the first segment to be empty or inverted.
      // We always want to start searching for the first stop from the beginning of the geometry.
      searchStart = 0;
      continue;
    }
    if (wpIndex === waypoints.length - 1) {
      // Find the actual closest point for the depot near the end of the geometry
      let minDist = Infinity;
      let minIdx = lastGeometryIndex;
      // Search the last 20% of the route for the end point
      const searchStartEnd = Math.min(lastGeometryIndex - 1, Math.max(searchStart, Math.floor(geometry.length * 0.8)));
      for (let i = searchStartEnd; i <= lastGeometryIndex; i++) {
        const dx = geometry[i][0] - wp[0];
        const dy = geometry[i][1] - wp[1];
        const latRad = wp[1] * Math.PI / 180;
        const cosLat = Math.cos(latRad);
        const dxWeighted = dx * cosLat;
        const dist = dxWeighted * dxWeighted + dy * dy;
        if (dist < minDist) {
          minDist = dist;
          minIdx = i;
        }
      }
      waypointIndices.push(minIdx);
      searchStart = minIdx;
      continue;
    }

    // Keep enough points for remaining waypoints to preserve monotonicity.
    const remainingWaypoints = waypoints.length - 1 - wpIndex;
    const searchEnd = Math.max(searchStart, lastGeometryIndex - remainingWaypoints);
    let minDist = Infinity;
    let minIdx = searchStart;

    // For the first stop (wpIndex === 1), we should search from the very beginning of the geometry,
    // not from where the depot was found, because the Valhalla geometry might start slightly
    // "after" the depot in terms of distance, causing the first stop to snap to the depot's location.
    const actualSearchStart = wpIndex === 1 ? 0 : searchStart;

    for (let i = actualSearchStart; i <= searchEnd; i++) {
      const dx = geometry[i][0] - wp[0];
      const dy = geometry[i][1] - wp[1];
      // Haversine-like weighting: scale longitude diff by cos(latitude) to avoid distortion
      // since 1 degree longitude is much smaller than 1 degree latitude in Czechia (~50°N)
      const latRad = wp[1] * Math.PI / 180;
      const cosLat = Math.cos(latRad);
      const dxWeighted = dx * cosLat;
      const dist = dxWeighted * dxWeighted + dy * dy;
      if (dist < minDist) {
        minDist = dist;
        minIdx = i;
      }
    }

    // #region agent log
    if (wpIndex === 1) {
      _log('splitGeometryIntoSegments: finding first stop', { 
        stop: wp, 
        actualSearchStart,
        searchEnd, 
        minIdx, 
        minDist,
        foundGeomPoint: geometry[minIdx]
      }, 'H4a');
    }
    // #endregion

    waypointIndices.push(minIdx);
    // Ensure monotonicity for subsequent stops
    searchStart = Math.min(lastGeometryIndex, Math.max(searchStart, minIdx + 1));
  }

  // Slice geometry into segments
  const segments: [number, number][][] = [];
  for (let i = 0; i < waypointIndices.length - 1; i++) {
    let start = waypointIndices[i];
    let end = waypointIndices[i + 1];
    
    // If the depot was found "after" the first stop (due to geometry quirks),
    // swap them so we still get a valid segment.
    if (i === 0 && start > end) {
      const temp = start;
      start = end;
      end = temp;
    }
    
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
