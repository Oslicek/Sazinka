export interface LayoutPreference {
  mode: 'stack' | 'dual' | 'grid' | 'wide';
  updatedAt: number;
}

const LS_KEY = 'sazinka.layoutPreference';

const LEGACY_MODE_MAP: Record<string, LayoutPreference['mode']> = {
  split: 'dual',
  tiles: 'grid',
  classic: 'wide',
};

export function getLocalLayoutPreference(): LayoutPreference | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const pref = JSON.parse(raw) as LayoutPreference;
    const migrated = LEGACY_MODE_MAP[pref.mode];
    if (migrated) {
      pref.mode = migrated;
      localStorage.setItem(LS_KEY, JSON.stringify(pref));
    }
    return pref;
  } catch {
    return null;
  }
}

export function setLocalLayoutPreference(pref: LayoutPreference): void {
  localStorage.setItem(LS_KEY, JSON.stringify(pref));
}

export async function syncLayoutPreferenceToDb(_pref: LayoutPreference): Promise<void> {
  // Stub — full DB implementation comes in a later step
}

export async function fetchLayoutPreferenceFromDb(): Promise<LayoutPreference | null> {
  // Stub — full DB implementation comes in a later step
  return null;
}
