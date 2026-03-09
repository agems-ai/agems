import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType;
  execute: (params: unknown) => Promise<unknown>;
}

export interface ToolResult {
  toolName: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  error?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Multimodal message content parts */
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: Uint8Array | string; mimeType?: string };

/** A single message in a multimodal conversation */
export interface UserMessage {
  role: 'user' | 'assistant';
  content: string | MessagePart[];
}
