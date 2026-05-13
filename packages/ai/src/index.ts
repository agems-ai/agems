export { createProvider, type AIProviderConfig } from './provider';
export { AgentRunner, type AgentRunnerConfig, type MCPServerConfig, type RunResult } from './runner';
export { MCPClient, mcpServersToTools } from './mcp-client';
export type { ToolDefinition, ToolResult, MessagePart, UserMessage } from './types';
// Re-export generateText so server-side modules can do one-shot LLM calls
// without depending on the `ai` package directly.
export { generateText } from 'ai';
