import { describe, it, expect } from 'vitest';
import {
  splitGeometryIntoSegments,
  splitVrpGeometryWithDepotLegs,
  geometryIncludesDepotLegs,
  getSegmentLabel,
  buildStraightLineSegments,
  type RouteWaypoint,
} from './routeGeometry';

describe('splitGeometryIntoSegments', () => {
  it('returns empty array for empty geometry', () => {
    const result = splitGeometryIntoSegments([], [], { lat: 50, lng: 14 });
    expect(result).toEqual([]);
  });

  it('returns empty array when fewer than 2 waypoints', () => {
    const geometry: [number, number][] = [[14, 50], [15, 51]];
    const result = splitGeometryIntoSegments(geometry, [], { lat: 50, lng: 14 });
    // With no stops, waypoints = [depot, depot] = 2 points, should produce 1 segment
    expect(result.length).toBe(1);
  });

  it('splits geometry into segments between depot and single stop', () => {
    // Geometry: depot(0,0) -> stop(1,1) -> depot(0,0)
    const geometry: [number, number][] = [
      [0, 0], [0.3, 0.3], [0.6, 0.6], [1, 1],
      [0.7, 0.7], [0.3, 0.3], [0, 0],
    ];
    const stops: RouteWaypoint[] = [
      { coordinates: { lat: 1, lng: 1 } },
    ];
    const depot = { lat: 0, lng: 0 };

    const segments = splitGeometryIntoSegments(geometry, stops, depot);

    expect(segments.length).toBe(2); // depot->stop, stop->depot
    // First segment starts near depot
    expect(segments[0][0]).toEqual([0, 0]);
    // First segment ends near stop
    expect(segments[0][segments[0].length - 1]).toEqual([1, 1]);
    // Second segment starts near stop
    expect(segments[1][0]).toEqual([1, 1]);
    // Second segment ends near depot
    expect(segments[1][segments[1].length - 1]).toEqual([0, 0]);
  });

  it('splits geometry into N+1 segments for N stops', () => {
    // Simple geometry through 3 stops
    const geometry: [number, number][] = [
      [0, 0], [1, 0], [2, 0], [3, 0], [2, 0], [1, 0], [0, 0],
    ];
    const stops: RouteWaypoint[] = [
      { coordinates: { lat: 0, lng: 1 } },
      { coordinates: { lat: 0, lng: 2 } },
      { coordinates: { lat: 0, lng: 3 } },
    ];
    const depot = { lat: 0, lng: 0 };

    const segments = splitGeometryIntoSegments(geometry, stops, depot);
    // depot->s1, s1->s2, s2->s3, s3->depot = 4 segments
    expect(segments.length).toBe(4);
  });

  it('each segment has at least 2 points', () => {
    const geometry: [number, number][] = [
      [0, 0], [1, 1], [2, 2],
    ];
    const stops: RouteWaypoint[] = [
      { coordinates: { lat: 1, lng: 1 } },
    ];
    const depot = { lat: 0, lng: 0 };

    const segments = splitGeometryIntoSegments(geometry, stops, depot);
    for (const seg of segments) {
      expect(seg.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('Valhalla geometry (with depot legs) produces multi-point first segment', () => {
    // Regression: Valhalla geometry that starts/ends at depot should produce
    // rich road geometry for depot legs, not 2-point straight lines.
    const geometry: [number, number][] = [];
    // Simulate Valhalla road geometry: depot → stop → depot (~100 points)
    for (let i = 0; i <= 50; i++) {
      geometry.push([14.0 + i * 0.01, 50.0 + i * 0.005]);
    }
    for (let i = 50; i >= 0; i--) {
      geometry.push([14.0 + i * 0.01, 50.0 + i * 0.005 + 0.001]);
    }

    const stops: RouteWaypoint[] = [
      { coordinates: { lat: 50.25, lng: 14.5 } },
    ];
    const depot = { lat: 50.0, lng: 14.0 };

    const segments = splitGeometryIntoSegments(geometry, stops, depot);

    expect(segments.length).toBe(2);
    // Depot-to-stop segment should have many road points, NOT just 2
    expect(segments[0].length).toBeGreaterThan(10);
    expect(segments[1].length).toBeGreaterThan(10);
  });

  it('anchors first and last segment to geometry endpoints', () => {
    const geometry: [number, number][] = [
      [14.0, 50.0],
      [14.1, 50.05],
      [14.2, 50.1],
      [14.3, 50.15],
      [14.4, 50.2],
      [14.5, 50.25],
    ];
    const stops: RouteWaypoint[] = [
      { coordinates: { lat: 50.1, lng: 14.2 } },
      { coordinates: { lat: 50.2, lng: 14.4 } },
    ];
    const depot = { lat: 50.0, lng: 14.0 };

    const segments = splitGeometryIntoSegments(geometry, stops, depot);

    expect(segments.length).toBe(3);
    expect(segments[0][0]).toEqual(geometry[0]);
    expect(segments[segments.length - 1][segments[segments.length - 1].length - 1]).toEqual(
      geometry[geometry.length - 1]
    );
  });
});

describe('splitVrpGeometryWithDepotLegs', () => {
  it('adds straight-line depot legs and splits road geometry between stops', () => {
    // VRP geometry covers stop1 → stop2 → stop3 (no depot legs)
    const geometry: [number, number][] = [
      [1, 1], [1.5, 1.2], [2, 2], [2.5, 2.3], [3, 3], [2.5, 2.3], [2, 2], [1.5, 1.2], [1, 1],
    ];
    const stops: RouteWaypoint[] = [
      { coordinates: { lat: 1, lng: 1 } },
      { coordinates: { lat: 2, lng: 2 } },
      { coordinates: { lat: 3, lng: 3 } },
    ];
    const depot = { lat: 0, lng: 0 };

    const segments = splitVrpGeometryWithDepotLegs(geometry, stops, depot);

    // depot→s1, s1→s2, s2→s3, s3→depot = 4 segments
    expect(segments.length).toBe(4);
    // First segment: straight line from depot to first geometry point near stop1
    expect(segments[0][0]).toEqual([0, 0]);
    // Last segment ends at depot
    expect(segments[3][segments[3].length - 1]).toEqual([0, 0]);
    // Middle segments use road geometry (more than 2 points)
    expect(segments[1].length).toBeGreaterThan(2);
  });

  it('returns empty array when no stops', () => {
    expect(splitVrpGeometryWithDepotLegs([[1, 1]], [], { lat: 0, lng: 0 })).toEqual([]);
  });

  it('middle segments preserve original road geometry points', () => {
    const geometry: [number, number][] = [
      [16.08, 48.93], [16.10, 48.95], [16.15, 49.00],
      [16.20, 49.05], [16.30, 49.10],
      [16.20, 49.05], [16.15, 49.00], [16.10, 48.95], [16.08, 48.93],
    ];
    const stops: RouteWaypoint[] = [
      { coordinates: { lat: 48.93, lng: 16.08 } },
      { coordinates: { lat: 49.10, lng: 16.30 } },
    ];
    const depot = { lat: 49.22, lng: 16.51 };

    const segments = splitVrpGeometryWithDepotLegs(geometry, stops, depot);

    expect(segments.length).toBe(3);
    // First segment is a straight line from depot to geometry start
    expect(segments[0]).toEqual([[16.51, 49.22], geometry[0]]);
    // Middle segment has multiple road points (not just 2-point straight line)
    expect(segments[1].length).toBeGreaterThan(2);
    // Last segment is a straight line from geometry end to depot
    expect(segments[2][segments[2].length - 1]).toEqual([16.51, 49.22]);
  });

  it('only depot legs are straight lines, not stop-to-stop segments', () => {
    const geometry: [number, number][] = [
      [1, 1], [1.2, 1.1], [1.5, 1.3], [2, 2],
      [2.2, 2.1], [2.5, 2.3], [3, 3],
    ];
    const stops: RouteWaypoint[] = [
      { coordinates: { lat: 1, lng: 1 } },
      { coordinates: { lat: 2, lng: 2 } },
      { coordinates: { lat: 3, lng: 3 } },
    ];
    const depot = { lat: 0, lng: 0 };

    const segments = splitVrpGeometryWithDepotLegs(geometry, stops, depot);

    // Depot legs are exactly 2 points (straight lines)
    expect(segments[0].length).toBe(2);
    expect(segments[segments.length - 1].length).toBe(2);
    // Stop-to-stop segments should have road geometry (> 2 points)
    for (let i = 1; i < segments.length - 1; i++) {
      expect(segments[i].length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('geometryIncludesDepotLegs', () => {
  it('returns true when geometry starts and ends near the depot', () => {
    const geometry: [number, number][] = [
      [16.51, 49.22],
      [16.40, 49.15],
      [16.30, 49.10],
      [16.51, 49.22],
    ];
    expect(geometryIncludesDepotLegs(geometry, { lat: 49.22, lng: 16.51 })).toBe(true);
  });

  it('returns true when geometry starts/ends within ~5km of depot (road snap)', () => {
    const geometry: [number, number][] = [
      [16.52, 49.23],
      [16.40, 49.15],
      [16.49, 49.21],
    ];
    expect(geometryIncludesDepotLegs(geometry, { lat: 49.22, lng: 16.51 })).toBe(true);
  });

  it('returns false when geometry starts far from depot (VRP geometry)', () => {
    const geometry: [number, number][] = [
      [16.08, 48.93],
      [16.20, 49.00],
      [16.08, 48.93],
    ];
    expect(geometryIncludesDepotLegs(geometry, { lat: 49.22, lng: 16.51 })).toBe(false);
  });

  it('returns false for empty geometry', () => {
    expect(geometryIncludesDepotLegs([], { lat: 49.22, lng: 16.51 })).toBe(false);
  });

  it('returns false when only start is far from depot', () => {
    const geometry: [number, number][] = [
      [16.08, 48.93],
      [16.20, 49.00],
      [16.51, 49.22],
    ];
    expect(geometryIncludesDepotLegs(geometry, { lat: 49.22, lng: 16.51 })).toBe(false);
  });

  it('returns false when only end is far from depot', () => {
    const geometry: [number, number][] = [
      [16.51, 49.22],
      [16.20, 49.00],
      [16.08, 48.93],
    ];
    expect(geometryIncludesDepotLegs(geometry, { lat: 49.22, lng: 16.51 })).toBe(false);
  });

  it('tolerates Valhalla road-snap offset of ~1-2km', () => {
    // Valhalla snaps depot to nearest road, typically within 1-2km
    const geometry: [number, number][] = [
      [16.52, 49.21],
      [16.30, 49.00],
      [16.50, 49.23],
    ];
    expect(geometryIncludesDepotLegs(geometry, { lat: 49.22, lng: 16.51 })).toBe(true);
  });
});

describe('getSegmentLabel', () => {
  const stops = [
    { name: 'Jana' },
    { name: 'Karel' },
    { name: 'Marie' },
  ];

  it('returns depot -> first stop for segment 0', () => {
    const label = getSegmentLabel(0, stops, 'Depo Brno');
    expect(label).toEqual({ fromName: 'Depo Brno', toName: 'Jana' });
  });

  it('returns stop -> stop for middle segments', () => {
    const label = getSegmentLabel(1, stops, 'Depo Brno');
    expect(label).toEqual({ fromName: 'Jana', toName: 'Karel' });
  });

  it('returns last stop -> depot for last segment', () => {
    const label = getSegmentLabel(3, stops, 'Depo Brno');
    expect(label).toEqual({ fromName: 'Marie', toName: 'Depo Brno' });
  });

  it('uses default depot name when not provided', () => {
    const label = getSegmentLabel(0, stops);
    expect(label.fromName).toBe('Depo');
  });

  it('handles empty stops list', () => {
    const label = getSegmentLabel(0, [], 'Depo');
    expect(label).toEqual({ fromName: 'Depo', toName: 'Depo' });
  });

  it('uses fallback point labels when stop names are missing', () => {
    const label = getSegmentLabel(1, [{}, {}], 'Depo');
    expect(label).toEqual({ fromName: 'Bod 1', toName: 'Bod 2' });
  });
});

describe('buildStraightLineSegments', () => {
  it('returns empty array when no stops', () => {
    const result = buildStraightLineSegments([], { lat: 0, lng: 0 });
    // With depot->depot, we get 1 segment
    expect(result.length).toBe(1);
  });

  it('creates N+1 straight-line segments for N stops', () => {
    const stops: RouteWaypoint[] = [
      { coordinates: { lat: 1, lng: 1 } },
      { coordinates: { lat: 2, lng: 2 } },
    ];
    const depot = { lat: 0, lng: 0 };

    const segments = buildStraightLineSegments(stops, depot);
    // depot->s1, s1->s2, s2->depot = 3 segments
    expect(segments.length).toBe(3);
  });

  it('each segment has exactly 2 points', () => {
    const stops: RouteWaypoint[] = [
      { coordinates: { lat: 1, lng: 1 } },
    ];
    const segments = buildStraightLineSegments(stops, { lat: 0, lng: 0 });
    for (const seg of segments) {
      expect(seg.length).toBe(2);
    }
  });

  it('segments connect in correct order', () => {
    const stops: RouteWaypoint[] = [
      { coordinates: { lat: 1, lng: 1 } },
      { coordinates: { lat: 2, lng: 2 } },
    ];
    const depot = { lat: 0, lng: 0 };

    const segments = buildStraightLineSegments(stops, depot);
    // depot -> stop1
    expect(segments[0]).toEqual([[0, 0], [1, 1]]);
    // stop1 -> stop2
    expect(segments[1]).toEqual([[1, 1], [2, 2]]);
    // stop2 -> depot
    expect(segments[2]).toEqual([[2, 2], [0, 0]]);
  });

  it('returns only stop-to-stop segments when depot is null', () => {
    const stops: RouteWaypoint[] = [
      { coordinates: { lat: 1, lng: 1 } },
      { coordinates: { lat: 2, lng: 2 } },
      { coordinates: { lat: 3, lng: 3 } },
    ];

    const segments = buildStraightLineSegments(stops, null);
    expect(segments).toEqual([
      [[1, 1], [2, 2]],
      [[2, 2], [3, 3]],
    ]);
  });
});
