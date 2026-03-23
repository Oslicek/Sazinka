import type { ControlPlugin } from './types';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class DatePlugin implements ControlPlugin<string | null> {
  encode(value: string | null): unknown {
    return value;
  }

  decode(raw: unknown): string | null {
    if (typeof raw !== 'string' || !ISO_DATE_RE.test(raw)) return null;
    return raw;
  }

  normalize(value: string | null): string | null {
    return value;
  }

  isEmpty(value: string | null | undefined): boolean {
    return value === null || value === undefined || value === '';
  }

  equals(a: string | null | undefined, b: string | null | undefined): boolean {
    return (a ?? null) === (b ?? null);
  }
}
