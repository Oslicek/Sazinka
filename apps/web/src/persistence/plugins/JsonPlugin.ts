import type { ControlPlugin } from './types';

export class JsonPlugin<T> implements ControlPlugin<T | null> {
  private defaultValue: T | null;

  constructor(defaultValue: T | null) {
    this.defaultValue = defaultValue;
  }

  encode(value: T | null): unknown {
    if (value === null) return null;
    return JSON.stringify(value);
  }

  decode(raw: unknown): T | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string' || raw === '') return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  normalize(value: T | null): T | null {
    return value;
  }

  isEmpty(value: T | null | undefined): boolean {
    return value === null || value === undefined;
  }

  equals(a: T | null | undefined, b: T | null | undefined): boolean {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
