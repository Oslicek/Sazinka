import { describe, it, expect, beforeEach } from 'vitest';
import {
  getLocalLayoutPreference,
  setLocalLayoutPreference,
  syncLayoutPreferenceToDb,
  fetchLayoutPreferenceFromDb,
} from '../layoutPreferenceService';

beforeEach(() => {
  localStorage.clear();
});

describe('getLocalLayoutPreference', () => {
  it('returns null when no preference is stored', () => {
    expect(getLocalLayoutPreference()).toBeNull();
  });

  it('returns stored preference', () => {
    const pref = { mode: 'dual' as const, updatedAt: 1234567890 };
    localStorage.setItem('sazinka.layoutPreference', JSON.stringify(pref));

    expect(getLocalLayoutPreference()).toEqual(pref);
  });

  it('returns null on invalid JSON', () => {
    localStorage.setItem('sazinka.layoutPreference', 'not-valid-json');

    expect(getLocalLayoutPreference()).toBeNull();
  });
});

describe('setLocalLayoutPreference', () => {
  it('stores preference in localStorage', () => {
    const pref = { mode: 'grid' as const, updatedAt: 1234567890 };
    setLocalLayoutPreference(pref);

    const stored = JSON.parse(localStorage.getItem('sazinka.layoutPreference')!);
    expect(stored).toEqual(pref);
  });

  it('overwrites existing preference', () => {
    setLocalLayoutPreference({ mode: 'stack' as const, updatedAt: 1000 });
    setLocalLayoutPreference({ mode: 'wide' as const, updatedAt: 2000 });

    expect(getLocalLayoutPreference()?.mode).toBe('wide');
    expect(getLocalLayoutPreference()?.updatedAt).toBe(2000);
  });

  it('round-trips all mode values correctly', () => {
    const modes = ['stack', 'dual', 'grid', 'wide'] as const;
    for (const mode of modes) {
      setLocalLayoutPreference({ mode, updatedAt: 0 });
      expect(getLocalLayoutPreference()?.mode).toBe(mode);
    }
  });
});

describe('syncLayoutPreferenceToDb', () => {
  it('resolves without error (stub)', async () => {
    await expect(
      syncLayoutPreferenceToDb({ mode: 'dual', updatedAt: 1000 })
    ).resolves.toBeUndefined();
  });
});

describe('fetchLayoutPreferenceFromDb', () => {
  it('returns null (stub)', async () => {
    await expect(fetchLayoutPreferenceFromDb()).resolves.toBeNull();
  });
});
