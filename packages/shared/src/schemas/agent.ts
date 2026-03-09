import { z } from 'zod';

// ── LLM Configuration ──────────────────────────────
export const llmConfigSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(1).max(200000).default(4096),
  topP: z.number().min(0).max(1).optional(),
  stopSequences: z.array(z.string()).optional(),
});

// ── Agent Tool Definition ──────────────────────────
export const toolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.unknown()), // JSON Schema
});

// ── Runtime Configuration (Eden-like) ──────────────
export const runtimeConfigSchema = z.object({
  mode: z.enum(['CLAUDE_CODE', 'N8N', 'API', 'CUSTOM']).default('CLAUDE_CODE'),
  maxIterations: z.number().min(1).max(100).default(50),
  timeoutMs: z.number().min(1000).max(600000).default(120000),
  // Claude Code mode settings
  allowedCommands: z.array(z.string()).optional(), // bash command whitelist
  blockedCommands: z.array(z.string()).optional(), // bash command blacklist
  workingDirectory: z.string().optional(),
  // n8n mode settings
  n8nApiUrl: z.string().url().optional(),
  n8nApiKey: z.string().optional(),
  // AGEMS self-management (agent can manage AGEMS platform)
  agemsApiAccess: z.boolean().optional(),       // Can this agent call AGEMS's own API?
  agemsPermissions: z.array(z.enum([
    'agents.read', 'agents.write', 'agents.create', 'agents.delete',
    'tasks.read', 'tasks.write', 'tasks.create',
    'meetings.read', 'meetings.write', 'meetings.create',
    'comms.read', 'comms.write',
    'tools.read', 'tools.write',
    'org.read', 'org.write',
  ])).optional(),
  // Rate limits
  maxTokensPerMinute: z.number().optional(),
  maxApiCallsPerMinute: z.number().optional(),
  maxCostPerDay: z.number().optional(), // USD
});

// ── Telegram Config (per agent) ────────────────────
export const telegramConfigSchema = z.object({
  // Bot mode
  botToken: z.string().optional(),
  botEnabled: z.boolean().optional(),
  accessMode: z.enum(['OPEN', 'WHITELIST']).optional(),
  allowedChatIds: z.array(z.number()).optional(),
  // Voice
  voiceEnabled: z.boolean().optional(),
  ttsVoice: z.string().optional(),
  // Account mode (MTProto — like Telethon)
  apiId: z.number().optional(),
  apiHash: z.string().optional(),
  sessionString: z.string().optional(),
});

// ── Create Agent ───────────────────────────────────
export const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  avatar: z.string().optional(),
  type: z.enum(['AUTONOMOUS', 'ASSISTANT', 'META', 'REACTIVE']).default('AUTONOMOUS'),

  // LLM
  llmProvider: z.enum(['ANTHROPIC', 'OPENAI', 'GOOGLE', 'DEEPSEEK', 'MISTRAL', 'OLLAMA', 'CUSTOM']),
  llmModel: z.string().min(1),
  llmConfig: llmConfigSchema.optional(),

  // Mission
  systemPrompt: z.string().min(1),
  mission: z.string().optional(),
  values: z.array(z.string()).optional(),

  // Runtime (Eden-like execution)
  runtimeConfig: runtimeConfigSchema.optional(),

  // Telegram integration
  telegramConfig: telegramConfigSchema.optional(),

  metadata: z.record(z.unknown()).optional(),
});

// ── Update Agent ───────────────────────────────────
export const updateAgentSchema = createAgentSchema.partial();

// ── Agent Filters ──────────────────────────────────
export const agentFiltersSchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ERROR', 'ARCHIVED']).optional(),
  type: z.enum(['AUTONOMOUS', 'ASSISTANT', 'META', 'REACTIVE']).optional(),
  llmProvider: z.enum(['ANTHROPIC', 'OPENAI', 'GOOGLE', 'DEEPSEEK', 'MISTRAL', 'OLLAMA', 'CUSTOM']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

// ── Types ──────────────────────────────────────────
export type LLMConfig = z.infer<typeof llmConfigSchema>;
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type TelegramConfig = z.infer<typeof telegramConfigSchema>;
export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type AgentFilters = z.infer<typeof agentFiltersSchema>;
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;
