/**
 * External Agent Adapter Types
 *
 * Adapters bridge AGEMS with external AI agent runtimes (Claude Code, Codex, Cursor, etc.)
 * Each adapter translates AGEMS tasks/messages into the external agent's protocol.
 */

export type AdapterType =
  | 'CLAUDE_CODE'
  | 'CODEX'
  | 'CURSOR'
  | 'GEMINI_CLI'
  | 'OPENCLAW'
  | 'OPENCODE'
  | 'PI'
  | 'HTTP'
  | 'PROCESS';

export interface AdapterConfig {
  /** Working directory for the agent */
  workingDir?: string;
  /** Environment variables to inject */
  env?: Record<string, string>;
  /** Execution timeout in ms (default: 30 min) */
  timeoutMs?: number;
  /** Adapter-specific config */
  [key: string]: unknown;
}

export interface ClaudeCodeConfig extends AdapterConfig {
  /** Claude model to use (default: claude-sonnet-4-20250514) */
  model?: string;
  /** Max tokens for output */
  maxTokens?: number;
  /** Allowed tools (e.g., ['Read', 'Write', 'Bash']) */
  allowedTools?: string[];
  /** Session compaction threshold (bytes) */
  compactionThreshold?: number;
}

export interface CodexConfig extends AdapterConfig {
  /** Model to use */
  model?: string;
  /** Approval mode: suggest, auto-edit, full-auto */
  approvalMode?: 'suggest' | 'auto-edit' | 'full-auto';
}

export interface CursorConfig extends AdapterConfig {
  /** Cursor workspace path */
  workspacePath?: string;
  /** Enable background mode */
  background?: boolean;
}

export interface GeminiCliConfig extends AdapterConfig {
  /** Gemini model */
  model?: string;
  /** Sandbox mode */
  sandbox?: boolean;
}

export interface OpenClawConfig extends AdapterConfig {
  /** Gateway URL for SSE connection */
  gatewayUrl?: string;
  /** Docker container name */
  containerName?: string;
}

export interface OpenCodeConfig extends AdapterConfig {
  /** Model provider and model */
  model?: string;
  /** Provider (anthropic, openai, etc.) */
  provider?: string;
}

export interface PiConfig extends AdapterConfig {
  /** Model name */
  model?: string;
}

export interface HttpAdapterConfig extends AdapterConfig {
  /** Webhook URL to call */
  url: string;
  /** HTTP method (default: POST) */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** Custom headers */
  headers?: Record<string, string>;
  /** Authentication */
  auth?: {
    type: 'bearer' | 'basic' | 'api_key';
    token?: string;
    username?: string;
    password?: string;
    headerName?: string;
    apiKey?: string;
  };
  /** Wait for response or fire-and-forget */
  waitForResponse?: boolean;
  /** Response timeout in ms */
  responseTimeoutMs?: number;
}

export interface ProcessConfig extends AdapterConfig {
  /** Shell command to execute */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Shell to use (default: /bin/bash) */
  shell?: string;
}

/** Result from an adapter execution */
export interface AdapterResult {
  /** Whether the execution succeeded */
  success: boolean;
  /** Output text from the agent */
  output: string;
  /** Structured tool calls made by the agent */
  toolCalls?: Array<{
    tool: string;
    input: Record<string, unknown>;
    output?: string;
    duration?: number;
  }>;
  /** Tokens used (if available) */
  tokensUsed?: number;
  /** Cost in USD (if available) */
  costUsd?: number;
  /** Error message if failed */
  error?: string;
  /** Raw output from the process */
  rawOutput?: string;
  /** Execution duration in ms */
  durationMs?: number;
}

/** Status of an adapter run */
export type AdapterRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';

/** Events emitted by adapters */
export interface AdapterEvents {
  'output': (chunk: string) => void;
  'tool-call': (toolName: string, input: Record<string, unknown>) => void;
  'status': (status: AdapterRunStatus) => void;
  'error': (error: Error) => void;
  'complete': (result: AdapterResult) => void;
}
