/**
 * Unified Persistence Platform (UPP) — public API barrel.
 *
 * Import from here rather than deep-linking into sub-modules.
 */

// Core
export { PersistenceOrchestrator } from './core/PersistenceOrchestrator';
export { resolvePrecedence } from './core/precedence';
export {
  makeEnvelope,
  isValidEnvelope,
  makeKey,
  type PersistenceEnvelope,
  type PersistenceAdapter,
  type PersistenceProfile,
  type ControlSpec,
  type HydrationContext,
  type HydratedState,
  type ChannelId,
  type WriteMode,
} from './core/types';

// Adapters
export { MemoryAdapter } from './adapters/MemoryAdapter';
export { SessionStorageAdapter } from './adapters/SessionStorageAdapter';
export { LocalStorageAdapter } from './adapters/LocalStorageAdapter';
export { UrlAdapter, type UrlAdapterOptions } from './adapters/UrlAdapter';
export { ServerPreferencesAdapter, type ServerPreferencesAdapterOptions } from './adapters/ServerPreferencesAdapter';

// Plugins
export { DatePlugin } from './plugins/DatePlugin';
export { DateRangePlugin, type DateRange } from './plugins/DateRangePlugin';
export { EnumPlugin } from './plugins/EnumPlugin';
export { TextSearchPlugin } from './plugins/TextSearchPlugin';
export { BooleanPlugin } from './plugins/BooleanPlugin';
export { JsonPlugin } from './plugins/JsonPlugin';
export { PluginRegistry } from './plugins/registry';
export type { ControlPlugin } from './plugins/types';

// React
export { PersistenceProvider, usePersistence } from './react/PersistenceProvider';
export { usePersistentControl } from './react/usePersistentControl';
export { usePersistentProfile } from './react/usePersistentProfile';

// Profiles
export { customersProfile, CUSTOMERS_PROFILE_ID } from './profiles/customersProfile';
export { routesProfile, ROUTES_PROFILE_ID } from './profiles/routesProfile';
export { planProfile, PLAN_PROFILE_ID } from './profiles/planProfile';
export { inboxProfile, INBOX_PROFILE_ID } from './profiles/inboxProfile';
