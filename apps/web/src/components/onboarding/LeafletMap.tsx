
/**
 * Lazy-loaded interactive map fallback for depot geocoding.
 *
 * Imported only when Nominatim geocoding fails (rare).
 * Wraps react-leaflet with a draggable pin; calls onPinMoved with new coords.
 *
 * NOTE: react-leaflet is NOT yet in package.json — install it when needed:
 *   pnpm add leaflet react-leaflet
 *   pnpm add -D @types/leaflet
 */

interface Props {
  hint: string;
  initialLat: number;
  initialLng: number;
  onPinMoved: (lat: number, lng: number) => void;
}

export function LeafletMap({ hint, initialLat, initialLng, onPinMoved }: Props) {
  // Placeholder implementation: display a note until react-leaflet is installed.
  // Replace with a real MapContainer + DraggableMarker once the dependency is added.
  return (
    <div
      style={{
        background: '#f3f4f6',
        border: '1px dashed #d1d5db',
        borderRadius: 8,
        padding: '1.5rem',
        textAlign: 'center',
        fontSize: '0.875rem',
        color: '#6b7280',
      }}
      role="img"
      aria-label="Interactive map (react-leaflet required)"
    >
      <p style={{ margin: 0 }}>{hint}</p>
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem' }}>
        [Map placeholder — install react-leaflet to enable interactive map]
      </p>
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem' }}>
        Initial position: {initialLat.toFixed(4)}, {initialLng.toFixed(4)}
      </p>
      <button
        type="button"
        style={{ marginTop: '0.75rem', padding: '0.375rem 0.75rem', cursor: 'pointer' }}
        onClick={() => onPinMoved(initialLat, initialLng)}
      >
        Confirm position
      </button>
    </div>
  );
}
