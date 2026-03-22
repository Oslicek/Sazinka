import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { SavedRouteStop } from '../../services/routeService';

// ---------------------------------------------------------------------------
// MapLibre mock — lightweight fake that captures addSource calls
// ---------------------------------------------------------------------------

const addSourceSpy = vi.fn();
const addLayerSpy = vi.fn();
const addControlSpy = vi.fn();
const onSpy = vi.fn();
const removeSpy = vi.fn();
const getSourceSpy = vi.fn().mockReturnValue(null);
const getLayerSpy = vi.fn().mockReturnValue(null);
const fitBoundsSpy = vi.fn();
const isStyleLoadedSpy = vi.fn().mockReturnValue(true);
const removeSourceSpy = vi.fn();
const removeLayerSpy = vi.fn();
const getZoomSpy = vi.fn().mockReturnValue(11);
const setPaintPropertySpy = vi.fn();
const setFilterSpy = vi.fn();
const getCanvasSpy = vi.fn().mockReturnValue({ style: {} });

function createMockMap() {
  const listeners = new Map<string, Array<() => void>>();
  return {
    addSource: addSourceSpy,
    addLayer: addLayerSpy,
    addControl: addControlSpy,
    on: (event: string, fn: () => void) => {
      onSpy(event, fn);
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(fn);
      if (event === 'load') setTimeout(fn, 0);
    },
    once: (event: string, fn: () => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(fn);
    },
    off: vi.fn(),
    remove: removeSpy,
    getSource: getSourceSpy,
    getLayer: getLayerSpy,
    fitBounds: fitBoundsSpy,
    isStyleLoaded: isStyleLoadedSpy,
    removeSource: removeSourceSpy,
    removeLayer: removeLayerSpy,
    getZoom: getZoomSpy,
    setPaintProperty: setPaintPropertySpy,
    setFilter: setFilterSpy,
    getCanvas: getCanvasSpy,
    triggerRepaint: vi.fn(),
    _listeners: listeners,
  };
}

let mockMapInstance: ReturnType<typeof createMockMap>;

vi.mock('maplibre-gl', () => {
  const Marker = vi.fn().mockImplementation(() => ({
    setLngLat: vi.fn().mockReturnThis(),
    setPopup: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    getElement: vi.fn().mockReturnValue(document.createElement('div')),
    setOffset: vi.fn().mockReturnThis(),
  }));

  return {
    default: {
      Map: vi.fn().mockImplementation(() => {
        mockMapInstance = createMockMap();
        return mockMapInstance;
      }),
      Marker,
      NavigationControl: vi.fn(),
      LngLatBounds: vi.fn().mockImplementation(() => ({
        extend: vi.fn().mockReturnThis(),
        isEmpty: vi.fn().mockReturnValue(false),
        toArray: vi.fn().mockReturnValue([[13, 49], [15, 51]]),
      })),
      Popup: vi.fn().mockImplementation(() => ({
        setHTML: vi.fn().mockReturnThis(),
      })),
    },
  };
});

vi.mock('../../utils/webgl', () => ({
  isWebGLSupported: () => true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStop(id: string, lat: number, lng: number): SavedRouteStop {
  return {
    id,
    routeId: 'route-1',
    revisionId: null,
    stopOrder: 1,
    estimatedArrival: null,
    estimatedDeparture: null,
    distanceFromPreviousKm: null,
    durationFromPreviousMinutes: null,
    status: 'pending',
    stopType: 'customer',
    customerId: `cust-${id}`,
    customerName: `Customer ${id}`,
    address: 'Test Address',
    customerLat: lat,
    customerLng: lng,
    customerPhone: null,
    customerEmail: null,
    scheduledDate: null,
    scheduledTimeStart: null,
    scheduledTimeEnd: null,
    revisionStatus: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RouteMapPanel — segment feature indexing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('each route segment feature has a sequential segmentIndex (0, 1, …, N)', async () => {
    const { RouteMapPanel } = await import('./RouteMapPanel');

    const stops = [
      makeStop('s1', 50.0, 14.0),
      makeStop('s2', 50.1, 14.1),
      makeStop('s3', 50.2, 14.2),
    ];

    const depot = { lat: 49.9, lng: 13.9, name: 'Depot' };

    render(
      <RouteMapPanel
        stops={stops}
        depot={depot}
        routeGeometry={undefined}
      />,
    );

    // Flush the 'load' event callback (fires via setTimeout(fn, 0))
    await act(async () => {
      vi.runAllTimers();
    });

    const routeSourceCall = addSourceSpy.mock.calls.find(
      ([name]: [string]) => name === 'route-segments',
    );

    expect(routeSourceCall).toBeDefined();

    const featureCollection = routeSourceCall![1].data;
    expect(featureCollection.type).toBe('FeatureCollection');

    const indices = featureCollection.features.map(
      (f: { properties: { segmentIndex: number } }) => f.properties.segmentIndex,
    );

    // 3 stops + depot = 4 segments (depot→s1, s1→s2, s2→s3, s3→depot)
    expect(indices).toEqual([0, 1, 2, 3]);
  });
});
