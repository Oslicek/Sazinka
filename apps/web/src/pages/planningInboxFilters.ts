import type { CallQueueItem, CallQueueRequest } from '../services/revisionService';

export type GroupOperator = 'AND' | 'OR';
export type RootOperator = 'AND' | 'OR';
export type TriState = 'ANY' | 'YES' | 'NO';

export type TimeToken = 'OVERDUE' | 'DUE_IN_7_DAYS' | 'DUE_IN_30_DAYS';
export type ProblemToken = 'MISSING_PHONE' | 'ADDRESS_ISSUE' | 'GEOCODE_FAILED';

export interface TokenGroup<T extends string> {
  enabled: boolean;
  operator: GroupOperator;
  selected: T[];
}

export interface InboxFilterGroups {
  time: TokenGroup<TimeToken>;
  problems: TokenGroup<ProblemToken>;
  hasTerm: TriState;
  inRoute: TriState;
}

export interface InboxFilterExpression {
  version: 1;
  rootOperator: RootOperator;
  groups: InboxFilterGroups;
}

export type FilterPresetId = 'ALL' | 'URGENT' | 'THIS_WEEK' | 'HAS_TERM' | 'PROBLEMS';

export interface FilterPreset {
  id: FilterPresetId;
  label: string;
}

export type FilterNode =
  | {
      type: 'GROUP';
      op: GroupOperator;
      field: 'time' | 'problems';
      values: Array<TimeToken | ProblemToken>;
    }
  | {
      type: 'TRISTATE';
      field: 'hasTerm' | 'inRoute';
      value: TriState;
    };

export interface FilterAst {
  rootOp: RootOperator;
  nodes: FilterNode[];
}

export const DEFAULT_FILTER_EXPRESSION: InboxFilterExpression = {
  version: 1,
  rootOperator: 'AND',
  groups: {
    time: { enabled: true, operator: 'OR', selected: ['DUE_IN_7_DAYS'] },
    problems: { enabled: false, operator: 'OR', selected: [] },
    hasTerm: 'ANY',
    inRoute: 'ANY',
  },
};

export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'ALL', label: 'Vše' },
  { id: 'URGENT', label: 'Akutní' },
  { id: 'THIS_WEEK', label: 'Do 7 dnů' },
  { id: 'HAS_TERM', label: 'Má termín' },
  { id: 'PROBLEMS', label: 'Problémové' },
];

export function isScheduledCandidate(item: CallQueueItem): boolean {
  return item.status === 'scheduled' || item.status === 'confirmed';
}

export function hasPhone(item: CallQueueItem): boolean {
  return item.customerPhone !== null && item.customerPhone.trim() !== '';
}

export function hasValidAddress(item: CallQueueItem): boolean {
  return (
    item.customerGeocodeStatus === 'success' &&
    item.customerLat !== null &&
    item.customerLng !== null
  );
}

function isTriState(value: unknown): value is TriState {
  return value === 'ANY' || value === 'YES' || value === 'NO';
}

function isGroupOperator(value: unknown): value is GroupOperator {
  return value === 'AND' || value === 'OR';
}

export function normalizeExpression(input?: Partial<InboxFilterExpression>): InboxFilterExpression {
  const base = DEFAULT_FILTER_EXPRESSION;
  if (!input) return base;

  return {
    version: 1,
    rootOperator: input.rootOperator === 'OR' ? 'OR' : 'AND',
    groups: {
      time: {
        enabled: input.groups?.time?.enabled ?? base.groups.time.enabled,
        operator: isGroupOperator(input.groups?.time?.operator)
          ? input.groups.time.operator
          : base.groups.time.operator,
        selected: (
          input.groups?.time?.selected ?? base.groups.time.selected
        ).filter(Boolean) as TimeToken[],
      },
      problems: {
        enabled: input.groups?.problems?.enabled ?? base.groups.problems.enabled,
        operator: isGroupOperator(input.groups?.problems?.operator)
          ? input.groups.problems.operator
          : base.groups.problems.operator,
        selected: (
          input.groups?.problems?.selected ?? base.groups.problems.selected
        ).filter(Boolean) as ProblemToken[],
      },
      hasTerm: isTriState(input.groups?.hasTerm) ? input.groups.hasTerm : base.groups.hasTerm,
      inRoute: isTriState(input.groups?.inRoute) ? input.groups.inRoute : base.groups.inRoute,
    },
  };
}

