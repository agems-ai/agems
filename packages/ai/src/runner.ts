import { generateText, streamText, tool, jsonSchema, stepCountIs } from 'ai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createProvider, type AIProviderConfig } from './provider';
import { mcpServersToTools } from './mcp-client';
import type { ToolDefinition, ToolResult, UserMessage } from './types';

export type { MCPServerConfig } from './mcp-client';
import type { MCPServerConfig } from './mcp-client';

export interface AgentRunnerConfig {
  provider: AIProviderConfig;
  systemPrompt: string;
  tools?: ToolDefinition[];
  maxIterations?: number;
  maxTokens?: number;
  temperature?: number;
  thinkingBudget?: number;
  mcpServers?: MCPServerConfig[];
}

export interface StreamCallbacks {
  onThinkingChunk?: (chunk: string) => void;
  onTextChunk?: (chunk: string) => void;
}

export interface RunResult {
  text: string;
  thinking: string[];
  toolCalls: ToolResult[];
  tokensUsed: { input: number; output: number };
  iterations: number;
  loopDetected?: boolean;
}

/**
 * Detects tool call loops using a sliding window with hash-based deduplication.
 * Inspired by OpenClaw's circuit breaker pattern.
 */
class ToolLoopDetector {
  private window: string[] = [];
  private readonly windowSize: number;
  private readonly threshold: number;

  constructor(windowSize = 20, threshold = 4) {
    this.windowSize = windowSize;
    this.threshold = threshold;
  }

  /** Returns true if a loop is detected */
  check(toolName: string, params: unknown): boolean {
    // Simple string fingerprint -- no crypto dependency needed
    const hash = toolName + ':' + JSON.stringify(params);

    this.window.push(hash);
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }

    // Count occurrences of this exact call in the window
    const count = this.window.filter(h => h === hash).length;
    if (count >= this.threshold) return true;

    // Ping-pong detection: A-B-A-B pattern (2 alternating calls)
    if (this.window.length >= 4) {
      const last4 = this.window.slice(-4);
      if (last4[0] === last4[2] && last4[1] === last4[3] && last4[0] !== last4[1]) {
        // Check if this pattern has been going on for 6+ calls
        if (this.window.length >= 6) {
          const last6 = this.window.slice(-6);
          if (last6[0] === last6[2] && last6[2] === last6[4] &&
              last6[1] === last6[3] && last6[3] === last6[5]) {
            return true;
          }
        }
      }
    }

    return false;
  }
}

/**
 * AgentRunner -- executes an agent task using the LLM with tool loop.
 * 1. Send message to LLM
 * 2. If LLM calls tool -> execute tool -> feed result back -> loop
 * 3. If LLM returns text -> done
 */
export class AgentRunner {
  private model: ReturnType<typeof createProvider>;
  private config: AgentRunnerConfig;

  constructor(config: AgentRunnerConfig) {
    this.config = config;
    this.model = createProvider(config.provider);
  }

  private buildCommon(toolsMap: Record<string, any>, maxSteps: number) {
    const isGeminiThinking = this.config.provider.provider === 'GOOGLE'
      && /gemini-3/i.test(this.config.provider.model);
    const isAnthropicFormat = this.config.provider.provider === 'ANTHROPIC' || this.config.provider.apiFormat === 'anthropic';
    const isAnthropicThinking = isAnthropicFormat
      && (/opus|sonnet|MiniMax/i.test(this.config.provider.model));

    const providerOptions: Record<string, any> = {};
    if (isGeminiThinking) {
      const gemBudget = this.config.thinkingBudget ?? 8000;
      providerOptions.google = { thinkingConfig: { thinkingBudget: gemBudget } };
    }
    if (isAnthropicThinking) {
      const budget = this.config.thinkingBudget ?? 4000;
      if (budget > 0) {
        providerOptions.anthropic = { thinking: { type: 'enabled', budgetTokens: budget } };
      }
    }
    // MCP servers: only use Anthropic remote MCP for publicly accessible URLs.
    // Internal Docker URLs (e.g. http://playwright-mcp:3002) are handled by MCPClient instead.
    if (this.config.provider.provider === 'ANTHROPIC' && this.config.mcpServers?.length) {
      const publicServers = this.config.mcpServers.filter(s => {
        const url = s.url || '';
        return url.startsWith('https://') && !url.includes('localhost') && !url.includes('127.0.0.1');
      });
      if (publicServers.length > 0) {
        if (!providerOptions.anthropic) providerOptions.anthropic = {};
        providerOptions.anthropic.mcpServers = publicServers.map(s => ({
          type: 'url' as const,
          name: s.name,
          url: s.url,
          authorizationToken: s.authorizationToken ?? undefined,
          toolConfiguration: s.toolConfiguration ?? undefined,
        }));
      }
    }

    // For Anthropic: wrap system prompt with cacheControl to enable prompt caching.
    // The provider must be created with cacheControl: true (see provider.ts).
    // Other providers receive the plain string — they ignore the structured format.
    const systemPromptText = this.config.systemPrompt || '';
    const isAnthropic = isAnthropicFormat;
    const system: any = isAnthropic
      ? [
          {
            role: 'system' as const,
            content: systemPromptText,
            providerOptions: {
              anthropic: { cacheControl: { type: 'ephemeral' } },
            },
          },
        ]
      : systemPromptText;

    return {
      model: this.model,
      system,
      tools: toolsMap,
      stopWhen: stepCountIs(maxSteps),
      maxTokens: this.config.maxTokens ?? 4096,
      ...(isAnthropicThinking ? {} : { temperature: this.config.temperature ?? 0.7 }),
      ...(Object.keys(providerOptions).length > 0 && { providerOptions }),
      repairToolCall: async ({ toolCall, error }: any) => {
        // Fix invalid tool_use input (e.g. string instead of object)
        const input = toolCall.args && typeof toolCall.args === 'object' ? toolCall.args : {};
        return { ...toolCall, args: input };
      },
    };
  }

