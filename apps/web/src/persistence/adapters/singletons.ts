/**
 * Shared adapter singletons.
 *
 * Import these in page components to avoid creating multiple adapter instances.
 * Each adapter is a module-level singleton.
 */
import { SessionStorageAdapter } from './SessionStorageAdapter';
import { LocalStorageAdapter } from './LocalStorageAdapter';

export const sessionAdapter = new SessionStorageAdapter();
export const localAdapter = new LocalStorageAdapter();