export function createEmptyExpression(): InboxFilterExpression {
  return {
    version: 1,
    rootOperator: 'AND',
    groups: {
      time: { enabled: false, operator: 'OR', selected: [] },
      problems: { enabled: false, operator: 'OR', selected: [] },
      hasTerm: 'ANY',
      inRoute: 'ANY',
    },
  };
}

export function applyFilterPreset(
  presetId: FilterPresetId,
  current?: InboxFilterExpression,
): InboxFilterExpression {
  const base = normalizeExpression(current);

  switch (presetId) {
    case 'ALL':
      return createEmptyExpression();
    case 'URGENT':
      return {
        ...base,
        rootOperator: 'AND',
        groups: {
          ...base.groups,
          time: { enabled: true, operator: 'OR', selected: ['OVERDUE', 'DUE_IN_7_DAYS'] },
          problems: { enabled: false, operator: 'OR', selected: [] },
          hasTerm: 'ANY',
          inRoute: 'ANY',
        },
      };
    case 'THIS_WEEK':
      return {
        ...base,
        rootOperator: 'AND',
        groups: {
          ...base.groups,
          time: { enabled: true, operator: 'OR', selected: ['DUE_IN_7_DAYS'] },
          problems: { enabled: false, operator: 'OR', selected: [] },
          hasTerm: 'ANY',
          inRoute: 'ANY',
        },
      };
    case 'HAS_TERM':
      return {
        ...base,
        rootOperator: 'AND',
        groups: {
          ...base.groups,
          hasTerm: 'YES',
          time: { ...base.groups.time, enabled: false, selected: [] },
          problems: { enabled: false, operator: 'OR', selected: [] },
        },
      };
    case 'PROBLEMS':
      return {
        ...base,
        rootOperator: 'AND',
        groups: {
          ...base.groups,
          time: { ...base.groups.time, enabled: false, selected: [] },
          hasTerm: 'ANY',
          inRoute: 'ANY',
          problems: {
            enabled: true,
            operator: 'OR',
            selected: ['MISSING_PHONE', 'ADDRESS_ISSUE', 'GEOCODE_FAILED'],
          },
        },
      };
  }
}

export function toFilterAst(expr: InboxFilterExpression): FilterAst {
  const nodes: FilterNode[] = [];

  if (expr.groups.time.enabled && expr.groups.time.selected.length > 0) {
    nodes.push({
      type: 'GROUP',
      op: expr.groups.time.operator,
      field: 'time',
      values: expr.groups.time.selected,
    });
  }

  if (expr.groups.problems.enabled && expr.groups.problems.selected.length > 0) {
    nodes.push({
      type: 'GROUP',
      op: expr.groups.problems.operator,
      field: 'problems',
      values: expr.groups.problems.selected,
    });
  }

  if (expr.groups.hasTerm !== 'ANY') {
    nodes.push({ type: 'TRISTATE', field: 'hasTerm', value: expr.groups.hasTerm });
  }

  if (expr.groups.inRoute !== 'ANY') {
    nodes.push({ type: 'TRISTATE', field: 'inRoute', value: expr.groups.inRoute });
  }

  return {
    rootOp: expr.rootOperator,
    nodes,
  };
}

function evaluateGroup(
  item: CallQueueItem,
  node: Extract<FilterNode, { type: 'GROUP' }>,
): boolean {
  const checks = node.values.map((token) => {
    if (token === 'OVERDUE') return item.daysUntilDue < 0;
    if (token === 'DUE_IN_7_DAYS') return item.daysUntilDue >= 0 && item.daysUntilDue <= 7;
    if (token === 'DUE_IN_30_DAYS') return item.daysUntilDue >= 0 && item.daysUntilDue <= 30;
    if (token === 'MISSING_PHONE') return !hasPhone(item);
    if (token === 'ADDRESS_ISSUE') return !hasValidAddress(item);
    if (token === 'GEOCODE_FAILED') return item.customerGeocodeStatus === 'failed';
    return false;
  });

  return node.op === 'AND' ? checks.every(Boolean) : checks.some(Boolean);
}

