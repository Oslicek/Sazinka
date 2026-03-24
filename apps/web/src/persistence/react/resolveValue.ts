/**
 * resolveValue — nullish-safe precedence resolver.
 *
 * Returns the first candidate that is NOT null or undefined.
 * Preserves valid falsy values: false, 0, empty string.
 *
 * Usage:
 *   const value = resolveValue(urlParam, uppValue, uxDefault);
 */
export function resolveValue<T>(...candidates: (T | null | undefined)[]): T | undefined {
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
}
