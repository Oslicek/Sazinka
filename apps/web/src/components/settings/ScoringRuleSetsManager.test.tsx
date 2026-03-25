/**
 * Phase A (RED) — ScoringRuleSetsManager localization tests.
 *
 * These tests assert that system presets use translated i18n names (via systemKey)
 * rather than the raw `name` stored in the database.
 *
 * Tests will FAIL until:
 *   - ScoringRuleSet.systemKey is added to shared-types
 *   - locale keys scoring_preset_name_* are added to settings.json
 *   - ScoringRuleSetsManager renders localised names for system presets
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ScoringRuleSetsManager } from './ScoringRuleSetsManager';
import type { ScoringRuleSet } from '@/services/scoringService';

// ── i18n test instance ────────────────────────────────────────────────────────

const EN_SCORING_KEYS = {
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
  // NEW: preset name keys (must exist for tests to pass)
  scoring_preset_name_standard: 'Standard',
  scoring_preset_name_new_customers_first: 'New Customers First',
  scoring_preset_name_due_date_radar: 'Due-Date Radar',
  scoring_preset_name_overdue_firefighter: 'Overdue Firefighter',
  scoring_preset_name_data_quality_first: 'Data Quality First',
};

const CS_SCORING_KEYS = {
  ...EN_SCORING_KEYS,
  scoring_preset_name_standard: 'Standardní',
  scoring_preset_name_new_customers_first: 'Noví zákazníci první',
  scoring_preset_name_due_date_radar: 'Radar termínů',
  scoring_preset_name_overdue_firefighter: 'Krizový režim po termínu',
  scoring_preset_name_data_quality_first: 'Kvalita dat a geokódingu',
};

const SK_SCORING_KEYS = {
  ...EN_SCORING_KEYS,
  scoring_preset_name_standard: 'Štandardný',
  scoring_preset_name_new_customers_first: 'Noví zákazníci prví',
  scoring_preset_name_due_date_radar: 'Radar termínov',
  scoring_preset_name_overdue_firefighter: 'Krízový režim po termíne',
  scoring_preset_name_data_quality_first: 'Kvalita dát a geokódovania',
};

function createI18n(locale: string) {
  const resources: Record<string, { settings: Record<string, string> }> = {
    en: { settings: EN_SCORING_KEYS },
    cs: { settings: CS_SCORING_KEYS },
    sk: { settings: SK_SCORING_KEYS },
  };
  const instance = i18n.createInstance();
  instance.use(initReactI18next).init({
    lng: locale,
    fallbackLng: 'en',
    resources,
    interpolation: { escapeValue: false },
  });
  return instance;
}

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
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <ScoringRuleSetsManager />
      </I18nextProvider>
    );
    expect(await screen.findByText('Standard')).toBeInTheDocument();
    expect(await screen.findByText('New Customers First')).toBeInTheDocument();
    expect(await screen.findByText('Due-Date Radar')).toBeInTheDocument();
    expect(await screen.findByText('Overdue Firefighter')).toBeInTheDocument();
    expect(await screen.findByText('Data Quality First')).toBeInTheDocument();
  });

  it('renders all 5 system presets in CS with localised names', async () => {
    render(
      <I18nextProvider i18n={createI18n('cs')}>
        <ScoringRuleSetsManager />
      </I18nextProvider>
    );
    expect(await screen.findByText('Standardní')).toBeInTheDocument();
    expect(await screen.findByText('Noví zákazníci první')).toBeInTheDocument();
    expect(await screen.findByText('Radar termínů')).toBeInTheDocument();
    expect(await screen.findByText('Krizový režim po termínu')).toBeInTheDocument();
    expect(await screen.findByText('Kvalita dat a geokódingu')).toBeInTheDocument();
  });

  it('renders all 5 system presets in SK with localised names', async () => {
    render(
      <I18nextProvider i18n={createI18n('sk')}>
        <ScoringRuleSetsManager />
      </I18nextProvider>
    );
    expect(await screen.findByText('Štandardný')).toBeInTheDocument();
    expect(await screen.findByText('Noví zákazníci prví')).toBeInTheDocument();
    expect(await screen.findByText('Radar termínov')).toBeInTheDocument();
    expect(await screen.findByText('Krízový režim po termíne')).toBeInTheDocument();
    expect(await screen.findByText('Kvalita dát a geokódovania')).toBeInTheDocument();
  });

  it('renders custom profile name directly (not via system key)', async () => {
    const custom: ScoringRuleSet = makePreset({
      id: 'rs-custom',
      name: 'My Custom Profile',
      isSystem: false,
      systemKey: null,
    });
    vi.mocked(scoringService.listRuleSets).mockResolvedValue([custom]);

    render(
      <I18nextProvider i18n={createI18n('cs')}>
        <ScoringRuleSetsManager />
      </I18nextProvider>
    );
    expect(await screen.findByText('My Custom Profile')).toBeInTheDocument();
  });

  it('CS preset names are not the raw English DB names', async () => {
    render(
      <I18nextProvider i18n={createI18n('cs')}>
        <ScoringRuleSetsManager />
      </I18nextProvider>
    );
    // Wait for the list to load, then check
    await screen.findByText('Standardní');
    expect(screen.queryByText('New Customers First')).not.toBeInTheDocument();
    expect(screen.queryByText('Due-Date Radar')).not.toBeInTheDocument();
  });
});