function evaluateTriState(
  item: CallQueueItem,
  node: Extract<FilterNode, { type: 'TRISTATE' }>,
  inRouteIds: Set<string>,
): boolean {
  if (node.field === 'hasTerm') {
    const hasTerm = isScheduledCandidate(item);
    return node.value === 'YES' ? hasTerm : !hasTerm;
  }

  const inRoute = inRouteIds.has(item.customerId);
  return node.value === 'YES' ? inRoute : !inRoute;
}

export function evaluateCandidate(
  item: CallQueueItem,
  ast: FilterAst,
  inRouteIds: Set<string>,
): boolean {
  if (ast.nodes.length === 0) return true;

  const results = ast.nodes.map((node) => {
    if (node.type === 'GROUP') return evaluateGroup(item, node);
    return evaluateTriState(item, node, inRouteIds);
  });

  return ast.rootOp === 'AND' ? results.every(Boolean) : results.some(Boolean);
}

export function applyInboxFilters(
  candidates: CallQueueItem[],
  expression: InboxFilterExpression,
  inRouteIds: Set<string>,
): CallQueueItem[] {
  const ast = toFilterAst(expression);
  return candidates.filter((item) => evaluateCandidate(item, ast, inRouteIds));
}

export function getActiveFilterCount(expression: InboxFilterExpression): number {
  const groups = expression.groups;
  return (
    groups.time.selected.length +
    groups.problems.selected.length +
    (groups.hasTerm === 'ANY' ? 0 : 1) +
    (groups.inRoute === 'ANY' ? 0 : 1)
  );
}

export function hasAdvancedCriteria(expression: InboxFilterExpression): boolean {
  return (
    expression.rootOperator !== 'AND' ||
    expression.groups.time.operator !== 'OR' ||
    expression.groups.problems.operator !== 'OR' ||
    expression.groups.problems.enabled ||
    expression.groups.problems.selected.length > 0
  );
}

export function toggleToken<T extends string>(source: T[], value: T): T[] {
  return source.includes(value)
    ? source.filter((entry) => entry !== value)
    : [...source, value];
}

export function buildFilterSummary(expression: InboxFilterExpression): string {
  const groupParts: string[] = [];
  const groups = expression.groups;

  if (groups.time.enabled && groups.time.selected.length > 0) {
    const labels = groups.time.selected.map((t) => {
      if (t === 'OVERDUE') return 'Po termínu';
      if (t === 'DUE_IN_7_DAYS') return 'Do 7 dnů';
      return 'Do 30 dnů';
    });
    groupParts.push(`Nová revize: (${labels.join(` ${groups.time.operator} `)})`);
  }

  if (groups.problems.enabled && groups.problems.selected.length > 0) {
    const labels = groups.problems.selected.map((p) => {
      if (p === 'MISSING_PHONE') return 'Chybí telefon';
      if (p === 'ADDRESS_ISSUE') return 'Problém s adresou';
      return 'Geokód selhal';
    });
    groupParts.push(`Problémy: (${labels.join(` ${groups.problems.operator} `)})`);
  }

  if (groups.hasTerm !== 'ANY') {
    groupParts.push(`Termín = ${groups.hasTerm === 'YES' ? 'Má' : 'Nemá'}`);
  }
  if (groups.inRoute !== 'ANY') {
    groupParts.push(`Trasa = ${groups.inRoute === 'YES' ? 'V trase' : 'Není v trase'}`);
  }

  if (groupParts.length === 0) return 'Bez filtrů';
  return groupParts.join(` ${expression.rootOperator} `);
}

export function mapExpressionToCallQueueRequestV1(
  expression: InboxFilterExpression,
  geocodedOnly: boolean,
): Pick<CallQueueRequest, 'priorityFilter' | 'geocodedOnly'> {
  let priorityFilter: CallQueueRequest['priorityFilter'] = 'all';

  if (expression.groups.time.enabled) {
    const selected = expression.groups.time.selected;
    // Keep backend narrowing conservative and deterministic.
    if (selected.length === 1) {
      if (selected[0] === 'OVERDUE') priorityFilter = 'overdue';
      if (selected[0] === 'DUE_IN_7_DAYS') priorityFilter = 'due_soon';
    }
  }

  return {
    priorityFilter,
    geocodedOnly,
  };
}
