import { describe, it, expect } from 'vitest';
import { createMockSavedRouteStop } from '../test/factories/inbox';
import {
  buildGeometryKey,
  buildRouteShapeKey,
  buildInRouteIds,
  computeActualRouteEnd,
  buildSelectedCandidatesForMap,
} from './planningInboxUtils';

describe('planningInboxUtils', () => {
  describe('buildGeometryKey', () => {
    it('joins customer stop lat/lng and skips breaks', () => {
      const stops = [
        createMockSavedRouteStop({
          id: '1',
          stopType: 'customer',
          customerLat: 50,
          customerLng: 14,
        }),
        createMockSavedRouteStop({
          id: '2',
          stopType: 'break',
          customerLat: null,
          customerLng: null,
          customerId: null,
        }),
      ];
      expect(buildGeometryKey(stops)).toBe('50,14');
    });

    it('returns empty string when no routable stops', () => {
      expect(buildGeometryKey([])).toBe('');
    });
  });

  describe('buildRouteShapeKey', () => {
    it('includes id and coords for customer stops only', () => {
      const stops = [
        createMockSavedRouteStop({
          id: 's1',
          stopType: 'customer',
          customerLat: 51,
          customerLng: 15,
        }),
      ];
      expect(buildRouteShapeKey(stops)).toBe('s1:51,15');
    });
  });

  describe('buildInRouteIds', () => {
    it('collects customerId per stop including null for breaks', () => {
      const customer = createMockSavedRouteStop({ customerId: 'a', stopType: 'customer' });
      const br = createMockSavedRouteStop({ stopType: 'break' });
      br.customerId = null;
      const set = buildInRouteIds([customer, br]);
      expect(set.has('a')).toBe(true);
      expect(set.has(null)).toBe(true);
    });
  });

  describe('computeActualRouteEnd', () => {
    it('returns routeEndTime when no stops', () => {
      expect(computeActualRouteEnd([], null, '17:00')).toBe('17:00');
    });

    it('returns routeEndTime when last stop has no ETA', () => {
      const s = createMockSavedRouteStop({ id: 'x' });
      s.estimatedArrival = null;
      s.estimatedDeparture = null;
      expect(computeActualRouteEnd([s], null, '16:00')).toBe('16:00');
    });

    it('returns last departure slice when no return leg', () => {
      const stops = [
        createMockSavedRouteStop({
          estimatedDeparture: '14:30:00',
        }),
      ];
      expect(computeActualRouteEnd(stops, { durationMinutes: 0 }, null)).toBe('14:30');
    });

    it('adds return travel minutes to last departure', () => {
      const stops = [
        createMockSavedRouteStop({
          estimatedDeparture: '10:00',
        }),
      ];
      expect(computeActualRouteEnd(stops, { durationMinutes: 45 }, null)).toBe('10:45');
    });
  });

  describe('buildSelectedCandidatesForMap', () => {
    it('returns empty when no selection', () => {
      expect(buildSelectedCandidatesForMap(new Set(), [], new Set())).toEqual([]);
    });

    it('maps selected geocoded candidates not in route', () => {
      const candidates = [
        { customerId: 'c1', customerName: 'A', customerLat: 50, customerLng: 14 },
        { customerId: 'c2', customerName: 'B', customerLat: 51, customerLng: 15 },
      ];
      const inRoute = new Set<string | null>(['c2']);
      const out = buildSelectedCandidatesForMap(new Set(['c1', 'c2']), candidates, inRoute);
      expect(out).toEqual([
        { id: 'c1', name: 'A', coordinates: { lat: 50, lng: 14 } },
      ]);
    });

    it('skips candidates without coordinates', () => {
      const candidates = [
        { customerId: 'c1', customerName: 'A', customerLat: null, customerLng: null },
      ];
      expect(buildSelectedCandidatesForMap(new Set(['c1']), candidates, new Set())).toEqual([]);
    });
  });
});