  private buildToolsMap(toolResults: ToolResult[], loopDetector: ToolLoopDetector, loopRef: { detected: boolean }, abortSignal?: AbortSignal) {
    const needsJsonSchema = ['DEEPSEEK', 'MISTRAL', 'OLLAMA', 'CUSTOM'].includes(this.config.provider.provider);
    const toolsMap: Record<string, any> = {};
    for (const td of this.config.tools ?? []) {
      const schema = needsJsonSchema && td.parameters?._def
        ? jsonSchema(zodToJsonSchema(td.parameters as any, { target: 'openApi3' }) as any)
        : td.parameters;
      toolsMap[td.name] = tool({
        description: td.description,
        inputSchema: schema as any,
        execute: async (params: any) => {
          // Check abort signal before executing tool
          if (abortSignal?.aborted) {
            const msg = 'Execution stopped by user';
            toolResults.push({ toolName: td.name, input: params, output: null, durationMs: 0, error: msg });
            throw new Error(msg);
          }
          if (loopDetector.check(td.name, params)) {
            loopRef.detected = true;
            const msg = `Loop detected: "${td.name}" has been called repeatedly with the same parameters. Stop calling this tool and respond with what you have.`;
            toolResults.push({ toolName: td.name, input: params, output: null, durationMs: 0, error: msg });
            return { error: msg, loop_detected: true };
          }
          const start = Date.now();
          try {
            const output = await td.execute(params);
            // Check abort signal after tool execution
            if (abortSignal?.aborted) {
              toolResults.push({ toolName: td.name, input: params, output, durationMs: Date.now() - start });
              throw new Error('Execution stopped by user');
            }
            toolResults.push({ toolName: td.name, input: params, output, durationMs: Date.now() - start });
            return output;
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            toolResults.push({ toolName: td.name, input: params, output: null, durationMs: Date.now() - start, error });
            if (abortSignal?.aborted) throw err;
            return { error };
          }
        },
      });
    }
    return toolsMap;
  }

  private extractThinking(result: any, text: string): { thinking: string[]; cleanText: string } {
    const thinking: string[] = [];

    // 1. AI SDK reasoning (Anthropic extended thinking & Google Gemini thinking)
    for (const step of result.steps ?? []) {
      const reasoning = (step as any).reasoning;
      if (reasoning && typeof reasoning === 'string' && reasoning.trim()) {
        thinking.push(reasoning.trim());
      }
      // Google Gemini: reasoning may be in response.messages content parts
      const msgs = (step as any).response?.messages ?? [];
      for (const msg of msgs) {
        if (!Array.isArray(msg.content)) continue;
        for (const part of msg.content) {
          if (part.type === 'reasoning' && part.text?.trim()) {
            if (!thinking.includes(part.text.trim())) thinking.push(part.text.trim());
          }
        }
      }
    }
    if ((result as any).reasoning && typeof (result as any).reasoning === 'string') {
      const r = (result as any).reasoning.trim();
      if (r && !thinking.includes(r)) thinking.push(r);
    }

    // 2. <think>...</think> blocks (DeepSeek, GLM, etc.)
    for (const step of result.steps ?? []) {
      const stepText = step.text ?? '';
      const thinkMatches = stepText.match(/<think>([\s\S]*?)<\/think>/g);
      if (thinkMatches) {
        for (const match of thinkMatches) {
          const content = match.replace(/<\/?think>/g, '').trim();
          if (content) thinking.push(content);
        }
      }
    }
    let cleanText = text;
    if (cleanText) {
      const finalThinkMatches = cleanText.match(/<think>([\s\S]*?)<\/think>/g);
      if (finalThinkMatches) {
        for (const match of finalThinkMatches) {
          const content = match.replace(/<\/?think>/g, '').trim();
          if (content) thinking.push(content);
        }
        cleanText = cleanText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      }
    }

    return { thinking, cleanText };
  }

