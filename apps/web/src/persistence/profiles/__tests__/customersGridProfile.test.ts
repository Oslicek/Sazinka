/**
 * Phase 1B (RED → GREEN) — customers.grid UPP profile tests.
 *
 * Tests profile structure, hydration via orchestrator + localStorage,
 * multi-cycle write/read, profile isolation, and cross-profile isolation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PersistenceOrchestrator } from '../../core/PersistenceOrchestrator';
import { LocalStorageAdapter } from '../../adapters/LocalStorageAdapter';
import { SessionStorageAdapter } from '../../adapters/SessionStorageAdapter';
import { makeEnvelope, makeKey } from '../../core/types';
import {
  customersGridProfile,
  CUSTOMERS_GRID_PROFILE_ID,
} from '../customersGridProfile';
import {
  ALL_COLUMNS,
  DEFAULT_SORT_MODEL,
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
} from '@/lib/customerColumns';
import { customersProfile } from '../customersProfile';

const USER_ID = 'test-user-1';
const CTX = { userId: USER_ID };

function makeOrchestrator() {
  return new PersistenceOrchestrator({
    adapters: {
      local: new LocalStorageAdapter(),
      session: new SessionStorageAdapter(),
    },
  });
}

function keyFor(controlId: string) {
  return makeKey({ userId: USER_ID, profileId: CUSTOMERS_GRID_PROFILE_ID, controlId });
}

function seedLocal(controlId: string, value: unknown) {
  localStorage.setItem(keyFor(controlId), JSON.stringify(makeEnvelope(value, 'local')));
}

function seedLocalRaw(controlId: string, raw: string) {
  localStorage.setItem(keyFor(controlId), raw);
}

// ── Profile structure ─────────────────────────────────────────────────────────

describe('Phase 1B: customersGridProfile — structure', () => {
  it('1. profileId equals customers.grid', () => {
    expect(customersGridProfile.profileId).toBe('customers.grid');
    expect(CUSTOMERS_GRID_PROFILE_ID).toBe('customers.grid');
  });

  it('2. readPriority is [local]', () => {
    expect(customersGridProfile.readPriority).toEqual(['local']);
  });

  it('3. writeTargets is [local]', () => {
    expect(customersGridProfile.writeTargets).toEqual(['local']);
  });

  it('4. contains exactly 3 controls: sortModel, visibleColumns, columnOrder', () => {
    const ids = customersGridProfile.controls.map((c) => c.controlId);
    expect(ids).toHaveLength(3);
    expect(ids).toContain('sortModel');
    expect(ids).toContain('visibleColumns');
    expect(ids).toContain('columnOrder');
  });

  it('5. sortModel default equals DEFAULT_SORT_MODEL', () => {
    const ctrl = customersGridProfile.controls.find((c) => c.controlId === 'sortModel');
    expect(ctrl?.defaultValue).toEqual(DEFAULT_SORT_MODEL);
  });

  it('6. visibleColumns default equals DEFAULT_VISIBLE_COLUMNS', () => {
    const ctrl = customersGridProfile.controls.find((c) => c.controlId === 'visibleColumns');
    expect(ctrl?.defaultValue).toEqual(DEFAULT_VISIBLE_COLUMNS);
  });

  it('7. columnOrder default equals DEFAULT_COLUMN_ORDER', () => {
    const ctrl = customersGridProfile.controls.find((c) => c.controlId === 'columnOrder');
    expect(ctrl?.defaultValue).toEqual(DEFAULT_COLUMN_ORDER);
  });
});

// ── Hydration ─────────────────────────────────────────────────────────────────

describe('Phase 1B: customersGridProfile — hydration', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('8. mount with empty storage → all 3 controls have default values', () => {
    const orc = makeOrchestrator();
    const state = orc.hydrateProfile(customersGridProfile, CTX);
    expect(state.sortModel).toEqual(DEFAULT_SORT_MODEL);
    expect(state.visibleColumns).toEqual(DEFAULT_VISIBLE_COLUMNS);
    expect(state.columnOrder).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it('9. seed sortModel in localStorage → hydrates correctly', () => {
    const model = [{ column: 'city', direction: 'desc' }];
    seedLocal('sortModel', model);
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.sortModel).toEqual(model);
  });

  it('10. seed visibleColumns in localStorage → hydrates correctly', () => {
    const cols = ['name', 'city'];
    seedLocal('visibleColumns', cols);
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.visibleColumns).toEqual(cols);
  });

  it('11. seed columnOrder in localStorage → hydrates correctly', () => {
    const order = [...DEFAULT_COLUMN_ORDER].reverse();
    seedLocal('columnOrder', order);
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.columnOrder).toEqual(order);
  });

  it('12. seed all 3 → all hydrate independently, no cross-contamination', () => {
    const model = [{ column: 'name', direction: 'asc' }];
    const cols = ['name', 'deviceCount'];
    const order = ['deviceCount', 'name', ...DEFAULT_COLUMN_ORDER.filter((id) => id !== 'name' && id !== 'deviceCount')];
    seedLocal('sortModel', model);
    seedLocal('visibleColumns', cols);
    seedLocal('columnOrder', order);
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.sortModel).toEqual(model);
    expect(state.visibleColumns).toEqual(cols);
    expect(state.columnOrder).toEqual(order);
  });
});

// ── Corrupted storage — unparseable JSON (adapter returns null) ───────────────

describe('Phase 1B: customersGridProfile — unparseable JSON corruption', () => {
  beforeEach(() => { localStorage.clear(); });

  it('13. unparseable JSON in sortModel → adapter yields null → falls back to DEFAULT_SORT_MODEL', () => {
    seedLocalRaw('sortModel', '{broken json]');
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.sortModel).toEqual(DEFAULT_SORT_MODEL);
  });

  it('14. unparseable JSON in visibleColumns → falls back to DEFAULT_VISIBLE_COLUMNS', () => {
    seedLocalRaw('visibleColumns', '[bad');
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.visibleColumns).toEqual(DEFAULT_VISIBLE_COLUMNS);
  });

  it('15. unparseable JSON in columnOrder → falls back to DEFAULT_COLUMN_ORDER', () => {
    seedLocalRaw('columnOrder', 'not_json');
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.columnOrder).toEqual(DEFAULT_COLUMN_ORDER);
  });
});

// ── Corrupted storage — parseable but wrong-shaped values ────────────────────

describe('Phase 1B: customersGridProfile — wrong-shaped value corruption', () => {
  beforeEach(() => { localStorage.clear(); });

  it('16. null stored for sortModel → sanitizer returns DEFAULT_SORT_MODEL', () => {
    seedLocal('sortModel', null);
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.sortModel).toEqual(DEFAULT_SORT_MODEL);
  });

  it('17. null stored for visibleColumns → sanitizer returns DEFAULT_VISIBLE_COLUMNS', () => {
    seedLocal('visibleColumns', null);
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.visibleColumns).toEqual(DEFAULT_VISIBLE_COLUMNS);
  });

  it('18. null stored for columnOrder → sanitizer returns DEFAULT_COLUMN_ORDER', () => {
    seedLocal('columnOrder', null);
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.columnOrder).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it('19. empty array [] stored for sortModel → sanitizer returns DEFAULT_SORT_MODEL', () => {
    seedLocal('sortModel', []);
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.sortModel).toEqual(DEFAULT_SORT_MODEL);
  });

  it('20. empty array [] stored for visibleColumns → sanitizer returns DEFAULT_VISIBLE_COLUMNS', () => {
    seedLocal('visibleColumns', []);
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.visibleColumns).toEqual(DEFAULT_VISIBLE_COLUMNS);
  });

  it('21. empty array [] stored for columnOrder → sanitizer returns DEFAULT_COLUMN_ORDER', () => {
    seedLocal('columnOrder', []);
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.columnOrder).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it('22. sortModel with nonexistent column → sanitizer strips invalid, returns DEFAULT_SORT_MODEL', () => {
    seedLocal('sortModel', [{ column: 'nonexistent', direction: 'asc' }]);
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.sortModel).toEqual(DEFAULT_SORT_MODEL);
  });

  it('23. visibleColumns with nonexistent ID → sanitizer strips, returns DEFAULT_VISIBLE_COLUMNS', () => {
    seedLocal('visibleColumns', ['nonexistent']);
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state.visibleColumns).toEqual(DEFAULT_VISIBLE_COLUMNS);
  });

  it('24. columnOrder with nonexistent IDs → sanitizer appends missing known IDs', () => {
    seedLocal('columnOrder', ['nonexistent']);
    const state = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    // Should contain all known column IDs
    ALL_COLUMNS.forEach((col: { id: string }) => {
      expect(state.columnOrder).toContain(col.id);
    });
  });
});

// ── Multi-cycle write / read ──────────────────────────────────────────────────

describe('Phase 1B: customersGridProfile — multi-cycle persistence', () => {
  beforeEach(() => { localStorage.clear(); });

  it('25. commit sortModel → new orchestrator → same sortModel restored', () => {
    const orc1 = makeOrchestrator();
    const model = [{ column: 'city', direction: 'desc' as const }];
    orc1.commit(customersGridProfile, 'sortModel', model, CTX);

    const state2 = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state2.sortModel).toEqual(model);
  });

  it('26. commit visibleColumns → new orchestrator → same visibleColumns restored', () => {
    const orc1 = makeOrchestrator();
    const cols = ['name', 'email'];
    orc1.commit(customersGridProfile, 'visibleColumns', cols, CTX);

    const state2 = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state2.visibleColumns).toEqual(cols);
  });

  it('27. commit columnOrder → new orchestrator → same columnOrder restored', () => {
    const orc1 = makeOrchestrator();
    const order = [...DEFAULT_COLUMN_ORDER].reverse();
    orc1.commit(customersGridProfile, 'columnOrder', order, CTX);

    const state2 = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state2.columnOrder).toEqual(order);
  });

  it('28. two commit/new-orchestrator cycles for all 3 controls → still correct', () => {
    const orc1 = makeOrchestrator();
    const model = [{ column: 'city', direction: 'asc' as const }];
    const cols = ['name', 'deviceCount'];
    const order = [...DEFAULT_COLUMN_ORDER].reverse();

    orc1.commit(customersGridProfile, 'sortModel', model, CTX);
    orc1.commit(customersGridProfile, 'visibleColumns', cols, CTX);
    orc1.commit(customersGridProfile, 'columnOrder', order, CTX);

    // First re-mount
    const state2 = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state2.sortModel).toEqual(model);
    expect(state2.visibleColumns).toEqual(cols);
    expect(state2.columnOrder).toEqual(order);

    // Second re-mount
    const state3 = makeOrchestrator().hydrateProfile(customersGridProfile, CTX);
    expect(state3.sortModel).toEqual(model);
    expect(state3.visibleColumns).toEqual(cols);
    expect(state3.columnOrder).toEqual(order);
  });
});

// ── Profile isolation ─────────────────────────────────────────────────────────

describe('Phase 1B: customersGridProfile — profile isolation', () => {
  beforeEach(() => { localStorage.clear(); });

  it('29. commit sortModel → visibleColumns unchanged', () => {
    const orc = makeOrchestrator();
    orc.commit(customersGridProfile, 'sortModel', [{ column: 'city', direction: 'asc' }], CTX);
    const state = orc.hydrateProfile(customersGridProfile, CTX);
    expect(state.visibleColumns).toEqual(DEFAULT_VISIBLE_COLUMNS);
  });

  it('30. commit visibleColumns → sortModel unchanged', () => {
    const orc = makeOrchestrator();
    orc.commit(customersGridProfile, 'visibleColumns', ['name', 'city'], CTX);
    const state = orc.hydrateProfile(customersGridProfile, CTX);
    expect(state.sortModel).toEqual(DEFAULT_SORT_MODEL);
  });

  it('31. commit columnOrder → sortModel and visibleColumns unchanged', () => {
    const orc = makeOrchestrator();
    orc.commit(customersGridProfile, 'columnOrder', [...DEFAULT_COLUMN_ORDER].reverse(), CTX);
    const state = orc.hydrateProfile(customersGridProfile, CTX);
    expect(state.sortModel).toEqual(DEFAULT_SORT_MODEL);
    expect(state.visibleColumns).toEqual(DEFAULT_VISIBLE_COLUMNS);
  });
});

// ── Cross-profile isolation ───────────────────────────────────────────────────

describe('Phase 1B: customersGridProfile — cross-profile isolation', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('32. customers.grid controls independent from customers.filters controls', () => {
    const orc = makeOrchestrator();

    // Write to customers.filters
    orc.commit(customersProfile, 'search', 'some search', CTX);

    // customers.grid should still have its defaults
    const gridState = orc.hydrateProfile(customersGridProfile, CTX);
    expect(gridState.sortModel).toEqual(DEFAULT_SORT_MODEL);
    expect(gridState.visibleColumns).toEqual(DEFAULT_VISIBLE_COLUMNS);

    // Write to customers.grid
    orc.commit(customersGridProfile, 'sortModel', [{ column: 'city', direction: 'desc' }], CTX);

    // customers.filters should still have its value
    const filterState = orc.hydrateProfile(customersProfile, CTX);
    expect(filterState.search).toBe('some search');
  });
});
