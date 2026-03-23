import type { ControlPlugin } from './types';

interface TextSearchOptions {
  debounceMs?: number;
}

export class TextSearchPlugin implements ControlPlugin<string> {
  private debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingValue: string | null = null;
  private pendingCallback: ((value: string) => void) | null = null;

  constructor({ debounceMs = 300 }: TextSearchOptions = {}) {
    this.debounceMs = debounceMs;
  }

  encode(value: string): unknown {
    return value.trim();
  }

  decode(raw: unknown): string {
    if (raw === null || raw === undefined) return '';
    return String(raw);
  }

  normalize(value: string): string {
    return value.trim();
  }

  isEmpty(value: string | null | undefined): boolean {
    return value === null || value === undefined || value === '';
  }

  equals(a: string | null | undefined, b: string | null | undefined): boolean {
    return (a ?? '') === (b ?? '');
  }

  debounce(value: string, callback: (value: string) => void): void {
    this.pendingValue = value;
    this.pendingCallback = callback;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pendingCallback !== null) {
        this.pendingCallback(this.pendingValue ?? '');
        this.pendingCallback = null;
        this.pendingValue = null;
      }
    }, this.debounceMs);
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingValue = null;
    this.pendingCallback = null;
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pendingCallback !== null) {
      this.pendingCallback(this.pendingValue ?? '');
      this.pendingCallback = null;
      this.pendingValue = null;
    }
  }
}
