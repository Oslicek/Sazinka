import { describe, it, expect } from 'vitest';
import {
  createMockCallQueueItem,
  createMockRouteContext,
  createMockSavedRouteStop,
  createMockSlotSuggestion,
  createMinimalUserSettings,
  createMockSettingsDepot,
} from './inbox';

describe('inbox test factories', () => {
  it('createMockCallQueueItem returns required CallQueueItem fields', () => {
    const c = createMockCallQueueItem({ customerName: 'X' });
    expect(c.customerId).toBeTruthy();
    expect(c.customerName).toBe('X');
    expect(c.daysUntilDue).toBeDefined();
    expect(c.priority).toMatch(/overdue|due_this_week|due_soon|upcoming/);
  });

  it('createMinimalUserSettings includes at least one depot', () => {
    const s = createMinimalUserSettings();
    expect(s.depots.length).toBeGreaterThan(0);
    expect(s.workConstraints.defaultServiceDurationMinutes).toBeGreaterThan(0);
  });

  it('createMockSettingsDepot has lat/lng', () => {
    const d = createMockSettingsDepot({ name: 'D1' });
    expect(d.name).toBe('D1');
    expect(typeof d.lat).toBe('number');
    expect(typeof d.lng).toBe('number');
  });

  it('createMockRouteContext has all RouteContext fields', () => {
    const ctx = createMockRouteContext({ depotId: 'Main', depotName: 'Main' });
    expect(ctx.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ctx.depotId).toBe('Main');
  });

  it('createMockSavedRouteStop defaults to customer stop', () => {
    const s = createMockSavedRouteStop();
    expect(s.stopType).toBe('customer');
    expect(s.customerId).toBeTruthy();
  });

  it('createMockSlotSuggestion has insertAfterIndex', () => {
    const slot = createMockSlotSuggestion({ insertAfterIndex: 2 });
    expect(slot.insertAfterIndex).toBe(2);
  });
});
