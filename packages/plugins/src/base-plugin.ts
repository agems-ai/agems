import type {
  PluginManifest,
  PluginContext,
  PluginHook,
  PluginPage,
  PluginTool,
  PluginDefinition,
} from './types';

/**
 * Abstract base class for creating AGEMS plugins.
 *
 * Extend this class and implement the abstract members to create a plugin:
 *
 * ```ts
 * class MyPlugin extends BasePlugin {
 *   manifest = {
 *     name: 'My Plugin',
 *     slug: 'my-plugin',
 *     version: '1.0.0',
 *     description: 'Does something useful',
 *     author: 'Me',
 *     permissions: [],
 *     entryPoint: './index.ts',
 *   };
 *
 *   async onActivate(ctx: PluginContext) {
 *     console.log('Plugin activated for org', ctx.orgId);
 *   }
 * }
 * ```
 */
export abstract class BasePlugin implements PluginDefinition {
  abstract manifest: PluginManifest;

  hooks: PluginHook[] = [];
  pages: PluginPage[] = [];
  tools: PluginTool[] = [];

  /**
   * Called when the plugin is activated. Override to perform setup.
   */
  async onActivate(_context: PluginContext): Promise<void> {
    // Default: no-op
  }

  /**
   * Called when the plugin is deactivated. Override to perform cleanup.
   */
  async onDeactivate(_context: PluginContext): Promise<void> {
    // Default: no-op
  }

  /**
   * Register an event hook.
   */
  protected addHook(event: string, handler: PluginHook['handler']): void {
    this.hooks.push({ event, handler });
  }

  /**
   * Register a custom page.
   */
  protected addPage(path: string, title: string, component: string): void {
    this.pages.push({ path, title, component });
  }

  /**
   * Register a tool for AI agents.
   */
  protected addTool(tool: PluginTool): void {
    this.tools.push(tool);
  }

  /**
   * Convert this plugin instance to a plain PluginDefinition object.
   */
  toDefinition(): PluginDefinition {
    return {
      manifest: this.manifest,
      hooks: this.hooks,
      pages: this.pages,
      tools: this.tools,
      onActivate: this.onActivate.bind(this),
      onDeactivate: this.onDeactivate.bind(this),
    };
  }
}
