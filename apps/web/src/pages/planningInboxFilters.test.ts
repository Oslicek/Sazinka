import { describe, expect, it } from 'vitest';
import type { CallQueueItem } from '../services/revisionService';
import {
  FILTER_PRESETS,
  applyInboxFilters,
  applyFilterPreset,
  DEFAULT_FILTER_EXPRESSION,
  buildFilterSummary,
  createEmptyExpression,
  evaluateCandidate,
  hasAdvancedCriteria,
  mapExpressionToCallQueueRequestV1,
  normalizeExpression,
  toFilterAst,
  type InboxFilterExpression,
  getActiveFilterCount,
  toggleToken,
} from './planningInboxFilters';

function buildCandidate(
  overrides: Partial<CallQueueItem> & Pick<CallQueueItem, 'id' | 'customerId'>,
): CallQueueItem {
  return {
    id: overrides.id,
    customerId: overrides.customerId,
    deviceId: 'device-1',
    userId: 'user-1',
    status: 'upcoming',
    dueDate: '2026-02-10',
    snoozeUntil: null,
    snoozeReason: null,
    customerName: 'Customer',
    customerPhone: '123456789',
    customerEmail: null,
    customerStreet: 'Main 1',
    customerCity: 'Prague',
    customerPostalCode: '11000',
    customerLat: 50.1,
    customerLng: 14.4,
    customerGeocodeStatus: 'success',
    deviceName: null,
    deviceType: 'extinguisher',
    daysUntilDue: 10,
    priority: 'due_soon',
    lastContactAt: null,
    contactAttempts: 0,
    ...overrides,
  };
}

