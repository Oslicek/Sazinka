import type { ScoringRuleSet } from '@/services/scoringService';

const PRESET_DISPLAY_ORDER: readonly string[] = [
  'standard',
  'due_date_radar',
  'overdue_firefighter',
  'new_customers_first',
  'data_quality_first',
];

const PRESET_ORDER_INDEX = new Map<string, number>(
  PRESET_DISPLAY_ORDER.map((key, index) => [key, index]),
);

function sortWeight(ruleSet: ScoringRuleSet): number {
  if (!ruleSet.systemKey) return Number.MAX_SAFE_INTEGER;
  return PRESET_ORDER_INDEX.get(ruleSet.systemKey) ?? Number.MAX_SAFE_INTEGER;
}

export function sortRuleSetsForDisplay(ruleSets: ScoringRuleSet[]): ScoringRuleSet[] {
  return [...ruleSets].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;

    const aWeight = sortWeight(a);
    const bWeight = sortWeight(b);
    if (aWeight !== bWeight) return aWeight - bWeight;

    return a.name.localeCompare(b.name);
  });
}
