/**
 * Phase 2 TDD tests: Batch Optimize
 *
 * Pure logic tests for the batch optimize feature:
 * - customerIds build logic (unique union, dedup, filter breaks)
 * - time window extraction from route stops + candidates
 * - handling unassigned: keep in selectedIds, clear assigned
 */
import { describe, it, expect } from 'vitest';

describe('Batch customerIds merge logic', () => {
  it('builds unique union of existing route IDs and selected IDs', () => {
    const existingIds = ['cust-1', 'cust-2'];
    const selectedIds = new Set(['cust-2', 'cust-3']); // cust-2 is duplicate
    const merged = [...new Set([...existingIds, ...Array.from(selectedIds)])];
    expect(merged).toHaveLength(3);
    expect(merged).toContain('cust-1');
    expect(merged).toContain('cust-2');
    expect(merged).toContain('cust-3');
  });

  it('filters out break stops and null customerIds', () => {
    const stops = [
      { stopType: 'customer', customerId: 'cust-1' },
      { stopType: 'break', customerId: null },
      { stopType: 'customer', customerId: null },
      { stopType: 'customer', customerId: 'cust-2' },
    ];
    const customerIds = stops
      .filter(s => s.stopType === 'customer' && s.customerId)
      .map(s => s.customerId as string);
    expect(customerIds).toEqual(['cust-1', 'cust-2']);
  });

  it('de-duplicates when same ID is in both existing route and selection', () => {
    const existingIds = ['a', 'b', 'c'];
    const selectedIds = new Set(['b', 'c', 'd', 'e']);
    const merged = [...new Set([...existingIds, ...Array.from(selectedIds)])];
    expect(merged).toHaveLength(5);
    expect(new Set(merged).size).toBe(merged.length);
  });

  it('returns empty when both existing and selected are empty', () => {
    const existingIds: string[] = [];
    const selectedIds = new Set<string>();
    const merged = [...new Set([...existingIds, ...Array.from(selectedIds)])];
    expect(merged).toHaveLength(0);
  });

  it('handles existing route with no customerIds when all are breaks', () => {
    const stops = [
      { stopType: 'break', customerId: null },
      { stopType: 'break', customerId: null },
    ];
    const existingIds = stops
      .filter(s => s.stopType === 'customer' && s.customerId)
      .map(s => s.customerId as string);
    const selectedIds = ['new-1', 'new-2'];
    const merged = [...new Set([...existingIds, ...selectedIds])];
    expect(merged).toEqual(['new-1', 'new-2']);
  });
});

describe('Time window extraction', () => {
  it('builds time windows from stops with agreed times', () => {
    const stops = [
      { customerId: 'c1', scheduledTimeStart: '10:00', scheduledTimeEnd: '10:30' },
      { customerId: 'c2', scheduledTimeStart: null, scheduledTimeEnd: null },
      { customerId: 'c3', scheduledTimeStart: '14:00', scheduledTimeEnd: '14:45' },
    ];
    const timeWindows = stops
      .filter(s => s.scheduledTimeStart && s.scheduledTimeEnd)
      .map(s => ({ customerId: s.customerId, start: s.scheduledTimeStart!, end: s.scheduledTimeEnd! }));
    expect(timeWindows).toHaveLength(2);
    expect(timeWindows[0]).toEqual({ customerId: 'c1', start: '10:00', end: '10:30' });
    expect(timeWindows[1]).toEqual({ customerId: 'c3', start: '14:00', end: '14:45' });
  });

  it('returns empty when no stops have agreed times', () => {
    const stops = [
      { customerId: 'c1', scheduledTimeStart: null, scheduledTimeEnd: null },
      { customerId: 'c2', scheduledTimeStart: null, scheduledTimeEnd: null },
    ];
    const timeWindows = stops.filter(s => s.scheduledTimeStart && s.scheduledTimeEnd);
    expect(timeWindows).toHaveLength(0);
  });

  it('does not create duplicate time windows when stop and candidate overlap', () => {
    const timeWindowMap = new Map<string, { start: string; end: string }>();
    // From existing stop
    timeWindowMap.set('c1', { start: '10:00', end: '10:30' });
    // Candidate for same customer — should be skipped
    const candidates = [{ customerId: 'c1', scheduledTimeStart: '11:00', scheduledTimeEnd: '11:30' }];
    for (const cand of candidates) {
      if (timeWindowMap.has(cand.customerId)) continue; // already covered by stop
      timeWindowMap.set(cand.customerId, { start: cand.scheduledTimeStart, end: cand.scheduledTimeEnd });
    }
    expect(timeWindowMap.size).toBe(1);
    expect(timeWindowMap.get('c1')?.start).toBe('10:00'); // original kept
  });
});

describe('Unassigned ID handling', () => {
  it('removes assigned IDs from selectedIds on optimizer success', () => {
    const selectedIds = new Set(['a', 'b', 'c']);
    const unassignedIds = new Set(['b']);
    const next = new Set(selectedIds);
    for (const id of selectedIds) {
      if (!unassignedIds.has(id)) next.delete(id);
    }
    expect(next).toEqual(new Set(['b']));
  });

  it('keeps all IDs when all are unassigned', () => {
    const selectedIds = new Set(['a', 'b']);
    const unassignedIds = new Set(['a', 'b']);
    const next = new Set(selectedIds);
    for (const id of selectedIds) {
      if (!unassignedIds.has(id)) next.delete(id);
    }
    expect(next).toEqual(new Set(['a', 'b']));
  });

  it('clears all IDs when none are unassigned', () => {
    const selectedIds = new Set(['a', 'b', 'c']);
    const unassignedIds = new Set<string>();
    const next = new Set(selectedIds);
    for (const id of selectedIds) {
      if (!unassignedIds.has(id)) next.delete(id);
    }
    expect(next.size).toBe(0);
  });

  it('handles empty selectedIds gracefully', () => {
    const selectedIds = new Set<string>();
    const unassignedIds = new Set(['x']);
    const next = new Set(selectedIds);
    for (const id of selectedIds) {
      if (!unassignedIds.has(id)) next.delete(id);
    }
    expect(next.size).toBe(0);
  });
});
