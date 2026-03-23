import { describe, it, expect } from 'vitest';
import { buildGoogleMapsUrl, MAX_WAYPOINTS } from './routeExport';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStop(lat: number, lng: number) {
  return { customerLat: lat, customerLng: lng, stopType: 'customer' as const };
}
function makeBreak() {
  return { customerLat: null, customerLng: null, stopType: 'break' as const };
}
function makeNullStop() {
  return { customerLat: null, customerLng: null, stopType: 'customer' as const };
}

const DEPOT = { lat: 49.0, lng: 17.0 };
const S1 = makeStop(49.1, 16.1);
const S2 = makeStop(49.2, 16.2);
const S3 = makeStop(49.3, 16.3);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildGoogleMapsUrl', () => {

  // #1
  it('depot + 3 customer stops → valid URL', () => {
    const r = buildGoogleMapsUrl({ depot: DEPOT, stops: [S1, S2, S3] });
    expect(r.url).toContain('google.com/maps/dir/');
    expect(r.url).toContain('origin=49,17');
    expect(r.url).toContain('destination=49,17');
    expect(r.url).toContain('travelmode=driving');
    // 3 waypoints pipe-separated
    const wpMatch = r.url.match(/waypoints=([^&]+)/);
    expect(wpMatch).not.toBeNull();
    const waypoints = wpMatch![1].split('|');
    expect(waypoints).toHaveLength(3);
    expect(r.warnings).toHaveLength(0);
  });

  // #2
  it('breaks are excluded from waypoints', () => {
    const r = buildGoogleMapsUrl({ depot: DEPOT, stops: [S1, makeBreak(), S2] });
    const wpMatch = r.url.match(/waypoints=([^&]+)/);
    expect(wpMatch).not.toBeNull();
    expect(wpMatch![1].split('|')).toHaveLength(2);
    expect(r.warnings).not.toContain('SKIPPED_NO_COORDS');
  });

  // #3
  it('stops with null coordinates are skipped', () => {
    const r = buildGoogleMapsUrl({ depot: DEPOT, stops: [S1, makeNullStop(), S2] });
    const wpMatch = r.url.match(/waypoints=([^&]+)/);
    expect(wpMatch![1].split('|')).toHaveLength(2);
    expect(r.warnings).toContain('SKIPPED_NO_COORDS');
  });

  // #4
  it('no depot → first stop as origin, last as destination', () => {
    const r = buildGoogleMapsUrl({ depot: null, stops: [S1, S2, S3] });
    expect(r.url).toContain('origin=49.1,16.1');
    expect(r.url).toContain('destination=49.3,16.3');
    const wpMatch = r.url.match(/waypoints=([^&]+)/);
    expect(wpMatch).not.toBeNull();
    expect(wpMatch![1].split('|')).toHaveLength(1); // middle stop
  });

  // #5
  it('no stops → empty URL + NO_STOPS warning', () => {
    const r = buildGoogleMapsUrl({ depot: DEPOT, stops: [] });
    expect(r.url).toBe('');
    expect(r.warnings).toContain('NO_STOPS');
  });

  // #6
  it('single customer stop + depot → one waypoint', () => {
    const r = buildGoogleMapsUrl({ depot: DEPOT, stops: [S1] });
    expect(r.url).toContain('origin=49,17');
    expect(r.url).toContain('destination=49,17');
    const wpMatch = r.url.match(/waypoints=([^&]+)/);
    expect(wpMatch).not.toBeNull();
    expect(wpMatch![1].split('|')).toHaveLength(1);
  });

  // #7
  it('30 customer stops → truncated to MAX_WAYPOINTS + TRUNCATED warning', () => {
    const stops = Array.from({ length: 30 }, (_, i) => makeStop(48 + i * 0.1, 16 + i * 0.1));
    const r = buildGoogleMapsUrl({ depot: DEPOT, stops });
    const wpMatch = r.url.match(/waypoints=([^&]+)/);
    expect(wpMatch![1].split('|')).toHaveLength(MAX_WAYPOINTS);
    expect(r.includedStopCount).toBe(MAX_WAYPOINTS);
    expect(r.warnings).toContain('TRUNCATED');
  });

  // #8
  it('exactly MAX_WAYPOINTS customer stops → no TRUNCATED warning', () => {
    const stops = Array.from({ length: MAX_WAYPOINTS }, (_, i) => makeStop(48 + i * 0.1, 16 + i * 0.1));
    const r = buildGoogleMapsUrl({ depot: DEPOT, stops });
    expect(r.warnings).not.toContain('TRUNCATED');
    expect(r.includedStopCount).toBe(MAX_WAYPOINTS);
  });

  // #9
  it('coordinates use at most 6 decimal places', () => {
    const stop = makeStop(49.123456789, 16.987654321);
    const r = buildGoogleMapsUrl({ depot: DEPOT, stops: [stop] });
    // Check no coord in the URL has more than 6 decimal digits
    const coordPattern = /-?\d+\.\d{7,}/g;
    expect(r.url).not.toMatch(coordPattern);
  });

  // #10
  it('no depot AND no stops → NO_STOPS and NO_DEPOT warnings, empty URL', () => {
    const r = buildGoogleMapsUrl({ depot: null, stops: [] });
    expect(r.url).toBe('');
    expect(r.warnings).toContain('NO_STOPS');
    expect(r.warnings).toContain('NO_DEPOT');
  });

  // #11
  it('no depot + single stop → stop is both origin and destination, no waypoints', () => {
    const r = buildGoogleMapsUrl({ depot: null, stops: [S1] });
    expect(r.url).toContain('origin=49.1,16.1');
    expect(r.url).toContain('destination=49.1,16.1');
    expect(r.url).not.toMatch(/waypoints=/);
  });

  // #12
  it('no depot → NO_DEPOT warning code present', () => {
    const r = buildGoogleMapsUrl({ depot: null, stops: [S1, S2] });
    expect(r.warnings).toContain('NO_DEPOT');
    expect(r.url).not.toBe('');
  });

  // #13
  it('all stops are breaks → NO_STOPS warning, empty URL', () => {
    const r = buildGoogleMapsUrl({ depot: DEPOT, stops: [makeBreak(), makeBreak()] });
    expect(r.url).toBe('');
    expect(r.warnings).toContain('NO_STOPS');
  });

  // #14
  it('depot present but ALL stops have null coords → no waypoints, SKIPPED_NO_COORDS', () => {
    const r = buildGoogleMapsUrl({ depot: DEPOT, stops: [makeNullStop(), makeNullStop()] });
    expect(r.url).toBe('');
    expect(r.warnings).toContain('SKIPPED_NO_COORDS');
    expect(r.warnings).toContain('NO_STOPS');
  });

  // #15
  it('mixed: breaks + null coords + valid stops → correct result', () => {
    const r = buildGoogleMapsUrl({ depot: DEPOT, stops: [S1, makeBreak(), makeNullStop(), S2, S3] });
    const wpMatch = r.url.match(/waypoints=([^&]+)/);
    expect(wpMatch![1].split('|')).toHaveLength(3); // S1, S2, S3
    expect(r.warnings).toContain('SKIPPED_NO_COORDS');
    expect(r.warnings).not.toContain('NO_STOPS');
  });

  // #16
  it('negative coordinates (southern/western hemisphere) → preserved in URL', () => {
    const sydneyStop = makeStop(-33.8688, 151.2093);
    const r = buildGoogleMapsUrl({ depot: { lat: -33.9, lng: 151.1 }, stops: [sydneyStop] });
    expect(r.url).toContain('origin=-33.9,151.1');
    expect(r.url).toContain('destination=-33.9,151.1');
    expect(r.url).toContain('-33.8688,151.2093');
  });

  // #17
  it('coordinate at 0,0 (lat=0, lng=0) is NOT treated as null (falsy guard)', () => {
    const nullIsland = makeStop(0, 0);
    const r = buildGoogleMapsUrl({ depot: DEPOT, stops: [nullIsland] });
    expect(r.warnings).not.toContain('SKIPPED_NO_COORDS');
    expect(r.url).toContain('waypoints=0,0');
  });

  // #18 — validStopCount reflects post-filter, pre-truncation count
  it('validStopCount equals valid stops before truncation', () => {
    const stops = Array.from({ length: 30 }, (_, i) => makeStop(48 + i * 0.1, 16 + i * 0.1));
    const r = buildGoogleMapsUrl({ depot: DEPOT, stops });
    expect(r.validStopCount).toBe(30);
    expect(r.includedStopCount).toBe(MAX_WAYPOINTS);
  });

  // #19 — validStopCount excludes null-coord stops
  it('validStopCount excludes stops with null coordinates', () => {
    const r = buildGoogleMapsUrl({ depot: DEPOT, stops: [S1, makeNullStop(), S2, makeNullStop()] });
    expect(r.validStopCount).toBe(2);
    expect(r.includedStopCount).toBe(2);
  });
});
