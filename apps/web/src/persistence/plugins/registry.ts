import type { ControlPlugin } from './types';

export class PluginRegistry {
  private plugins = new Map<string, ControlPlugin<unknown>>();

  register(id: string, plugin: ControlPlugin<unknown>): void {
    if (this.plugins.has(id)) {
      throw new Error(`Plugin with id "${id}" is already registered`);
    }
    this.plugins.set(id, plugin);
  }

  get(id: string): ControlPlugin<unknown> | undefined {
    return this.plugins.get(id);
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }
}
