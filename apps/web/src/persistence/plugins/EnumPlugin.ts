import type { ControlPlugin } from './types';

export class EnumPlugin<T extends string> implements ControlPlugin<T> {
  private allowed: Set<T>;
  private defaultValue: T;

  constructor(allowed: T[], defaultValue: T) {
    this.allowed = new Set(allowed);
    this.defaultValue = defaultValue;
  }

  encode(value: T): unknown {
    return value;
  }

  decode(raw: unknown): T {
    if (typeof raw === 'string' && this.allowed.has(raw as T)) return raw as T;
    return this.defaultValue;
  }

  normalize(value: T): T {
    return this.allowed.has(value) ? value : this.defaultValue;
  }

  isEmpty(value: T | null | undefined): boolean {
    return value === null || value === undefined || value === ('' as T);
  }

  equals(a: T | null | undefined, b: T | null | undefined): boolean {
    return (a ?? null) === (b ?? null);
  }
}
