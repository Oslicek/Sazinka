import { useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import {
  splitGeometryIntoSegments,
  buildStraightLineSegments,
  getSegmentLabel,
} from '../../utils/routeGeometry';
import type { SavedRouteStop } from '../../services/routeService';
import styles from './RouteMapPanel.module.css';

export interface MapDepot {
  lat: number;
  lng: number;
  name?: string;
}

export interface InsertionPreview {
  candidateId: string;
  candidateName: string;
  coordinates: { lat: number; lng: number };
  insertAfterIndex: number;
  insertBeforeIndex: number;
}

export interface SelectedCandidate {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number };
}

interface RouteMapPanelProps {
  stops: SavedRouteStop[];
  depot: MapDepot | null;
  routeGeometry?: [number, number][];
  highlightedStopId?: string | null;
  /** Show a candidate's location on the map before it is added to the route */
  selectedCandidate?: SelectedCandidate | null;
  insertionPreview?: InsertionPreview | null;
  onStopClick?: (stopId: string) => void;
  isLoading?: boolean;
  className?: string;
  /** Called when a route segment is highlighted/unhighlighted */
  onSegmentHighlight?: (segmentIndex: number | null) => void;
  /** Currently highlighted segment (controlled mode) */
  highlightedSegment?: number | null;
  /** Debug source tag (planner / inbox / day overview) */
  debugSource?: string;
  /** Debug route id */
  debugRouteId?: string | null;
}

