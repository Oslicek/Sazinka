export interface Country {
  /** ISO 3166-1 alpha-2 code, e.g. "CZ" */
  code: string;
  /** ISO 3166-1 alpha-3 code, e.g. "CZE" */
  alpha3: string;
  /** Localized names keyed by locale code */
  name: Record<string, string>;
}
