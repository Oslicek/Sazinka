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

  // If it's a string, try to parse as JSON { key, params } first
  if (typeof message === 'string') {
    // Quick check: if it looks like JSON, try to parse
    if (message.startsWith('{') && message.includes('"key"')) {
      try {
        const parsed = JSON.parse(message);
        if (parsed && typeof parsed.key === 'string') {
          return resolveBackendMessage(parsed, instance);
        }
      } catch {
        // Not valid JSON — fall through to plain string handling
      }
    }
    // Plain string — could be a simple i18n key (e.g. "jobs:loading_customers")
    // or a legacy Czech/English string
    if (message.includes(':') && !message.includes(' ')) {
      const result = i18n.t(message);
      if (result !== message && result !== message.split(':').slice(1).join(':')) {
        return result;
      }
    }
    return message;
  }

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