describe('planningInboxFilters', () => {
  it('combines groups with root AND logic', () => {
    const candidates = [
      buildCandidate({ id: '1', customerId: 'c1', daysUntilDue: -1, status: 'scheduled' }),
      buildCandidate({ id: '2', customerId: 'c2', daysUntilDue: -1, status: 'upcoming' }),
      buildCandidate({ id: '3', customerId: 'c3', daysUntilDue: 5, status: 'scheduled' }),
    ];

    const expression: InboxFilterExpression = {
      ...DEFAULT_FILTER_EXPRESSION,
      rootOperator: 'AND',
      groups: {
        ...DEFAULT_FILTER_EXPRESSION.groups,
        time: { enabled: true, operator: 'OR', selected: ['OVERDUE'] },
        hasTerm: 'YES',
      },
    };

    const result = applyInboxFilters(
      candidates,
      expression,
      new Set<string>(),
    );

    expect(result.map((c) => c.id)).toEqual(['1']);
  });

  it('supports root OR logic between nodes', () => {
    const candidates = [
      buildCandidate({ id: '1', customerId: 'c1', status: 'scheduled' }),
      buildCandidate({ id: '2', customerId: 'c2', status: 'upcoming' }),
    ];

    const expression: InboxFilterExpression = {
      ...DEFAULT_FILTER_EXPRESSION,
      rootOperator: 'OR',
      groups: {
        ...DEFAULT_FILTER_EXPRESSION.groups,
        time: { enabled: true, operator: 'OR', selected: ['OVERDUE'] },
        hasTerm: 'YES',
      },
    };

    const result = applyInboxFilters(
      candidates,
      expression,
      new Set<string>(),
    );

    expect(result.map((c) => c.id)).toEqual(['1']);
  });

  it('supports group AND logic for problems', () => {
    const candidates = [
      buildCandidate({ id: '1', customerId: 'c1', customerPhone: null, customerLat: null, customerGeocodeStatus: 'failed' }),
      buildCandidate({ id: '2', customerId: 'c2', customerPhone: null }),
      buildCandidate({ id: '3', customerId: 'c3', customerLat: null, customerGeocodeStatus: 'failed' }),
    ];

    const expression: InboxFilterExpression = {
      ...DEFAULT_FILTER_EXPRESSION,
      groups: {
        ...DEFAULT_FILTER_EXPRESSION.groups,
        time: { enabled: false, operator: 'OR', selected: [] },
        problems: { enabled: true, operator: 'AND', selected: ['MISSING_PHONE', 'GEOCODE_FAILED'] },
      },
    };

    const result = applyInboxFilters(
      candidates,
      expression,
      new Set<string>(),
    );

    expect(result.map((c) => c.id)).toEqual(['1']);
  });

  it('evaluates tri-state route filter correctly', () => {
    const candidates = [
      buildCandidate({ id: '1', customerId: 'c1' }),
      buildCandidate({ id: '2', customerId: 'c2' }),
    ];

    const onlyInRoute = applyInboxFilters(
      candidates,
      {
        ...DEFAULT_FILTER_EXPRESSION,
        groups: {
          ...DEFAULT_FILTER_EXPRESSION.groups,
          time: { enabled: false, operator: 'OR', selected: [] },
          inRoute: 'YES',
        },
      },
      new Set(['c1']),
    );
    const onlyOutsideRoute = applyInboxFilters(
      candidates,
      {
        ...DEFAULT_FILTER_EXPRESSION,
        groups: {
          ...DEFAULT_FILTER_EXPRESSION.groups,
          time: { enabled: false, operator: 'OR', selected: [] },
          inRoute: 'NO',
        },
      },
      new Set(['c1']),
    );

    expect(onlyInRoute.map((c) => c.id)).toEqual(['1']);
    expect(onlyOutsideRoute.map((c) => c.id)).toEqual(['2']);
  });

  it('counts active filters', () => {
    const count = getActiveFilterCount({
      version: 1,
      rootOperator: 'AND',
      groups: {
        time: { enabled: true, operator: 'OR', selected: ['DUE_IN_7_DAYS'] },
        problems: { enabled: true, operator: 'OR', selected: ['ADDRESS_ISSUE'] },
        hasTerm: 'YES',
        inRoute: 'NO',
      },
    });

    expect(count).toBe(4);
  });

  it('toggles token value in array', () => {
    expect(toggleToken(['DUE_IN_7_DAYS'], 'DUE_IN_30_DAYS')).toEqual(['DUE_IN_7_DAYS', 'DUE_IN_30_DAYS']);
    expect(toggleToken(['DUE_IN_7_DAYS', 'DUE_IN_30_DAYS'], 'DUE_IN_7_DAYS')).toEqual(['DUE_IN_30_DAYS']);
  });

  it('normalizes partial expression safely', () => {
    const expression = normalizeExpression({
      rootOperator: 'OR',
      groups: {
        hasTerm: 'YES',
      } as Partial<InboxFilterExpression['groups']>,
    });

    expect(expression.rootOperator).toBe('OR');
    expect(expression.groups.hasTerm).toBe('YES');
    expect(expression.groups.time.selected).toEqual(['DUE_IN_7_DAYS']);
  });

  it('creates AST from enabled nodes only', () => {
    const ast = toFilterAst({
      ...DEFAULT_FILTER_EXPRESSION,
      groups: {
        ...DEFAULT_FILTER_EXPRESSION.groups,
        time: { enabled: false, operator: 'OR', selected: ['DUE_IN_7_DAYS'] },
        hasTerm: 'YES',
      },
    });

    expect(ast.nodes).toHaveLength(1);
    expect(ast.nodes[0]).toEqual({ type: 'TRISTATE', field: 'hasTerm', value: 'YES' });
  });

  it('evaluates a candidate directly against AST', () => {
    const candidate = buildCandidate({ id: '1', customerId: 'c1', daysUntilDue: -2, status: 'scheduled' });
    const ast = toFilterAst({
      ...DEFAULT_FILTER_EXPRESSION,
      groups: {
        ...DEFAULT_FILTER_EXPRESSION.groups,
        time: { enabled: true, operator: 'OR', selected: ['OVERDUE'] },
        hasTerm: 'YES',
      },
    });

    expect(evaluateCandidate(candidate, ast, new Set())).toBe(true);
  });

  it('builds human-readable summary', () => {
    const summary = buildFilterSummary({
      ...DEFAULT_FILTER_EXPRESSION,
      rootOperator: 'AND',
      groups: {
        ...DEFAULT_FILTER_EXPRESSION.groups,
        time: { enabled: true, operator: 'OR', selected: ['OVERDUE', 'DUE_IN_7_DAYS'] },
        hasTerm: 'YES',
      },
    });

    expect(summary).toContain('Nová revize:');
    expect(summary).toContain('Termín = Má');
  });

  it('maps expression to backend v1 request', () => {
    const request = mapExpressionToCallQueueRequestV1(
      {
        ...DEFAULT_FILTER_EXPRESSION,
        groups: {
          ...DEFAULT_FILTER_EXPRESSION.groups,
          time: { enabled: true, operator: 'OR', selected: ['OVERDUE'] },
        },
      },
      true,
    );

    expect(request.priorityFilter).toBe('overdue');
    expect(request.geocodedOnly).toBe(true);
  });

  it('exposes expected quick filter presets', () => {
    expect(FILTER_PRESETS.map((p) => p.id)).toEqual([
      'ALL',
      'URGENT',
      'THIS_WEEK',
      'THIS_MONTH',
      'HAS_TERM',
      'PROBLEMS',
    ]);
  });

  it('applies urgent preset as OR overdue + 7 days', () => {
    const expression = applyFilterPreset('URGENT', DEFAULT_FILTER_EXPRESSION);
    expect(expression.groups.time.selected).toEqual(['OVERDUE', 'DUE_IN_7_DAYS']);
    expect(expression.groups.time.operator).toBe('OR');
    expect(expression.rootOperator).toBe('AND');
  });

  it('applies all preset as truly empty filter expression', () => {
    const expression = applyFilterPreset('ALL', DEFAULT_FILTER_EXPRESSION);
    const empty = createEmptyExpression();
    expect(expression).toEqual(empty);
  });

  it('detects advanced criteria usage', () => {
    const withRootOr: InboxFilterExpression = {
      ...DEFAULT_FILTER_EXPRESSION,
      rootOperator: 'OR',
    };

    expect(hasAdvancedCriteria(DEFAULT_FILTER_EXPRESSION)).toBe(false);
    expect(hasAdvancedCriteria(withRootOr)).toBe(true);
  });
});
