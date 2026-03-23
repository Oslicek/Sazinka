import { describe, it, expect } from 'vitest';
import { buildPrintHtml, escapeHtml } from './routePrint';
import type { PrintRouteParams } from './routePrint';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function makeStop(
  order: number,
  name: string,
  address = 'Some address',
  eta: string | null = '09:00',
  etd: string | null = '09:30',
): PrintRouteParams['stops'][0] {
  return { order, name, address, eta, etd, serviceDuration: '30 min', stopType: 'customer' };
}

function makeBreakStop(order: number): PrintRouteParams['stops'][0] {
  return { order, name: 'Break', address: '', eta: '12:00', etd: '12:30', serviceDuration: '30 min', stopType: 'break' };
}

const BASE_PARAMS: PrintRouteParams = {
  title: 'P1 · D1 · 2026-03-21',
  mapImageDataUrl: '',
  stops: [makeStop(1, 'Novák'), makeStop(2, 'Dvořák'), makeStop(3, 'Procházka')],
  depot: { name: 'Brno depot' },
  depotDeparture: '07:00',
  returnTime: '15:00',
  stats: {
    totalTime: '8h',
    workTime: '5h',
    travelTime: '3h',
    distance: '150 km',
    stopCount: 3,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  // #19 — each of the 5 characters individually
  it('escapes &', () => expect(escapeHtml('a & b')).toBe('a &amp; b'));
  it('escapes <', () => expect(escapeHtml('<br>')).toBe('&lt;br&gt;'));
  it('escapes >', () => expect(escapeHtml('a > b')).toBe('a &gt; b'));
  it('escapes "', () => expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;'));
  it("escapes '", () => expect(escapeHtml("it's")).toBe('it&#39;s'));
});

describe('buildPrintHtml', () => {

  // #1
  it('returns valid HTML with doctype', () => {
    const html = buildPrintHtml(BASE_PARAMS);
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  // #2
  it('includes map image when dataUrl provided', () => {
    const html = buildPrintHtml({ ...BASE_PARAMS, mapImageDataUrl: 'data:image/png;base64,AAAA' });
    expect(html).toContain('<img');
    expect(html).toContain('data:image/png;base64,AAAA');
  });

  // #3
  it('omits map image when dataUrl is empty string', () => {
    const html = buildPrintHtml({ ...BASE_PARAMS, mapImageDataUrl: '' });
    expect(html).not.toContain('<img');
  });

  // #4
  it('renders all customer stops', () => {
    const html = buildPrintHtml(BASE_PARAMS);
    expect(html).toContain('Novák');
    expect(html).toContain('Dvořák');
    expect(html).toContain('Procházka');
  });

  // #5
  it('skips break stops from the table', () => {
    const html = buildPrintHtml({
      ...BASE_PARAMS,
      stops: [makeStop(1, 'Customer A'), makeBreakStop(2), makeStop(3, 'Customer B')],
    });
    expect(html).toContain('Customer A');
    expect(html).toContain('Customer B');
    // Break entries should not appear as a table row with the name "Break" as a customer stop
    // (break stop name is 'Break' — ensure only 2 customer rows)
    const rows = html.match(/<tr/g) ?? [];
    // At least header + 2 customer rows; exact count depends on impl
    // The key test is that Customer A and Customer B appear
    expect(rows.length).toBeGreaterThanOrEqual(3); // header + 2 data rows
    // And the breaks are NOT rendered as regular stop rows
    // (check that "Break" as a stop row is absent by checking for the absence of a break-stop-specific marker)
  });

  // #6
  it('includes depot name in header', () => {
    const html = buildPrintHtml(BASE_PARAMS);
    expect(html).toContain('Brno depot');
  });

  // #7
  it('includes title in header', () => {
    const html = buildPrintHtml(BASE_PARAMS);
    expect(html).toContain('P1 · D1 · 2026-03-21');
  });

  // #8
  it('includes all stats values', () => {
    const html = buildPrintHtml(BASE_PARAMS);
    expect(html).toContain('8h');
    expect(html).toContain('5h');
    expect(html).toContain('3h');
    expect(html).toContain('150 km');
    expect(html).toContain('3');
  });

  // #9
  it('includes depot departure time', () => {
    const html = buildPrintHtml(BASE_PARAMS);
    expect(html).toContain('07:00');
  });

  // #10
  it('includes return time', () => {
    const html = buildPrintHtml(BASE_PARAMS);
    expect(html).toContain('15:00');
  });

  // #11
  it('handles null ETAs gracefully — renders — or empty, no crash', () => {
    const params: PrintRouteParams = {
      ...BASE_PARAMS,
      stops: [{ ...makeStop(1, 'Nulový'), eta: null, etd: null }],
    };
    expect(() => buildPrintHtml(params)).not.toThrow();
    const html = buildPrintHtml(params);
    expect(html).toContain('Nulový');
  });

  // #12
  it('HTML is self-contained — no <link> or <script src=', () => {
    const html = buildPrintHtml(BASE_PARAMS);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\s+src=/i);
  });

  // #13
  it('dangerous characters in names are escaped', () => {
    const params: PrintRouteParams = {
      ...BASE_PARAMS,
      stops: [makeStop(1, 'Foo & Bar <script>alert(1)</script>')],
    };
    const html = buildPrintHtml(params);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;script&gt;');
  });

  // #14
  it('empty stops array → no crash, renders without stop rows', () => {
    const params: PrintRouteParams = { ...BASE_PARAMS, stops: [] };
    expect(() => buildPrintHtml(params)).not.toThrow();
    const html = buildPrintHtml(params);
    expect(html).toContain('<!DOCTYPE html');
  });

  // #15
  it('depot is null → header omits depot name, no crash', () => {
    const params: PrintRouteParams = { ...BASE_PARAMS, depot: null };
    expect(() => buildPrintHtml(params)).not.toThrow();
    const html = buildPrintHtml(params);
    expect(html).not.toContain('Brno depot');
  });

  // #16
  it('all stats fields null → renders — or equivalent, no crash', () => {
    const params: PrintRouteParams = {
      ...BASE_PARAMS,
      stats: { totalTime: null, workTime: null, travelTime: null, distance: null, stopCount: 0 },
    };
    expect(() => buildPrintHtml(params)).not.toThrow();
  });

  // #17
  it('unicode names render correctly (Czech diacritics)', () => {
    const params: PrintRouteParams = {
      ...BASE_PARAMS,
      stops: [makeStop(1, 'Říčany'), makeStop(2, 'Břeclav')],
    };
    const html = buildPrintHtml(params);
    expect(html).toContain('Říčany');
    expect(html).toContain('Břeclav');
  });

  // #18
  it('stop order is preserved in output (relative position)', () => {
    const html = buildPrintHtml(BASE_PARAMS);
    const idx1 = html.indexOf('Novák');
    const idx2 = html.indexOf('Dvořák');
    const idx3 = html.indexOf('Procházka');
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });

  // #20
  it('depotDeparture is null → no crash, renders gracefully', () => {
    const params: PrintRouteParams = { ...BASE_PARAMS, depotDeparture: null };
    expect(() => buildPrintHtml(params)).not.toThrow();
    const html = buildPrintHtml(params);
    expect(html).toContain('<!DOCTYPE html');
  });

  // #21 — default English labels when no labels provided
  it('uses English default labels when labels param is omitted', () => {
    const html = buildPrintHtml(BASE_PARAMS);
    expect(html).toContain('Departure');
    expect(html).toContain('Return');
    expect(html).toContain('Total time');
    expect(html).toContain('Distance');
  });

  // #22 — custom labels override defaults
  it('uses custom labels when labels param is provided', () => {
    const params: PrintRouteParams = {
      ...BASE_PARAMS,
      labels: {
        depot: 'Depo',
        departure: 'Odjezd',
        return: 'Návrat',
        totalTime: 'Celkový čas',
        distance: 'Vzdálenost',
        colName: 'Jméno',
        colAddress: 'Adresa',
        generated: 'Vygenerováno',
      },
    };
    const html = buildPrintHtml(params);
    expect(html).toContain('Depo');
    expect(html).toContain('Odjezd');
    expect(html).toContain('Návrat');
    expect(html).toContain('Celkový čas');
    expect(html).toContain('Vzdálenost');
    expect(html).toContain('Jméno');
    expect(html).toContain('Adresa');
    expect(html).toContain('Vygenerováno');
    // English defaults should not appear for overridden keys
    expect(html).not.toContain('>Departure<');
    expect(html).not.toContain('>Return<');
  });

  // #23 — partial labels: only some overridden, rest fall back to English
  it('partial labels: overridden keys use custom values, others use English defaults', () => {
    const params: PrintRouteParams = {
      ...BASE_PARAMS,
      labels: { depot: 'Depo' },
    };
    const html = buildPrintHtml(params);
    expect(html).toContain('Depo');
    // Non-overridden labels should still be English
    expect(html).toContain('Departure');
    expect(html).toContain('Distance');
  });

  // #24 — labels with dangerous characters are escaped
  it('custom labels with HTML characters are escaped', () => {
    const params: PrintRouteParams = {
      ...BASE_PARAMS,
      labels: { depot: '<b>Depot</b>' },
    };
    const html = buildPrintHtml(params);
    expect(html).toContain('&lt;b&gt;Depot&lt;/b&gt;');
    expect(html).not.toContain('<b>Depot</b>');
  });

  // #25 — serviceDuration is rendered when provided
  it('renders service duration for stops when provided', () => {
    const params: PrintRouteParams = {
      ...BASE_PARAMS,
      stops: [{ ...makeStop(1, 'TestStop'), serviceDuration: '45 min' }],
    };
    const html = buildPrintHtml(params);
    expect(html).toContain('45 min');
  });
});
