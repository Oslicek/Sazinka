import type { ControlPlugin } from './types';

export class BooleanPlugin implements ControlPlugin<boolean> {
  private defaultValue: boolean;

  constructor(defaultValue: boolean) {
    this.defaultValue = defaultValue;
  }

  encode(value: boolean): unknown {
    return value;
  }

  decode(raw: unknown): boolean {
    if (raw === true || raw === 'true' || raw === '1') return true;
    if (raw === false || raw === 'false' || raw === '0') return false;
    return this.defaultValue;
  }

  normalize(value: boolean): boolean {
    return value;
  }

  isEmpty(value: boolean | null | undefined): boolean {
    return value === null || value === undefined;
  }

  equals(a: boolean | null | undefined, b: boolean | null | undefined): boolean {
    return (a ?? null) === (b ?? null);
  }
}
