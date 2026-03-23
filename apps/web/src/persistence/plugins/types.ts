/**
 * ControlPlugin interface — defines the behavior contract for all plugins.
 */
export interface ControlPlugin<T> {
  encode(value: T): unknown;
  decode(raw: unknown): T | null;
  normalize(value: T): T;
  isEmpty(value: T | null | undefined): boolean;
  equals(a: T | null | undefined, b: T | null | undefined): boolean;
}
