/**
 * Resolve a backend message to a user-visible string.
 *
 * Backend sends either:
 *   - A legacy plain string (pre-migration) → returned as-is.
 *   - A unified `{ key, params }` shape → translated via i18next.
 *
 * @param message  The backend message payload
 * @param instance Optional i18next instance (defaults to the global singleton)
 */
import type { i18n as I18nInstance } from 'i18next';
import defaultI18n from './index';

/** Backend sends either a legacy plain string or the unified { key, params } shape. */
export type BackendMessage =
  | string
  | { key: string; params?: Record<string, unknown> };

export function resolveBackendMessage(
  message: BackendMessage,
  instance?: I18nInstance,
): string {
  const i18n = instance ?? defaultI18n;

  // Legacy plain string — pass through as-is
  if (typeof message === 'string') return message;

  const { key, params } = message;

  // Translate using i18next
  const result = i18n.t(key, params ?? {});

  // i18next returns the key (or last segment) when translation is missing
  // Check both the full key and the key part after the namespace separator
  const keyPart = key.includes(':') ? key.split(':').slice(1).join(':') : key;
  if (result === key || result === keyPart) {
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      console.warn(`[i18n] missing key: ${key}`);
    }
    return i18n.t('common:errors.unknown');
  }

  return result;
}
