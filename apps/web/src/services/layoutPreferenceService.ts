export interface LayoutPreference {
  mode: 'stack' | 'split' | 'tiles' | 'classic';
  updatedAt: number;
}

const LS_KEY = 'sazinka.layoutPreference';

export function getLocalLayoutPreference(): LayoutPreference | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LayoutPreference;
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