export function RouteMapPanel({
  stops,
  depot,
  routeGeometry,
  highlightedStopId,
  selectedCandidate,
  insertionPreview,
  onStopClick,
  isLoading,
  className,
  onSegmentHighlight,
  highlightedSegment: controlledHighlightedSegment,
  debugSource,
  debugRouteId,
}: RouteMapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const depotMarkerRef = useRef<maplibregl.Marker | null>(null);
  const previewMarkerRef = useRef<maplibregl.Marker | null>(null);
  const selectedCandidateMarkerRef = useRef<maplibregl.Marker | null>(null);

  // Event handler refs for proper cleanup
  const segmentClickHandlerRef = useRef<((e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void) | null>(null);
  const segmentEnterHandlerRef = useRef<(() => void) | null>(null);
  const segmentLeaveHandlerRef = useRef<(() => void) | null>(null);
  const highlightedSegmentRef = useRef<number | null>(null);

  // Track whether map style has finished loading (needed before addSource/addLayer)
  const [mapLoaded, setMapLoaded] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(11);

  // Internal segment highlight state (used when not controlled)
  const [internalHighlightedSegment, setInternalHighlightedSegment] = useState<number | null>(null);

  // Use controlled or internal state
  const highlightedSegment = controlledHighlightedSegment !== undefined
    ? controlledHighlightedSegment
    : internalHighlightedSegment;

  const setHighlightedSegment = useCallback((value: number | null) => {
    if (onSegmentHighlight) {
      onSegmentHighlight(value);
    } else {
      setInternalHighlightedSegment(value);
    }
  }, [onSegmentHighlight]);

  useEffect(() => {
    highlightedSegmentRef.current = highlightedSegment ?? null;
  }, [highlightedSegment]);

  // Initialize map (only once - depot changes are handled by fitBounds/flyTo)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter: [number, number] = [14.4378, 50.0755]; // Prague default

    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
          },
        ],
      },
      center: initialCenter,
      zoom: 11,
    });

    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    mapRef.current.on('load', () => {
      setMapLoaded(true);
    });

    mapRef.current.on('zoom', () => {
      setZoomLevel(mapRef.current?.getZoom() ?? 0);
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update depot marker
  useEffect(() => {
    if (!mapRef.current || !depot) return;

    if (depotMarkerRef.current) {
      depotMarkerRef.current.setLngLat([depot.lng, depot.lat]);
    } else {
      depotMarkerRef.current = new maplibregl.Marker({ color: '#22c55e' })
        .setLngLat([depot.lng, depot.lat])
        .setPopup(new maplibregl.Popup().setHTML(`<strong>Depo</strong><br/>${depot.name || 'Výchozí místo'}`))
        .addTo(mapRef.current);
    }
  }, [depot]);

  // Clear all stop markers and route layers
  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();
  }, []);

  const clearRouteLayers = useCallback(() => {
    if (!mapRef.current) return;

    // Remove event handlers
    if (segmentClickHandlerRef.current) {
      mapRef.current.off('click', 'route-hit-area', segmentClickHandlerRef.current);
      segmentClickHandlerRef.current = null;
    }
    if (segmentEnterHandlerRef.current) {
      mapRef.current.off('mouseenter', 'route-hit-area', segmentEnterHandlerRef.current);
      segmentEnterHandlerRef.current = null;
    }
    if (segmentLeaveHandlerRef.current) {
      mapRef.current.off('mouseleave', 'route-hit-area', segmentLeaveHandlerRef.current);
      segmentLeaveHandlerRef.current = null;
    }

    // Remove layers and sources
    for (const layerId of ['route-highlight', 'route-hit-area', 'route-line']) {
      if (mapRef.current.getLayer(layerId)) {
        mapRef.current.removeLayer(layerId);
      }
    }
    if (mapRef.current.getSource('route-segments')) {
      mapRef.current.removeSource('route-segments');
    }
    // Legacy single-line source
    if (mapRef.current.getSource('route')) {
      mapRef.current.removeSource('route');
    }

  }, []);

  // Update stop markers
  useEffect(() => {
    if (!mapRef.current) return;

    clearMarkers();

    const snappedCoordByStopId = new Map<string, [number, number]>();
    if (routeGeometry && routeGeometry.length > 0 && depot) {
      const mappableStops = stops.filter((s) => s.customerLat != null && s.customerLng != null);
      if (mappableStops.length > 0) {
        const waypoints = mappableStops.map((s) => ({
          coordinates: { lat: s.customerLat!, lng: s.customerLng! },
          name: s.customerName,
        }));
        const snappedSegments = splitGeometryIntoSegments(routeGeometry, waypoints, depot);
        for (let i = 0; i < mappableStops.length; i += 1) {
          const seg = snappedSegments[i];
          const end = seg?.[seg.length - 1];
          if (end) {
            snappedCoordByStopId.set(mappableStops[i].id, end);
          }
        }
      }
    }

    stops.forEach((stop, index) => {
      const markerKey = stop.customerId ?? stop.id;
      const isHighlighted = stop.id === highlightedStopId || stop.customerId === highlightedStopId;
      const snapped = snappedCoordByStopId.get(stop.id);
      const lat = snapped ? snapped[1] : stop.customerLat;
      const lng = snapped ? snapped[0] : stop.customerLng;
      if (!lat || !lng) return; // Skip stops without coordinates

      const el = document.createElement('div');
      el.className = `${styles.stopMarker} ${isHighlighted ? styles.stopMarkerHighlighted : ''}`;
      const label = document.createElement('span');
      label.className = styles.markerLabel;
      label.textContent = String(index + 1);
      el.appendChild(label);

      // Use 'top-left' anchor with explicit pixel offset instead of 'bottom'.
      // 'bottom' uses CSS translate(-50%,-100%) which depends on the element's
      // computed height. If CSS module hasn't loaded yet, the height may be wrong
      // (e.g. 12px from label content instead of 36px from CSS), causing the
      // marker to drift hundreds of km south at low zoom levels.
      // With 'top-left' + fixed offset, positioning is independent of CSS timing.
      // Marker is 30×36px; bottom-center tip is at (15, 36) from top-left.
      const marker = new maplibregl.Marker({
        element: el,
        anchor: 'top-left',
        offset: [-15, -36],
      })
        .setLngLat([lng, lat])
        .setPopup(
          new maplibregl.Popup().setHTML(`
            <strong>${index + 1}. ${stop.customerName}</strong><br/>
            ${stop.address}<br/>
            ${stop.estimatedArrival && stop.estimatedDeparture ? `<small>ETA: ${stop.estimatedArrival} | ETD: ${stop.estimatedDeparture}</small>` : ''}
          `)
        )
        .addTo(mapRef.current!);

      // Click handler
      if (onStopClick) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => onStopClick(markerKey));
      }

      markersRef.current.set(markerKey, marker);
    });
    // #region agent log – marker dimensions diagnostic
    const markerDiag = Array.from(markersRef.current.entries()).map(([key, m]) => {
      const ll = m.getLngLat();
      const mEl = m.getElement();
      const child = mEl.firstElementChild as HTMLElement | null;
      return {
        key,
        lng: ll.lng,
        lat: ll.lat,
        wrapperW: mEl.offsetWidth,
        wrapperH: mEl.offsetHeight,
        childW: child?.offsetWidth,
        childH: child?.offsetHeight,
        wrapperTransform: mEl.style.transform,
      };
    });
    fetch('http://127.0.0.1:7242/ingest/9aaba2f3-fc9a-42ee-ad9d-d660c5a30902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'marker-drift-1',hypothesisId:'H18',location:'RouteMapPanel.tsx:markers-build',message:'markers rendered with dimension diagnostics',data:{debugSource:debugSource ?? null,debugRouteId:debugRouteId ?? null,markerCount:markersRef.current.size,snappedCount:snappedCoordByStopId.size,markers:markerDiag,stops:stops.map((s,i)=>({i,id:s.id,customerId:s.customerId,name:s.customerName,lng:s.customerLng,lat:s.customerLat,stopOrder:s.stopOrder,snapped:snappedCoordByStopId.get(s.id) ?? null}))},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [stops, highlightedStopId, onStopClick, clearMarkers, routeGeometry, depot]);

  // Show selected candidate location on the map (before adding to route)
  useEffect(() => {
    if (!mapRef.current) return;

    // Remove previous selected candidate marker
    if (selectedCandidateMarkerRef.current) {
      selectedCandidateMarkerRef.current.remove();
      selectedCandidateMarkerRef.current = null;
    }

    if (!selectedCandidate) return;

    // Don't show if candidate is already a route stop (it already has a marker)
    if (stops.some((s) => s.id === selectedCandidate.id)) return;

    const { lat, lng } = selectedCandidate.coordinates;
    if (!lat || !lng) return;

    // Create a distinctive marker for the selected candidate
    const el = document.createElement('div');
    el.className = styles.selectedCandidateMarker;

    // Use 'top-left' with fixed pixel offset to avoid CSS-timing dependency.
    // Circle marker is 28×28px; center is at (14, 14).
    selectedCandidateMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [-14, -14] })
      .setLngLat([lng, lat])
      .setPopup(
        new maplibregl.Popup({ offset: 25 }).setHTML(
          `<strong>${selectedCandidate.name}</strong>`
        )
      )
      .addTo(mapRef.current);
  }, [selectedCandidate, stops]);

  // Fit map bounds whenever relevant points change:
  // - No candidate, no route: center on depot
  // - Candidate selected, no route: fit depot + candidate
  // - Route exists (± candidate): fit all route stops + depot + candidate
  useEffect(() => {
    if (!mapRef.current) return;

    const candidateCoord = selectedCandidate
      && !stops.some((s) => s.id === selectedCandidate.id)
      && selectedCandidate.coordinates.lat && selectedCandidate.coordinates.lng
      ? selectedCandidate.coordinates
      : null;

    if (stops.length === 0 && !candidateCoord) {
      // No route, no candidate → center on depot
      if (depot) {
        mapRef.current.flyTo({
          center: [depot.lng, depot.lat],
          zoom: 11,
          duration: 500,
        });
      }
      return;
    }

    // Build bounds from all visible points
    const bounds = new maplibregl.LngLatBounds();

    // Include depot
    if (depot) {
      bounds.extend([depot.lng, depot.lat]);
    }

    // Include all route stops
    for (const stop of stops) {
      if (stop.customerLat && stop.customerLng) {
        bounds.extend([stop.customerLng, stop.customerLat]);
      }
    }

    // Include selected candidate
    if (candidateCoord) {
      bounds.extend([candidateCoord.lng, candidateCoord.lat]);
    }

    mapRef.current.fitBounds(bounds, { padding: 60, duration: 500, maxZoom: 14 });
  }, [selectedCandidate, stops, depot]);

  // Update route line as segmented GeoJSON with highlight support
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    clearRouteLayers();

    if (stops.length === 0) return;

    console.log('[RouteMapPanel] Rendering route with', stops.length, 'stops, routeGeometry length:', routeGeometry?.length || 0, 'depot:', !!depot);

    // Build segments using shared utilities
    const waypoints = stops
      .filter((s) => s.customerLat && s.customerLng)
      .map((s) => ({
        coordinates: { lat: s.customerLat!, lng: s.customerLng! },
        name: s.customerName,
      }));
    const stopsWithoutCoords = stops.filter((s) => !(s.customerLat && s.customerLng)).length;

    // Use a fake depot at the first stop's location if no depot is set
    const effectiveDepot = depot ?? { lat: stops[0].customerLat!, lng: stops[0].customerLng! };

    let segments: [number, number][][];
    if (routeGeometry && routeGeometry.length > 0) {
      console.log('[RouteMapPanel] Using Valhalla geometry');
      segments = splitGeometryIntoSegments(routeGeometry, waypoints, effectiveDepot);
    } else {
      console.log('[RouteMapPanel] Using straight line segments (no Valhalla geometry)');
      segments = buildStraightLineSegments(waypoints, depot ? effectiveDepot : null);
    }

    if (segments.length === 0) return;

    const expectedSegments = waypoints.length + 1;
    const hasGeometry = !!(routeGeometry && routeGeometry.length > 0);
    const startsAtGeometryStart = hasGeometry ? (
      segments[0]?.[0]?.[0] === routeGeometry![0]?.[0] &&
      segments[0]?.[0]?.[1] === routeGeometry![0]?.[1]
    ) : null;
    const lastSegment = segments[segments.length - 1];
    const lastPoint = lastSegment?.[lastSegment.length - 1];
    const geometryLast = hasGeometry ? routeGeometry![routeGeometry!.length - 1] : null;
    const endsAtGeometryEnd = hasGeometry ? (
      !!lastPoint &&
      !!geometryLast &&
      lastPoint[0] === geometryLast[0] &&
      lastPoint[1] === geometryLast[1]
    ) : null;
    const endToDepotKm = hasGeometry && geometryLast && depot
      ? Math.sqrt(
        ((geometryLast[0] - depot.lng) * 111.32) ** 2 +
        ((geometryLast[1] - depot.lat) * 111.32) ** 2
      )
      : null;
    const endToLastWaypointKm = hasGeometry && geometryLast && waypoints.length > 0
      ? Math.sqrt(
        ((geometryLast[0] - waypoints[waypoints.length - 1].coordinates.lng) * 111.32) ** 2 +
        ((geometryLast[1] - waypoints[waypoints.length - 1].coordinates.lat) * 111.32) ** 2
      )
      : null;
    const endToDepotPx = hasGeometry && geometryLast && depot && mapRef.current
      ? (() => {
          const endPx = mapRef.current!.project([geometryLast[0], geometryLast[1]]);
          const depotPx = mapRef.current!.project([depot.lng, depot.lat]);
          return Math.hypot(endPx.x - depotPx.x, endPx.y - depotPx.y);
        })()
      : null;
    const endToLastWaypointPx = hasGeometry && geometryLast && waypoints.length > 0 && mapRef.current
      ? (() => {
          const endPx = mapRef.current!.project([geometryLast[0], geometryLast[1]]);
          const wp = waypoints[waypoints.length - 1].coordinates;
          const wpPx = mapRef.current!.project([wp.lng, wp.lat]);
          return Math.hypot(endPx.x - wpPx.x, endPx.y - wpPx.y);
        })()
      : null;
    const waypointSnapDistancesKm = hasGeometry
      ? waypoints.map((w, idx) => {
          let best = Infinity;
          for (let i = 0; i < routeGeometry!.length; i += 1) {
            const dx = routeGeometry![i][0] - w.coordinates.lng;
            const dy = routeGeometry![i][1] - w.coordinates.lat;
            const d = Math.sqrt(((dx * 111.32) ** 2) + ((dy * 111.32) ** 2));
            if (d < best) best = d;
          }
          return { index: idx, name: w.name ?? `wp-${idx + 1}`, km: best };
        })
      : [];
    const depotSnapDistanceKm = hasGeometry && depot
      ? (() => {
          let best = Infinity;
          for (let i = 0; i < routeGeometry!.length; i += 1) {
            const dx = routeGeometry![i][0] - depot.lng;
            const dy = routeGeometry![i][1] - depot.lat;
            const d = Math.sqrt(((dx * 111.32) ** 2) + ((dy * 111.32) ** 2));
            if (d < best) best = d;
          }
          return best;
        })()
      : null;
    const maxWaypointSnapKm = waypointSnapDistancesKm.length > 0
      ? Math.max(...waypointSnapDistancesKm.map((x) => x.km))
      : null;
    const mapZoom = mapRef.current?.getZoom?.() ?? null;
    const targetChain: [number, number][] = depot
      ? [
          [effectiveDepot.lng, effectiveDepot.lat],
          ...waypoints.map((w) => [w.coordinates.lng, w.coordinates.lat] as [number, number]),
          [effectiveDepot.lng, effectiveDepot.lat],
        ]
      : waypoints.map((w) => [w.coordinates.lng, w.coordinates.lat] as [number, number]);
    const segmentEndpointDistancesKm = targetChain.length >= 2
      ? segments.slice(0, Math.min(segments.length, targetChain.length - 1)).map((seg, i) => {
          const segStart = seg?.[0];
          const segEnd = seg?.[seg.length - 1];
          const tgtStart = targetChain[i];
          const tgtEnd = targetChain[i + 1];
          const startKm = segStart && tgtStart
            ? Math.sqrt((((segStart[0]-tgtStart[0])*111.32)**2)+(((segStart[1]-tgtStart[1])*111.32)**2))
            : null;
          const endKm = segEnd && tgtEnd
            ? Math.sqrt((((segEnd[0]-tgtEnd[0])*111.32)**2)+(((segEnd[1]-tgtEnd[1])*111.32)**2))
            : null;
          return { i, startKm, endKm, segPoints: seg.length };
        })
      : [];
    let maxSegmentStartErrKm: number | null = null;
    let maxSegmentEndErrKm: number | null = null;
    if (targetChain.length >= 2 && segments.length > 0) {
      let startMax = 0;
      let endMax = 0;
      const comparable = Math.min(segments.length, targetChain.length - 1);
      for (let i = 0; i < comparable; i += 1) {
        const seg = segments[i];
        const segStart = seg?.[0];
        const segEnd = seg?.[seg.length - 1];
        const tgtStart = targetChain[i];
        const tgtEnd = targetChain[i + 1];
        if (segStart && tgtStart) {
          const startErr = Math.sqrt(
            ((segStart[0] - tgtStart[0]) * 111.32) ** 2 +
            ((segStart[1] - tgtStart[1]) * 111.32) ** 2
          );
          startMax = Math.max(startMax, startErr);
        }
        if (segEnd && tgtEnd) {
          const endErr = Math.sqrt(
            ((segEnd[0] - tgtEnd[0]) * 111.32) ** 2 +
            ((segEnd[1] - tgtEnd[1]) * 111.32) ** 2
          );
          endMax = Math.max(endMax, endErr);
        }
      }
      maxSegmentStartErrKm = startMax;
      maxSegmentEndErrKm = endMax;
    }
    const markerVisualTipOffsetPx = 0;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9aaba2f3-fc9a-42ee-ad9d-d660c5a30902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix-7',hypothesisId:'H11',location:'RouteMapPanel.tsx:route-build',message:'route segmentation summary',data:{debugSource:debugSource ?? null,debugRouteId:debugRouteId ?? null,stopsCount:stops.length,waypointsCount:waypoints.length,stopsWithoutCoords,segmentsCount:segments.length,expectedSegments,hasGeometry,geometryLength:routeGeometry?.length ?? 0,startsAtGeometryStart,endsAtGeometryEnd,endToDepotKm,endToLastWaypointKm,endToDepotPx,endToLastWaypointPx,maxSegmentStartErrKm,maxSegmentEndErrKm,mapZoom,markerVisualTipOffsetPx,depotSnapDistanceKm,maxWaypointSnapKm,waypointSnapDistancesKm,segmentEndpointDistancesKm,stopSignature:stops.map((s,i)=>`${i}:${s.id}:${s.customerId}:${s.customerLat},${s.customerLng}`)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // Build GeoJSON FeatureCollection with segmentIndex property
    const features = segments.map((coords, index) => ({
      type: 'Feature' as const,
      properties: { segmentIndex: index },
      geometry: {
        type: 'LineString' as const,
        coordinates: coords,
      },
    }));

    mapRef.current.addSource('route-segments', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features,
      },
    });

    // Base route line (all segments)
    mapRef.current.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route-segments',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#3b82f6',
        'line-width': 4,
        'line-opacity': 0.8,
      },
    });

    // Wider invisible hit area for clicking segments
    mapRef.current.addLayer({
      id: 'route-hit-area',
      type: 'line',
      source: 'route-segments',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': 'transparent',
        'line-width': 20,
        'line-opacity': 0,
      },
    });

    // Highlight layer (only shows the selected segment)
    mapRef.current.addLayer({
      id: 'route-highlight',
      type: 'line',
      source: 'route-segments',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#f59e0b',
        'line-width': 6,
        'line-opacity': 0.9,
      },
      filter: ['==', ['get', 'segmentIndex'], -1], // Hide initially
    });

    // Click handler: toggle segment highlight
    segmentClickHandlerRef.current = (e) => {
      const feat = e.features;
      if (feat && feat.length > 0) {
        const clickedIndex = feat[0].properties?.segmentIndex;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9aaba2f3-fc9a-42ee-ad9d-d660c5a30902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix-3',hypothesisId:'H1',location:'RouteMapPanel.tsx:segment-click',message:'map segment click raw index',data:{clickedIndexType:typeof clickedIndex,clickedIndexValue:clickedIndex,currentHighlightedRef:highlightedSegmentRef.current},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        if (typeof clickedIndex === 'number' && Number.isFinite(clickedIndex)) {
          setHighlightedSegment(highlightedSegmentRef.current === clickedIndex ? null : clickedIndex);
        } else if (typeof clickedIndex === 'string') {
          const parsed = Number(clickedIndex);
          if (Number.isFinite(parsed)) {
            setHighlightedSegment(highlightedSegmentRef.current === parsed ? null : parsed);
          }
        }
      }
    };
    mapRef.current.on('click', 'route-hit-area', segmentClickHandlerRef.current);

    // Cursor pointer on hover
    segmentEnterHandlerRef.current = () => {
      if (mapRef.current) mapRef.current.getCanvas().style.cursor = 'pointer';
    };
    segmentLeaveHandlerRef.current = () => {
      if (mapRef.current) mapRef.current.getCanvas().style.cursor = '';
    };
    mapRef.current.on('mouseenter', 'route-hit-area', segmentEnterHandlerRef.current);
    mapRef.current.on('mouseleave', 'route-hit-area', segmentLeaveHandlerRef.current);
  }, [stops, depot, routeGeometry, clearRouteLayers, mapLoaded, setHighlightedSegment]);

  // Update highlight filter when highlightedSegment changes
  useEffect(() => {
    if (!mapRef.current) return;
    if (!mapRef.current.getLayer('route-highlight')) return;

    if (highlightedSegment !== null) {
      mapRef.current.setFilter('route-highlight', ['==', ['get', 'segmentIndex'], highlightedSegment]);
    } else {
      mapRef.current.setFilter('route-highlight', ['==', ['get', 'segmentIndex'], -1]);
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9aaba2f3-fc9a-42ee-ad9d-d660c5a30902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix-1',hypothesisId:'H2',location:'RouteMapPanel.tsx:highlight-filter',message:'highlight filter updated',data:{highlightedSegment},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [highlightedSegment]);

  // Update insertion preview marker
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    // Remove existing preview marker
    if (previewMarkerRef.current) {
      previewMarkerRef.current.remove();
      previewMarkerRef.current = null;
    }

    // Remove existing preview line
    if (mapRef.current.getLayer('preview-line')) {
      mapRef.current.removeLayer('preview-line');
    }
    if (mapRef.current.getSource('preview')) {
      mapRef.current.removeSource('preview');
    }

    if (!insertionPreview || !depot) return;

    // Add preview marker (pulsing)
    const el = document.createElement('div');
    el.className = styles.previewMarker;

    // Preview marker is 24×24px circle; center at (12, 12).
    previewMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [-12, -12] })
      .setLngLat([insertionPreview.coordinates.lng, insertionPreview.coordinates.lat])
      .setPopup(
        new maplibregl.Popup().setHTML(`
          <strong>Návrh: ${insertionPreview.candidateName}</strong><br/>
          <small>Vloží se mezi ${insertionPreview.insertAfterIndex + 1} → ${insertionPreview.insertBeforeIndex + 1}</small>
        `)
      )
      .addTo(mapRef.current);

    // Draw preview insertion line
    const prevStop = stops[insertionPreview.insertAfterIndex];
    const nextStop = stops[insertionPreview.insertBeforeIndex];

    if (prevStop && nextStop) {
      const previewCoords: [number, number][] = [
        [prevStop.coordinates.lng, prevStop.coordinates.lat],
        [insertionPreview.coordinates.lng, insertionPreview.coordinates.lat],
        [nextStop.coordinates.lng, nextStop.coordinates.lat],
      ];

      mapRef.current.addSource('preview', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: previewCoords,
          },
        },
      });

      mapRef.current.addLayer({
        id: 'preview-line',
        type: 'line',
        source: 'preview',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#f59e0b',
          'line-width': 3,
          'line-dasharray': [2, 2],
          'line-opacity': 0.9,
        },
      });
    }
  }, [insertionPreview, stops, depot, mapLoaded]);

  // Build segment info overlay
  const segmentInfo = highlightedSegment !== null && stops.length > 0
    ? getSegmentLabel(
        highlightedSegment,
        stops.map((s) => ({ name: s.customerName })),
        depot?.name || 'Depo',
      )
    : null;

  // #region agent log
  if (highlightedSegment !== null && segmentInfo) { fetch('http://127.0.0.1:7242/ingest/9aaba2f3-fc9a-42ee-ad9d-d660c5a30902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix-1',hypothesisId:'H4',location:'RouteMapPanel.tsx:segment-info',message:'segment overlay rendered',data:{highlightedSegment,fromName:segmentInfo.fromName,toName:segmentInfo.toName},timestamp:Date.now()})}).catch(()=>{}); }
  // #endregion

  return (
    <div className={`${styles.container} ${className ?? ''}`}>
      {isLoading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.spinner} />
        </div>
      )}
      <div ref={containerRef} className={styles.map} />
      <div className={styles.zoomLevel}>Z {zoomLevel.toFixed(1)}</div>
      {stops.length === 0 && !isLoading && !selectedCandidate && (
        <div className={styles.emptyHint}>
          Zatím žádné zastávky v trase
        </div>
      )}
      {segmentInfo && (
        <div className={styles.segmentInfo}>
          <span className={styles.segmentInfoLabel}>
            {segmentInfo.fromName} → {segmentInfo.toName}
          </span>
          <button
            className={styles.segmentInfoClose}
            onClick={() => setHighlightedSegment(null)}
            title="Zrušit zvýraznění"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
