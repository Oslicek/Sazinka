/**
 * Print HTML builder for a planned route.
 *
 * Generates a self-contained HTML document with inline CSS for printing.
 * All user-supplied strings pass through escapeHtml to prevent XSS.
 */

export interface PrintLabels {
  depot: string;
  departure: string;
  return: string;
  totalTime: string;
  workTime: string;
  travelTime: string;
  distance: string;
  stops: string;
  colOrder: string;
  colName: string;
  colAddress: string;
  colEta: string;
  colEtd: string;
  colService: string;
  generated: string;
}

const DEFAULT_LABELS: PrintLabels = {
  depot: 'Depot',
  departure: 'Departure',
  return: 'Return',
  totalTime: 'Total time',
  workTime: 'Work time',
  travelTime: 'Travel time',
  distance: 'Distance',
  stops: 'Stops',
  colOrder: '#',
  colName: 'Name',
  colAddress: 'Address',
  colEta: 'ETA',
  colEtd: 'ETD',
  colService: 'Service',
  generated: 'Generated',
};

export interface PrintRouteParams {
  title: string;
  mapImageDataUrl: string;
  stops: Array<{
    order: number;
    name: string;
    address: string;
    eta: string | null;
    etd: string | null;
    serviceDuration: string | null;
    stopType: 'customer' | 'break';
  }>;
  depot: { name: string } | null;
  depotDeparture: string | null;
  returnTime: string | null;
  stats: {
    totalTime: string | null;
    workTime: string | null;
    travelTime: string | null;
    distance: string | null;
    stopCount: number;
  };
  /** Localized labels for the print document. Falls back to English defaults. */
  labels?: Partial<PrintLabels>;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dash(value: string | null | undefined): string {
  return value ? escapeHtml(value) : '—';
}

export function buildPrintHtml(params: PrintRouteParams): string {
  const { title, mapImageDataUrl, stops, depot, depotDeparture, returnTime, stats } = params;
  const l: PrintLabels = { ...DEFAULT_LABELS, ...params.labels };

  const customerStops = stops.filter(s => s.stopType === 'customer');

  const mapSection = mapImageDataUrl
    ? `<div class="map-section"><img src="${escapeHtml(mapImageDataUrl)}" alt="Route map" class="map-img" /></div>`
    : '';

  const depotRow = depot
    ? `<tr><td class="label">${escapeHtml(l.depot)}</td><td>${escapeHtml(depot.name)}</td></tr>`
    : '';
  const departureRow = `<tr><td class="label">${escapeHtml(l.departure)}</td><td>${dash(depotDeparture)}</td></tr>`;
  const returnRow = `<tr><td class="label">${escapeHtml(l.return)}</td><td>${dash(returnTime)}</td></tr>`;
  const totalRow = `<tr><td class="label">${escapeHtml(l.totalTime)}</td><td>${dash(stats.totalTime)}</td></tr>`;
  const workRow = `<tr><td class="label">${escapeHtml(l.workTime)}</td><td>${dash(stats.workTime)}</td></tr>`;
  const travelRow = `<tr><td class="label">${escapeHtml(l.travelTime)}</td><td>${dash(stats.travelTime)}</td></tr>`;
  const distRow = `<tr><td class="label">${escapeHtml(l.distance)}</td><td>${dash(stats.distance)}</td></tr>`;
  const stopsRow = `<tr><td class="label">${escapeHtml(l.stops)}</td><td>${stats.stopCount}</td></tr>`;

  const stopRows = customerStops
    .map(
      s => `<tr>
      <td>${s.order}</td>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.address)}</td>
      <td>${dash(s.eta)}</td>
      <td>${dash(s.etd)}</td>
      <td>${dash(s.serviceDuration)}</td>
    </tr>`,
    )
    .join('\n');

  const generatedAt = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: sans-serif; margin: 20px; color: #111; }
    h1 { font-size: 1.2rem; margin-bottom: 4px; }
    .meta-table { border-collapse: collapse; margin-bottom: 16px; font-size: 0.9rem; }
    .meta-table td { padding: 2px 12px 2px 0; }
    .meta-table td.label { font-weight: bold; white-space: nowrap; }
    .map-section { margin-bottom: 20px; }
    .map-img { max-width: 100%; border: 1px solid #ccc; }
    .stops-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .stops-table th { background: #f0f0f0; border-bottom: 2px solid #999; text-align: left; padding: 4px 6px; }
    .stops-table td { border-bottom: 1px solid #ddd; padding: 3px 6px; vertical-align: top; }
    footer { margin-top: 20px; font-size: 0.75rem; color: #888; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <table class="meta-table">
    <tbody>
      ${depotRow}
      ${departureRow}
      ${returnRow}
      ${totalRow}
      ${workRow}
      ${travelRow}
      ${distRow}
      ${stopsRow}
    </tbody>
  </table>
  ${mapSection}
  <table class="stops-table">
    <thead>
      <tr>
        <th>${escapeHtml(l.colOrder)}</th>
        <th>${escapeHtml(l.colName)}</th>
        <th>${escapeHtml(l.colAddress)}</th>
        <th>${escapeHtml(l.colEta)}</th>
        <th>${escapeHtml(l.colEtd)}</th>
        <th>${escapeHtml(l.colService)}</th>
      </tr>
    </thead>
    <tbody>
      ${stopRows}
    </tbody>
  </table>
  <footer>${escapeHtml(l.generated)}: ${generatedAt}</footer>
</body>
</html>`;
}
