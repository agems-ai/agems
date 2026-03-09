// Common types used across AGEMS platform

export type ActorType = 'AGENT' | 'HUMAN' | 'SYSTEM';

export type LLMProvider =
  | 'ANTHROPIC'
  | 'OPENAI'
  | 'GOOGLE'
  | 'DEEPSEEK'
  | 'MISTRAL'
  | 'OLLAMA'
  | 'CUSTOM';

export type AgentType = 'AUTONOMOUS' | 'ASSISTANT' | 'META' | 'REACTIVE';

export type AgentStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ERROR' | 'ARCHIVED';

export type RuntimeMode = 'CLAUDE_CODE' | 'N8N' | 'API' | 'CUSTOM';

export type TaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'IN_TESTING'
  | 'VERIFIED'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'CANCELLED';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type Permission = 'READ' | 'WRITE' | 'EXECUTE' | 'ADMIN';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
