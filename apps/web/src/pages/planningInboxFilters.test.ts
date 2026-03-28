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
  matchesSearchQuery,
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
    scheduledDate: null,
    scheduledTimeStart: null,
    scheduledTimeEnd: null,
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
    deviceTypeDefaultDurationMinutes: null,
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

    expect(summary).toContain('planner:filter_summary_new_revision');
    expect(summary).toContain('planner:filter_summary_has_term_yes');
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

  it('maps due_in_7_days to due_soon for backend v1 request', () => {
    const request = mapExpressionToCallQueueRequestV1(
      {
        ...DEFAULT_FILTER_EXPRESSION,
        groups: {
          ...DEFAULT_FILTER_EXPRESSION.groups,
          time: { enabled: true, operator: 'OR', selected: ['DUE_IN_7_DAYS'] },
        },
      },
      false,
    );

    expect(request.priorityFilter).toBe('due_soon');
    expect(request.geocodedOnly).toBe(false);
  });

  it('maps multiple selected time tokens conservatively to all', () => {
    const request = mapExpressionToCallQueueRequestV1(
      {
        ...DEFAULT_FILTER_EXPRESSION,
        groups: {
          ...DEFAULT_FILTER_EXPRESSION.groups,
          time: { enabled: true, operator: 'OR', selected: ['OVERDUE', 'DUE_IN_7_DAYS'] },
        },
      },
      true,
    );

    expect(request.priorityFilter).toBe('all');
    expect(request.geocodedOnly).toBe(true);
  });

  it('maps disabled time group to all', () => {
    const request = mapExpressionToCallQueueRequestV1(
      {
        ...DEFAULT_FILTER_EXPRESSION,
        groups: {
          ...DEFAULT_FILTER_EXPRESSION.groups,
          time: { enabled: false, operator: 'OR', selected: ['OVERDUE'] },
        },
      },
      false,
    );

    expect(request.priorityFilter).toBe('all');
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

  it('applies this_week preset', () => {
    const expression = applyFilterPreset('THIS_WEEK', DEFAULT_FILTER_EXPRESSION);
    expect(expression.groups.time.enabled).toBe(true);
    expect(expression.groups.time.selected).toEqual(['DUE_IN_7_DAYS']);
    expect(expression.groups.problems.enabled).toBe(false);
  });

  it('applies this_month preset', () => {
    const expression = applyFilterPreset('THIS_MONTH', DEFAULT_FILTER_EXPRESSION);
    expect(expression.groups.time.enabled).toBe(true);
    expect(expression.groups.time.selected).toEqual(['DUE_IN_30_DAYS']);
    expect(expression.groups.problems.enabled).toBe(false);
  });

  it('applies has_term preset', () => {
    const expression = applyFilterPreset('HAS_TERM', DEFAULT_FILTER_EXPRESSION);
    expect(expression.groups.hasTerm).toBe('YES');
    expect(expression.groups.time.enabled).toBe(false);
    expect(expression.groups.time.selected).toEqual([]);
  });

  it('applies problems preset', () => {
    const expression = applyFilterPreset('PROBLEMS', DEFAULT_FILTER_EXPRESSION);
    expect(expression.groups.problems.enabled).toBe(true);
    expect(expression.groups.problems.selected).toEqual([
      'MISSING_PHONE',
      'ADDRESS_ISSUE',
      'GEOCODE_FAILED',
    ]);
    expect(expression.groups.time.enabled).toBe(false);
  });

  it('detects advanced criteria usage', () => {
    const withRootOr: InboxFilterExpression = {
      ...DEFAULT_FILTER_EXPRESSION,
      rootOperator: 'OR',
    };

    expect(hasAdvancedCriteria(DEFAULT_FILTER_EXPRESSION)).toBe(false);
    expect(hasAdvancedCriteria(withRootOr)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Text search — matchesSearchQuery
  // ---------------------------------------------------------------------------

  it('matchesSearchQuery returns true for empty query', () => {
    const candidate = buildCandidate({ id: '1', customerId: 'c1' });
    expect(matchesSearchQuery(candidate, '')).toBe(true);
  });

  it('matchesSearchQuery matches customerName case-insensitively', () => {
    const candidate = buildCandidate({ id: '1', customerId: 'c1', customerName: 'Jan Novák' });
    expect(matchesSearchQuery(candidate, 'novák')).toBe(true);
    expect(matchesSearchQuery(candidate, 'NOVÁK')).toBe(true);
    expect(matchesSearchQuery(candidate, 'jan')).toBe(true);
  });

  it('matchesSearchQuery matches customerCity', () => {
    const candidate = buildCandidate({ id: '1', customerId: 'c1', customerCity: 'Brno' });
    expect(matchesSearchQuery(candidate, 'brn')).toBe(true);
    expect(matchesSearchQuery(candidate, 'BRN')).toBe(true);
  });

  it('matchesSearchQuery matches customerPhone', () => {
    const candidate = buildCandidate({ id: '1', customerId: 'c1', customerPhone: '+420 123 456' });
    expect(matchesSearchQuery(candidate, '123')).toBe(true);
    expect(matchesSearchQuery(candidate, '+420')).toBe(true);
  });

  it('matchesSearchQuery matches customerStreet', () => {
    const candidate = buildCandidate({ id: '1', customerId: 'c1', customerStreet: 'Hlavní 42' });
    expect(matchesSearchQuery(candidate, 'hlavní')).toBe(true);
  });

  it('matchesSearchQuery returns false when no field matches', () => {
    const candidate = buildCandidate({ id: '1', customerId: 'c1', customerName: 'Jan', customerCity: 'Prague', customerPhone: '123' });
    expect(matchesSearchQuery(candidate, 'xyz-no-match')).toBe(false);
  });

  it('matchesSearchQuery handles null phone gracefully', () => {
    const candidate = buildCandidate({ id: '1', customerId: 'c1', customerPhone: null });
    expect(matchesSearchQuery(candidate, '123')).toBe(false);
  });

  it('matchesSearchQuery trims whitespace from query', () => {
    const candidate = buildCandidate({ id: '1', customerId: 'c1', customerName: 'Test' });
    expect(matchesSearchQuery(candidate, '  test  ')).toBe(true);
    expect(matchesSearchQuery(candidate, '   ')).toBe(true);
  });

  it('normalizes invalid operators to safe defaults', () => {
    const expression = normalizeExpression({
      rootOperator: 'XOR' as unknown as InboxFilterExpression['rootOperator'],
      groups: {
        time: { enabled: true, operator: 'XOR' as unknown as 'AND' | 'OR', selected: ['OVERDUE'] },
      } as Partial<InboxFilterExpression['groups']>,
    });

    expect(expression.rootOperator).toBe('AND');
    expect(expression.groups.time.operator).toBe('OR');
  });
});
