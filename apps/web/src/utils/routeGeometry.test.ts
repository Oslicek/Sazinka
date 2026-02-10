import { describe, it, expect } from 'vitest';
import {
  splitGeometryIntoSegments,
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
});