  async run(input: string | UserMessage[], abortSignal?: AbortSignal, streamCallbacks?: StreamCallbacks): Promise<RunResult> {
    // Resolve MCP servers into regular tools via MCPClient
    // For Anthropic: only internal/Docker URLs (public ones go through native MCP)
    // For others: all MCP servers
    if (this.config.mcpServers?.length) {
      const isAnthropic = this.config.provider.provider === 'ANTHROPIC' || this.config.provider.apiFormat === 'anthropic';
      const serversToResolve = isAnthropic
        ? this.config.mcpServers.filter(s => {
            const url = s.url || '';
            return !url.startsWith('https://') || url.includes('localhost') || url.includes('127.0.0.1');
          })
        : this.config.mcpServers;
      if (serversToResolve.length > 0) {
        try {
          const mcpTools = await mcpServersToTools(serversToResolve);
          this.config.tools = [...(this.config.tools || []), ...mcpTools];
        } catch (err) {
          console.warn(`[MCP] Failed to resolve MCP tools: ${err}`);
        }
      }
    }

    const maxSteps = this.config.maxIterations ?? 50;
    const toolResults: ToolResult[] = [];
    const loopDetector = new ToolLoopDetector();
    const loopRef = { detected: false };

    const toolsMap = this.buildToolsMap(toolResults, loopDetector, loopRef, abortSignal);
    const common = this.buildCommon(toolsMap, maxSteps);

    // Use streamText when callbacks provided, generateText otherwise
    if (streamCallbacks?.onThinkingChunk || streamCallbacks?.onTextChunk) {
      return this.runStream(input, common, toolResults, loopRef, abortSignal, streamCallbacks);
    }

    const result = typeof input === 'string'
      ? await generateText({ ...common, prompt: input, abortSignal } as any)
      : await generateText({ ...common, messages: input as any, abortSignal } as any);

    const { thinking, cleanText } = this.extractThinking(result, result.text);
    let text = cleanText;

    if (!text?.trim() && toolResults.length > 0) {
      const errors = toolResults.filter(t => t.error);
      if (errors.length > 0) {
        text = `I encountered issues while processing your request. ${errors.map(e => `Tool "${e.toolName}" failed: ${e.error}`).join('. ')}. Please try rephrasing your question.`;
      }
    }

    return {
      text,
      thinking,
      toolCalls: toolResults,
      tokensUsed: { input: result.usage?.inputTokens ?? 0, output: result.usage?.outputTokens ?? 0 },
      iterations: result.steps?.length ?? 1,
      loopDetected: loopRef.detected,
    };
  }

