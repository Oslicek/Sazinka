/**
 * Phase A (RED) / Phase B (GREEN) — ScoringRuleSetsManager localization tests.
 *
 * These tests assert that system presets use translated i18n names (via systemKey)
 * rather than the raw `name` stored in the database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoringRuleSetsManager } from './ScoringRuleSetsManager';
import type { ScoringRuleSet } from '@/services/scoringService';

// ── Translation tables ────────────────────────────────────────────────────────

const TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    scoring_title: 'Scoring Profiles',
    scoring_description: 'Configure scoring profiles',
    scoring_new_profile: 'New Profile',
    scoring_show_archived: 'Show archived',
    scoring_no_profiles: 'No profiles',
    scoring_system_badge: 'System',
    scoring_default_badge: 'Default',
    scoring_archived_badge: 'Archived',
    scoring_edit: 'Edit',
    scoring_archive: 'Archive',
    scoring_restore_defaults: 'Restore defaults',
    scoring_set_default: 'Set as default',
    scoring_error_load: 'Failed to load',
    delete_action: 'Delete',
    scoring_preset_name_standard: 'Standard',
    scoring_preset_name_new_customers_first: 'New Customers First',
    scoring_preset_name_due_date_radar: 'Due-Date Radar',
    scoring_preset_name_overdue_firefighter: 'Overdue Firefighter',
    scoring_preset_name_data_quality_first: 'Data Quality First',
  },
  cs: {
    scoring_title: 'Profily hodnocení',
    scoring_description: 'Nastavte profily hodnocení',
    scoring_new_profile: 'Nový profil',
    scoring_show_archived: 'Zobrazit archivované',
    scoring_no_profiles: 'Žádné profily',
    scoring_system_badge: 'Systémový',
    scoring_default_badge: 'Výchozí',
    scoring_archived_badge: 'Archivovaný',
    scoring_edit: 'Upravit',
    scoring_archive: 'Archivovat',
    scoring_restore_defaults: 'Obnovit výchozí',
    scoring_set_default: 'Nastavit jako výchozí',
    scoring_error_load: 'Nepodařilo se načíst',
    delete_action: 'Smazat',
    scoring_preset_name_standard: 'Standardní',
    scoring_preset_name_new_customers_first: 'Noví zákazníci první',
    scoring_preset_name_due_date_radar: 'Radar termínů',
    scoring_preset_name_overdue_firefighter: 'Krizový režim po termínu',
    scoring_preset_name_data_quality_first: 'Kvalita dat a geokódingu',
  },
  sk: {
    scoring_title: 'Profily hodnotenia',
    scoring_description: 'Nastavte profily hodnotenia',
    scoring_new_profile: 'Nový profil',
    scoring_show_archived: 'Zobrazit archivované',
    scoring_no_profiles: 'Žiadne profily',
    scoring_system_badge: 'Systémový',
    scoring_default_badge: 'Predvolený',
    scoring_archived_badge: 'Archivovaný',
    scoring_edit: 'Upraviť',
    scoring_archive: 'Archivovať',
    scoring_restore_defaults: 'Obnoviť predvolené',
    scoring_set_default: 'Nastaviť ako predvolené',
    scoring_error_load: 'Nepodarilo sa načítať',
    delete_action: 'Zmazať',
    scoring_preset_name_standard: 'Štandardný',
    scoring_preset_name_new_customers_first: 'Noví zákazníci prví',
    scoring_preset_name_due_date_radar: 'Radar termínov',
    scoring_preset_name_overdue_firefighter: 'Krízový režim po termíne',
    scoring_preset_name_data_quality_first: 'Kvalita dát a geokódovania',
  },
};

// Mock react-i18next — locale is injected per test via `setLocale()`
let activeLocale = 'en';
const setLocale = (l: string) => { activeLocale = l; };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => TRANSLATIONS[activeLocale]?.[key] ?? key,
    i18n: { language: activeLocale },
  }),
}));

// ── Service mock ──────────────────────────────────────────────────────────────

vi.mock('../../services/scoringService', () => ({
  listRuleSets: vi.fn(),
  createRuleSet: vi.fn(),
  updateRuleSet: vi.fn(),
  archiveRuleSet: vi.fn(),
  setDefaultRuleSet: vi.fn(),
  deleteRuleSet: vi.fn(),
  restoreRuleSetDefaults: vi.fn(),
}));

vi.mock('../../stores/natsStore', () => ({
  useNatsStore: vi.fn(() => ({ isConnected: true })),
}));

import * as scoringService from '../../services/scoringService';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SYSTEM_PRESET_BASE = {
  userId: 'user-1',
  description: null,
  isDefault: false,
  isArchived: false,
  isSystem: true,
  createdByUserId: 'user-1',
  updatedByUserId: 'user-1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  factors: [],
};

function makePreset(overrides: Partial<ScoringRuleSet>): ScoringRuleSet {
  return { ...SYSTEM_PRESET_BASE, ...overrides } as ScoringRuleSet;
}

const ALL_PRESETS: ScoringRuleSet[] = [
  makePreset({ id: 'rs-1', name: 'Standard', isDefault: true, systemKey: 'standard' }),
  makePreset({ id: 'rs-2', name: 'New Customers First', systemKey: 'new_customers_first' }),
  makePreset({ id: 'rs-3', name: 'Due-Date Radar', systemKey: 'due_date_radar' }),
  makePreset({ id: 'rs-4', name: 'Overdue Firefighter', systemKey: 'overdue_firefighter' }),
  makePreset({ id: 'rs-5', name: 'Data Quality First', systemKey: 'data_quality_first' }),
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ScoringRuleSetsManager – preset localisation', () => {
  beforeEach(() => {
    vi.mocked(scoringService.listRuleSets).mockResolvedValue(ALL_PRESETS);
  });

  it('renders all 5 system presets in EN with localised names', async () => {
    setLocale('en');
    render(<ScoringRuleSetsManager />);
    expect(await screen.findByText('Standard')).toBeInTheDocument();
    expect(await screen.findByText('New Customers First')).toBeInTheDocument();
    expect(await screen.findByText('Due-Date Radar')).toBeInTheDocument();
    expect(await screen.findByText('Overdue Firefighter')).toBeInTheDocument();
    expect(await screen.findByText('Data Quality First')).toBeInTheDocument();
  });

  it('renders all 5 system presets in CS with localised names', async () => {
    setLocale('cs');
    render(<ScoringRuleSetsManager />);
    expect(await screen.findByText('Standardní')).toBeInTheDocument();
    expect(await screen.findByText('Noví zákazníci první')).toBeInTheDocument();
    expect(await screen.findByText('Radar termínů')).toBeInTheDocument();
    expect(await screen.findByText('Krizový režim po termínu')).toBeInTheDocument();
    expect(await screen.findByText('Kvalita dat a geokódingu')).toBeInTheDocument();
  });

  it('renders all 5 system presets in SK with localised names', async () => {
    setLocale('sk');
    render(<ScoringRuleSetsManager />);
    expect(await screen.findByText('Štandardný')).toBeInTheDocument();
    expect(await screen.findByText('Noví zákazníci prví')).toBeInTheDocument();
    expect(await screen.findByText('Radar termínov')).toBeInTheDocument();
    expect(await screen.findByText('Krízový režim po termíne')).toBeInTheDocument();
    expect(await screen.findByText('Kvalita dát a geokódovania')).toBeInTheDocument();
  });

  it('renders custom profile name directly (not via system key)', async () => {
    setLocale('cs');
    const custom: ScoringRuleSet = makePreset({
      id: 'rs-custom',
      name: 'My Custom Profile',
      isSystem: false,
      systemKey: null,
    });
    vi.mocked(scoringService.listRuleSets).mockResolvedValue([custom]);
    render(<ScoringRuleSetsManager />);
    expect(await screen.findByText('My Custom Profile')).toBeInTheDocument();
  });

  it('CS preset names are not the raw English DB names', async () => {
    setLocale('cs');
    render(<ScoringRuleSetsManager />);
    await screen.findByText('Standardní');
    expect(screen.queryByText('New Customers First')).not.toBeInTheDocument();
    expect(screen.queryByText('Due-Date Radar')).not.toBeInTheDocument();
  });
});
