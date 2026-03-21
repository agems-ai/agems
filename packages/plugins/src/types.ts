/**
 * Plugin manifest describing metadata and requirements.
 */
export interface PluginManifest {
  /** Human-readable plugin name */
  name: string;
  /** URL-safe unique identifier (e.g. "crm-sync") */
  slug: string;
  /** Semver version string */
  version: string;
  /** Short description of what the plugin does */
  description: string;
  /** Plugin author name or organization */
  author: string;
  /** URL to plugin homepage or documentation */
  homepage?: string;
  /** Permissions the plugin requires (e.g. ["tasks:read", "agents:write"]) */
  permissions: string[];
  /** Path to the plugin's main module */
  entryPoint: string;
  /** JSON Schema describing the plugin's configuration options */
  configSchema?: Record<string, ConfigSchemaField>;
}

export interface ConfigSchemaField {
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  description?: string;
  default?: string | number | boolean;
  required?: boolean;
  options?: { label: string; value: string }[];
}

/**
 * Runtime context provided to a plugin when it is activated.
 */
export interface PluginContext {
  /** Organization ID the plugin is running for */
  orgId: string;
  /** Base API URL for making requests */
  apiUrl: string;
  /** API token for authenticated requests */
  apiToken: string;
  /** Plugin configuration values set by the user */
  config: Record<string, unknown>;
}

/**
 * A hook that subscribes to platform events.
 */
export interface PluginHook {
  /** Event name to listen for (e.g. "task.created", "agent.message") */
  event: string;
  /** Handler function called when the event fires */
  handler: (payload: unknown, context: PluginContext) => Promise<void> | void;
}

/**
 * A custom page contributed by a plugin.
 */
export interface PluginPage {
  /** URL path segment (e.g. "/analytics" becomes /plugins/<slug>/analytics) */
  path: string;
  /** Page title shown in navigation */
  title: string;
  /** React component or module path to render */
  component: string;
}

/**
 * A tool that the plugin exposes to AI agents.
 */
export interface PluginTool {
  /** Tool name */
  name: string;
  /** Description for the AI agent */
  description: string;
  /** JSON Schema for tool parameters */
  parameters: Record<string, unknown>;
  /** Tool execution handler */
  execute: (params: Record<string, unknown>, context: PluginContext) => Promise<unknown>;
}

/**
 * Complete plugin definition returned by a plugin module.
 */
export interface PluginDefinition {
  /** Plugin manifest with metadata */
  manifest: PluginManifest;
  /** Event hooks the plugin subscribes to */
  hooks?: PluginHook[];
  /** Custom pages the plugin contributes */
  pages?: PluginPage[];
  /** Tools exposed to AI agents */
  tools?: PluginTool[];
  /** Called when the plugin is activated */
  onActivate?: (context: PluginContext) => Promise<void> | void;
  /** Called when the plugin is deactivated */
  onDeactivate?: (context: PluginContext) => Promise<void> | void;
}
