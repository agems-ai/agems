import type { PluginDefinition, PluginContext } from './types';

/**
 * Manages loading, unloading, and lifecycle of plugins.
 */
export class PluginLoader {
  private plugins: Map<string, PluginDefinition> = new Map();
  private activeContexts: Map<string, PluginContext> = new Map();

  /**
   * Load and activate a plugin.
   */
  async load(definition: PluginDefinition, context: PluginContext): Promise<void> {
    const { slug } = definition.manifest;

    if (this.plugins.has(slug)) {
      throw new Error(`Plugin "${slug}" is already loaded`);
    }

    // Activate the plugin
    if (definition.onActivate) {
      await definition.onActivate(context);
    }

    this.plugins.set(slug, definition);
    this.activeContexts.set(slug, context);
  }

  /**
   * Deactivate and unload a plugin.
   */
  async unload(slug: string): Promise<void> {
    const definition = this.plugins.get(slug);
    if (!definition) {
      throw new Error(`Plugin "${slug}" is not loaded`);
    }

    const context = this.activeContexts.get(slug);
    if (definition.onDeactivate && context) {
      await definition.onDeactivate(context);
    }

    this.plugins.delete(slug);
    this.activeContexts.delete(slug);
  }

  /**
   * Get a loaded plugin by slug.
   */
  get(slug: string): PluginDefinition | undefined {
    return this.plugins.get(slug);
  }

  /**
   * List all loaded plugins.
   */
  list(): PluginDefinition[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Check if a plugin is loaded.
   */
  isLoaded(slug: string): boolean {
    return this.plugins.has(slug);
  }

  /**
   * Get the configuration for a loaded plugin.
   */
  getConfig(slug: string): Record<string, unknown> | undefined {
    const context = this.activeContexts.get(slug);
    return context?.config;
  }

  /**
   * Update the configuration for a loaded plugin.
   * The plugin remains loaded; only the context config is replaced.
   */
  updateConfig(slug: string, config: Record<string, unknown>): void {
    const context = this.activeContexts.get(slug);
    if (!context) {
      throw new Error(`Plugin "${slug}" is not loaded`);
    }
    this.activeContexts.set(slug, { ...context, config });
  }

  /**
   * Emit an event to all loaded plugins that have matching hooks.
   */
  async emit(event: string, payload: unknown): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [slug, definition] of this.plugins) {
      const context = this.activeContexts.get(slug);
      if (!context || !definition.hooks) continue;

      for (const hook of definition.hooks) {
        if (hook.event === event) {
          promises.push(
            Promise.resolve(hook.handler(payload, context)).catch((err) => {
              console.error(`Plugin "${slug}" hook "${event}" failed:`, err);
            }),
          );
        }
      }
    }

    await Promise.all(promises);
  }

  /**
   * Unload all plugins.
   */
  async unloadAll(): Promise<void> {
    const slugs = Array.from(this.plugins.keys());
    for (const slug of slugs) {
      await this.unload(slug);
    }
  }
}
