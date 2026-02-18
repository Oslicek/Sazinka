/**
 * Priority chain for revision service duration (in minutes):
 *   stop-level override  →  device type default  →  global default
 *
 * Rules:
 * - `stopOverride` wins if truthy and > 0.
 * - `deviceTypeDefault` is used when it is truthy and > 0 and no stop-level override exists.
 * - `globalDefault` is the final fallback; must be > 0 (validated by settings).
 */
export function resolveRevisionDuration(
  stopOverride: number | null | undefined,
  deviceTypeDefault: number | null | undefined,
  globalDefault: number
): number {
  if (stopOverride != null && stopOverride > 0) return stopOverride;
  if (deviceTypeDefault != null && deviceTypeDefault > 0) return deviceTypeDefault;
  return globalDefault;
}
