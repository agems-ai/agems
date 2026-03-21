import { BaseAdapter } from './base-adapter';
import { AdapterType, AdapterConfig } from './types';
import { ClaudeCodeAdapter } from './adapters/claude-code';
import { CodexAdapter } from './adapters/codex';
import { CursorAdapter } from './adapters/cursor';
import { GeminiCliAdapter } from './adapters/gemini-cli';
import { OpenClawAdapter } from './adapters/openclaw';
import { OpenCodeAdapter } from './adapters/opencode';
import { PiAdapter } from './adapters/pi';
import { HttpAdapter } from './adapters/http';
import { ProcessAdapter } from './adapters/process';

/**
 * Factory for creating external agent adapters.
 *
 * Usage:
 *   const adapter = AdapterFactory.create('CLAUDE_CODE', { workingDir: '/path' });
 *   const result = await adapter.execute({ prompt: 'Fix the bug in auth.ts' });
 */
export class AdapterFactory {
  private static registry = new Map<AdapterType, new (config: any) => BaseAdapter>([
    ['CLAUDE_CODE', ClaudeCodeAdapter],
    ['CODEX', CodexAdapter],
    ['CURSOR', CursorAdapter],
    ['GEMINI_CLI', GeminiCliAdapter],
    ['OPENCLAW', OpenClawAdapter],
    ['OPENCODE', OpenCodeAdapter],
    ['PI', PiAdapter],
    ['HTTP', HttpAdapter],
    ['PROCESS', ProcessAdapter],
  ]);

  /**
   * Create an adapter instance by type
   */
  static create(type: AdapterType, config: AdapterConfig = {}): BaseAdapter {
    const AdapterClass = this.registry.get(type);
    if (!AdapterClass) {
      throw new Error(`Unknown adapter type: ${type}. Available: ${Array.from(this.registry.keys()).join(', ')}`);
    }
    return new AdapterClass(config);
  }

  /**
   * Check availability of all registered adapters
   */
  static async checkAll(): Promise<Record<AdapterType, { available: boolean; version?: string; error?: string }>> {
    const results: Record<string, any> = {};

    await Promise.all(
      Array.from(this.registry.entries()).map(async ([type, AdapterClass]) => {
        const adapter = new AdapterClass({});
        results[type] = await adapter.checkAvailability();
      })
    );

    return results as Record<AdapterType, { available: boolean; version?: string; error?: string }>;
  }

  /**
   * Check availability of a specific adapter
   */
  static async check(type: AdapterType, config: AdapterConfig = {}): Promise<{ available: boolean; version?: string; error?: string }> {
    const adapter = this.create(type, config);
    return adapter.checkAvailability();
  }

  /**
   * Get metadata about all registered adapters
   */
  static listAdapters(): Array<{
    type: AdapterType;
    name: string;
    description: string;
  }> {
    return [
      { type: 'CLAUDE_CODE', name: 'Claude Code', description: 'Anthropic Claude Code CLI - AI coding agent with file editing, bash, and search tools' },
      { type: 'CODEX', name: 'OpenAI Codex', description: 'OpenAI Codex CLI - AI coding agent with auto-edit and full-auto modes' },
      { type: 'CURSOR', name: 'Cursor', description: 'Cursor IDE agent - AI coding within Cursor IDE with background mode support' },
      { type: 'GEMINI_CLI', name: 'Gemini CLI', description: 'Google Gemini CLI - AI agent with sandbox mode and multimodal support' },
      { type: 'OPENCLAW', name: 'OpenClaw', description: 'OpenClaw agent - Docker-based agent accessed via SSE gateway' },
      { type: 'OPENCODE', name: 'OpenCode', description: 'OpenCode AI agent - Multi-provider coding agent with model detection' },
      { type: 'PI', name: 'Pi', description: 'Pi agent - AI coding agent with model selection' },
      { type: 'HTTP', name: 'HTTP Webhook', description: 'Generic HTTP adapter - Send tasks to any REST endpoint, fire-and-forget or wait-for-response' },
      { type: 'PROCESS', name: 'Process', description: 'Generic shell command adapter - Run any CLI tool or script as an agent' },
    ];
  }

  /**
   * Register a custom adapter type
   */
  static register(type: string, adapterClass: new (config: any) => BaseAdapter): void {
    this.registry.set(type as AdapterType, adapterClass);
  }
}
