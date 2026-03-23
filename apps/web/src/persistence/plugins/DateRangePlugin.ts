import type { ControlPlugin } from './types';

export interface DateRange {
  dateFrom: string;
  dateTo: string;
  isRange: boolean;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class DateRangePlugin implements ControlPlugin<DateRange | null> {
  encode(value: DateRange | null): unknown {
    if (value === null) return null;
    return JSON.stringify(value);
  }

  decode(raw: unknown): DateRange | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string') return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (
        typeof parsed.dateFrom !== 'string' ||
        !ISO_DATE_RE.test(parsed.dateFrom) ||
        typeof parsed.dateTo !== 'string' ||
        !ISO_DATE_RE.test(parsed.dateTo)
      ) {
        return null;
      }
      return {
        dateFrom: parsed.dateFrom,
        dateTo: parsed.dateTo,
        isRange: Boolean(parsed.isRange),
      };
    } catch {
      return null;
    }
  }

  normalize(value: DateRange | null): DateRange | null {
    if (value === null) return null;
    if (!value.isRange) {
      return { ...value, dateTo: value.dateFrom };
    }
    return value;
  }

  isEmpty(value: DateRange | null | undefined): boolean {
    return value === null || value === undefined;
  }

  equals(a: DateRange | null | undefined, b: DateRange | null | undefined): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.dateFrom === b.dateFrom && a.dateTo === b.dateTo && a.isRange === b.isRange;
  }
}