  private async runStream(
    input: string | UserMessage[],
    common: any,
    toolResults: ToolResult[],
    loopRef: { detected: boolean },
    abortSignal?: AbortSignal,
    callbacks?: StreamCallbacks,
  ): Promise<RunResult> {
    const streamArgs = typeof input === 'string'
      ? { ...common, prompt: input, abortSignal }
      : { ...common, messages: input, abortSignal };

    const result = streamText(streamArgs as any);

    // Stream reasoning and text chunks to callbacks
    let fullText = '';
    let inThinkBlock = false;
    let thinkBuffer = '';
    const streamedThinking: string[] = [];

    const seenPartTypes = new Set<string>();
    for await (const part of result.fullStream) {
      if (abortSignal?.aborted) break;

      // Debug: log part types and metadata
      if (!seenPartTypes.has(part.type)) {
        seenPartTypes.add(part.type);
        const meta = (part as any).providerMetadata;
        const metaStr = meta ? JSON.stringify(meta).substring(0, 200) : 'none';
        console.log(`[AI-STREAM] part.type="${part.type}" keys=${Object.keys(part).join(',')} meta=${metaStr}`);
      }
      // Log first text-start with full details
      if (part.type === 'text-start' && !seenPartTypes.has('text-start-detail')) {
        seenPartTypes.add('text-start-detail');
        console.log(`[AI-STREAM] text-start FULL:`, JSON.stringify(part).substring(0, 500));
      }
      // Log finish-step details and extract Google thinking from providerMetadata
      if (part.type === 'finish-step' && !seenPartTypes.has('finish-step-detail')) {
        seenPartTypes.add('finish-step-detail');
        const meta = (part as any).providerMetadata;
        if (meta) console.log(`[AI-STREAM] finish-step providerMetadata:`, JSON.stringify(meta).substring(0, 500));
        const resp = (part as any).response;
        if (resp?.messages) {
          for (const m of resp.messages) {
            if (Array.isArray(m.content)) {
              const types = m.content.map((c: any) => `${c.type}(${Object.keys(c).join(',')})`).join(', ');
              console.log(`[AI-STREAM] finish-step msg content: ${types}`);
            }
          }
        }
        // Extract Google thinking from providerMetadata
        const googleMeta = meta?.google;
        const thoughtsField = googleMeta?.groundingMetadata?.thoughts || googleMeta?.thoughts;
        if (thoughtsField) {
          console.log(`[AI-STREAM] GOOGLE THOUGHTS FOUND in metadata`);
          const chunk = typeof thoughtsField === 'string' ? thoughtsField : JSON.stringify(thoughtsField);
          callbacks?.onThinkingChunk?.(chunk);
          thinkBuffer += chunk;
        }
      }

      if (part.type === 'reasoning-delta' || (part as any).type === 'reasoning') {
        // Anthropic extended thinking & Google Gemini thinking — stream directly
        const chunk = (part as any).textDelta || (part as any).text || (part as any).content || '';
        if (chunk) {
          callbacks?.onThinkingChunk?.(chunk);
          thinkBuffer += chunk;
        }
      } else if (part.type === 'text-delta') {
        const delta = (part as any).textDelta ?? '';
        if (!delta) continue;

        // Handle <think>...</think> blocks inline (DeepSeek etc.)
        if (inThinkBlock) {
          const endIdx = delta.indexOf('</think>');
          if (endIdx >= 0) {
            const thinkPart = delta.substring(0, endIdx);
            thinkBuffer += thinkPart;
            callbacks?.onThinkingChunk?.(thinkPart);
            inThinkBlock = false;
            const textPart = delta.substring(endIdx + 8);
            if (textPart) {
              fullText += textPart;
              callbacks?.onTextChunk?.(textPart);
            }
          } else {
            thinkBuffer += delta;
            callbacks?.onThinkingChunk?.(delta);
          }
        } else {
          const startIdx = delta.indexOf('<think>');
          if (startIdx >= 0) {
            const textBefore = delta.substring(0, startIdx);
            if (textBefore) {
              fullText += textBefore;
              callbacks?.onTextChunk?.(textBefore);
            }
            inThinkBlock = true;
            const afterTag = delta.substring(startIdx + 7);
            if (afterTag) {
              thinkBuffer += afterTag;
              callbacks?.onThinkingChunk?.(afterTag);
            }
          } else {
            fullText += delta;
            callbacks?.onTextChunk?.(delta);
          }
        }
      }
      // step-start, step-finish, tool-call, tool-result are handled by AI SDK internally
    }

    // Collect final result
    const finalResult = await result.response;
    const usage = await result.usage;
    const steps = await result.steps;

    if (thinkBuffer.trim()) {
      streamedThinking.push(thinkBuffer.trim());
    }

    // Also extract from steps (for non-streamed reasoning from earlier steps)
    const { thinking: stepsThinking, cleanText } = this.extractThinking(
      { steps, reasoning: (finalResult as any).reasoning },
      fullText || (await result.text),
    );

    // Merge: streamed thinking first, then any from steps not already captured
    const allThinking = [...streamedThinking];
    for (const t of stepsThinking) {
      if (!allThinking.some(s => s.includes(t.substring(0, 50)))) {
        allThinking.push(t);
      }
    }

    let text = cleanText || fullText;
    if (!text?.trim() && toolResults.length > 0) {
      const errors = toolResults.filter(t => t.error);
      if (errors.length > 0) {
        text = `I encountered issues while processing your request. ${errors.map(e => `Tool "${e.toolName}" failed: ${e.error}`).join('. ')}. Please try rephrasing your question.`;
      }
    }

    return {
      text,
      thinking: allThinking,
      toolCalls: toolResults,
      tokensUsed: { input: usage?.inputTokens ?? 0, output: usage?.outputTokens ?? 0 },
      iterations: steps?.length ?? 1,
      loopDetected: loopRef.detected,
    };
  }
}
