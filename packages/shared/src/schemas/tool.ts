import { z } from 'zod';

export const createToolSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['MCP_SERVER', 'REST_API', 'GRAPHQL', 'DATABASE', 'WEBHOOK', 'WEBSOCKET', 'GRPC', 'S3_STORAGE', 'N8N', 'DIGITALOCEAN', 'SSH']),
  config: z.record(z.unknown()), // URL, headers, etc.
  authType: z.enum(['NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC', 'OAUTH2', 'CUSTOM']).optional(),
  authConfig: z.record(z.unknown()).optional(),
});

export const createSkillSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  description: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/), // semver
  type: z.enum(['BUILTIN', 'PLUGIN', 'CUSTOM']),
  entryPoint: z.string(),
  configSchema: z.record(z.unknown()).optional(),
});

export const assignToolSchema = z.object({
  agentId: z.string().uuid(),
  toolId: z.string().uuid(),
  permissions: z.object({
    read: z.boolean().default(true),
    write: z.boolean().default(false),
    execute: z.boolean().default(true),
  }),
});

export type CreateToolInput = z.infer<typeof createToolSchema>;
export type CreateSkillInput = z.infer<typeof createSkillSchema>;
export type AssignToolInput = z.infer<typeof assignToolSchema>;
