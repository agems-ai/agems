import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { SettingsService } from '../settings/settings.service';
import { N8nService } from '../n8n/n8n.service';
import { CommsService } from '../comms/comms.service';
import { TelegramAccountService } from '../telegram/telegram-account.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { categorizeToolName } from '../approvals/tool-categories';
import { AgentRunner, type MCPServerConfig, type RunResult, type UserMessage, type MessagePart } from '@agems/ai';
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { join, resolve } from 'path';
import { decryptJson } from '../../common/crypto.util';
import { RedisLockService } from '../../common/redis-lock.service';
import { BrowserService } from './browser.service';

@Injectable()
export class RuntimeService {
  private readonly logger = new Logger(RuntimeService.name);
  /** Abort controllers for running executions — keyed by executionId */
  private readonly abortControllers = new Map<string, AbortController>();
  /** Maps channelId → Set of executionIds for targeted channel stopping */
  private readonly channelExecutionMap = new Map<string, Set<string>>();

  // Redis queue TTL (seconds)
  private readonly QUEUE_TTL_SECONDS = 5 * 60; // 5 minutes
  private readonly EXECUTION_STOP_TTL_SECONDS = 10 * 60; // 10 minutes
  private readonly STOP_POLL_INTERVAL_MS = 1000;

  /** In-memory cache of buildSystemPrompt() result, keyed by agentId. TTL configurable via setting `system_prompt_cache_seconds` (default 60s). */
  private readonly systemPromptCache = new Map<string, { prompt: string; ts: number }>();
  private readonly DEFAULT_SYSTEM_PROMPT_CACHE_MS = 60_000;
  private readonly DEFAULT_MEMORY_KNOWLEDGE_LIMIT = 10;
  private readonly DEFAULT_MEMORY_CONVERSATION_LIMIT = 5;
  private readonly DEFAULT_MAX_ITERATIONS = 40;

  private invalidateSystemPromptCache(agentId: string) {
    this.systemPromptCache.delete(agentId);
  }

  @OnEvent('agent.updated')
  onAgentUpdated(payload: { id: string }) {
    if (payload?.id) this.invalidateSystemPromptCache(payload.id);
  }

  /** Read a numeric setting (system-wide), falling back to default. */
  private async getNumericSetting(key: string, fallback: number): Promise<number> {
    try {
      const raw = await this.settings.get(key);
      const parsed = parseInt(String(raw ?? ''), 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {}
    return fallback;
  }

  /** Resolve a numeric runtime limit: agent.runtimeConfig override → system setting → default. */
  private async resolveRuntimeLimit(
    runtimeConfig: Record<string, unknown>,
    field: string,
    settingKey: string,
    fallback: number,
  ): Promise<number> {
    const fromAgent = runtimeConfig[field];
    if (typeof fromAgent === 'number' && Number.isFinite(fromAgent) && fromAgent > 0) return fromAgent;
    if (typeof fromAgent === 'string') {
      const parsed = parseInt(fromAgent, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return this.getNumericSetting(settingKey, fallback);
  }

  private hasHostAccessEnabled(runtimeConfig: Record<string, unknown>) {
    return runtimeConfig.allowHostAccess === true;
  }

  private getHostWorkspaceRoot(runtimeConfig: Record<string, unknown>) {
    return resolve((runtimeConfig.workingDirectory as string) || process.cwd());
  }

  private resolveWorkspacePath(targetPath: string, runtimeConfig: Record<string, unknown>) {
    const workspaceRoot = this.getHostWorkspaceRoot(runtimeConfig);
    const resolvedPath = resolve(targetPath);
    if (resolvedPath !== workspaceRoot && !resolvedPath.startsWith(workspaceRoot + '\\') && !resolvedPath.startsWith(workspaceRoot + '/')) {
      throw new Error(`Path "${targetPath}" is outside the allowed workspace`);
    }
    return resolvedPath;
  }

  constructor(
    private prisma: PrismaService,
    private agentsService: AgentsService,
    private settings: SettingsService,
    private n8n: N8nService,
    private comms: CommsService,
    private events: EventEmitter2,
    @Inject(forwardRef(() => TelegramAccountService))
    private telegramAccount: TelegramAccountService,
    @Inject(forwardRef(() => ApprovalsService))
    private approvals: ApprovalsService,
    private dashboard: DashboardService,
    private redisLock: RedisLockService,
    private browserService: BrowserService,
  ) {}

  /** Pending browser sessions — started lazily on first browser tool call */
  private readonly pendingBrowserSessions = new Map<string, { agentId: string; agentName: string; channelId?: string }>();

  /** Start browser session on-demand (called when agent uses a browser tool) */
  async ensureBrowserSession(executionId: string): Promise<void> {
    const pending = this.pendingBrowserSessions.get(executionId);
    if (!pending) return;
    this.pendingBrowserSessions.delete(executionId);
    const browserSession = await this.browserService.startSession(executionId, pending.agentId, pending.channelId);
    if (browserSession) {
      this.logger.log(`Browser session started on-demand for ${pending.agentName}`);
    }
  }

  // ========== Redis queue helpers ==========
  private async enqueueMessage(channelId: string, message: any): Promise<void> {
    const queueKey = `channel:${channelId}:queue`;
    const serialized = JSON.stringify({ channelId, message });
    const client = this.redisLock.getClient();
    await client.lpush(queueKey, serialized);
    await client.expire(queueKey, this.QUEUE_TTL_SECONDS);
  }

  private async dequeueLastMessage(channelId: string): Promise<{ channelId: string; message: any } | null> {
    const queueKey = `channel:${channelId}:queue`;
    const client = this.redisLock.getClient();
    const raw = await client.lpop(queueKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private getExecutionStopKey(executionId: string): string {
    return `execution:${executionId}:stop`;
  }

  private getChannelStopKey(channelId: string): string {
    return `channel:${channelId}:stop`;
  }

  /** Handle stop execution request from UI */
  @OnEvent('agent.execution.stop')
  async handleStopExecution(payload: { channelId?: string; executionId?: string }) {
    if (payload.executionId) {
      const stopped = await this.stopExecution(payload.executionId);
      this.logger.log(`Stop execution ${payload.executionId}: ${stopped ? 'stopped' : 'not found'}`);
    } else {
      const stopped = await this.stopChannel(payload.channelId || '');
      this.logger.log(`Stop all executions in channel ${payload.channelId}: ${stopped} stopped`);
    }
  }

  /** Default max agent-to-agent rounds per channel per window if no setting is set. */
  private readonly DEFAULT_MAX_AGENT_EXCHANGES = 6;
  private readonly AGENT_EXCHANGE_WINDOW_MS = 10 * 60 * 1000; // 10 minute window (extended to reduce chatter density)

  /** Read MAX_AGENT_EXCHANGES from settings (key: max_agent_exchanges_per_window). Falls back to default if missing/invalid. */
  private async getMaxAgentExchanges(): Promise<number> {
    try {
      const raw = await this.settings.get('max_agent_exchanges_per_window');
      const parsed = parseInt(String(raw ?? ''), 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {}
    return this.DEFAULT_MAX_AGENT_EXCHANGES;
  }

  /** When a message arrives, trigger agent responses */
  @OnEvent('message.new')
  async handleChannelMessage(payload: { channelId: string; message: any }) {
    const { channelId, message } = payload;

    // SYSTEM messages never trigger agents
    if (message.senderType === 'SYSTEM') return;

    // Agent-to-agent loop prevention (Redis-backed for multi-instance support)
    if (message.senderType === 'AGENT') {
      const exchKey = `a2a:${channelId}`;
      const count = await this.redisLock.incrementWithTtl(exchKey, this.AGENT_EXCHANGE_WINDOW_MS);
      const maxExchanges = await this.getMaxAgentExchanges();
      if (count > maxExchanges) {
        this.logger.debug(`Agent-to-agent limit reached in channel ${channelId}, skipping`);
        return;
      }
    }

    // Execution queue guard: use Redis distributed lock for multi-instance support
    const lockKey = `channel:${channelId}`;
    const releaseLock = await this.redisLock.tryAcquire(lockKey, 5 * 60 * 1000); // 5 min TTL
    if (!releaseLock) {
      this.logger.log(`Queuing message in channel ${channelId} — agents are already executing`);
      await this.enqueueMessage(channelId, message);
      return;
    }

    // Check if comms module is enabled for this channel's org
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { orgId: true },
    });
    if (channel?.orgId && !(await this.settings.isModuleEnabled('comms', channel.orgId))) {
      await releaseLock();
      return;
    }

    // Find active agent participants
    const participants = await this.prisma.channelParticipant.findMany({
      where: { channelId, participantType: 'AGENT' },
    });
    if (participants.length === 0) { await releaseLock(); return; }

    const agents: any[] = [];
    for (const p of participants) {
      try {
        // Skip sender agent — don't let agent respond to itself
        if (message.senderType === 'AGENT' && p.participantId === message.senderId) continue;
        const agent = await this.agentsService.findOne(p.participantId);
        if (agent.status === 'ACTIVE') agents.push(agent);
        } catch (err: any) {
          this.logger.warn(`Failed to load channel agent ${p.participantId}: ${err?.message || err}`);
        }
    }
    if (agents.length === 0) { await releaseLock(); return; }

    try {
      // Sequential dialogue: each agent sees previous agents' replies
      // For agent-to-agent: only 1 round to prevent loops
      // For human messages: 2 rounds so agents can react to each other
      const maxRounds = 1; // always 1 round — prevents circular agent-to-agent discussions

      for (let round = 0; round < maxRounds; round++) {
        for (const agent of agents) {
          try {
            let context = await this.buildConversationContext(channelId, agent, agents);

            // Strip image parts for non-vision providers (DeepSeek, Mistral, etc.)
            const nonVisionProviders = ['DEEPSEEK', 'MISTRAL', 'MINIMAX', 'GLM', 'COHERE', 'TOGETHER', 'FIREWORKS', 'GROQ', 'MOONSHOT', 'QWEN', 'AI21', 'SAMBANOVA', 'OLLAMA'];
            if (nonVisionProviders.includes(agent.llmProvider)) {
              context = context.map(msg => {
                if (Array.isArray(msg.content)) {
                  const textParts = msg.content
                    .map((p: any) => p.type === 'text' ? p.text : `[Image: ${p.mimeType || 'image'}]`)
                    .join('\n');
                  return { ...msg, content: textParts };
                }
                return msg;
              });
            }

            const result = await this.execute(
              agent.id,
              context,
              { type: 'MESSAGE', id: channelId },
              { channelId },
            );

            // If waiting for approval, skip sending a reply (the approval card handles communication)
            if (result.waitingForApproval) continue;

            // If model returned empty text, try to produce a fallback from tool errors
            let replyText = result.text?.trim() || '';
            if (!replyText && result.toolCalls?.length) {
              const errors = result.toolCalls.filter((tc: any) => tc.error);
              if (errors.length > 0) {
                replyText = `I encountered issues while processing your request. ${errors.map((e: any) => e.error).join('. ')}. Let me try a different approach — could you rephrase your question?`;
              }
            }
            // Strip "[AgentName]: " prefix that LLM may echo from context
            const namePrefix = new RegExp(`^\\[${agent.name}\\]:\\s*`, 'i');
            while (namePrefix.test(replyText)) {
              replyText = replyText.replace(namePrefix, '').trim();
            }
            if (!replyText) {
              this.logger.warn(`Agent ${agent.name ?? agent.id} returned empty response in channel ${channelId}`);
              continue;
            }

            // Send agent's reply to the channel with execution metadata
            // Separate skill calls from tool calls for UI display
            const allCalls = result.toolCalls || [];
            const skillCalls = allCalls.filter((tc: any) => tc.toolName === 'use_skill');
            const toolCalls = allCalls.filter((tc: any) => tc.toolName !== 'use_skill');

            const thinking = result.thinking || [];
            const loopDetected = result.loopDetected || false;
            const screenshots = (result as any).screenshots || [];
            const executionMeta = (skillCalls.length > 0 || toolCalls.length > 0 || thinking.length > 0 || screenshots.length > 0 || loopDetected || result.iterations > 1) ? {
              execution: {
                id: result.executionId,
                skills: skillCalls.map((tc: any) => tc.input?.skillName || tc.input?.skill_name || 'unknown'),
                toolCalls: toolCalls.map((tc: any) => ({
                  toolName: tc.toolName,
                  input: tc.input,
                  output: tc.output,
                  durationMs: tc.durationMs,
                  error: tc.error,
                })),
                thinking: thinking.length > 0 ? thinking : undefined,
                screenshots: screenshots.length > 0 ? screenshots : undefined,
                loopDetected: loopDetected || undefined,
                iterations: result.iterations,
                tokensUsed: result.tokensUsed,
              },
            } : undefined;

            await this.comms.sendMessage(
              channelId,
              { content: replyText, contentType: 'TEXT', metadata: executionMeta },
              'AGENT',
              agent.id,
            );

            // Auto-save conversation summary to memory (fire-and-forget)
            this.saveConversationSummary(agent.id, channelId, message, replyText).catch(() => {});
          } catch (err) {
            this.logger.error(`Agent ${agent.id} failed in channel ${channelId}: ${err}`);
          }
        }
      }
    } finally {
      await releaseLock();

      // Process the latest queued message if any arrived during execution
      const pending = await this.dequeueLastMessage(channelId);
      if (pending) {
        this.logger.log(`Processing queued message in channel ${channelId}`);
        // Use setImmediate to avoid deep recursion
        setImmediate(() => this.handleChannelMessage(pending));
      }
    }
  }

  /** Build conversation context with agent names so each agent sees the full dialogue */
  private async buildConversationContext(channelId: string, currentAgent: any, allAgents: any[]): Promise<UserMessage[]> {
    const messages = await this.prisma.message.findMany({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const agentNames = new Map(allAgents.map(a => [a.id, a.name]));
    // Resolve uploads dir: works from both monorepo root and apps/api
    const cwd = process.cwd();
    const isMonorepoRoot = existsSync(join(cwd, 'apps', 'api')) && existsSync(join(cwd, 'apps', 'web'));
    const uploadsDir = isMonorepoRoot
      ? join(cwd, 'apps', 'web', 'public')
      : join(cwd, '..', 'web', 'public');

    const result: UserMessage[] = [];

    // Preamble message
    result.push({
      role: 'user',
      content: `You are ${currentAgent.name}. This conversation is happening in the AGEMS platform (internal company chat). Respond naturally to the latest messages. Be concise.`,
    });

    for (const m of messages.reverse()) {
      let sender: string;
      if (m.senderType === 'HUMAN') sender = 'Human';
      else if (m.senderType === 'SYSTEM') sender = 'System';
      else sender = agentNames.get(m.senderId) || 'Agent';

      const role: 'user' | 'assistant' = m.senderType === 'AGENT' && m.senderId === currentAgent.id ? 'assistant' : 'user';

      // Handle FILE messages with images
      if (m.contentType === 'FILE' && m.metadata) {
        const meta = m.metadata as any;
        const files = meta?.files as any[];
        if (files?.length) {
          // Assistant messages cannot contain image parts (Anthropic API restriction)
          // Only include image buffers for user-role messages
          if (role === 'assistant') {
            const textContent = meta.text || m.content;
            const fileDescs = files.map((f: any) =>
              f.mimetype?.startsWith('image/')
                ? `[Image: ${f.originalName || f.filename}]`
                : `[File: ${f.originalName || f.filename}]`
            ).join(' ');
            const label = textContent && textContent !== 'Sent files' ? textContent : fileDescs;
            result.push({ role, content: `[${sender}]: ${label}` });
            continue;
          }

          const parts: MessagePart[] = [];
          const textContent = meta.text || m.content;
          if (textContent && textContent !== 'Sent files') {
            parts.push({ type: 'text', text: `[${sender}]: ${textContent}` });
          } else {
            parts.push({ type: 'text', text: `[${sender}] sent file(s):` });
          }

          for (const f of files) {
            if (f.mimetype?.startsWith('image/')) {
              // Read image from disk and include as Buffer
              const filePath = join(uploadsDir, f.url);
              if (existsSync(filePath)) {
                try {
                  const buf = readFileSync(filePath);
                  parts.push({ type: 'image', image: buf, mimeType: f.mimetype });
                } catch {
                  parts.push({ type: 'text', text: `[Image: ${f.originalName || f.filename}]` });
                }
              } else {
                parts.push({ type: 'text', text: `[Image: ${f.originalName || f.filename}]` });
              }
            } else {
              // Non-image file — describe it as text
              parts.push({ type: 'text', text: `[File: ${f.originalName || f.filename} (${f.mimetype}, ${Math.round((f.size || 0) / 1024)}KB)]` });
            }
          }

          result.push({ role, content: parts });
          continue;
        }
      }

      // Regular text messages
      result.push({ role, content: `[${sender}]: ${m.content}` });
    }

    // Cross-platform memory: include recent Telegram conversations for this agent
    const telegramChats = await this.prisma.telegramChat.findMany({
      where: { agentId: currentAgent.id },
      select: { channelId: true, firstName: true },
    });
    for (const tgChat of telegramChats) {
      if (tgChat.channelId === channelId) continue;
      const tgMessages = await this.prisma.message.findMany({
        where: { channelId: tgChat.channelId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      if (tgMessages.length > 0) {
        const tgLines = tgMessages.reverse().map(m => {
          const sender = m.senderType === 'AGENT' ? currentAgent.name : (tgChat.firstName || 'User');
          return `[${sender}]: ${m.content}`;
        });
        // Insert after preamble but before current conversation
        result.splice(1, 0, {
          role: 'user',
          content: `[Previous conversation in Telegram with ${tgChat.firstName || 'a user'}]:\n${tgLines.join('\n')}\n[End of Telegram context]`,
        });
      }
    }

    // Optimize context: strip images from all messages except the last 2 that contain images
    // This saves tokens while preserving recent visual context
    let imageCount = 0;
    for (let i = result.length - 1; i >= 0; i--) {
      const msg = result[i];
      if (Array.isArray(msg.content)) {
        const hasImage = msg.content.some((p: any) => p.type === 'image');
        if (hasImage) {
          imageCount++;
          if (imageCount > 2) {
            // Replace image parts with text placeholders
            msg.content = msg.content.map((p: any) =>
              p.type === 'image'
                ? { type: 'text' as const, text: '[Earlier image omitted for context efficiency]' }
                : p,
            );
          }
        }
      }
    }

    // Merge consecutive same-role messages (required by most LLM APIs)
    const merged: UserMessage[] = [];
    for (const msg of result) {
      const prev = merged[merged.length - 1];
      if (prev && prev.role === msg.role) {
        // Merge content into previous message
        const prevText = typeof prev.content === 'string' ? prev.content : prev.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
        const currText = typeof msg.content === 'string' ? msg.content : msg.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
        // Keep image parts from both if any
        const prevImages = Array.isArray(prev.content) ? prev.content.filter((p: any) => p.type === 'image') : [];
        const currImages = Array.isArray(msg.content) ? msg.content.filter((p: any) => p.type === 'image') : [];
        const allImages = [...prevImages, ...currImages];
        if (allImages.length > 0) {
          prev.content = [{ type: 'text', text: prevText + '\n' + currText }, ...allImages];
        } else {
          prev.content = prevText + '\n' + currText;
        }
      } else {
        merged.push({ ...msg });
      }
    }

    // Ensure messages start with 'user' role (required by most APIs)
    if (merged.length > 0 && merged[0].role !== 'user') {
      merged.unshift({ role: 'user', content: 'Continue the conversation.' });
    }

    // Ensure last message is from user (add action reminder if last is assistant)
    if (merged.length > 0 && merged[merged.length - 1].role === 'assistant') {
      merged.push({ role: 'user', content: '[System: Respond to the above. If an action was requested, use tools NOW — do not write plans or promise future work.]' });
    }

    // Cross-channel context injection (if enabled in settings)
    try {
      const crossConfig = (await this.settings.getAllModulesConfig(currentAgent.orgId)).crossChannel;
      if (crossConfig.enabled && crossConfig.messageCount > 0) {
        const crossCtx = await this.buildCrossChannelContext(currentAgent.id, channelId, crossConfig.messageCount);
        if (crossCtx && merged.length > 1) {
          // Insert after first message (preamble) as a user message
          merged.splice(1, 0, { role: 'user', content: crossCtx });
        }
      }
    } catch (err) {
      this.logger.debug(`Failed to inject cross-channel context: ${err}`);
    }

    return merged;
  }

  /** Save a brief conversation summary to agent memory (cross-channel awareness) */
  private async saveConversationSummary(agentId: string, channelId: string, userMessage: any, agentResponse: string) {
    try {
      const channel = await this.prisma.channel.findUnique({
        where: { id: channelId },
        select: { name: true, type: true },
      });
      const senderName = userMessage.senderName || userMessage.senderId || 'someone';
      const userText = (userMessage.content || '').substring(0, 200);
      const agentText = (agentResponse || '').substring(0, 300);
      const summary = `[${channel?.name || 'channel'}] ${senderName}: "${userText}" → I responded: ${agentText}`;

      await this.prisma.agentMemory.create({
        data: {
          agentId,
          type: 'CONVERSATION',
          content: summary,
          metadata: { channelId, channelName: channel?.name, senderName, timestamp: new Date().toISOString() } as any,
        },
      });

      // Cleanup: keep only last 50 CONVERSATION memories per agent
      const allConv = await this.prisma.agentMemory.findMany({
        where: { agentId, type: 'CONVERSATION' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (allConv.length > 50) {
        const toDelete = allConv.slice(50).map(m => m.id);
        await this.prisma.agentMemory.deleteMany({ where: { id: { in: toDelete } } });
      }
    } catch (err) {
      this.logger.debug(`Failed to save conversation summary: ${err}`);
    }
  }

  /** Build cross-channel context: recent messages from agent's other channels */
  private async buildCrossChannelContext(agentId: string, currentChannelId: string, messageCount: number): Promise<string | null> {
    const participations = await this.prisma.channelParticipant.findMany({
      where: { participantId: agentId, participantType: 'AGENT', channelId: { not: currentChannelId } },
      select: { channelId: true },
    });
    if (participations.length === 0) return null;

    const channelIds = participations.map(p => p.channelId);
    const messages = await this.prisma.message.findMany({
      where: { channelId: { in: channelIds } },
      orderBy: { createdAt: 'desc' },
      take: messageCount,
      include: { channel: { select: { name: true } } },
    });
    if (messages.length === 0) return null;

    const lines = messages.reverse().map(m => {
      const sender = (m as any).senderName || m.senderId || 'unknown';
      const ch = (m.channel as any)?.name || 'channel';
      return `[${ch}] ${sender}: ${(m.content || '').substring(0, 200)}`;
    });

    return `[System: Recent activity in your OTHER channels for context. You participated in these conversations.]\n${lines.join('\n')}\n[End of cross-channel context]`;
  }

  /** Estimate token count for a message (~4 chars per token) */
  private estimateMessageTokens(msg: UserMessage): number {
    const content = typeof msg.content === 'string'
      ? msg.content
      : (msg.content as any[]).map((p: any) => p.type === 'text' ? p.text : '[image:1000tokens]').join(' ');
    return Math.ceil(content.length / 4);
  }

  /** Trim conversation context to fit within model's token limit */
  private trimContextToFit(messages: UserMessage[], provider: string, model: string): UserMessage[] {
    // Known context limits (tokens)
    const modelLimits: Record<string, number> = {
      'deepseek-chat': 131072,
      'deepseek-reasoner': 131072,
      'gpt-4-turbo': 128000,
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'claude-sonnet-4-20250514': 200000,
      'claude-opus-4-20250514': 200000,
    };
    const providerDefaults: Record<string, number> = {
      DEEPSEEK: 131072,
      OPENAI: 128000,
      ANTHROPIC: 200000,
      GOOGLE: 1048576,
      MISTRAL: 128000,
      MINIMAX: 1048576,
      GLM: 128000,
      XAI: 131072,
      COHERE: 128000,
      PERPLEXITY: 128000,
      TOGETHER: 131072,
      FIREWORKS: 131072,
      GROQ: 131072,
      MOONSHOT: 128000,
      QWEN: 131072,
      AI21: 256000,
      SAMBANOVA: 131072,
    };
    const contextLimit = modelLimits[model] || providerDefaults[provider] || 131072;
    // Reserve tokens for: system prompt (~5K), tools (~10K), output (~5K), safety margin
    const reserveTokens = 25000;
    const maxInputTokens = contextLimit - reserveTokens;

    let totalTokens = messages.reduce((sum, m) => sum + this.estimateMessageTokens(m), 0);

    if (totalTokens <= maxInputTokens) return messages;

    // Trim older messages (keep first=preamble + last 4 messages for recency)
    const trimmed = [...messages];
    const keepLast = 4;
    let removed = 0;
    while (totalTokens > maxInputTokens && trimmed.length > keepLast + 2) {
      // Remove second message (right after preamble)
      const msg = trimmed.splice(1, 1)[0];
      totalTokens -= this.estimateMessageTokens(msg);
      removed++;
    }

    if (removed > 0) {
      this.logger.warn(`Trimmed ${removed} older messages from context (est. tokens now: ${totalTokens}, limit: ${maxInputTokens})`);
      trimmed.splice(1, 0, {
        role: 'user' as const,
        content: `[System: ${removed} older messages were trimmed to fit the context window. Focus on the recent messages below.]`,
      });
    }

    return trimmed;
  }

  /** Force-finish a stuck meeting: generate summary and close */
  @OnEvent('meeting.force.finish')
  async handleForceFinishMeeting(payload: { meetingId: string }) {
    const { meetingId } = payload;
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { title: true, agenda: true, orgId: true, status: true, summary: true },
    });
    if (!meeting || meeting.status !== 'IN_PROGRESS') return;
    if (meeting.summary) {
      // Already has summary, just close
      await this.prisma.meeting.update({ where: { id: meetingId }, data: { status: 'COMPLETED', endedAt: new Date() } });
      return;
    }

    const participants = await this.prisma.meetingParticipant.findMany({
      where: { meetingId, participantType: 'AGENT' },
    });
    const agents: any[] = [];
    for (const p of participants) {
      try {
        const agent = await this.agentsService.findOne(p.participantId);
        if (agent.status === 'ACTIVE') agents.push(agent);
      } catch {}
    }

    this.logger.log(`Force-finishing meeting "${meeting.title}" with summary generation`);
    await this.generateMeetingSummary(meetingId, meeting, agents);
  }

  /** When a human adds a meeting entry, trigger agent participants to respond.
   *  Rounds and auto-finish are driven by module settings:
   *    Activity (1-5) → max rounds (1-5)
   *    Autonomy (1-2) → no auto-finish; (3) → auto-finish with summary; (4-5) → summary + auto-create tasks */
  @OnEvent('meeting.entry.human')
  async handleMeetingEntry(payload: { meetingId: string; entry: any; round?: number }) {
    const { meetingId, entry } = payload;
    const round = payload.round ?? 1;

    if (entry.speakerType !== 'HUMAN' || entry.entryType !== 'SPEECH') return;

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { title: true, agenda: true, orgId: true, status: true },
    });
    if (!meeting || meeting.status !== 'IN_PROGRESS') return;
    if (meeting.orgId && !(await this.settings.isModuleEnabled('meetings', meeting.orgId))) return;

    // Get module settings
    const moduleConfig = await this.settings.getModuleConfig('meetings', meeting.orgId ?? undefined);
    const maxRounds = moduleConfig.activityLevel; // Activity 1-5 → rounds 1-5
    const autonomy = moduleConfig.autonomyLevel;  // Autonomy 1-5

    const participants = await this.prisma.meetingParticipant.findMany({
      where: { meetingId, participantType: 'AGENT' },
    });
    if (participants.length === 0) return;

    const agents: any[] = [];
    for (const p of participants) {
      try {
        const agent = await this.agentsService.findOne(p.participantId);
        if (agent.status === 'ACTIVE') agents.push(agent);
        } catch (err: any) {
          this.logger.warn(`Failed to load meeting agent ${p.participantId}: ${err?.message || err}`);
        }
    }
    if (agents.length === 0) return;

    this.logger.log(`Meeting "${meeting.title}" round ${round}/${maxRounds} (activity=${moduleConfig.activityLevel}, autonomy=${autonomy}): triggering ${agents.length} agents`);

    this.events.emit('meeting.agents.pending', { meetingId, count: agents.length });

    // Run all agents in parallel
    await Promise.allSettled(agents.map(async (agent) => {
      try {
        const context = await this.buildMeetingContext(meetingId, agent, agents, meeting, round, maxRounds);

        const result = await this.execute(agent.id, context, { type: 'MEETING', id: meetingId });

        const lastEntry = await this.prisma.meetingEntry.findFirst({
          where: { meetingId }, orderBy: { order: 'desc' },
        });

        const agentEntry = await this.prisma.meetingEntry.create({
          data: {
            meetingId, speakerType: 'AGENT', speakerId: agent.id,
            content: result.text, entryType: 'SPEECH',
            order: (lastEntry?.order ?? 0) + 1,
          },
        });

        this.events.emit('meeting.entry.new', { meetingId, entry: agentEntry });
      } catch (err) {
        this.logger.error(`Agent ${agent.name} failed in meeting ${meetingId}: ${err}`);

        const lastEntry = await this.prisma.meetingEntry.findFirst({
          where: { meetingId }, orderBy: { order: 'desc' },
        });
        const errorEntry = await this.prisma.meetingEntry.create({
          data: {
            meetingId, speakerType: 'SYSTEM', speakerId: 'system',
            content: `${agent.name} failed to respond: ${err instanceof Error ? err.message : String(err)}`,
            entryType: 'SYSTEM',
            order: (lastEntry?.order ?? 0) + 1,
          },
        });
        this.events.emit('meeting.entry.new', { meetingId, entry: errorEntry });
      }
    }));

    // After all agents responded: continue or wrap up
    if (round < maxRounds) {
      const nextRoundEntry = await this.prisma.meetingEntry.findFirst({
        where: { meetingId }, orderBy: { order: 'desc' },
      });
      if (nextRoundEntry) {
        this.logger.log(`Meeting "${meeting.title}": starting round ${round + 1}/${maxRounds}`);
        setTimeout(() => {
          this.events.emit('meeting.entry.human', {
            meetingId,
            entry: { ...nextRoundEntry, speakerType: 'HUMAN', entryType: 'SPEECH' },
            round: round + 1,
          });
        }, 2000);
      }
    } else if (autonomy >= 3) {
      // Autonomy 3+ → auto-finish with summary (and tasks if autonomy 4+)
      this.logger.log(`Meeting "${meeting.title}": all ${maxRounds} rounds complete, generating summary (autonomy=${autonomy})`);
      setTimeout(() => this.generateMeetingSummary(meetingId, meeting, agents, autonomy), 3000);
    } else {
      // Autonomy 1-2 → just log, wait for human to end manually
      this.logger.log(`Meeting "${meeting.title}": all ${maxRounds} rounds complete, waiting for human to end (autonomy=${autonomy})`);
    }
  }

  /** Generate meeting summary using the CHAIR agent, then end the meeting.
   *  autonomy 3: summary only; autonomy 4-5: summary + auto-create tasks from action items */
  private async generateMeetingSummary(meetingId: string, meeting: any, agents: any[], autonomy = 3) {
    try {
      const chairParticipant = await this.prisma.meetingParticipant.findFirst({
        where: { meetingId, participantType: 'AGENT', role: 'CHAIR' },
      });
      const chairAgent = agents.find(a => a.id === chairParticipant?.participantId) || agents[0];
      if (!chairAgent) return;

      const entries = await this.prisma.meetingEntry.findMany({
        where: { meetingId }, orderBy: { order: 'asc' }, take: 100,
      });

      const nameMap = new Map(agents.map((a: any) => [a.id, a.name]));
      const lines = entries.map((e: any) => {
        if (e.speakerType === 'SYSTEM') return `[System]: ${e.content}`;
        return `[${nameMap.get(e.speakerId) || e.speakerType}]: ${e.content}`;
      });

      const taskInstructions = autonomy >= 4
        ? `\n\n## Action Items (JSON)
After the summary, output a JSON array of action items in this exact format (for automatic task creation):
\`\`\`json
[{"assignee": "AgentName", "title": "Task title", "priority": "HIGH"}]
\`\`\`
Use exact agent names from the meeting: ${agents.map((a: any) => a.name).join(', ')}.
Only include concrete, actionable tasks discussed in the meeting.`
        : '';

      const summaryPrompt = `You are ${chairAgent.name}, the meeting chair. The meeting "${meeting.title}" has concluded.

Full transcript:
${lines.join('\n')}

Please provide a structured meeting summary in the following format:

## Meeting Summary
Brief overview of what was discussed and achieved.

## Key Decisions
- List each decision made during the meeting

## Action Items
For each action item, use this exact format:
- **[Agent Name]**: Task description

## Next Steps
What should happen after this meeting.

Be concise but comprehensive. Write in the same language as the meeting transcript.${taskInstructions}`;

      const result = await this.execute(chairAgent.id, summaryPrompt, { type: 'MEETING', id: meetingId });

      // Save summary
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { summary: result.text },
      });

      // Add summary entry
      const lastEntry = await this.prisma.meetingEntry.findFirst({
        where: { meetingId }, orderBy: { order: 'desc' },
      });
      const summaryEntry = await this.prisma.meetingEntry.create({
        data: {
          meetingId, speakerType: 'SYSTEM', speakerId: 'system',
          content: `## Meeting Summary\n\n${result.text}`,
          entryType: 'SYSTEM',
          order: (lastEntry?.order ?? 0) + 1,
        },
      });
      this.events.emit('meeting.entry.new', { meetingId, entry: summaryEntry });

      // Autonomy 4-5: auto-create tasks from action items
      if (autonomy >= 4) {
        await this.createTasksFromSummary(meetingId, meeting, result.text, agents);
      }

      // End the meeting
      const endEntry = await this.prisma.meetingEntry.create({
        data: {
          meetingId, speakerType: 'SYSTEM', speakerId: 'system',
          content: 'Meeting ended',
          entryType: 'SYSTEM',
          order: (lastEntry?.order ?? 0) + 2,
        },
      });
      this.events.emit('meeting.entry.new', { meetingId, entry: endEntry });

      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { status: 'COMPLETED', endedAt: new Date() },
      });

      this.logger.log(`Meeting "${meeting.title}" completed with summary (autonomy=${autonomy})`);
    } catch (err) {
      this.logger.error(`Failed to generate meeting summary for ${meetingId}: ${err}`);
      // Even if summary fails, close the meeting
      try {
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: 'COMPLETED', endedAt: new Date(), summary: 'Summary generation failed.' },
        });
      } catch {}
    }
  }

  /** Parse action items from summary JSON block and create tasks */
  private async createTasksFromSummary(meetingId: string, meeting: any, summaryText: string, agents: any[]) {
    try {
      const jsonMatch = summaryText.match(/```json\s*\n?([\s\S]*?)\n?```/);
      if (!jsonMatch) return;

      const items = JSON.parse(jsonMatch[1]);
      if (!Array.isArray(items)) return;

      const agentByName = new Map(agents.map((a: any) => [a.name.toLowerCase(), a]));

      for (const item of items) {
        const agent = agentByName.get((item.assignee || '').toLowerCase());
        if (!agent || !item.title) continue;

        const task = await this.prisma.task.create({
          data: {
            title: item.title,
            description: `Created from meeting: ${meeting.title}`,
            priority: (item.priority || 'MEDIUM') as any,
            type: 'ONE_TIME',
            creatorType: 'AGENT',
            creatorId: agents[0].id, // CHAIR creates tasks
            assigneeType: 'AGENT',
            assigneeId: agent.id,
            orgId: meeting.orgId,
          },
        });

        await this.prisma.meetingTask.create({
          data: { meetingId, taskId: task.id },
        });

        this.logger.log(`Created task "${item.title}" → ${agent.name} from meeting`);
      }
    } catch (err) {
      this.logger.warn(`Failed to parse tasks from meeting summary: ${err}`);
    }
  }

  private async buildMeetingContext(meetingId: string, currentAgent: any, allAgents: any[], meeting: any, round = 1, maxRounds = 3): Promise<string> {
    const entries = await this.prisma.meetingEntry.findMany({
      where: { meetingId }, orderBy: { order: 'asc' }, take: 100,
    });

    const nameMap = new Map(allAgents.map(a => [a.id, a.name]));
    const humanIds = [...new Set(entries.filter(e => e.speakerType === 'HUMAN').map(e => e.speakerId))];
    if (humanIds.length > 0) {
      const users = await this.prisma.user.findMany({ where: { id: { in: humanIds } }, select: { id: true, name: true } });
      for (const u of users) nameMap.set(u.id, u.name);
    }

    const lines = entries.map(e => {
      if (e.speakerType === 'SYSTEM') return `[System]: ${e.content}`;
      return `[${nameMap.get(e.speakerId) || (e.speakerType === 'AGENT' ? 'Agent' : 'Human')}]: ${e.content}`;
    });

    const agenda = meeting?.agenda ? `\nAgenda: ${meeting.agenda}` : '';

    let roundInstructions: string;
    if (round === 1) {
      roundInstructions = 'Share your initial thoughts and expertise on the agenda topics.';
    } else if (round === maxRounds) {
      roundInstructions = 'This is the final round. Summarize your position, state any remaining concerns, and propose concrete action items or decisions.';
    } else if (round === 2) {
      roundInstructions = 'React to what other participants said. Build on their ideas, raise concerns, or propose specific actions. Reference other speakers by name.';
    } else {
      roundInstructions = `Round ${round}/${maxRounds}. Continue the discussion: address open questions, refine proposals, resolve disagreements. Be specific and actionable.`;
    }

    return `You are ${currentAgent.name}, participating in meeting "${meeting?.title || 'Meeting'}" (Round ${round}/${maxRounds}).${agenda}

Transcript so far:
${lines.join('\n')}

Instructions for this round: ${roundInstructions}

Respond as ${currentAgent.name}. Be concise and professional. Write in the same language as the agenda/transcript.`;
  }

  async execute(
    agentId: string,
    input: string | UserMessage[],
    triggeredBy?: { type: string; id?: string },
    context?: { channelId?: string; taskId?: string; approvedTools?: string[]; extraTools?: any[] },
  ) {
    const agent = await this.agentsService.findOne(agentId);

    const inputSummary = typeof input === 'string' ? input : '[multimodal conversation]';
    const execution = await this.prisma.agentExecution.create({
      data: {
        agentId,
        status: 'RUNNING',
        triggerType: (triggeredBy?.type ?? 'MANUAL') as any,
        triggerId: triggeredBy?.id,
        input: { message: inputSummary },
      },
    });

    let executionTimeout: ReturnType<typeof setTimeout> | undefined;
    let stopPollTimer: ReturnType<typeof setInterval> | undefined;
    try {
      const tools = await this.buildTools(agent, context);

      // Inject extra tools (e.g. Telegram-specific tools)
      if (context?.extraTools?.length) {
        tools.push(...context.extraTools);
      }

      // Wrap tools with approval checks
      const wrappedTools = await this.wrapToolsWithApproval(
        tools, agent.id, execution.id, context?.channelId, context?.taskId, context?.approvedTools, agent.orgId,
      );

      const runtimeConfig = agent.runtimeConfig as Record<string, unknown> ?? {};
      const llmConfig = agent.llmConfig as Record<string, unknown> ?? {};

      const apiKey = await this.getApiKey(agent.llmProvider, agent.orgId);

      // If no API key configured, return a helpful welcome message instead of failing
      if (!apiKey) {
        const noKeyMessage = `Hello! I'm ${agent.name}, your AGEMS assistant.\n\nTo start working, I need an API key for any LLM provider. You can choose based on your needs and budget:\n\n**Popular options:**\n• **Google Gemini** — great free tier, good for getting started → [ai.google.dev](https://ai.google.dev)\n• **Anthropic Claude** — excellent reasoning and coding → [console.anthropic.com](https://console.anthropic.com)\n• **OpenAI GPT** — versatile, widely supported → [platform.openai.com](https://platform.openai.com)\n• **DeepSeek** — very affordable, strong performance → [platform.deepseek.com](https://platform.deepseek.com)\n\n**How to set up:**\n1. Get an API key from any provider above\n2. Go to **Settings** → **LLM Keys** and paste your key\n3. Come back here and I'm ready!\n\n**Want to change your model later?**\nGo to **Agents** → select me → change **LLM Provider** and **Model** anytime.\n\nPick what works for you — I'll work with any of them!`;
        await this.prisma.agentExecution.update({
          where: { id: execution.id },
          data: { status: 'COMPLETED', output: { text: noKeyMessage }, endedAt: new Date() },
        });
        return { text: noKeyMessage, toolCalls: [], tokensUsed: 0, costUsd: 0, waitingForApproval: false, thinking: [] as string[], iterations: 0, loopDetected: false, executionId: execution.id };
      }

      // Check budget limits before execution (hourly + daily)
      const agentLlmConfig = (agent.llmConfig as any) || {};
      const settingsService = this.settings;

      // Helper: check spend against limit
      const checkBudgetLimit = async (since: Date, limitValue: number | null, defaultKey: string, label: string): Promise<string | null> => {
        let limit = limitValue;
        if (limit === null || limit === undefined) {
          const defaultVal = await settingsService.get(defaultKey, agent.orgId);
          limit = defaultVal ? parseFloat(defaultVal) : 0;
        }
        if (!limit || limit <= 0) return null;

        const spent = await this.prisma.agentExecution.aggregate({
          where: { agentId, startedAt: { gte: since } },
          _sum: { costUsd: true },
        });
        const totalSpent = spent._sum.costUsd || 0;
        if (totalSpent >= limit) {
          return `${label} budget limit reached ($${totalSpent.toFixed(2)}/$${limit}).`;
        }
        return null;
      };

      // Hourly check
      const hourAgo = new Date(Date.now() - 3600_000);
      const hourlyBlock = await checkBudgetLimit(
        hourAgo,
        agentLlmConfig.hourlyBudgetUsd ?? null,
        'default_hourly_budget_usd',
        'Hourly',
      );

      // Daily check
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const dailyBlock = await checkBudgetLimit(
        todayStart,
        agentLlmConfig.dailyBudgetUsd ?? null,
        'task_review_daily_budget_usd',
        'Daily',
      );

      const budgetBlock = hourlyBlock || dailyBlock;
      if (budgetBlock) {
        this.logger.warn(`Agent ${agent.name}: ${budgetBlock}`);
        await this.prisma.agentExecution.update({
          where: { id: execution.id },
          data: { status: 'COMPLETED', output: { text: budgetBlock }, endedAt: new Date() },
        });
        return { text: budgetBlock, toolCalls: [], tokensUsed: 0, costUsd: 0, waitingForApproval: false, thinking: [] as string[], iterations: 0, loopDetected: false, executionId: execution.id };
      }

      this.logger.log(`Agent ${agent.name}: ${wrappedTools.length} tools, provider=${agent.llmProvider}, model=${agent.llmModel}`);

      // Emit execution start for real-time UI
      if (context?.channelId) {
        this.events.emit('agent.execution.start', {
          channelId: context.channelId, agentId, agentName: agent.name, executionId: execution.id,
        });
      }

      // Wrap tools with live event emitting for real-time tool call tracking
      const liveTools = wrappedTools.map((t: any) => {
        const originalExec = t.execute;
        return {
          ...t,
          execute: async (params: any) => {
            // Lazy browser session: start screencast on first browser tool call
            const browserKeywords = ['browser', 'playwright', 'puppeteer', 'navigate', 'screenshot', 'snapshot'];
            if (browserKeywords.some(kw => t.name.toLowerCase().includes(kw))) {
              await this.ensureBrowserSession(execution.id);
            }
            if (context?.channelId) {
              this.events.emit('agent.tool.start', {
                channelId: context.channelId, agentId, agentName: agent.name,
                executionId: execution.id, toolName: t.name, toolInput: params,
              });
            }
            const start = Date.now();
            try {
              const result = await originalExec(params);
              if (context?.channelId) {
                this.events.emit('agent.tool.complete', {
                  channelId: context.channelId, agentId, agentName: agent.name,
                  executionId: execution.id, toolName: t.name, durationMs: Date.now() - start,
                });
              }
              return result;
            } catch (err: any) {
              if (context?.channelId) {
                this.events.emit('agent.tool.complete', {
                  channelId: context.channelId, agentId, agentName: agent.name,
                  executionId: execution.id, toolName: t.name, durationMs: Date.now() - start,
                  error: err.message || String(err),
                });
              }
              throw err;
            }
          },
        };
      });

      // Create abort controller for this execution with 30-minute timeout
      const abortController = new AbortController();
      this.abortControllers.set(execution.id, abortController);
      // Track execution → channel mapping for targeted stopChannel()
      if (context?.channelId) {
        if (!this.channelExecutionMap.has(context.channelId)) {
          this.channelExecutionMap.set(context.channelId, new Set());
        }
        this.channelExecutionMap.get(context.channelId)!.add(execution.id);
        // Clear any stale stop signal from previous execution so new messages aren't immediately killed
        try {
          const client = this.redisLock.getClient();
          await client.del(this.getChannelStopKey(context.channelId));
        } catch {}
      }
      executionTimeout = setTimeout(() => {
        this.logger.warn(`Agent ${agent.name}: execution timeout (30 min) — aborting`);
        abortController.abort();
      }, 30 * 60 * 1000);
      stopPollTimer = setInterval(async () => {
        try {
          const client = this.redisLock.getClient();
          const keys = [this.getExecutionStopKey(execution.id)];
          if (context?.channelId) keys.push(this.getChannelStopKey(context.channelId));
          const stopFlags = await client.mget(keys);
          if (stopFlags.includes('1')) {
            this.logger.log(`Execution ${execution.id} stopped via distributed stop signal`);
            abortController.abort();
          }
        } catch (err) {
          this.logger.warn(`Failed to poll distributed stop signal for ${execution.id}: ${err}`);
        }
      }, this.STOP_POLL_INTERVAL_MS);

      // Collect MCP servers from runtimeConfig + MCP_SERVER tools
      const mcpServers = await this.collectMcpServers(agent.id, runtimeConfig);

      // Browser screencast: disabled by default to save resources.
      // Agents use playwright tools directly — screenshots are returned inline.
      // Screencast only starts if agent has non-MCP browser tools (rare).
      const hasBrowserTools = this.detectBrowserTools(liveTools, []);  // exclude MCP from detection
      if (hasBrowserTools) {
      } else if (hasBrowserTools) {
        this.pendingBrowserSessions.set(execution.id, { agentId, agentName: agent.name, channelId: context?.channelId });
      }

      const resolvedMaxIterations = await this.resolveRuntimeLimit(runtimeConfig, 'maxIterations', 'default_max_iterations', this.DEFAULT_MAX_ITERATIONS);
      const runner = new AgentRunner({
        provider: {
          provider: agent.llmProvider as any,
          model: agent.llmModel,
          apiKey,
          ...(llmConfig.baseUrl ? { baseUrl: String(llmConfig.baseUrl) } : {}),
          ...(llmConfig.apiFormat ? { apiFormat: String(llmConfig.apiFormat) as 'openai' | 'anthropic' | 'google' } : {}),
        },
        systemPrompt: await this.buildSystemPrompt(agent),
        tools: liveTools,
        maxIterations: resolvedMaxIterations,
        maxTokens: (llmConfig.maxTokens as number) ?? 4096,
        temperature: (llmConfig.temperature as number) ?? 0.7,
        thinkingBudget: (llmConfig.thinkingBudget as number) ?? 4000,
        ...(mcpServers.length > 0 && { mcpServers }),
      });

      // Stream thinking & text chunks to frontend in real-time
      // Only use streaming for providers that support it (Anthropic, OpenAI, Google, DeepSeek)
      const streamingProviders = ['ANTHROPIC', 'OPENAI', 'GOOGLE', 'DEEPSEEK', 'MISTRAL', 'GROQ', 'TOGETHER', 'FIREWORKS', 'PERPLEXITY', 'MINIMAX'];
      const supportsStreaming = streamingProviders.includes(agent.llmProvider);
      const streamCallbacks = supportsStreaming ? {
        onThinkingChunk: (chunk: string) => {
          this.events.emit('agent.thinking.chunk', {
            channelId: context?.channelId, agentId, executionId: execution.id, chunk,
          });
        },
        onTextChunk: (chunk: string) => {
          this.events.emit('agent.text.chunk', {
            channelId: context?.channelId, agentId, executionId: execution.id, chunk,
          });
        },
      } : undefined;

      // Trim context to fit model's token limit (prevents context overflow errors)
      if (Array.isArray(input)) {
        input = this.trimContextToFit(input as UserMessage[], agent.llmProvider, agent.llmModel);
      }

      let result = await runner.run(input, abortController.signal, streamCallbacks);

      // Self-correction: if result is empty and there were tool errors, retry with a hint
      if (!result.text?.trim() && result.toolCalls?.some((tc: any) => tc.error)) {
        const errors = result.toolCalls.filter((tc: any) => tc.error);
        const hint = `Your previous tool calls had errors:\n${errors.map((e: any) => `- ${e.toolName}: ${e.error}`).join('\n')}\n\nPlease try a different approach or respond with what you know.`;
        this.logger.warn(`Agent ${agent.name}: empty response with ${errors.length} tool errors, retrying with correction hint`);
        const retryInput = typeof input === 'string'
          ? `${input}\n\n[System note: ${hint}]`
          : [...input, { role: 'user' as const, content: hint }];
        result = await runner.run(retryInput, abortController.signal, streamCallbacks);
      }

      // Anti-hallucination: if agent claims to do something but made 0 tool calls, force retry
      if (result.text && (result.toolCalls?.length || 0) === 0) {
        const actionWords = /(?:создаю|генерирую|запускаю|загружаю|делаю|начинаю|выполняю|отправляю|сейчас|creating|generating|launching|uploading|running|executing|sending|starting)/i;
        if (actionWords.test(result.text)) {
          this.logger.warn(`Agent ${agent.name}: claimed action but 0 tool calls — forcing retry`);
          const retryHint = `[System: You just wrote "${result.text.substring(0, 100)}..." but made ZERO tool calls. This is unacceptable. You MUST call the actual tool NOW to do the work. Do not describe what you will do — execute it with a tool call.]`;
          const retryInput = typeof input === 'string'
            ? `${input}\n\n${retryHint}`
            : [...input, { role: 'user' as const, content: retryHint }];
          result = await runner.run(retryInput, abortController.signal, streamCallbacks);
        }
      }

      // Empty-text recovery: if tool calls succeeded but agent returned no text, ask it to summarize
      if (!result.text?.trim() && result.toolCalls?.length) {
        const successfulCalls = result.toolCalls.filter((tc: any) => !tc.error);
        if (successfulCalls.length > 0) {
          const toolSummary = successfulCalls.map((tc: any) => {
            const output = typeof tc.output === 'string' ? tc.output.substring(0, 200) : JSON.stringify(tc.output).substring(0, 200);
            return `- ${tc.toolName}: ${output}`;
          }).join('\n');
          this.logger.warn(`Agent ${agent.name}: empty text after ${successfulCalls.length} successful tool calls — requesting summary`);
          const summaryHint = `[System: You executed tool calls successfully but returned NO text response to the user. You MUST now provide a brief response summarizing what you did and the results. Here are the tool results:\n${toolSummary}]`;
          const summaryInput = typeof input === 'string'
            ? `${input}\n\n${summaryHint}`
            : [...input, { role: 'user' as const, content: summaryHint }];
          result = await runner.run(summaryInput, abortController.signal, streamCallbacks);
        }
      }

      // Clear execution timeout and stop poll timer
      clearTimeout(executionTimeout);
      if (stopPollTimer) clearInterval(stopPollTimer);

      this.logger.log(`Agent ${agent.name}: ${result.toolCalls?.length || 0} tool calls, ${result.iterations} iterations, text=${result.text?.substring(0, 80)}...`);

      // Clean up abort controller, channel mapping, and browser session
      this.abortControllers.delete(execution.id);
      if (context?.channelId) {
        this.channelExecutionMap.get(context.channelId)?.delete(execution.id);
      }
      const browserScreenshots = this.browserService.stopSession(execution.id);

      // Emit execution done for real-time UI
      if (context?.channelId) {
        this.events.emit('agent.execution.done', {
          channelId: context.channelId, agentId, executionId: execution.id,
          screenshots: browserScreenshots.length > 0 ? browserScreenshots : undefined,
        });
      }

      // Check if any tool calls returned approval_required
      const needsApproval = result.toolCalls?.some(
        (tc: any) => tc.output?.approval_required === true,
      );

      if (needsApproval) {
        await this.prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: 'WAITING_HITL',
            output: { text: result.text, pendingApprovals: true },
            toolCalls: result.toolCalls as any,
            tokensUsed: result.tokensUsed.input + result.tokensUsed.output,
            costUsd: this.estimateCost(agent.llmProvider, result.tokensUsed),
            endedAt: new Date(),
          },
        });

        return { executionId: execution.id, ...result, waitingForApproval: true };
      }

      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: 'COMPLETED',
          output: {
            text: result.text,
            ...(result.thinking?.length > 0 && { thinking: result.thinking }),
            ...(browserScreenshots.length > 0 && { screenshots: browserScreenshots }),
          },
          toolCalls: result.toolCalls as any,
          tokensUsed: result.tokensUsed.input + result.tokensUsed.output,
          costUsd: this.estimateCost(agent.llmProvider, result.tokensUsed),
          endedAt: new Date(),
        },
      });

      this.events.emit('audit.create', {
        actorType: 'AGENT',
        actorId: agentId,
        action: 'EXECUTE',
        resourceType: 'agent_execution',
        resourceId: execution.id,
        details: { iterations: result.iterations, tokensUsed: result.tokensUsed },
      });

      return { executionId: execution.id, ...result, waitingForApproval: false, screenshots: browserScreenshots };
    } catch (error) {
      clearTimeout(executionTimeout);
      if (stopPollTimer) clearInterval(stopPollTimer);
      this.abortControllers.delete(execution.id);
      if (context?.channelId) {
        this.channelExecutionMap.get(context.channelId)?.delete(execution.id);
      }
      const errorScreenshots = this.browserService.stopSession(execution.id);
      const isAborted = error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted') || error.message.includes('stopped by user'));
      const errorMessage = isAborted ? 'Execution timed out or stopped' : (error instanceof Error ? error.message : String(error));
      this.logger.log(isAborted ? `Agent ${agentId} execution stopped by user` : `Agent ${agentId} execution failed: ${errorMessage}`);

      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: isAborted ? 'CANCELLED' as any : 'FAILED',
          error: errorMessage,
          endedAt: new Date(),
          ...(errorScreenshots.length > 0 && { output: { screenshots: errorScreenshots } }),
        },
      });

      // Emit done so UI clears the thinking indicator
      if (context?.channelId) {
        this.events.emit('agent.execution.done', {
          channelId: context.channelId, agentId, executionId: execution.id,
        });
      }

      if (!isAborted) throw error;
      return { executionId: execution.id, text: '', toolCalls: [], tokensUsed: { input: 0, output: 0 }, iterations: 0, thinking: [], waitingForApproval: false };
    }
  }

  /** Stop a running agent execution */
  async stopExecution(executionId: string): Promise<boolean> {
    const client = this.redisLock.getClient();
    await client.set(this.getExecutionStopKey(executionId), '1', 'EX', this.EXECUTION_STOP_TTL_SECONDS);

    const controller = this.abortControllers.get(executionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(executionId);
      return true;
    }

    // No local abort controller — execution may be orphaned (e.g. after API restart).
    // Force-update DB status so it doesn't stay stuck as RUNNING.
    try {
      const exec = await this.prisma.agentExecution.findUnique({ where: { id: executionId }, select: { status: true } });
      if (exec && exec.status === 'RUNNING') {
        await this.prisma.agentExecution.update({
          where: { id: executionId },
          data: { status: 'CANCELLED' as any, error: 'Stopped by user (no active process)', endedAt: new Date() },
        });
        this.logger.log(`Force-cancelled orphaned execution ${executionId}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to force-cancel execution ${executionId}: ${err}`);
    }

    return true;
  }

  /** Stop all running executions in a channel */
  async stopChannel(channelId: string): Promise<number> {
    if (!channelId) return 0;
    const client = this.redisLock.getClient();
    await client.set(this.getChannelStopKey(channelId), '1', 'EX', this.EXECUTION_STOP_TTL_SECONDS);

    // Find executions belonging to this specific channel and stop only those
    let stopped = 0;
    const channelExecIds = this.channelExecutionMap.get(channelId);
    if (channelExecIds) {
      for (const execId of channelExecIds) {
        const controller = this.abortControllers.get(execId);
        if (controller) {
          controller.abort();
          this.abortControllers.delete(execId);
          stopped++;
        }
      }
      this.channelExecutionMap.delete(channelId);
    }
    return stopped;
  }

  /** Handle resume after approval is granted */
  @OnEvent('approval.resume')
  async handleApprovalResume(payload: {
    agentId: string;
    executionId: string;
    channelId?: string;
    taskId?: string;
    resumeMessage: string;
    approvedTools?: string[];
  }) {
    try {
      const result = await this.execute(
        payload.agentId,
        payload.resumeMessage,
        { type: 'APPROVAL', id: payload.executionId },
        { channelId: payload.channelId, taskId: payload.taskId, approvedTools: payload.approvedTools },
      );

      // Send result to channel if available
      if (payload.channelId && result.text && !result.waitingForApproval) {
        await this.comms.sendMessage(
          payload.channelId,
          { content: result.text, contentType: 'TEXT' },
          'AGENT',
          payload.agentId,
        );
      }
    } catch (err) {
      this.logger.error(`Approval resume failed for agent ${payload.agentId}: ${err}`);
    }
  }

  /** Wrap tools with approval policy checks */
  private async wrapToolsWithApproval(
    tools: any[],
    agentId: string,
    executionId: string,
    channelId?: string,
    taskId?: string,
    approvedTools?: string[],
    orgId?: string,
  ): Promise<any[]> {
    const policy = await this.approvals.getPolicy(agentId, orgId!);

    // No policy = everything free (backward compatible)
    if (!policy) return tools;

    // Fetch agent-tool approval mode overrides
    const agentTools = await this.prisma.agentTool.findMany({
      where: { agentId, enabled: true },
      select: { tool: { select: { name: true } }, approvalMode: true },
    });
    const toolModeMap = new Map<string, string>();
    for (const at of agentTools) {
      const safeName = at.tool.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      // Map all possible tool name variants to their approval mode
      toolModeMap.set(safeName, at.approvalMode);
      toolModeMap.set(`db_query_${safeName}`, at.approvalMode);
      toolModeMap.set(`db_execute_${safeName}`, at.approvalMode);
      toolModeMap.set(`db_tables_${safeName}`, at.approvalMode);
      toolModeMap.set(`api_call_${safeName}`, at.approvalMode);
    }

    const approvedSet = new Set(approvedTools || []);

    return tools.map(tool => {
      // Skip approval for tools that were just approved in a resumed execution
      if (approvedSet.has(tool.name)) return tool;

      const agentToolMode = toolModeMap.get(tool.name);
      const mode = this.approvals.resolveModeForTool(policy, tool.name, agentToolMode);

      if (mode === 'FREE') return tool;

      if (mode === 'BLOCKED') {
        return {
          ...tool,
          execute: async () => ({
            error: `Tool "${tool.name}" is blocked by approval policy. You cannot use this tool.`,
            blocked: true,
          }),
        };
      }

      // REQUIRES_APPROVAL
      const originalExecute = tool.execute;
      return {
        ...tool,
        execute: async (params: unknown) => {
          const request = await this.approvals.createRequest({
            agentId,
            executionId,
            toolName: tool.name,
            toolInput: params,
            channelId,
            taskId,
          });

          // Send approval card to chat
          if (channelId) {
            await this.approvals.sendApprovalMessage(request, channelId);
          }

          return {
            approval_required: true,
            approval_id: request.id,
            message: `This action requires approval. An approval request has been sent (ID: ${request.id}). Please inform the user that you are waiting for approval to: "${request.description}".`,
          };
        },
      };
    });
  }

  /** Build full system prompt: AGEMS preamble + module directives + company context + skill names + agent's own system prompt.
   *  Cached per agent for `system_prompt_cache_seconds` (default 60s) to avoid 4 DB queries on every execute. */
  private async buildSystemPrompt(agent: any): Promise<string> {
    // Cache lookup
    const cacheTtlMs = (await this.getNumericSetting('system_prompt_cache_seconds', 60)) * 1000;
    if (cacheTtlMs > 0) {
      const hit = this.systemPromptCache.get(agent.id);
      if (hit && (Date.now() - hit.ts) < cacheTtlMs) {
        return hit.prompt;
      }
    }

    const orgId = agent.orgId;
    const runtimeConfig = (agent.runtimeConfig as Record<string, unknown>) ?? {};
    const knowledgeLimit = await this.resolveRuntimeLimit(runtimeConfig, 'memoryKnowledgeLimit', 'memory_knowledge_limit', this.DEFAULT_MEMORY_KNOWLEDGE_LIMIT);
    const conversationLimit = await this.resolveRuntimeLimit(runtimeConfig, 'memoryConversationLimit', 'memory_conversation_limit', this.DEFAULT_MEMORY_CONVERSATION_LIMIT);

    const [agemsPreamble, companyContext, modulesDirective] = await Promise.all([
      this.settings.getAgemsPreamble(orgId),
      this.settings.getCompanyContext(orgId),
      this.settings.getModulesDirective(orgId),
    ]);

    let skillsContext = '';
    if (agent.skills?.length) {
      const activeSkills = agent.skills
        .filter((as: any) => as.enabled !== false && as.skill?.name)
        .map((as: any) => as.skill);
      if (activeSkills.length > 0) {
        const names = activeSkills.map((s: any) => `- ${s.name}`).join('\n');
        skillsContext = `=== AVAILABLE SKILLS ===\nYou have the following skills available. Use the "use_skill" tool to load a skill when you need its knowledge:\n${names}\n=== END AVAILABLE SKILLS ===\n\n`;
      }
    }

    // Inject persistent KNOWLEDGE memories into prompt — sorted by updatedAt (LRU touch on read)
    let memoryContext = '';
    try {
      if (knowledgeLimit > 0) {
        const memories = await this.prisma.agentMemory.findMany({
          where: { agentId: agent.id, type: 'KNOWLEDGE' },
          orderBy: { createdAt: 'desc' },
          take: knowledgeLimit,
        });
        if (memories.length > 0) {
          const entries = memories.map(m => `- ${m.content}`).join('\n');
          memoryContext = `\n=== YOUR PERSISTENT MEMORY ===\nThese are facts you saved from previous conversations. Use memory_write to add new knowledge, memory_delete to remove outdated entries.\n${entries}\n=== END MEMORY ===\n\n`;
        }
      }

      // Inject CONVERSATION summaries (cross-channel awareness) — sorted by updatedAt
      if (conversationLimit > 0) {
        const conversations = await this.prisma.agentMemory.findMany({
          where: { agentId: agent.id, type: 'CONVERSATION' },
          orderBy: { createdAt: 'desc' },
          take: conversationLimit,
        });
        if (conversations.length > 0) {
          const entries = conversations.map(m => `- ${m.content}`).join('\n');
          memoryContext += `=== RECENT CONVERSATIONS (cross-channel) ===\nThese are your recent interactions across all channels. You DID have these conversations — do not deny them.\n${entries}\n=== END RECENT CONVERSATIONS ===\n\n`;
        }
      }
    } catch { /* memory table might not exist yet */ }

    // Inject active goals assigned to this agent
    let goalsContext = '';
    try {
      const goals = await this.prisma.goal.findMany({
        where: { agentId: agent.id, status: { in: ['PLANNED', 'ACTIVE'] } },
        select: { id: true, title: true, status: true, priority: true, progress: true, targetDate: true, description: true },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        take: 10,
      });
      if (goals.length > 0) {
        const entries = goals.map(g =>
          `- [${g.id}] "${g.title}" (${g.status}, ${g.priority}, ${g.progress}% done${g.targetDate ? `, target: ${g.targetDate.toISOString().split('T')[0]}` : ''})${g.description ? `\n  ${g.description.substring(0, 150)}` : ''}`
        ).join('\n');
        goalsContext = `\n=== YOUR ACTIVE GOALS ===\nThese goals are assigned to you. Use agems_goals to view details and update progress. Use agems_tasks to create/manage tasks linked to goals.\n${entries}\n=== END GOALS ===\n\n`;
      }
    } catch { /* goals table might not exist yet */ }

    let reposContext = '';
    const agentRepos = (agent.repositories || [])
      .filter((ar: any) => ar.enabled && ar.repo?.syncStatus === 'SYNCED');
    if (agentRepos.length > 0) {
      const repoList = agentRepos.map((ar: any) => {
        const r = ar.repo;
        return `- ${r.slug}: ${r.name}${r.description ? ' — ' + r.description : ''} (branch: ${r.branch})`;
      }).join('\n');
      reposContext = `=== CONNECTED REPOSITORIES ===\nYou have access to these code repositories via repo_search, repo_read_file, repo_file_summary, repo_structure, and repo_find_definition tools:\n${repoList}\nAlways specify the repo slug when searching. Search in specific repos, not all at once.\n=== END REPOSITORIES ===\n\n`;
    }

    const prompt = agemsPreamble + '\n' + modulesDirective + '\n\n' + companyContext + skillsContext + reposContext + memoryContext + goalsContext + (agent.systemPrompt || '');

    if (cacheTtlMs > 0) {
      this.systemPromptCache.set(agent.id, { prompt, ts: Date.now() });
    }
    return prompt;
  }

  private async buildTools(agent: any, context?: { channelId?: string }) {
    const runtimeConfig = agent.runtimeConfig as Record<string, unknown> ?? {};
    const mode = runtimeConfig.mode ?? 'CLAUDE_CODE';
    const disabledTools = new Set<string>((runtimeConfig.disabledBuiltinTools as string[]) || []);
    const tools: any[] = [];

    // ── Skill loader tool ──
    if (agent.skills?.length) {
      const skillMap = new Map<string, string>();
      for (const as of agent.skills) {
        if (as.enabled !== false && as.skill?.name && as.skill?.content) {
          skillMap.set(as.skill.name, as.skill.content);
        }
      }
      if (skillMap.size > 0) {
        tools.push({
          name: 'use_skill',
          description: `Load a skill to gain its knowledge. Available skills: ${Array.from(skillMap.keys()).join(', ')}`,
          parameters: z.object({
            skillName: z.string().describe('Name of the skill to load'),
          }),
          execute: async (params: { skillName: string }) => {
            const content = skillMap.get(params.skillName);
            if (!content) {
              return { error: `Skill "${params.skillName}" not found. Available: ${Array.from(skillMap.keys()).join(', ')}` };
            }
            return { skill: params.skillName, content };
          },
        });
      }
    }

    // ── bash_command — only when allowHostAccess is enabled ──
    if (this.hasHostAccessEnabled(runtimeConfig)) {
      tools.push({
        name: 'bash_command',
        description: 'Execute a bash command and return the output.',
        parameters: z.object({
          command: z.string().describe('The bash command to execute'),
          timeout: z.number().optional().describe('Timeout in seconds (default 30)'),
        }),
        execute: async (params: { command: string; timeout?: number }) => {
          return this.executeBash(params.command, params.timeout ?? 30, runtimeConfig);
        },
      });
    }

    // ── File I/O tools — available to ALL agents ──
    if (!disabledTools.has('read_file')) {
      tools.push({
        name: 'read_file',
        description: 'Read the contents of a file. Supports text files and PDF (auto-extracts text from PDF).',
        parameters: z.object({
          path: z.string().describe('Absolute path to the file'),
          maxLines: z.number().optional().describe('Max lines to read (default 200)'),
        }),
        execute: async (params: { path: string; maxLines?: number }) => {
          return this.readFile(params.path, params.maxLines ?? 200, runtimeConfig);
        },
      });
    }

    if (!disabledTools.has('write_file')) {
      tools.push({
        name: 'write_file',
        description: 'Write content to a file (creates or overwrites). Set saveToFiles=true to also register the file in the organisation Files library so users can find and download it from the /files page.',
        parameters: z.object({
          path: z.string().describe('Absolute path to the file'),
          content: z.string().describe('Content to write'),
          saveToFiles: z.boolean().optional().describe('If true, also copy file to /uploads/ and register in Files library (default: false)'),
        }),
        execute: async (params: { path: string; content: string; saveToFiles?: boolean }) => {
          const writeResult = await this.writeFile(params.path, params.content, runtimeConfig);
          if ('error' in writeResult || !params.saveToFiles) return writeResult;

          // Also register in Files library
          try {
            const { copyFileSync, statSync } = await import('fs');
            const { basename, extname: pathExtname } = await import('path');
            const origName = basename(params.path);
            const ext = pathExtname(origName).toLowerCase() || '.bin';
            const filename = `${randomUUID()}${ext}`;

            const cwd = process.cwd();
            const isMonorepoRoot = existsSync(join(cwd, 'apps', 'api')) && existsSync(join(cwd, 'apps', 'web'));
            const uploadsDir = isMonorepoRoot
              ? join(cwd, 'apps', 'web', 'public', 'uploads')
              : join(cwd, '..', 'web', 'public', 'uploads');
            if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

            const sourcePath = this.resolveWorkspacePath(params.path, runtimeConfig);
            copyFileSync(sourcePath, join(uploadsDir, filename));
            const stat = statSync(sourcePath);
            const mimeMap: Record<string, string> = {
              '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv',
              '.json': 'application/json', '.md': 'text/markdown',
              '.html': 'text/html', '.xml': 'application/xml',
            };
            const url = `/uploads/${filename}`;
            const record = await this.prisma.fileRecord.create({
              data: {
                orgId: agent.orgId,
                filename,
                originalName: origName,
                mimetype: mimeMap[ext] || 'application/octet-stream',
                size: stat.size,
                url,
                uploadedBy: 'AGENT',
                uploaderId: agent.id,
              },
            });
            return { success: true, path: params.path, savedToFiles: true, fileUrl: url, fileId: record.id };
          } catch (err: any) {
            // File was written successfully, just Files registration failed
            return { success: true, path: params.path, savedToFiles: false, filesError: err.message };
          }
        },
      });
    }

    // ── Memory tools — persistent agent knowledge store ──
    {
      const agentId = agent.id;

      tools.push({
        name: 'memory_read',
        description: 'Read your persistent memory entries. Use to recall knowledge from past conversations. Filter by type: KNOWLEDGE (learned facts), CONTEXT (situational), FILE (saved files), CONVERSATION (past chats).',
        parameters: z.object({
          type: z.string().optional().describe('Memory type filter: KNOWLEDGE, CONTEXT, FILE, CONVERSATION (default: all)'),
          search: z.string().optional().describe('Search term to filter memories by content'),
          limit: z.number().optional().describe('Max entries to return (default 20)'),
        }),
        execute: async (params: { type?: string; search?: string; limit?: number }) => {
          const where: any = { agentId };
          if (params.type) where.type = params.type;
          const memories = await this.prisma.agentMemory.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: params.limit ?? 20,
          });
          let results = memories.map(m => ({
            id: m.id,
            type: m.type,
            content: m.content.substring(0, 5000),
            metadata: m.metadata,
            createdAt: m.createdAt,
          }));
          if (params.search) {
            const q = params.search.toLowerCase();
            results = results.filter(r => r.content.toLowerCase().includes(q));
          }
          return { count: results.length, memories: results };
        },
      });

      tools.push({
        name: 'memory_write',
        description: 'Save information to your persistent memory. Survives across conversations. Use for: learned facts, important IDs, user preferences, solutions to problems, API quirks.',
        parameters: z.object({
          content: z.string().describe('The information to remember'),
          type: z.string().optional().describe('Memory type: KNOWLEDGE (default), CONTEXT, FILE'),
          metadata: z.string().optional().describe('Optional JSON metadata (tags, source, etc.)'),
        }),
        execute: async (params: { content: string; type?: string; metadata?: string }) => {
          const mem = await this.prisma.agentMemory.create({
            data: {
              agentId,
              type: (params.type as any) ?? 'KNOWLEDGE',
              content: params.content,
              metadata: params.metadata ? JSON.parse(params.metadata) : undefined,
            },
          });
          this.invalidateSystemPromptCache(agentId);
          return { success: true, id: mem.id, type: mem.type };
        },
      });

      tools.push({
        name: 'memory_delete',
        description: 'Delete a memory entry by ID. Use to clean up outdated or incorrect memories.',
        parameters: z.object({
          id: z.string().describe('Memory entry ID to delete'),
        }),
        execute: async (params: { id: string }) => {
          try {
            await this.prisma.agentMemory.delete({ where: { id: params.id } });
            this.invalidateSystemPromptCache(agentId);
            return { success: true };
          } catch {
            return { error: 'Memory entry not found' };
          }
        },
      });
    }

    // ── Repository code search tools ──
    {
      const agentRepos = (agent.repositories || [])
        .filter((ar: any) => ar.enabled && ar.repo?.localPath && ar.repo?.syncStatus === 'SYNCED');

      if (agentRepos.length > 0) {
        const repoMap = new Map<string, string>(agentRepos.map((ar: any) => [ar.repo.slug, ar.repo.localPath]));
        const repoNames = Array.from(repoMap.keys());

        const getRepoPath = (slug: string): { path: string } | { error: string } => {
          const p = repoMap.get(slug);
          if (!p) return { error: `Repository "${slug}" not found. Available: ${repoNames.join(', ')}` };
          if (!existsSync(p)) return { error: `Repository "${slug}" is not cloned yet. Trigger a sync first.` };
          return { path: p };
        };

        const EXCLUDE_DIRS = ['node_modules', 'dist', 'build', '.git', '__pycache__', '.next'];
        const EXCLUDE_FILES = ['*.lock', '*.min.js', '*.min.css', '*.map'];

        const extToLang = (ext: string): string => {
          const map: Record<string, string> = {
            '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
            '.py': 'Python', '.java': 'Java', '.kt': 'Kotlin', '.cs': 'C#',
            '.go': 'Go', '.rs': 'Rust', '.rb': 'Ruby', '.php': 'PHP', '.swift': 'Swift',
            '.c': 'C', '.cpp': 'C++', '.h': 'C', '.hpp': 'C++',
          };
          return map[ext] || 'unknown';
        };

        const extractDefinitions = (lines: string[], language: string): Array<{ line: number; kind: string; name: string; signature: string }> => {
          const defs: Array<{ line: number; kind: string; name: string; signature: string }> = [];
          const lang = language.toLowerCase();

          const patterns: Array<{ re: RegExp; kind: string | ((m: RegExpMatchArray) => string); nameGroup: number }> = [];

          if (lang === 'typescript' || lang === 'javascript') {
            patterns.push(
              { re: /^(\s*)(export\s+)?(default\s+)?(abstract\s+)?class\s+(\w+)/, kind: 'class', nameGroup: 5 },
              { re: /^(\s*)(export\s+)?(default\s+)?interface\s+(\w+)/, kind: 'interface', nameGroup: 4 },
              { re: /^(\s*)(export\s+)?(default\s+)?type\s+(\w+)\s*=/, kind: 'type', nameGroup: 4 },
              { re: /^(\s*)(export\s+)?(default\s+)?enum\s+(\w+)/, kind: 'enum', nameGroup: 4 },
              { re: /^(\s*)(export\s+)?(default\s+)?(async\s+)?function\s+(\w+)/, kind: 'function', nameGroup: 5 },
              { re: /^(export\s+)?(const|let|var)\s+(\w+)\s*[=:]/, kind: (m) => m[2] === 'const' ? 'const' : 'variable', nameGroup: 3 },
              { re: /^\s+(public|private|protected|static|async|get|set|readonly)\s+(?:(?:public|private|protected|static|async|get|set|readonly)\s+)*(\w+)\s*[\(<]/, kind: 'method', nameGroup: 2 },
              { re: /^\s*@(Controller|Injectable|Module|Guard|Resolver|Middleware|Interceptor)\b/, kind: 'decorator', nameGroup: 1 },
            );
          } else if (lang === 'python') {
            patterns.push(
              { re: /^class\s+(\w+)/, kind: 'class', nameGroup: 1 },
              { re: /^(async\s+)?def\s+(\w+)/, kind: 'function', nameGroup: 2 },
              { re: /^(\w+)\s*=\s*/, kind: 'variable', nameGroup: 1 },
            );
          } else if (lang === 'java' || lang === 'kotlin' || lang === 'c#') {
            patterns.push(
              { re: /(?:public|private|protected|internal|static|final|abstract|override|open|data|sealed|suspend)\s+.*?(class|interface|enum|record|struct|object)\s+(\w+)/, kind: (m) => m[1], nameGroup: 2 },
              { re: /^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:abstract\s+)?(?:override\s+)?(?:suspend\s+)?(?:fun\s+)?[\w<>\[\].]+\s+(\w+)\s*\(/, kind: 'method', nameGroup: 1 },
              { re: /^\s*(val|var|const val)\s+(\w+)/, kind: 'variable', nameGroup: 2 },
              { re: /^\s*(?:abstract\s+)?(?:class|interface|enum|record|struct|object)\s+(\w+)/, kind: (m) => 'class', nameGroup: 1 },
            );
          } else if (lang === 'go') {
            patterns.push(
              { re: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/, kind: 'function', nameGroup: 1 },
              { re: /^type\s+(\w+)\s+(struct|interface)/, kind: (m) => m[2], nameGroup: 1 },
              { re: /^type\s+(\w+)\s+/, kind: 'type', nameGroup: 1 },
              { re: /^(?:var|const)\s+(\w+)/, kind: 'variable', nameGroup: 1 },
            );
          } else if (lang === 'rust') {
            patterns.push(
              { re: /^\s*(pub\s+)?(async\s+)?fn\s+(\w+)/, kind: 'function', nameGroup: 3 },
              { re: /^\s*(pub\s+)?(struct|enum|trait|union)\s+(\w+)/, kind: (m) => m[2], nameGroup: 3 },
              { re: /^\s*(pub\s+)?impl\s+(?:<[^>]+>\s+)?(\w+)/, kind: 'impl', nameGroup: 2 },
              { re: /^\s*(pub\s+)?type\s+(\w+)/, kind: 'type', nameGroup: 2 },
              { re: /^\s*(pub\s+)?(?:const|static)\s+(\w+)/, kind: 'const', nameGroup: 2 },
              { re: /^\s*(pub\s+)?mod\s+(\w+)/, kind: 'module', nameGroup: 2 },
            );
          } else if (lang === 'ruby') {
            patterns.push(
              { re: /^\s*class\s+(\w+)/, kind: 'class', nameGroup: 1 },
              { re: /^\s*module\s+(\w+)/, kind: 'module', nameGroup: 1 },
              { re: /^\s*def\s+(\w+)/, kind: 'function', nameGroup: 1 },
              { re: /^\s*attr_(?:accessor|reader|writer)\s+:(\w+)/, kind: 'variable', nameGroup: 1 },
            );
          } else if (lang === 'php') {
            patterns.push(
              { re: /^\s*(?:abstract\s+)?(?:class|interface|trait|enum)\s+(\w+)/, kind: 'class', nameGroup: 1 },
              { re: /^\s*(?:public|private|protected|static)\s+.*?function\s+(\w+)/, kind: 'method', nameGroup: 1 },
              { re: /^\s*function\s+(\w+)/, kind: 'function', nameGroup: 1 },
            );
          } else if (lang === 'swift') {
            patterns.push(
              { re: /^\s*(?:public\s+|private\s+|internal\s+|open\s+|fileprivate\s+)?(?:final\s+)?(class|struct|enum|protocol|extension|actor)\s+(\w+)/, kind: (m) => m[1], nameGroup: 2 },
              { re: /^\s*(?:public\s+|private\s+|internal\s+|open\s+)?(?:static\s+|class\s+)?func\s+(\w+)/, kind: 'function', nameGroup: 1 },
              { re: /^\s*(?:public\s+|private\s+|internal\s+|open\s+)?(?:static\s+)?(?:let|var)\s+(\w+)/, kind: 'variable', nameGroup: 1 },
            );
          }

          // Fallback patterns for unknown languages
          if (patterns.length === 0) {
            patterns.push(
              { re: /^\s*(export\s+)?(class|function|interface|type|enum|struct|def|fn|func)\s+(\w+)/, kind: (m) => m[2], nameGroup: 3 },
            );
          }

          for (let i = 0; i < lines.length && defs.length < 100; i++) {
            const line = lines[i];
            for (const p of patterns) {
              const m = line.match(p.re);
              if (m && m[p.nameGroup]) {
                const kind = typeof p.kind === 'function' ? p.kind(m) : p.kind;
                defs.push({
                  line: i + 1,
                  kind,
                  name: m[p.nameGroup],
                  signature: line.trim().substring(0, 150),
                });
                break;
              }
            }
            // Python decorators: only capture if next line is class/def
            if (lang === 'python' && line.match(/^\s*@(\w+)/) && i + 1 < lines.length) {
              const next = lines[i + 1];
              if (next.match(/^\s*(class|async\s+def|def)\s+/)) {
                const dm = line.match(/^\s*@(\w+)/);
                if (dm) {
                  defs.push({ line: i + 1, kind: 'decorator', name: dm[1], signature: line.trim().substring(0, 150) });
                }
              }
            }
          }

          return defs;
        };

        if (!disabledTools.has('repo_list')) {
          tools.push({
            name: 'repo_list',
            description: 'List available code repositories connected to this agent.',
            parameters: z.object({}),
            execute: async () => {
              return {
                repositories: agentRepos.map((ar: any) => ({
                  slug: ar.repo.slug,
                  name: ar.repo.name,
                  branch: ar.repo.branch,
                  description: ar.repo.description,
                })),
              };
            },
          });
        }

        if (!disabledTools.has('repo_search')) {
          tools.push({
            name: 'repo_search',
            description: `Search for text/code patterns in a repository. Available repos: ${repoNames.join(', ')}.\n\nTwo modes:\n- mode="files" (default): Returns a ranked list of files containing matches, with match count and preview. Start with this to find relevant files.\n- mode="content": Returns full grep output with 25 lines of context, grouped by file. Use after identifying target files with mode="files".\n\nWorkflow: repo_search(mode="files") → identify relevant file → repo_search(mode="content", filePattern="exact/path.ts") or repo_read_file.`,
            parameters: z.object({
              repo: z.string().describe('Repository slug'),
              query: z.string().describe('Search query (text or regex pattern)'),
              filePattern: z.string().optional().default('*').describe('File glob pattern, e.g. "*.ts", "*.py", "*.java"'),
              caseSensitive: z.boolean().optional().default(false),
              mode: z.enum(['files', 'content']).optional().default('files').describe(
                'files = list matching files with preview (default, start here); content = show full grep matches with surrounding context',
              ),
            }),
            execute: async (params: { repo: string; query: string; filePattern?: string; caseSensitive?: boolean; mode?: 'files' | 'content' }) => {
              const result = getRepoPath(params.repo);
              if ('error' in result) return { error: result.error };
              const repoPath = result.path;

              const { execSync } = await import('child_process');
              const prune = EXCLUDE_DIRS.map(d => `-name ${d}`).join(' -o ');
              const excludeFiles = EXCLUDE_FILES.map(f => `! -name '${f}'`).join(' ');
              const nameFilter = params.filePattern && params.filePattern !== '*'
                ? `-name '${params.filePattern}'` : '';
              const findCmd = `find . -maxdepth 20 \\( ${prune} \\) -prune -o -type f ${nameFilter} ${excludeFiles} -print`;
              const caseFlag = params.caseSensitive ? '' : '-i';
              const safeQuery = JSON.stringify(params.query);

              if (params.mode === 'content') {
                // ── content mode: grep with context, grouped by file ──
                try {
                  const cmd = `${findCmd} | xargs grep -n -C 25 ${caseFlag} -- ${safeQuery} | head -1000`;
                  const output = execSync(cmd, {
                    cwd: repoPath, timeout: 10_000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf-8', shell: '/bin/sh',
                  });
                  return parseContentOutput(output);
                } catch (err: any) {
                  const partial = typeof err.stdout === 'string' ? err.stdout : '';
                  if (partial.length > 0) return parseContentOutput(partial, true);
                  if (err.status === 1 || err.status === 123) return { results: [], totalMatches: 0, truncated: false };
                  return { error: `Search failed: ${(err.message || '').substring(0, 200)}` };
                }
              }

              // ── files mode (default): ranked file list with previews ──
              try {
                const script = [
                  `TOTAL=$(${findCmd} | xargs grep -l ${caseFlag} -- ${safeQuery} 2>/dev/null | wc -l)`,
                  `echo "TOTAL:$TOTAL"`,
                  `FILES=$(${findCmd} | xargs grep -l ${caseFlag} -- ${safeQuery} 2>/dev/null | head -30)`,
                  `for f in $FILES; do`,
                  `  COUNT=$(grep -c ${caseFlag} -- ${safeQuery} "$f" 2>/dev/null || echo 0)`,
                  `  PREVIEW=$(grep -n -m 1 -A 1 -B 1 ${caseFlag} -- ${safeQuery} "$f" 2>/dev/null | head -5)`,
                  `  echo "FILE:$f"`,
                  `  echo "COUNT:$COUNT"`,
                  `  echo "$PREVIEW"`,
                  `  echo "---END---"`,
                  `done`,
                ].join('; ');
                const output = execSync(script, {
                  cwd: repoPath, timeout: 10_000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf-8', shell: '/bin/sh',
                });

                // Parse total
                const totalMatch = output.match(/^TOTAL:\s*(\d+)/m);
                const totalFiles = totalMatch ? parseInt(totalMatch[1], 10) : 0;

                // Parse file blocks
                const defPattern = /\b(export|class|function|interface|type|enum|struct|trait|impl|def|fn|func|pub fn|pub struct|const|let|var|val|object|abstract class|public static|private|protected)\s/;
                const importPattern = /\b(import|require|from|use)\b/;

                const blocks = output.split('---END---').filter(b => b.includes('FILE:'));
                const files = blocks.map(block => {
                  const lines = block.trim().split('\n');
                  const fileLine = lines.find(l => l.startsWith('FILE:'));
                  const countLine = lines.find(l => l.startsWith('COUNT:'));
                  const path = (fileLine?.substring(5) || '').replace(/^\.\//, '');
                  const matchCount = parseInt(countLine?.substring(6) || '0', 10);
                  const previewLines = lines.filter(l => !l.startsWith('FILE:') && !l.startsWith('COUNT:') && !l.startsWith('TOTAL:'));
                  const preview = previewLines.join('\n').trim();

                  // Determine weight from preview content
                  let weight = 2;
                  if (defPattern.test(preview)) weight = 3;
                  else if (importPattern.test(preview)) weight = 1;

                  return { path, matchCount, preview, weight };
                }).filter(f => f.path);

                files.sort((a, b) => (b.matchCount * b.weight) - (a.matchCount * a.weight));

                return {
                  files: files.map(f => ({ path: f.path, matchCount: f.matchCount, preview: f.preview })),
                  totalFiles,
                  query: params.query,
                  hint: "Use repo_search with mode='content' and filePattern to read matches in a specific file, or repo_read_file to read the full file.",
                };
              } catch (err: any) {
                const partial = typeof err.stdout === 'string' ? err.stdout : '';
                if (partial.length > 0) {
                  // Try to parse partial output
                  const blocks = partial.split('---END---').filter((b: string) => b.includes('FILE:'));
                  if (blocks.length > 0) {
                    const files = blocks.map((block: string) => {
                      const lines = block.trim().split('\n');
                      const fileLine = lines.find((l: string) => l.startsWith('FILE:'));
                      const countLine = lines.find((l: string) => l.startsWith('COUNT:'));
                      const path = (fileLine?.substring(5) || '').replace(/^\.\//, '');
                      const matchCount = parseInt(countLine?.substring(6) || '0', 10);
                      const previewLines = lines.filter((l: string) => !l.startsWith('FILE:') && !l.startsWith('COUNT:') && !l.startsWith('TOTAL:'));
                      return { path, matchCount, preview: previewLines.join('\n').trim() };
                    }).filter((f: { path: string }) => f.path);
                    return { files, totalFiles: files.length, query: params.query, hint: 'Partial results returned.' };
                  }
                }
                if (err.status === 1 || err.status === 123) return { files: [], totalFiles: 0, query: params.query, hint: 'No matches found.' };
                return { error: `Search failed: ${(err.message || '').substring(0, 200)}` };
              }

              function parseContentOutput(raw: string, truncated = false): any {
                const outputLines = raw.split('\n');
                const fileGroups: Array<{ file: string; matches: string }> = [];
                let currentFile = '';
                let currentLines: string[] = [];
                let totalMatches = 0;
                let totalOutputLines = 0;

                for (const line of outputLines) {
                  if (totalOutputLines >= 200) { truncated = true; break; }
                  // grep -n output: ./path/file.ts:42:content or ./path/file.ts-42-context
                  const fileMatch = line.match(/^\.\/([^:]+?)[:|-]\d+[:|-]/);
                  const file = fileMatch ? fileMatch[1] : '';
                  if (file && file !== currentFile) {
                    if (currentFile && currentLines.length > 0) {
                      fileGroups.push({ file: currentFile, matches: currentLines.join('\n') });
                    }
                    currentFile = file;
                    currentLines = [];
                  }
                  if (line === '--') {
                    currentLines.push(line);
                  } else if (file) {
                    currentLines.push(line);
                    if (line.includes(':') && !line.startsWith('--')) totalMatches++;
                  }
                  totalOutputLines++;
                }
                if (currentFile && currentLines.length > 0) {
                  fileGroups.push({ file: currentFile, matches: currentLines.join('\n') });
                }

                return { results: fileGroups, totalMatches, truncated };
              }
            },
          });
        }

        if (!disabledTools.has('repo_read_file')) {
          tools.push({
            name: 'repo_read_file',
            description: `Read a file from a repository. Returns content with line numbers. If the file is longer than the requested range, the response includes a hint with key definitions in the unread portion to help you decide whether to continue reading. Available repos: ${repoNames.join(', ')}`,
            parameters: z.object({
              repo: z.string().describe('Repository slug'),
              path: z.string().describe('File path relative to repo root'),
              startLine: z.number().optional().default(1).describe('Start line number (1-based)'),
              endLine: z.number().optional().default(500).describe('End line number (max 500 lines per read)'),
            }),
            execute: async (params: { repo: string; path: string; startLine?: number; endLine?: number }) => {
              const result = getRepoPath(params.repo);
              if ('error' in result) return { error: result.error };
              const repoPath = result.path;

              const { resolve: pathResolve, join: pathJoin, extname } = await import('path');
              const filePath = pathResolve(pathJoin(repoPath, params.path));
              if (!filePath.startsWith(pathResolve(repoPath))) {
                return { error: 'Path traversal not allowed' };
              }

              try {
                const { readFileSync, statSync } = await import('fs');
                const stat = statSync(filePath);
                if (stat.size > 1024 * 1024) return { error: 'File too large (>1MB). Try reading a specific line range.' };

                const content = readFileSync(filePath, 'utf-8');
                const allLines = content.split('\n');
                const start = Math.max(1, params.startLine || 1);
                const end = Math.min(allLines.length, Math.min(params.endLine || 500, start + 499));
                const slice = allLines.slice(start - 1, end);
                const numbered = slice.map((line, i) => `${start + i}: ${line}`).join('\n');

                const res: any = { content: numbered, startLine: start, endLine: end, totalLines: allLines.length };

                if (end < allLines.length) {
                  const ext = extname(params.path).toLowerCase();
                  const language = extToLang(ext);
                  const remaining = allLines.slice(end);
                  const defs = extractDefinitions(remaining, language);
                  res.hint = `File has ${allLines.length} lines. You read lines ${start}\u2013${end}. Call again with startLine=${end + 1} to continue reading.`;
                  if (defs.length > 0) {
                    const defSummary = defs.slice(0, 15).map(d =>
                      `  L${end + d.line}: ${d.kind} ${d.name}`,
                    ).join('\n');
                    res.hint += `\nKey definitions in unread portion:\n${defSummary}`;
                    if (defs.length > 15) res.hint += `\n  ... and ${defs.length - 15} more`;
                  }
                }

                return res;
              } catch (err: any) {
                return { error: `Failed to read file: ${(err.message || '').substring(0, 200)}` };
              }
            },
          });
        }

        if (!disabledTools.has('repo_structure')) {
          tools.push({
            name: 'repo_structure',
            description: `List the file tree of a repository. Available repos: ${repoNames.join(', ')}`,
            parameters: z.object({
              repo: z.string().describe('Repository slug'),
              path: z.string().optional().default('.').describe('Subdirectory path (default: repo root)'),
              depth: z.number().optional().default(3).describe('Max depth (1-5, default 3)'),
            }),
            execute: async (params: { repo: string; path?: string; depth?: number }) => {
              const result = getRepoPath(params.repo);
              if ('error' in result) return { error: result.error };
              const repoPath = result.path;

              const { resolve: pathResolve, join: pathJoin } = await import('path');
              const targetPath = pathResolve(pathJoin(repoPath, params.path || '.'));
              if (!targetPath.startsWith(pathResolve(repoPath))) {
                return { error: 'Path traversal not allowed' };
              }

              if (!existsSync(targetPath)) {
                return { error: `Path "${params.path}" not found in repository` };
              }

              try {
                const { execSync } = await import('child_process');
                const depth = Math.min(5, Math.max(1, params.depth || 3));
                const excludes = EXCLUDE_DIRS.map(d => `-name ${d} -prune -o`).join(' ');
                const cmd = `find . -maxdepth ${depth} ${excludes} -print | head -500 | sort`;
                const output = execSync(cmd, {
                  cwd: targetPath,
                  timeout: 10_000,
                  encoding: 'utf-8',
                });
                return { tree: output.trim() };
              } catch (err: any) {
                return { error: `Failed to list structure: ${(err.message || '').substring(0, 200)}` };
              }
            },
          });
        }

        if (!disabledTools.has('repo_file_summary')) {
          tools.push({
            name: 'repo_file_summary',
            description: `Get a structural summary of a file: imports, exports, class/function/type definitions with line numbers. Much cheaper than reading the whole file — use this to decide if a file is relevant before reading it. Available repos: ${repoNames.join(', ')}`,
            parameters: z.object({
              repo: z.string().describe('Repository slug'),
              path: z.string().describe('File path relative to repo root'),
            }),
            execute: async (params: { repo: string; path: string }) => {
              const result = getRepoPath(params.repo);
              if ('error' in result) return { error: result.error };
              const repoPath = result.path;

              const { resolve: pathResolve, join: pathJoin, extname } = await import('path');
              const filePath = pathResolve(pathJoin(repoPath, params.path));
              if (!filePath.startsWith(pathResolve(repoPath))) {
                return { error: 'Path traversal not allowed' };
              }

              try {
                const { readFileSync, statSync } = await import('fs');
                const stat = statSync(filePath);
                if (stat.size > 2 * 1024 * 1024) return { error: 'File too large (>2MB).' };

                const content = readFileSync(filePath, 'utf-8');
                const allLines = content.split('\n');
                const ext = extname(params.path).toLowerCase();
                const language = extToLang(ext);
                const header = allLines.slice(0, 10).map((l, i) => `${i + 1}: ${l}`).join('\n');
                const definitions = extractDefinitions(allLines, language);
                const truncated = definitions.length >= 100;

                return {
                  path: params.path,
                  totalLines: allLines.length,
                  language,
                  header,
                  definitions: definitions.slice(0, 100),
                  ...(truncated ? { truncated } : {}),
                };
              } catch (err: any) {
                return { error: `Failed to read file: ${(err.message || '').substring(0, 200)}` };
              }
            },
          });
        }

        if (!disabledTools.has('repo_find_definition')) {
          tools.push({
            name: 'repo_find_definition',
            description: `Find definitions of classes, functions, types, etc. in a repository. Available repos: ${repoNames.join(', ')}`,
            parameters: z.object({
              repo: z.string().describe('Repository slug'),
              name: z.string().describe('Name of the class, function, type, or variable to find'),
              filePattern: z.string().optional().describe('File glob pattern to narrow search, e.g. "*.ts"'),
            }),
            execute: async (params: { repo: string; name: string; filePattern?: string }) => {
              const result = getRepoPath(params.repo);
              if ('error' in result) return { error: result.error };
              const repoPath = result.path;

              try {
                const { execSync } = await import('child_process');
                const pattern = `(class|interface|type|enum|function|const|let|var|export|def|struct)\\s+${params.name}\\b`;
                const prune = EXCLUDE_DIRS.map(d => `-name ${d}`).join(' -o ');
                const excludeFiles = EXCLUDE_FILES.map(f => `! -name '${f}'`).join(' ');
                const nameFilter = params.filePattern ? `-name '${params.filePattern}'` : '';
                const findCmd = `find . -maxdepth 20 \\( ${prune} \\) -prune -o -type f ${nameFilter} ${excludeFiles} -print`;
                const cmd = `${findCmd} | xargs grep -n -E -C 30 -- ${JSON.stringify(pattern)} | head -300`;
                const output = execSync(cmd, {
                  cwd: repoPath,
                  timeout: 10_000,
                  maxBuffer: 2 * 1024 * 1024,
                  encoding: 'utf-8',
                  shell: '/bin/sh',
                });

                const lines = output.split('\n');
                return { results: lines.slice(0, 50).join('\n'), truncated: lines.length > 50 };
              } catch (err: any) {
                const partial = typeof err.stdout === 'string' ? err.stdout : '';
                if (partial.length > 0) {
                  const lines = partial.split('\n');
                  return { results: lines.slice(0, 50).join('\n'), truncated: true };
                }
                if (err.status === 1 || err.status === 123) return { results: 'No definitions found', truncated: false };
                return { error: `Search failed: ${(err.message || '').substring(0, 200)}` };
              }
            },
          });
        }
      }
    }

    // ── Agent-assigned tools from database (N8N, DigitalOcean, REST_API, DATABASE, etc.) ──
    const chatCtx = context?.channelId ? { channelId: context.channelId, agentId: agent.id } : undefined;
    await this.buildAgentTools(agent.id, agent.orgId, tools, chatCtx);

    // ── Telegram Account tools (MTProto) ──
    const tgConfig = agent.telegramConfig as Record<string, any> | null;
    if (tgConfig?.apiId && tgConfig?.apiHash && tgConfig?.sessionString) {
      const accountConfig = {
        apiId: tgConfig.apiId,
        apiHash: tgConfig.apiHash,
        sessionString: tgConfig.sessionString,
      };

      tools.push(
        {
          name: 'tg_send_message',
          description: 'Send a message from the Telegram user account to a contact. Searches contacts by name.',
          parameters: z.object({
            contact: z.string().describe('Contact name to search for (e.g. "Mom", "John")'),
            text: z.string().describe('Message text to send'),
          }),
          execute: async (params: { contact: string; text: string }) =>
            this.telegramAccount.sendMessage(accountConfig, params.contact, params.text),
        },
        {
          name: 'tg_find_contact',
          description: 'Search Telegram contacts/dialogs by name.',
          parameters: z.object({
            query: z.string().describe('Name or part of name to search for'),
          }),
          execute: async (params: { query: string }) =>
            this.telegramAccount.findContact(accountConfig, params.query),
        },
        {
          name: 'tg_list_dialogs',
          description: 'List recent Telegram dialogs (conversations).',
          parameters: z.object({
            limit: z.number().optional().describe('Max dialogs to return (default 30)'),
          }),
          execute: async (params: { limit?: number }) =>
            this.telegramAccount.getDialogs(accountConfig, params.limit ?? 30),
        },
      );
    }

    // ── AGEMS Agent management ──
    tools.push({
      name: 'agems_manage_agents',
      description: `Manage AGEMS platform agents. Actions:
- "list" — list all agents in the org with id, name, mission, status, llmProvider, llmModel
- "get" — get agent details by id (includes assigned skills and tools)
- "update" — update agent fields (name, llmProvider, llmModel, systemPrompt, status, llmConfig, runtimeConfig)
- "create" — create a new agent. IMPORTANT: always use check_existing first to avoid duplicates, and search_catalog to prefer imports.
- "check_existing" — search existing org agents by role/mission similarity. Use BEFORE creating to avoid duplicates.
- "search_catalog" — search catalog for ready-made agents. Returns skills/tools included. ALWAYS try this before creating from scratch.
- "import_catalog" — import an agent from catalog by catalogAgentId. Auto-imports linked skills and tools.
- "archive" — archive an agent (set status ARCHIVED). Use to clean up duplicates or unused agents.
- "assign_tools" — assign a tool to an agent. Provide agentId and toolId.
- "list_tools" — list all available tools in the org.

WORKFLOW: search_catalog → check_existing → import or create → assign skills/tools.`,
      parameters: z.object({
        action: z.enum(['list', 'get', 'update', 'create', 'check_existing', 'search_catalog', 'import_catalog', 'archive', 'assign_tools', 'list_tools']).describe('Action to perform'),
        agentId: z.string().optional().describe('Agent ID (for get/update/archive/assign_tools)'),
        catalogAgentId: z.string().optional().describe('Catalog agent ID (for import_catalog)'),
        toolId: z.string().optional().describe('Tool ID (for assign_tools)'),
        query: z.string().optional().describe('Search term (for search_catalog, check_existing)'),
        create: z.object({
          name: z.string().describe('Agent name, e.g. "Alex — Frontend Developer"'),
          slug: z.string().describe('URL slug, e.g. "alex-frontend-dev"'),
          systemPrompt: z.string().describe('Instructions for the agent'),
          mission: z.string().optional().describe('Brief role description'),
          llmProvider: z.string().optional().describe('ANTHROPIC, OPENAI, GOOGLE, DEEPSEEK, MISTRAL, MINIMAX, GLM, XAI, COHERE, PERPLEXITY, TOGETHER, FIREWORKS, GROQ, MOONSHOT, QWEN, AI21, SAMBANOVA'),
          llmModel: z.string().optional().describe('e.g. deepseek-chat, claude-sonnet-4-5, gpt-4o'),
          type: z.string().optional().describe('AUTONOMOUS (default), ASSISTANT, REACTIVE'),
          values: z.array(z.string()).optional().describe('Agent values, e.g. ["quality", "speed"]'),
        }).optional().describe('Agent data (for create action)'),
        updates: z.object({
          name: z.string().optional(),
          llmProvider: z.string().optional(),
          llmModel: z.string().optional(),
          systemPrompt: z.string().optional(),
          status: z.string().optional().describe('ACTIVE, PAUSED, ARCHIVED'),
          llmConfig: z.string().optional().describe('JSON string'),
          runtimeConfig: z.string().optional().describe('JSON string'),
        }).optional().describe('Fields to update (for update action)'),
      }),
      execute: async (params: { action: string; agentId?: string; catalogAgentId?: string; toolId?: string; query?: string; create?: any; updates?: any }) => {
        switch (params.action) {
          case 'list': {
            const agents = await this.prisma.agent.findMany({
              where: { orgId: agent.orgId, status: { not: 'ARCHIVED' } },
              select: { id: true, name: true, slug: true, status: true, mission: true, llmProvider: true, llmModel: true },
              orderBy: { name: 'asc' },
            });
            return { agents };
          }
          case 'get': {
            if (!params.agentId) return { error: 'agentId is required' };
            const a = await this.prisma.agent.findFirst({
              where: { id: params.agentId, orgId: agent.orgId },
              select: {
                id: true, name: true, slug: true, status: true, llmProvider: true, llmModel: true,
                llmConfig: true, runtimeConfig: true, systemPrompt: true, mission: true,
                skills: { include: { skill: { select: { id: true, name: true, slug: true, description: true } } } },
                tools: { include: { tool: { select: { id: true, name: true, type: true } } } },
              },
            });
            if (!a) return { error: 'Agent not found' };
            return {
              ...a,
              skills: (a.skills as any[]).map(s => ({ ...s.skill, enabled: s.enabled })),
              tools: (a.tools as any[]).map(t => ({ ...t.tool, enabled: t.enabled, permissions: t.permissions })),
            };
          }
          case 'check_existing': {
            const q = params.query || '';
            if (!q) return { error: 'query is required — describe the role/mission you need' };
            const existing = await this.prisma.agent.findMany({
              where: {
                orgId: agent.orgId,
                status: { not: 'ARCHIVED' },
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { mission: { contains: q, mode: 'insensitive' } },
                  { systemPrompt: { contains: q, mode: 'insensitive' } },
                ],
              },
              select: { id: true, name: true, slug: true, status: true, mission: true, llmProvider: true, llmModel: true },
              orderBy: { name: 'asc' },
            });
            if (existing.length > 0) {
              return { found: existing, warning: `Found ${existing.length} existing agent(s) matching "${q}". Consider using/updating these instead of creating a new one.` };
            }
            return { found: [], note: `No existing agents match "${q}". Safe to create or import.` };
          }
          case 'create': {
            if (!params.create) return { error: 'create object is required with name, slug, systemPrompt' };
            const c = params.create;
            if (!c.name || !c.slug || !c.systemPrompt) return { error: 'name, slug, and systemPrompt are required' };
            // Auto-check for duplicates before creating
            const duplicates = await this.prisma.agent.findMany({
              where: {
                orgId: agent.orgId,
                status: { not: 'ARCHIVED' },
                OR: [
                  { name: { contains: c.name.split(/[—\-–]/)[0].trim(), mode: 'insensitive' } },
                  ...(c.mission ? [{ mission: { contains: c.mission.substring(0, 50), mode: 'insensitive' as const } }] : []),
                ],
              },
              select: { id: true, name: true, mission: true },
              take: 5,
            });
            // Auto-check catalog for similar agents
            const searchTerm = c.mission || c.name;
            const catalogMatches = await this.prisma.catalogAgent.findMany({
              where: { OR: [
                { name: { contains: searchTerm.split(/[—\-–]/)[0].trim(), mode: 'insensitive' } },
                { mission: { contains: searchTerm.substring(0, 50), mode: 'insensitive' } },
                { tags: { hasSome: searchTerm.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3) } },
              ] },
              select: { id: true, name: true, mission: true, tags: true },
              take: 3,
            });
            const warnings: string[] = [];
            if (duplicates.length > 0) {
              warnings.push(`⚠️ DUPLICATE WARNING: Found ${duplicates.length} similar agent(s): ${duplicates.map(d => `"${d.name}" (${d.id})`).join(', ')}. Consider using check_existing + update instead of creating.`);
            }
            if (catalogMatches.length > 0) {
              warnings.push(`💡 CATALOG TIP: Found ${catalogMatches.length} catalog agent(s) that may fit: ${catalogMatches.map(m => `"${m.name}" (${m.id})`).join(', ')}. Consider import_catalog for pre-configured agents with skills/tools.`);
            }
            // Only allow providers that have API keys configured in this org
            const availableKeys = await this.prisma.setting.findMany({
              where: { orgId: agent.orgId, key: { startsWith: 'llm_key_' }, value: { not: '' } },
              select: { key: true },
            });
            const availableProviders = availableKeys.map(k => k.key.replace('llm_key_', '').toUpperCase());
            // Use creator's provider as default (guaranteed to have a key)
            const safeProvider = availableProviders.includes(c.llmProvider?.toUpperCase()) ? c.llmProvider : agent.llmProvider;
            const safeModel = safeProvider === agent.llmProvider ? (c.llmModel || agent.llmModel) : (c.llmModel || 'deepseek-chat');
            const newAgent = await this.prisma.agent.create({
              data: {
                orgId: agent.orgId,
                name: c.name,
                slug: c.slug,
                systemPrompt: c.systemPrompt,
                mission: c.mission || '',
                type: (c.type as any) || 'AUTONOMOUS',
                llmProvider: safeProvider as any,
                llmModel: safeModel,
                values: c.values || [],
                llmConfig: {},
                runtimeConfig: {},
                ownerId: agent.ownerId,
                status: 'ACTIVE',
              },
              select: { id: true, name: true, slug: true, status: true, mission: true, llmProvider: true, llmModel: true },
            });
            return {
              success: true,
              agent: newAgent,
              ...(warnings.length > 0 ? { warnings } : {}),
              note: 'Agent created and ACTIVE. Next: use agems_manage_skills to assign skills, and assign_tools to give it tools.',
            };
          }
          case 'search_catalog': {
            const q = params.query || '';
            const results = await this.prisma.catalogAgent.findMany({
              where: q ? { OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
                { mission: { contains: q, mode: 'insensitive' } },
                { tags: { hasSome: [q.toLowerCase()] } },
              ] } : {},
              select: {
                id: true, name: true, slug: true, description: true, mission: true,
                tags: true, llmProvider: true, downloads: true,
                skillSlugs: true, toolSlugs: true,
              },
              orderBy: { downloads: 'desc' },
              take: 10,
            });
            return {
              results: results.map(r => ({
                ...r,
                skillsIncluded: r.skillSlugs?.length || 0,
                toolsIncluded: r.toolSlugs?.length || 0,
              })),
              note: 'Use import_catalog with catalogAgentId to import. Agents with skills/tools included are pre-configured and ready to work.',
            };
          }
          case 'import_catalog': {
            if (!params.catalogAgentId) return { error: 'catalogAgentId is required' };
            const item = await this.prisma.catalogAgent.findUnique({ where: { id: params.catalogAgentId } });
            if (!item) return { error: 'Catalog agent not found' };
            // Check slug uniqueness
            const suffix = Math.random().toString(36).substring(2, 8);
            let slug = item.slug;
            const existing = await this.prisma.agent.findFirst({ where: { slug, orgId: agent.orgId } });
            if (existing) slug = `${item.slug}-${suffix}`;
            // Override LLM provider to match what's available in this org
            const orgKeys = await this.prisma.setting.findMany({
              where: { orgId: agent.orgId, key: { startsWith: 'llm_key_' }, value: { not: '' } },
              select: { key: true },
            });
            const orgProviders = orgKeys.map(k => k.key.replace('llm_key_', '').toUpperCase());
            const importProvider = orgProviders.includes(item.llmProvider) ? item.llmProvider : agent.llmProvider;
            const importModel = importProvider === item.llmProvider ? item.llmModel : agent.llmModel;
            const imported = await this.prisma.agent.create({
              data: {
                orgId: agent.orgId, name: item.name, slug, avatar: item.avatar,
                type: item.type, systemPrompt: item.systemPrompt, mission: item.mission,
                llmProvider: importProvider, llmModel: importModel,
                llmConfig: item.llmConfig as any, runtimeConfig: item.runtimeConfig as any,
                values: item.values as any, metadata: item.metadata as any,
                ownerId: agent.ownerId, status: 'ACTIVE',
              },
              select: { id: true, name: true, slug: true, status: true, mission: true, llmProvider: true, llmModel: true },
            });
            // Import linked skills
            if (item.skillSlugs?.length) {
              for (const skillSlug of item.skillSlugs) {
                try {
                  let skill = await this.prisma.skill.findFirst({ where: { slug: skillSlug, orgId: agent.orgId } });
                  if (!skill) {
                    const cs = await this.prisma.catalogSkill.findUnique({ where: { slug: skillSlug } });
                    if (cs) skill = await this.prisma.skill.create({ data: { orgId: agent.orgId, name: cs.name, slug: cs.slug, description: cs.description, content: cs.content, version: cs.version, type: cs.type, entryPoint: cs.entryPoint, configSchema: cs.configSchema as any } });
                  }
                  if (skill) await this.prisma.agentSkill.create({ data: { agentId: imported.id, skillId: skill.id } }).catch(() => {});
                } catch {}
              }
            }
            // Import linked tools
            if (item.toolSlugs?.length) {
              for (const toolSlug of item.toolSlugs) {
                try {
                  let tool = await this.prisma.tool.findFirst({ where: { name: toolSlug, orgId: agent.orgId } });
                  if (!tool) {
                    const ct = await this.prisma.catalogTool.findUnique({ where: { slug: toolSlug } });
                    if (ct) tool = await this.prisma.tool.create({ data: { orgId: agent.orgId, name: ct.name, type: ct.type, config: ct.configTemplate as any, authType: ct.authType, authConfig: {} } });
                  }
                  if (tool) await this.prisma.agentTool.create({ data: { agentId: imported.id, toolId: tool.id, permissions: { read: true, write: false, execute: true } } }).catch(() => {});
                } catch {}
              }
            }
            // Auto-create default approval policy (SUPERVISED)
            await this.prisma.approvalPolicy.create({
              data: { agentId: imported.id, preset: 'SUPERVISED' },
            }).catch(() => {}); // ignore if already exists
            const skillCount = item.skillSlugs?.length || 0;
            const toolCount = item.toolSlugs?.length || 0;
            return {
              success: true,
              agent: imported,
              configured: { skills: skillCount, tools: toolCount, approvalPolicy: 'SUPERVISED' },
              note: `Imported "${item.name}" with ${skillCount} skills, ${toolCount} tools, and SUPERVISED approval policy. Agent is ACTIVE. Next: assign a position with agems_org_structure → assign_position.`,
            };
          }
          case 'update': {
            if (!params.agentId) return { error: 'agentId is required' };
            if (!params.updates) return { error: 'updates object is required' };
            const target = await this.prisma.agent.findFirst({ where: { id: params.agentId, orgId: agent.orgId } });
            if (!target) return { error: 'Agent not found' };
            const data: any = {};
            if (params.updates.name) data.name = params.updates.name;
            if (params.updates.llmProvider) data.llmProvider = params.updates.llmProvider;
            if (params.updates.llmModel) data.llmModel = params.updates.llmModel;
            if (params.updates.systemPrompt) data.systemPrompt = params.updates.systemPrompt;
            if (params.updates.status) data.status = params.updates.status;
            if (params.updates.llmConfig) data.llmConfig = JSON.parse(params.updates.llmConfig);
            if (params.updates.runtimeConfig) data.runtimeConfig = JSON.parse(params.updates.runtimeConfig);
            if (Object.keys(data).length === 0) return { error: 'No valid fields to update' };
            const updated = await this.prisma.agent.update({
              where: { id: params.agentId }, data,
              select: { id: true, name: true, llmProvider: true, llmModel: true, status: true },
            });
            return { success: true, agent: updated };
          }
          case 'archive': {
            if (!params.agentId) return { error: 'agentId is required' };
            const toArchive = await this.prisma.agent.findFirst({ where: { id: params.agentId, orgId: agent.orgId } });
            if (!toArchive) return { error: 'Agent not found' };
            if (toArchive.status === 'ARCHIVED') return { error: 'Agent is already archived' };
            await this.prisma.agent.update({ where: { id: params.agentId }, data: { status: 'ARCHIVED' } });
            return { success: true, note: `Agent "${toArchive.name}" archived. It will no longer appear in lists or receive tasks.` };
          }
          case 'assign_tools': {
            if (!params.agentId || !params.toolId) return { error: 'agentId and toolId are required' };
            const targetAgent = await this.prisma.agent.findFirst({ where: { id: params.agentId, orgId: agent.orgId } });
            if (!targetAgent) return { error: 'Agent not found' };
            const tool = await this.prisma.tool.findFirst({ where: { id: params.toolId, orgId: agent.orgId } });
            if (!tool) return { error: 'Tool not found in this org' };
            const existingLink = await this.prisma.agentTool.findUnique({ where: { agentId_toolId: { agentId: params.agentId, toolId: params.toolId } } });
            if (existingLink) return { error: 'Tool already assigned to this agent', agentToolId: existingLink.id };
            const at = await this.prisma.agentTool.create({
              data: { agentId: params.agentId, toolId: params.toolId, permissions: { read: true, write: false, execute: true } },
            });
            return { success: true, agentToolId: at.id, note: `Tool "${tool.name}" assigned to agent "${targetAgent.name}".` };
          }
          case 'list_tools': {
            const orgTools = await this.prisma.tool.findMany({
              where: { orgId: agent.orgId },
              select: { id: true, name: true, type: true, authType: true },
              orderBy: { name: 'asc' },
            });
            return { tools: orgTools };
          }
          default:
            return { error: 'Invalid action. Use: list, get, create, update, check_existing, search_catalog, import_catalog, archive, assign_tools, list_tools' };
        }
      },
    });

    // ── AGEMS Agent Skills management ──
    tools.push({
      name: 'agems_manage_skills',
      description: `Manage agent skills (knowledge/capabilities). Actions:
- "list_skills" — list all available skills in the platform
- "agent_skills" — list skills assigned to a specific agent (agentId required)
- "assign" — assign a skill to an agent
- "remove" — remove a skill from an agent
- "enable" / "disable" — toggle a skill on/off for an agent
Use agems_manage_agents to get agent IDs first.`,
      parameters: z.object({
        action: z.enum(['list_skills', 'agent_skills', 'assign', 'remove', 'enable', 'disable']).describe('Action to perform'),
        agentId: z.string().optional().describe('Agent ID (required for agent_skills/assign/remove/enable/disable)'),
        skillId: z.string().optional().describe('Skill ID (required for assign/remove/enable/disable)'),
      }),
      execute: async (params: { action: string; agentId?: string; skillId?: string }) => {
        switch (params.action) {
          case 'list_skills': {
            const skills = await this.prisma.skill.findMany({
              where: { OR: [{ orgId: null }, { orgId: agent.orgId }] },
              select: { id: true, name: true, slug: true, description: true, type: true },
              orderBy: { name: 'asc' },
            });
            return { skills };
          }
          case 'agent_skills': {
            if (!params.agentId) return { error: 'agentId is required' };
            const agentSkills = await this.prisma.agentSkill.findMany({
              where: { agentId: params.agentId },
              include: { skill: { select: { id: true, name: true, slug: true, description: true } } },
            });
            return { skills: agentSkills.map((as: any) => ({ ...as.skill, enabled: as.enabled, agentSkillId: as.id })) };
          }
          case 'assign': {
            if (!params.agentId || !params.skillId) return { error: 'agentId and skillId are required' };
            const existing = await this.prisma.agentSkill.findUnique({ where: { agentId_skillId: { agentId: params.agentId, skillId: params.skillId } } });
            if (existing) return { error: 'Skill already assigned', agentSkillId: existing.id };
            const as = await this.prisma.agentSkill.create({ data: { agentId: params.agentId, skillId: params.skillId, enabled: true } });
            return { success: true, agentSkillId: as.id };
          }
          case 'remove': {
            if (!params.agentId || !params.skillId) return { error: 'agentId and skillId are required' };
            const toDelete = await this.prisma.agentSkill.findUnique({ where: { agentId_skillId: { agentId: params.agentId, skillId: params.skillId } } });
            if (!toDelete) return { error: 'Skill not assigned to this agent' };
            await this.prisma.agentSkill.delete({ where: { id: toDelete.id } });
            return { success: true };
          }
          case 'enable':
          case 'disable': {
            if (!params.agentId || !params.skillId) return { error: 'agentId and skillId are required' };
            const record = await this.prisma.agentSkill.findUnique({ where: { agentId_skillId: { agentId: params.agentId, skillId: params.skillId } } });
            if (!record) return { error: 'Skill not assigned to this agent' };
            await this.prisma.agentSkill.update({ where: { id: record.id }, data: { enabled: params.action === 'enable' } });
            return { success: true, enabled: params.action === 'enable' };
          }
          default:
            return { error: 'Invalid action' };
        }
      },
    });

    // ── AGEMS Org Structure management ──
    tools.push({
      name: 'agems_org_structure',
      description: `Manage organization structure: departments, positions, and hierarchy. Actions:
- "get_structure" — view the full org tree (departments → positions → agents/humans)
- "create_department" — create a new department. Provide: title
- "create_position" — create a position. Provide: title, department (optional), parentId (optional), holderType (AGENT/HUMAN/HYBRID)
- "assign_position" — assign an agent or user to a position. Provide: positionId, agentId or userId
- "get_gaps" — analyze what positions are unfilled or what roles are missing
- "remove_position" — delete a position (must be unoccupied)
Use this to build a clear org hierarchy. Every agent should have a position.`,
      parameters: z.object({
        action: z.enum(['get_structure', 'create_department', 'create_position', 'assign_position', 'get_gaps', 'remove_position']).describe('Action to perform'),
        title: z.string().optional().describe('Department or position title (for create_department/create_position)'),
        department: z.string().optional().describe('Department name (for create_position)'),
        parentId: z.string().optional().describe('Parent position ID for hierarchy (for create_position)'),
        holderType: z.string().optional().describe('AGENT, HUMAN, or HYBRID (for create_position)'),
        positionId: z.string().optional().describe('Position ID (for assign_position/remove_position)'),
        agentId: z.string().optional().describe('Agent ID (for assign_position)'),
        userId: z.string().optional().describe('User ID (for assign_position)'),
      }),
      execute: async (params: { action: string; title?: string; department?: string; parentId?: string; holderType?: string; positionId?: string; agentId?: string; userId?: string }) => {
        switch (params.action) {
          case 'get_structure': {
            const positions = await this.prisma.orgPosition.findMany({
              where: { orgId: agent.orgId },
              include: {
                agent: { select: { id: true, name: true, status: true, mission: true } },
                user: { select: { id: true, name: true, email: true } },
              },
              orderBy: [{ department: 'asc' }, { title: 'asc' }],
            });
            // Group by department
            const departments: Record<string, any[]> = {};
            for (const pos of positions) {
              const dept = pos.department || 'Unassigned';
              if (!departments[dept]) departments[dept] = [];
              departments[dept].push({
                id: pos.id,
                title: pos.title,
                holderType: pos.holderType,
                parentId: pos.parentId,
                agent: pos.agent ? { id: pos.agent.id, name: pos.agent.name, status: pos.agent.status } : null,
                user: pos.user ? { id: pos.user.id, name: pos.user.name } : null,
                filled: !!(pos.agentId || pos.userId),
              });
            }
            // Also list agents WITHOUT positions
            const agentsWithPositions = positions.filter(p => p.agentId).map(p => p.agentId);
            const unassignedAgents = await this.prisma.agent.findMany({
              where: { orgId: agent.orgId, status: { not: 'ARCHIVED' }, id: { notIn: agentsWithPositions as string[] } },
              select: { id: true, name: true, mission: true },
            });
            return {
              departments,
              unassignedAgents,
              summary: {
                totalPositions: positions.length,
                filledPositions: positions.filter(p => p.agentId || p.userId).length,
                unfilledPositions: positions.filter(p => !p.agentId && !p.userId).length,
                agentsWithoutPosition: unassignedAgents.length,
              },
            };
          }
          case 'create_department': {
            if (!params.title) return { error: 'title is required for department name' };
            // Create a root position representing the department head
            const pos = await this.prisma.orgPosition.create({
              data: {
                orgId: agent.orgId,
                title: `${params.title} — Head`,
                department: params.title,
                holderType: 'AGENT' as any,
              },
            });
            return { success: true, department: params.title, headPositionId: pos.id, note: `Department "${params.title}" created with head position. Use create_position to add roles under it.` };
          }
          case 'create_position': {
            if (!params.title) return { error: 'title is required' };
            const pos = await this.prisma.orgPosition.create({
              data: {
                orgId: agent.orgId,
                title: params.title,
                department: params.department || null,
                parentId: params.parentId || null,
                holderType: (params.holderType as any) || 'AGENT',
              },
            });
            return { success: true, position: { id: pos.id, title: pos.title, department: pos.department }, note: 'Position created. Use assign_position to assign an agent or user.' };
          }
          case 'assign_position': {
            if (!params.positionId) return { error: 'positionId is required' };
            if (!params.agentId && !params.userId) return { error: 'agentId or userId is required' };
            const pos = await this.prisma.orgPosition.findFirst({ where: { id: params.positionId, orgId: agent.orgId } });
            if (!pos) return { error: 'Position not found' };
            const updateData: any = {};
            if (params.agentId) {
              const targetAgent = await this.prisma.agent.findFirst({ where: { id: params.agentId, orgId: agent.orgId } });
              if (!targetAgent) return { error: 'Agent not found' };
              updateData.agentId = params.agentId;
              updateData.holderType = 'AGENT';
            }
            if (params.userId) {
              updateData.userId = params.userId;
              updateData.holderType = params.agentId ? 'HYBRID' : 'HUMAN';
            }
            await this.prisma.orgPosition.update({ where: { id: params.positionId }, data: updateData });
            return { success: true, note: `Position "${pos.title}" assigned.` };
          }
          case 'get_gaps': {
            const positions = await this.prisma.orgPosition.findMany({
              where: { orgId: agent.orgId },
              include: { agent: { select: { id: true, name: true, status: true } } },
            });
            const unfilled = positions.filter(p => !p.agentId && !p.userId);
            const filledWithInactive = positions.filter(p => p.agent && p.agent.status !== 'ACTIVE');
            const allAgents = await this.prisma.agent.findMany({
              where: { orgId: agent.orgId, status: 'ACTIVE' },
              select: { id: true, name: true, mission: true },
            });
            const agentIdsWithPos = new Set(positions.filter(p => p.agentId).map(p => p.agentId));
            const orphanAgents = allAgents.filter(a => !agentIdsWithPos.has(a.id));
            return {
              unfilledPositions: unfilled.map(p => ({ id: p.id, title: p.title, department: p.department })),
              inactiveHolders: filledWithInactive.map(p => ({ positionId: p.id, title: p.title, agent: p.agent })),
              agentsWithoutPosition: orphanAgents,
              recommendations: [
                ...(unfilled.length > 0 ? [`${unfilled.length} position(s) need agents — use search_catalog or check_existing to fill them.`] : []),
                ...(orphanAgents.length > 0 ? [`${orphanAgents.length} agent(s) have no position — assign them or archive if unused.`] : []),
                ...(filledWithInactive.length > 0 ? [`${filledWithInactive.length} position(s) held by non-ACTIVE agents — replace or reactivate.`] : []),
              ],
            };
          }
          case 'remove_position': {
            if (!params.positionId) return { error: 'positionId is required' };
            const pos = await this.prisma.orgPosition.findFirst({ where: { id: params.positionId, orgId: agent.orgId } });
            if (!pos) return { error: 'Position not found' };
            if (pos.agentId || pos.userId) return { error: 'Position is occupied. Unassign the holder first (assign_position with empty agentId).' };
            // Check for children
            const children = await this.prisma.orgPosition.findMany({ where: { parentId: params.positionId } });
            if (children.length > 0) return { error: `Position has ${children.length} child position(s). Remove or reassign them first.` };
            await this.prisma.orgPosition.delete({ where: { id: params.positionId } });
            return { success: true, note: `Position "${pos.title}" removed.` };
          }
          default:
            return { error: 'Invalid action. Use: get_structure, create_department, create_position, assign_position, get_gaps, remove_position' };
        }
      },
    });

    // ── AGEMS Company Profile management ──
    tools.push({
      name: 'agems_company_profile',
      description: `View and update the company profile. This context is injected into EVERY agent's system prompt — accurate info makes all agents smarter. Actions:
- "get" — view current company profile (all fields)
- "set" — update one or more fields. Fields: company_name, company_industry, company_description, company_mission, company_vision, company_goals, company_values, company_products, company_target_audience, company_tone, company_languages, company_website
If the profile is mostly empty, proactively ask the user about their company and fill it in.`,
      parameters: z.object({
        action: z.enum(['get', 'set']).describe('Action to perform'),
        data: z.record(z.string()).optional().describe('Key-value pairs to set (for set action). Keys must be from the allowed fields list.'),
      }),
      execute: async (params: { action: string; data?: Record<string, string> }) => {
        switch (params.action) {
          case 'get': {
            const profile = await this.settings.getCompanyProfile(agent.orgId);
            const filled = Object.entries(profile).filter(([, v]) => v).length;
            const total = Object.keys(profile).length;
            return {
              profile,
              completeness: `${filled}/${total} fields filled`,
              ...(filled < 3 ? { warning: 'Company profile is mostly empty! Ask the user about their company (name, industry, mission, products, audience) and fill it in. All agents use this context.' } : {}),
            };
          }
          case 'set': {
            if (!params.data || Object.keys(params.data).length === 0) return { error: 'data object is required with key-value pairs' };
            const updated = await this.settings.setCompanyProfile(params.data, agent.orgId);
            const filled = Object.entries(updated).filter(([, v]) => v).length;
            return { success: true, profile: updated, completeness: `${filled}/${Object.keys(updated).length} fields filled` };
          }
          default:
            return { error: 'Invalid action. Use: get, set' };
        }
      },
    });

    // ── AGEMS Tasks management ──
    tools.push({
      name: 'agems_tasks',
      description: `Manage tasks in AGEMS platform. Actions:
- "my_tasks" — list tasks assigned to YOU (the current agent). Optional status filter.
- "created_by_me" — list tasks YOU created. Optional status filter.
- "get" — get task details by id (includes comments and subtasks)
- "create" — create a new task (assign to yourself, another agent, or a human)
- "update" — update task status, result, or other fields
- "list_all" — list all tasks (optional filters: status, assigneeId, creatorId)
- "add_comment" — add a comment to a task (for progress updates, questions, blockers)
- "get_team" — list all agents and humans you can assign tasks to
Statuses: PENDING, IN_PROGRESS, IN_REVIEW, IN_TESTING, VERIFIED, COMPLETED, FAILED, BLOCKED, CANCELLED
Priorities: LOW, MEDIUM, HIGH, CRITICAL
Types: ONE_TIME (do once), RECURRING (repeats on cron schedule), CONTINUOUS (ongoing responsibility)
Your agent ID: ${agent.id} | Your name: ${agent.name}
WORKFLOW AS EXECUTOR: my_tasks → pick PENDING → set IN_PROGRESS → work → add_comment → set IN_REVIEW (NOT COMPLETED). A reviewer will check, then creator signs off.
WORKFLOW AS CREATOR: created_by_me → monitor progress → when VERIFIED → check results → set COMPLETED or back to IN_PROGRESS.
When creating tasks, set expectedResult (what success looks like) and optionally reviewerId, resultCheckAt.
You can create tasks for yourself and for other agents/humans based on company goals.`,
      parameters: z.object({
        action: z.enum(['my_tasks', 'created_by_me', 'get', 'create', 'update', 'list_all', 'add_comment', 'get_team']).describe('Action to perform'),
        taskId: z.string().optional().describe('Task ID (for get/update/add_comment)'),
        status: z.string().optional().describe('Filter by status (for my_tasks/created_by_me/list_all)'),
        assigneeId: z.string().optional().describe('Filter by assignee ID (for list_all)'),
        creatorId: z.string().optional().describe('Filter by creator ID (for list_all)'),
        comment: z.string().optional().describe('Comment text (for add_comment)'),
        task: z.object({
          title: z.string().optional(),
          description: z.string().optional(),
          status: z.string().optional(),
          priority: z.string().optional(),
          type: z.string().optional().describe('ONE_TIME, RECURRING, or CONTINUOUS'),
          cronExpression: z.string().optional().describe('Cron schedule for RECURRING tasks (e.g. "0 9 * * 1" = every Monday 9am)'),
          assigneeType: z.string().optional().describe('AGENT or HUMAN (default: AGENT)'),
          assigneeId: z.string().optional().describe('ID of agent or human to assign to (defaults to yourself)'),
          deadline: z.string().optional().describe('ISO date string'),
          result: z.string().optional().describe('JSON string of result data'),
          parentTaskId: z.string().optional(),
          expectedResult: z.string().optional().describe('What does success look like? Used for verification after completion.'),
          reviewerId: z.string().optional().describe('Agent ID of the reviewer/QA agent who will verify the work'),
          resultCheckAt: z.string().optional().describe('ISO date when to verify if expected result was achieved (for goals that take time)'),
          goalId: z.string().optional().describe('Link task to a goal by ID'),
        }).optional().describe('Task data (for create/update)'),
      }),
      execute: async (params: { action: string; taskId?: string; status?: string; assigneeId?: string; creatorId?: string; comment?: string; task?: any }) => {
        const selectFields = { id: true, title: true, description: true, status: true, priority: true, type: true, cronExpression: true, creatorType: true, creatorId: true, assigneeType: true, assigneeId: true, deadline: true, completedAt: true, result: true, parentTaskId: true, createdAt: true, updatedAt: true };
        switch (params.action) {
          case 'my_tasks': {
            const where: any = { assigneeType: 'AGENT', assigneeId: agent.id };
            if (params.status) where.status = params.status;
            const tasks = await this.prisma.task.findMany({ where, select: selectFields, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], take: 50 });
            return { tasks, count: tasks.length };
          }
          case 'created_by_me': {
            const where: any = { creatorType: 'AGENT', creatorId: agent.id };
            if (params.status) where.status = params.status;
            const tasks = await this.prisma.task.findMany({ where, select: selectFields, orderBy: { createdAt: 'desc' }, take: 50 });
            return { tasks, count: tasks.length };
          }
          case 'get': {
            if (!params.taskId) return { error: 'taskId is required' };
            const t = await this.prisma.task.findUnique({
              where: { id: params.taskId },
              include: {
                subtasks: { select: { id: true, title: true, status: true, priority: true, assigneeId: true } },
                comments: { orderBy: { createdAt: 'asc' }, select: { id: true, authorType: true, authorId: true, content: true, createdAt: true } },
              },
            });
            return t || { error: 'Task not found' };
          }
          case 'create': {
            if (!params.task?.title) return { error: 'task.title is required' };
            const assigneeType = (params.task.assigneeType as any) || 'AGENT';
            // Validate assignee exists in the same org
            let resolvedAssigneeId = params.task.assigneeId || agent.id;
            if (resolvedAssigneeId !== agent.id) {
              if (assigneeType === 'AGENT') {
                const assignee = await this.prisma.agent.findFirst({ where: { id: resolvedAssigneeId, orgId: agent.orgId } });
                if (!assignee) {
                  // Try to find by name (agents often hallucinate IDs)
                  const byName = await this.prisma.agent.findFirst({ where: { orgId: agent.orgId, name: { contains: resolvedAssigneeId, mode: 'insensitive' } } });
                  if (byName) {
                    resolvedAssigneeId = byName.id;
                  } else {
                    return { error: `Agent "${resolvedAssigneeId}" not found in your organization. Use get_team to see available agents.` };
                  }
                }
              }
            }
            // Build metadata from verification fields
            const taskMeta: any = {};
            if (params.task.expectedResult) taskMeta.expectedResult = params.task.expectedResult;
            if (params.task.reviewerId) taskMeta.reviewerId = params.task.reviewerId;
            if (params.task.resultCheckAt) taskMeta.resultCheckAt = params.task.resultCheckAt;
            const newTask = await this.prisma.task.create({
              data: {
                orgId: agent.orgId,
                title: params.task.title,
                description: params.task.description || null,
                status: 'PENDING',
                priority: (params.task.priority as any) || 'MEDIUM',
                type: (params.task.type as any) || 'ONE_TIME',
                cronExpression: params.task.cronExpression || null,
                creatorType: 'AGENT',
                creatorId: agent.id,
                assigneeType,
                assigneeId: resolvedAssigneeId,
                deadline: params.task.deadline ? new Date(params.task.deadline) : null,
                parentTaskId: params.task.parentTaskId || null,
                goalId: params.task.goalId || null,
                metadata: Object.keys(taskMeta).length > 0 ? taskMeta : undefined,
              },
              select: selectFields,
            });
            this.events.emit('task.created', newTask);
            return { success: true, task: newTask };
          }
          case 'update': {
            if (!params.taskId) return { error: 'taskId is required' };
            if (!params.task) return { error: 'task object is required' };
            const data: any = {};
            if (params.task.title) data.title = params.task.title;
            if (params.task.description !== undefined) data.description = params.task.description;
            if (params.task.status) {
              data.status = params.task.status;
              if (params.task.status === 'COMPLETED') data.completedAt = new Date();
            }
            if (params.task.priority) data.priority = params.task.priority;
            if (params.task.type) data.type = params.task.type;
            if (params.task.cronExpression !== undefined) data.cronExpression = params.task.cronExpression || null;
            if (params.task.deadline) data.deadline = new Date(params.task.deadline);
            if (params.task.result) data.result = JSON.parse(params.task.result);
            if (params.task.assigneeId) { data.assigneeId = params.task.assigneeId; data.assigneeType = params.task.assigneeType || 'AGENT'; }
            // Merge verification metadata
            if (params.task.expectedResult || params.task.reviewerId || params.task.resultCheckAt) {
              const existing = await this.prisma.task.findUnique({ where: { id: params.taskId }, select: { metadata: true } });
              const meta = (existing?.metadata as any) || {};
              if (params.task.expectedResult) meta.expectedResult = params.task.expectedResult;
              if (params.task.reviewerId) meta.reviewerId = params.task.reviewerId;
              if (params.task.resultCheckAt) meta.resultCheckAt = params.task.resultCheckAt;
              data.metadata = meta;
            }
            if (Object.keys(data).length === 0) return { error: 'No valid fields to update' };
            const updated = await this.prisma.task.update({ where: { id: params.taskId }, data, select: selectFields });
            this.events.emit('task.updated', updated);
            return { success: true, task: updated };
          }
          case 'add_comment': {
            if (!params.taskId) return { error: 'taskId is required' };
            if (!params.comment) return { error: 'comment text is required' };
            const comment = await this.prisma.taskComment.create({
              data: { taskId: params.taskId, authorType: 'AGENT', authorId: agent.id, content: params.comment },
            });
            return { success: true, comment };
          }
          case 'get_team': {
            const [teamAgents, teamMembers] = await Promise.all([
              this.prisma.agent.findMany({
                where: { orgId: agent.orgId, status: { not: 'ARCHIVED' } },
                select: { id: true, name: true, mission: true, status: true },
                orderBy: { name: 'asc' },
              }),
              this.prisma.orgMember.findMany({
                where: { orgId: agent.orgId },
                include: { user: { select: { id: true, name: true, email: true } } },
              }),
            ]);
            return { agents: teamAgents, humans: teamMembers.map(m => ({ id: m.user.id, name: m.user.name, email: m.user.email, role: m.role })), note: 'Use assigneeType="AGENT" for agents, assigneeType="HUMAN" for humans' };
          }
          case 'list_all': {
            const where: any = { orgId: agent.orgId };
            if (params.status) where.status = params.status;
            if (params.assigneeId) where.assigneeId = params.assigneeId;
            if (params.creatorId) where.creatorId = params.creatorId;
            const tasks = await this.prisma.task.findMany({ where, select: selectFields, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], take: 50 });
            return { tasks, count: tasks.length };
          }
          default:
            return { error: 'Invalid action' };
        }
      },
    });

    // ── AGEMS Goals management ──
    tools.push({
      name: 'agems_goals',
      description: `Manage goals in AGEMS platform. Actions:
- "my_goals" — list goals assigned to YOU (the current agent). Optional status filter.
- "org_goals" — list all organization goals. Optional status/priority filter.
- "get" — get goal details by id (includes tasks, children, parent)
- "create" — create a new goal (assign to yourself or another agent)
- "update" — update goal status, progress, or other fields
- "create_child" — create a child/sub-goal under a parent goal
Statuses: PLANNED, ACTIVE, ACHIEVED, CANCELLED, PAUSED
Priorities: LOW, MEDIUM, HIGH, CRITICAL
Owner types: AGENT, HUMAN
Your agent ID: ${agent.id} | Your name: ${agent.name}
WORKFLOW: Receive goal → plan tasks (use agems_tasks) → update progress → mark ACHIEVED when all tasks complete.
When creating tasks for a goal, always set goalId so tasks are linked to the goal.`,
      parameters: z.object({
        action: z.enum(['my_goals', 'org_goals', 'get', 'create', 'update', 'create_child']).describe('Action to perform'),
        goalId: z.string().optional().describe('Goal ID (for get/update/create_child)'),
        status: z.string().optional().describe('Filter by status'),
        priority: z.string().optional().describe('Filter by priority'),
        goal: z.object({
          title: z.string().optional(),
          description: z.string().optional(),
          status: z.string().optional(),
          priority: z.string().optional(),
          progress: z.number().optional().describe('0-100 progress percentage'),
          ownerType: z.string().optional().describe('AGENT or HUMAN'),
          ownerId: z.string().optional(),
          agentId: z.string().optional().describe('Agent assigned to achieve this goal'),
          projectId: z.string().optional(),
          targetDate: z.string().optional().describe('ISO date string'),
          metadata: z.any().optional(),
        }).optional().describe('Goal data (for create/update/create_child)'),
      }),
      execute: async (params: { action: string; goalId?: string; status?: string; priority?: string; goal?: any }) => {
        const selectFields = { id: true, title: true, description: true, status: true, priority: true, progress: true, ownerType: true, ownerId: true, agentId: true, projectId: true, parentId: true, targetDate: true, achievedAt: true, createdAt: true, updatedAt: true };
        switch (params.action) {
          case 'my_goals': {
            const where: any = { orgId: agent.orgId, agentId: agent.id };
            if (params.status) where.status = params.status;
            const goals = await this.prisma.goal.findMany({
              where,
              select: { ...selectFields, tasks: { select: { id: true, title: true, status: true } }, children: { select: { id: true, title: true, status: true, progress: true } } },
              orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
              take: 30,
            });
            return { goals, count: goals.length };
          }
          case 'org_goals': {
            const where: any = { orgId: agent.orgId };
            if (params.status) where.status = params.status;
            if (params.priority) where.priority = params.priority;
            const goals = await this.prisma.goal.findMany({
              where,
              select: { ...selectFields, tasks: { select: { id: true, status: true } }, children: { select: { id: true, status: true } } },
              orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
              take: 50,
            });
            return { goals, count: goals.length };
          }
          case 'get': {
            if (!params.goalId) return { error: 'goalId is required' };
            const g = await this.prisma.goal.findUnique({
              where: { id: params.goalId },
              include: {
                children: { select: { id: true, title: true, status: true, progress: true, agentId: true } },
                parent: { select: { id: true, title: true, status: true } },
                tasks: { orderBy: { createdAt: 'asc' }, select: { id: true, title: true, status: true, priority: true, assigneeId: true, assigneeType: true } },
                agent: { select: { id: true, name: true } },
                project: { select: { id: true, name: true } },
              },
            });
            return g || { error: 'Goal not found' };
          }
          case 'create': {
            if (!params.goal?.title) return { error: 'goal.title is required' };
            const newGoal = await this.prisma.goal.create({
              data: {
                orgId: agent.orgId,
                title: params.goal.title,
                description: params.goal.description || null,
                status: params.goal.status ?? 'PLANNED',
                priority: (params.goal.priority as any) ?? 'MEDIUM',
                ownerType: (params.goal.ownerType as any) ?? 'AGENT',
                ownerId: params.goal.ownerId || agent.id,
                agentId: params.goal.agentId || agent.id,
                projectId: params.goal.projectId || null,
                targetDate: params.goal.targetDate ? new Date(params.goal.targetDate) : null,
                metadata: params.goal.metadata ?? null,
              },
              select: selectFields,
            });
            this.events.emit('goal.created', newGoal);
            return { success: true, goal: newGoal };
          }
          case 'update': {
            if (!params.goalId) return { error: 'goalId is required' };
            if (!params.goal) return { error: 'goal object is required' };
            const data: any = {};
            if (params.goal.title) data.title = params.goal.title;
            if (params.goal.description !== undefined) data.description = params.goal.description;
            if (params.goal.status) {
              data.status = params.goal.status;
              if (params.goal.status === 'ACHIEVED') data.achievedAt = new Date();
            }
            if (params.goal.priority) data.priority = params.goal.priority;
            if (params.goal.progress !== undefined) data.progress = params.goal.progress;
            if (params.goal.agentId !== undefined) data.agentId = params.goal.agentId || null;
            if (params.goal.projectId !== undefined) data.projectId = params.goal.projectId || null;
            if (params.goal.targetDate !== undefined) data.targetDate = params.goal.targetDate ? new Date(params.goal.targetDate) : null;
            if (params.goal.metadata !== undefined) data.metadata = params.goal.metadata;
            if (Object.keys(data).length === 0) return { error: 'No valid fields to update' };
            const updated = await this.prisma.goal.update({ where: { id: params.goalId }, data, select: selectFields });
            this.events.emit('goal.updated', updated);
            return { success: true, goal: updated };
          }
          case 'create_child': {
            if (!params.goalId) return { error: 'goalId (parent) is required' };
            if (!params.goal?.title) return { error: 'goal.title is required' };
            const child = await this.prisma.goal.create({
              data: {
                orgId: agent.orgId,
                title: params.goal.title,
                description: params.goal.description || null,
                status: params.goal.status ?? 'PLANNED',
                priority: (params.goal.priority as any) ?? 'MEDIUM',
                ownerType: (params.goal.ownerType as any) ?? 'AGENT',
                ownerId: params.goal.ownerId || agent.id,
                agentId: params.goal.agentId || agent.id,
                parentId: params.goalId,
                projectId: params.goal.projectId || null,
                targetDate: params.goal.targetDate ? new Date(params.goal.targetDate) : null,
                metadata: params.goal.metadata ?? null,
              },
              select: selectFields,
            });
            this.events.emit('goal.created', child);
            return { success: true, goal: child };
          }
          default:
            return { error: 'Invalid action' };
        }
      },
    });

    // ── AGEMS Channels — inter-agent communication ──
    tools.push({
      name: 'agems_channels',
      description: `Communicate via AGEMS channels. Actions:
- "my_channels" — list channels you participate in (id, name, type, participantCount)
- "send_message" — send a message to a channel (channelId + message required)
- "send_dm" — send a direct message to another agent or human (recipientId + recipientType + message). Finds or creates a DM channel automatically.
- "get_messages" — read recent messages from a channel (channelId required, returns last 20)
Use this to coordinate with other agents, share task updates, ask questions, and report results.
Always reference task IDs when discussing work.
Your agent ID: ${agent.id} | Your name: ${agent.name}`,
      parameters: z.object({
        action: z.enum(['my_channels', 'send_message', 'send_dm', 'get_messages']).describe('Action to perform'),
        channelId: z.string().optional().describe('Channel ID (for send_message/get_messages)'),
        message: z.string().optional().describe('Message text to send'),
        recipientId: z.string().optional().describe('Agent or Human ID (for send_dm)'),
        recipientType: z.enum(['AGENT', 'HUMAN']).optional().describe('Recipient type (for send_dm)'),
      }),
      execute: async (params: { action: string; channelId?: string; message?: string; recipientId?: string; recipientType?: 'AGENT' | 'HUMAN' }) => {
        switch (params.action) {
          case 'my_channels': {
            const participations = await this.prisma.channelParticipant.findMany({
              where: { participantType: 'AGENT', participantId: agent.id },
              select: { channelId: true },
            });
            const channelIds = participations.map(p => p.channelId);
            if (channelIds.length === 0) return { channels: [], count: 0 };
            const channels = await this.prisma.channel.findMany({
              where: { id: { in: channelIds } },
              select: { id: true, name: true, type: true, _count: { select: { participants: true } } },
              orderBy: { createdAt: 'desc' },
              take: 30,
            });
            return { channels: channels.map((c: any) => ({ id: c.id, name: c.name, type: c.type, participantCount: c._count.participants })), count: channels.length };
          }
          case 'send_message': {
            if (!params.channelId) return { error: 'channelId is required' };
            if (!params.message) return { error: 'message is required' };
            const msg = await this.comms.sendMessage(
              params.channelId,
              { content: params.message, contentType: 'TEXT' },
              'AGENT',
              agent.id,
            );
            return { success: true, messageId: msg.id };
          }
          case 'send_dm': {
            if (!params.recipientId) return { error: 'recipientId is required. Use get_team to find correct IDs.' };
            if (!params.message) return { error: 'message is required' };
            const recipientType = params.recipientType || 'AGENT';

            // Smart recipient resolution: accept name or UUID, validate existence
            let resolvedRecipientId = params.recipientId;
            const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRe.test(params.recipientId)) {
              // Not a UUID — try to find by name in the same org
              if (recipientType === 'AGENT') {
                const found = await this.prisma.agent.findFirst({
                  where: { orgId: agent.orgId, name: { contains: params.recipientId, mode: 'insensitive' }, status: { not: 'ARCHIVED' } },
                  select: { id: true },
                });
                if (found) { resolvedRecipientId = found.id; }
                else { return { error: `Agent "${params.recipientId}" not found in your organization. Use get_team to see available agents.` }; }
              } else {
                const found = await this.prisma.user.findFirst({
                  where: { memberships: { some: { orgId: agent.orgId } }, name: { contains: params.recipientId, mode: 'insensitive' } },
                  select: { id: true },
                });
                if (found) { resolvedRecipientId = found.id; }
                else { return { error: `Human "${params.recipientId}" not found in your organization. Use get_team to see available humans.` }; }
              }
            } else {
              // UUID provided — validate it exists in this org
              if (recipientType === 'AGENT') {
                const exists = await this.prisma.agent.findFirst({
                  where: { id: params.recipientId, orgId: agent.orgId },
                  select: { id: true },
                });
                if (!exists) { return { error: `Agent ID "${params.recipientId}" not found in your org. Use get_team to get correct IDs.` }; }
              } else {
                const exists = await this.prisma.user.findFirst({
                  where: { id: params.recipientId, memberships: { some: { orgId: agent.orgId } } },
                  select: { id: true },
                });
                if (!exists) { return { error: `Human ID "${params.recipientId}" not found in your org. Use get_team to get correct IDs.` }; }
              }
            }

            // Find existing DM channel between this agent and resolved recipient
            const existingChannel = await this.prisma.channel.findFirst({
              where: {
                type: 'DIRECT',
                AND: [
                  { participants: { some: { participantType: 'AGENT', participantId: agent.id } } },
                  { participants: { some: { participantType: recipientType, participantId: resolvedRecipientId } } },
                ],
              },
              select: { id: true },
            });
            let dmChannelId: string;
            if (existingChannel) {
              dmChannelId = existingChannel.id;
            } else {
              // Resolve recipient name for the channel
              let recipientName = 'Unknown';
              if (recipientType === 'AGENT') {
                const ra = await this.prisma.agent.findUnique({ where: { id: resolvedRecipientId }, select: { name: true } });
                if (ra) recipientName = ra.name;
              } else {
                const ru = await this.prisma.user.findUnique({ where: { id: resolvedRecipientId }, select: { name: true } });
                if (ru) recipientName = ru.name || 'Unknown';
              }
              // Create DM channel
              const newChannel = await this.prisma.channel.create({
                data: {
                  orgId: agent.orgId,
                  name: `${agent.name} & ${recipientName}`,
                  type: 'DIRECT',
                  participants: {
                    create: [
                      { participantType: 'AGENT', participantId: agent.id },
                      { participantType: recipientType, participantId: resolvedRecipientId },
                    ],
                  },
                },
              });
              dmChannelId = newChannel.id;
            }
            const msg = await this.comms.sendMessage(
              dmChannelId,
              { content: params.message, contentType: 'TEXT' },
              'AGENT',
              agent.id,
            );
            return { success: true, channelId: dmChannelId, messageId: msg.id };
          }
          case 'get_messages': {
            if (!params.channelId) return { error: 'channelId is required' };
            const messages = await this.prisma.message.findMany({
              where: { channelId: params.channelId },
              orderBy: { createdAt: 'desc' },
              take: 20,
              select: { id: true, senderType: true, senderId: true, content: true, contentType: true, createdAt: true },
            });
            // Resolve sender names
            const resolved = [];
            for (const m of messages.reverse()) {
              let senderName = m.senderId;
              if (m.senderType === 'AGENT') {
                const a = await this.prisma.agent.findUnique({ where: { id: m.senderId }, select: { name: true } });
                if (a) senderName = a.name;
              } else if (m.senderType === 'HUMAN') {
                const u = await this.prisma.user.findUnique({ where: { id: m.senderId }, select: { name: true } });
                if (u) senderName = u.name || m.senderId;
              }
              resolved.push({ id: m.id, sender: senderName, senderType: m.senderType, content: m.content?.substring(0, 500), createdAt: m.createdAt });
            }
            return { messages: resolved, count: resolved.length };
          }
          default:
            return { error: 'Invalid action' };
        }
      },
    });

    // ── AGEMS Meetings — schedule and manage meetings ──
    tools.push({
      name: 'agems_meetings',
      description: `Schedule and manage meetings in AGEMS. Actions:
- "create" — schedule a meeting (title, agenda, scheduledAt, participants required)
- "list" — list recent meetings (last 20)
- "get" — get meeting details by id (includes entries, decisions, participants)
Use meetings for multi-party discussions, planning sessions, reviews, and decision-making.`,
      parameters: z.object({
        action: z.enum(['create', 'list', 'get']).describe('Action to perform'),
        meetingId: z.string().optional().describe('Meeting ID (for get)'),
        meeting: z.object({
          title: z.string().optional().describe('Meeting title'),
          agenda: z.string().optional().describe('Meeting agenda/description'),
          scheduledAt: z.string().optional().describe('ISO date-time for the meeting'),
          participants: z.array(z.object({
            id: z.string(),
            type: z.enum(['AGENT', 'HUMAN']),
            role: z.enum(['CHAIR', 'MEMBER', 'OBSERVER']).optional(),
          })).optional().describe('List of participants'),
        }).optional().describe('Meeting data (for create)'),
      }),
      execute: async (params: { action: string; meetingId?: string; meeting?: any }) => {
        switch (params.action) {
          case 'create': {
            if (!params.meeting?.title) return { error: 'meeting.title is required' };
            if (!params.meeting?.scheduledAt) return { error: 'meeting.scheduledAt is required' };
            const participants = params.meeting.participants || [];
            // Ensure the creating agent is included
            const selfIncluded = participants.some((p: any) => p.type === 'AGENT' && p.id === agent.id);
            if (!selfIncluded) participants.push({ id: agent.id, type: 'AGENT', role: 'CHAIR' });
            const meeting = await this.prisma.meeting.create({
              data: {
                orgId: agent.orgId,
                title: params.meeting.title,
                agenda: params.meeting.agenda || null,
                scheduledAt: new Date(params.meeting.scheduledAt),
                status: 'SCHEDULED',
                creatorType: 'AGENT',
                creatorId: agent.id,
                participants: {
                  create: participants.map((p: any) => ({
                    participantType: p.type,
                    participantId: p.id,
                    role: p.role || 'MEMBER',
                  })),
                },
              },
              select: { id: true, title: true, scheduledAt: true, status: true },
            });
            return { success: true, meeting };
          }
          case 'list': {
            const meetings = await this.prisma.meeting.findMany({
              where: { orgId: agent.orgId },
              orderBy: { scheduledAt: 'desc' },
              take: 20,
              select: { id: true, title: true, status: true, scheduledAt: true, _count: { select: { participants: true } } },
            });
            return { meetings: meetings.map(m => ({ ...m, participantCount: m._count.participants })), count: meetings.length };
          }
          case 'get': {
            if (!params.meetingId) return { error: 'meetingId is required' };
            const m = await this.prisma.meeting.findUnique({
              where: { id: params.meetingId },
              include: {
                participants: { select: { participantType: true, participantId: true, role: true } },
                entries: { orderBy: { order: 'asc' }, select: { id: true, speakerType: true, speakerId: true, content: true, entryType: true, createdAt: true } },
                decisions: { select: { id: true, description: true, result: true } },
              },
            });
            return m || { error: 'Meeting not found' };
          }
          default:
            return { error: 'Invalid action' };
        }
      },
    });

    // ── AGEMS Approvals — request and resolve approvals between agents/humans ──
    tools.push({
      name: 'agems_approvals',
      description: `Request and manage approvals in AGEMS. Agents can request approval from other agents or humans, and resolve pending approval requests assigned to them.
Actions:
- "request" — create an approval request. Specify requestedFromType (AGENT or HUMAN), requestedFromId, subject (what needs approval), details (JSON context), priority (LOW/MEDIUM/HIGH/CRITICAL), taskId (optional link to task).
- "my_pending" — list approval requests waiting for YOU to resolve.
- "resolve" — approve or reject an approval request (approvalId required, decision: APPROVED or REJECTED, reason optional).
- "my_requests" — list approval requests YOU created (to check their status).
- "list_all" — list all approval requests (optional filters: status, agentId, requestedFromId).
Your agent ID: ${agent.id} | Your name: ${agent.name}
Use approvals when you need permission, sign-off, or confirmation from another agent or human before proceeding.
Examples: budget approval, deployment sign-off, content review, strategy confirmation.`,
      parameters: z.object({
        action: z.enum(['request', 'my_pending', 'resolve', 'my_requests', 'list_all']).describe('Action to perform'),
        requestedFromType: z.string().optional().describe('AGENT or HUMAN (for request action)'),
        requestedFromId: z.string().optional().describe('ID of agent or human to request approval from'),
        subject: z.string().optional().describe('What needs approval (for request action)'),
        details: z.string().optional().describe('JSON string with context/details for the approval'),
        priority: z.string().optional().describe('LOW, MEDIUM, HIGH, or CRITICAL (default: MEDIUM)'),
        taskId: z.string().optional().describe('Link approval to a task (optional)'),
        approvalId: z.string().optional().describe('Approval request ID (for resolve action)'),
        decision: z.string().optional().describe('APPROVED or REJECTED (for resolve action)'),
        reason: z.string().optional().describe('Reason for approval/rejection (for resolve action)'),
        status: z.string().optional().describe('Filter by status (for list_all/my_requests)'),
        agentId: z.string().optional().describe('Filter by requesting agent (for list_all)'),
        requestedFromIdFilter: z.string().optional().describe('Filter by approver (for list_all)'),
      }),
      execute: async (params: any) => {
        switch (params.action) {
          case 'request': {
            if (!params.subject) return { error: 'subject is required' };
            if (!params.requestedFromType || !params.requestedFromId) {
              return { error: 'requestedFromType and requestedFromId are required' };
            }
            let toolInput: any = {};
            if (params.details) {
              try { toolInput = JSON.parse(params.details); } catch { toolInput = { details: params.details }; }
            }
            toolInput._subject = params.subject;
            const request = await this.approvals.createRequest({
              agentId: agent.id,
              toolName: 'agent_approval_request',
              toolInput,
              category: 'EXECUTE',
              riskLevel: params.priority || 'MEDIUM',
              description: `${agent.name} requests approval: ${params.subject}`,
              taskId: params.taskId,
              requestedFromType: params.requestedFromType,
              requestedFromId: params.requestedFromId,
            });
            // Notify the approver via DM if they are an agent
            if (params.requestedFromType === 'AGENT') {
              try {
                const dmChannel = await this.prisma.channel.findFirst({
                  where: {
                    type: 'DIRECT',
                    AND: [
                      { participants: { some: { participantId: agent.id } } },
                      { participants: { some: { participantId: params.requestedFromId } } },
                    ],
                  },
                });
                if (dmChannel) {
                  await this.comms.sendMessage(
                    dmChannel.id,
                    { content: `Approval request from ${agent.name}: ${params.subject} (ID: ${request.id})`, contentType: 'TEXT' },
                    'AGENT', agent.id,
                  );
                }
              } catch { /* best effort DM */ }
            }
            return { success: true, approvalId: request.id, status: 'PENDING' };
          }
          case 'my_pending': {
            const pending = await this.approvals.getPendingForApprover('AGENT', agent.id, agent.orgId);
            return {
              approvals: pending.map((a: any) => ({
                id: a.id,
                from: a.agent?.name || a.agentId,
                fromAgentId: a.agentId,
                subject: a.description,
                toolInput: a.toolInput,
                riskLevel: a.riskLevel,
                taskId: a.taskId,
                createdAt: a.createdAt,
              })),
              count: pending.length,
            };
          }
          case 'resolve': {
            if (!params.approvalId) return { error: 'approvalId is required' };
            if (!params.decision || !['APPROVED', 'REJECTED'].includes(params.decision)) {
              return { error: 'decision must be APPROVED or REJECTED' };
            }
            try {
              const result = await this.approvals.resolveRequest(
                params.approvalId,
                params.decision as 'APPROVED' | 'REJECTED',
                'AGENT',
                agent.id,
                agent.orgId,
                params.reason,
              );
              return { success: true, approvalId: result.id, status: result.status };
            } catch (e: any) {
              return { error: e.message || 'Failed to resolve approval' };
            }
          }
          case 'my_requests': {
            const where: any = { agentId: agent.id };
            if (params.status) where.status = params.status;
            const requests = await this.prisma.approvalRequest.findMany({
              where,
              orderBy: { createdAt: 'desc' },
              take: 50,
            });
            return {
              approvals: requests.map((a: any) => ({
                id: a.id,
                subject: a.description,
                status: a.status,
                requestedFromType: a.requestedFromType,
                requestedFromId: a.requestedFromId,
                resolvedByType: a.resolvedByType,
                resolvedById: a.resolvedById,
                resolvedAt: a.resolvedAt,
                rejectionReason: a.rejectionReason,
                taskId: a.taskId,
                createdAt: a.createdAt,
              })),
              count: requests.length,
            };
          }
          case 'list_all': {
            const filters: any = { page: '1', pageSize: '50', orgId: agent.orgId };
            if (params.status) filters.status = params.status;
            if (params.agentId) filters.agentId = params.agentId;
            if (params.requestedFromIdFilter) filters.requestedFromId = params.requestedFromIdFilter;
            const result = await this.approvals.findAll(filters, agent.orgId);
            return result;
          }
          default:
            return { error: 'Invalid action' };
        }
      },
    });

    // ── Dashboard widget management ──
    const dashTools = await this.dashboard.getTools();
    const toolsList = dashTools.map((t: any) => `${t.type} "${t.name}" id=${t.id}`).join(', ');
    tools.push({
      name: 'dashboard_manage_widget',
      description: `Manage dashboard widgets. Actions: "list" (get current widgets), "add" (create new widget), "update" (edit existing), "remove" (delete widget).
Widget code is JavaScript that runs in the browser with helpers: query(toolId, sql), http(toolId, method, path, body?, params?), ctx.tools.
For "number" display, return a single value/string. For "breakdown", return array of {label, value}. For "chart", return array of {label, value}. For "table", return array of objects.
Available tools: ${toolsList || 'none'}.
Example code for number widget: const r = await query("TOOL_ID", "SELECT COUNT(*) as value FROM table"); return r.data?.[0]?.value ?? 0;`,
      parameters: z.object({
        action: z.enum(['list', 'add', 'update', 'remove']).describe('Action to perform'),
        widget: z.object({
          id: z.string().optional().describe('Widget ID (required for update/remove)'),
          title: z.string().optional().describe('Widget title'),
          code: z.string().optional().describe('JavaScript code for the widget'),
          display: z.enum(['number', 'breakdown', 'chart', 'table']).optional().describe('Display type'),
          refreshMin: z.number().optional().describe('Auto-refresh interval in minutes (0 = no refresh)'),
        }).optional().describe('Widget config (for add/update)'),
      }),
      execute: async (params: { action: string; widget?: any }) => {
        const widgets = await this.dashboard.getWidgets();
        switch (params.action) {
          case 'list':
            return { widgets };
          case 'add': {
            if (!params.widget?.title || !params.widget?.code) return { error: 'title and code are required' };
            const newWidget = {
              id: `w${Date.now()}`,
              title: params.widget.title,
              code: params.widget.code,
              display: params.widget.display || 'number',
              refreshMin: params.widget.refreshMin ?? 5,
            };
            widgets.push(newWidget);
            await this.dashboard.saveWidgets(widgets);
            return { success: true, widget: newWidget, message: 'Widget added. Refresh the dashboard page to see it.' };
          }
          case 'update': {
            if (!params.widget?.id) return { error: 'widget.id is required for update' };
            const idx = widgets.findIndex((w: any) => w.id === params.widget.id);
            if (idx === -1) return { error: `Widget ${params.widget.id} not found` };
            if (params.widget.title) widgets[idx].title = params.widget.title;
            if (params.widget.code) widgets[idx].code = params.widget.code;
            if (params.widget.display) widgets[idx].display = params.widget.display;
            if (params.widget.refreshMin !== undefined) widgets[idx].refreshMin = params.widget.refreshMin;
            await this.dashboard.saveWidgets(widgets);
            return { success: true, widget: widgets[idx], message: 'Widget updated. Refresh the dashboard page to see changes.' };
          }
          case 'remove': {
            if (!params.widget?.id) return { error: 'widget.id is required for remove' };
            const filtered = widgets.filter((w: any) => w.id !== params.widget.id);
            if (filtered.length === widgets.length) return { error: `Widget ${params.widget.id} not found` };
            await this.dashboard.saveWidgets(filtered);
            return { success: true, message: `Widget ${params.widget.id} removed. Refresh the dashboard page.` };
          }
          default:
            return { error: 'Invalid action. Use: list, add, update, remove' };
        }
      },
    });

    // ── Send image to chat channel ──
    if (context?.channelId) {
      tools.push({
        name: 'agems_send_image',
        description: `MANDATORY: Send an image to the chat as a visible photo. You MUST call this tool for EVERY image you want the user to see — writing "[Image: ...]" as text does NOT display images. After generating an image via api_call_google_gemini_ai, use the savedImages[].url from the response (e.g. /uploads/uuid.jpg) as the imageUrl parameter. Call this tool once per image.`,
        parameters: z.object({
          imageUrl: z.string().describe('Image URL path, e.g. /uploads/abc123.jpg'),
          caption: z.string().optional().describe('Optional caption text to show below the image'),
        }),
        execute: async (params: { imageUrl: string; caption?: string }) => {
          const url = params.imageUrl;
          const ext = url.split('.').pop()?.toLowerCase() || 'jpg';
          const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
          const mimetype = mimeMap[ext] || 'image/jpeg';
          const filename = url.split('/').pop() || 'image.jpg';

          // Verify file exists
          const cwd = process.cwd();
          const isMonorepoRoot = existsSync(join(cwd, 'apps', 'api')) && existsSync(join(cwd, 'apps', 'web'));
          const uploadsBase = isMonorepoRoot ? join(cwd, 'apps', 'web', 'public') : join(cwd, '..', 'web', 'public');
          const filePath = join(uploadsBase, url);
          if (!existsSync(filePath)) {
            return { error: `File not found: ${url}` };
          }

          const { statSync } = await import('fs');
          const size = statSync(filePath).size;

          // Ensure file is registered in DB (visible in /files)
          const existingRecord = await this.prisma.fileRecord.findFirst({ where: { filename } });
          if (!existingRecord) {
            await this.prisma.fileRecord.create({
              data: {
                orgId: agent.orgId,
                filename,
                originalName: params.caption || filename,
                mimetype,
                size,
                url,
                uploadedBy: 'AGENT',
                uploaderId: agent.id,
              },
            }).catch(() => {});
          }

          await this.comms.sendMessage(
            context.channelId!,
            {
              content: params.caption || 'Image',
              contentType: 'FILE',
              metadata: {
                files: [{ url, filename, mimetype, size, originalName: params.caption || filename }],
                text: params.caption || undefined,
              },
            },
            'AGENT',
            agent.id,
          );
          return { ok: true, sentTo: 'chat', imageUrl: url };
        },
      });

      // ── Send any file to chat as downloadable attachment ──
      tools.push({
        name: 'agems_send_file',
        description: 'Send a file to the chat as a downloadable attachment. The file appears as a clickable card with filename, size and download link. Use this after save_to_files or html_to_pdf to deliver reports, PDFs, CSVs, and other documents directly in the chat. The fileUrl must be a /uploads/ path (returned by save_to_files or html_to_pdf).',
        parameters: z.object({
          fileUrl: z.string().describe('File URL path from /uploads/, e.g. /uploads/abc123.pdf'),
          fileName: z.string().optional().describe('Display name for the file, e.g. "Weekly Report.pdf"'),
          message: z.string().optional().describe('Optional message text to show alongside the file'),
        }),
        execute: async (params: { fileUrl: string; fileName?: string; message?: string }) => {
          const url = params.fileUrl;
          const filename = url.split('/').pop() || 'file';
          const ext = ('.' + (filename.split('.').pop()?.toLowerCase() || 'bin'));

          // Verify file exists
          const cwd = process.cwd();
          const isMonorepoRoot = existsSync(join(cwd, 'apps', 'api')) && existsSync(join(cwd, 'apps', 'web'));
          const uploadsBase = isMonorepoRoot ? join(cwd, 'apps', 'web', 'public') : join(cwd, '..', 'web', 'public');
          const filePath = join(uploadsBase, url);
          if (!existsSync(filePath)) {
            return { error: `File not found: ${url}. Use save_to_files or html_to_pdf first to create the file.` };
          }

          const { statSync } = await import('fs');
          const size = statSync(filePath).size;
          const mimeMap: Record<string, string> = {
            '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv',
            '.json': 'application/json', '.md': 'text/markdown', '.html': 'text/html',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
            '.gif': 'image/gif', '.webp': 'image/webp',
          };
          const mimetype = mimeMap[ext] || 'application/octet-stream';
          const displayName = params.fileName || filename;

          // Ensure file is registered in DB
          const existingRecord = await this.prisma.fileRecord.findFirst({ where: { filename } });
          if (!existingRecord) {
            await this.prisma.fileRecord.create({
              data: {
                orgId: agent.orgId,
                filename,
                originalName: displayName,
                mimetype,
                size,
                url,
                uploadedBy: 'AGENT',
                uploaderId: agent.id,
              },
            }).catch(() => {});
          }

          await this.comms.sendMessage(
            context.channelId!,
            {
              content: params.message || displayName,
              contentType: 'FILE',
              metadata: {
                files: [{ url, filename, mimetype, size, originalName: displayName }],
                text: params.message || undefined,
              },
            },
            'AGENT',
            agent.id,
          );
          return { ok: true, sentTo: 'chat', fileUrl: url, fileName: displayName };
        },
      });
    }

    // ── List organisation files ──
    tools.push({
      name: 'list_org_files',
      description: 'List files uploaded to this organisation. Use to find logos, images, documents etc. Returns file URL, name, type and size.',
      parameters: z.object({
        search: z.string().optional().describe('Search by filename (case-insensitive)'),
        type: z.enum(['image', 'document', 'all']).optional().describe('Filter by type (default: all)'),
        limit: z.number().optional().describe('Max results (default 20)'),
      }),
      execute: async (params: { search?: string; type?: string; limit?: number }) => {
        const where: any = { orgId: agent.orgId };
        if (params.search) where.originalName = { contains: params.search, mode: 'insensitive' };
        if (params.type === 'image') where.mimetype = { startsWith: 'image/' };
        else if (params.type === 'document') where.mimetype = { not: { startsWith: 'image/' } };
        const files = await this.prisma.fileRecord.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: params.limit ?? 20,
          select: { id: true, originalName: true, url: true, mimetype: true, size: true, createdAt: true },
        });
        return { count: files.length, files };
      },
    });

    // ── Save file to organisation Files (copies to /uploads/ + registers in DB) ──
    tools.push({
      name: 'save_to_files',
      description: 'Save a file to the organisation Files library so it appears on the /files page and is downloadable by users. Use this after write_file to make reports, PDFs, CSVs etc. accessible. Copies the file from its current path into /uploads/ and registers it in the database.',
      parameters: z.object({
        sourcePath: z.string().describe('Absolute path to the file to save, e.g. /tmp/report.pdf'),
        name: z.string().optional().describe('Display name for the file (default: original filename)'),
        folderId: z.string().optional().describe('Folder ID to place the file in (default: root)'),
      }),
      execute: async (params: { sourcePath: string; name?: string; folderId?: string }) => {
        try {
          const { copyFileSync, statSync } = await import('fs');
          const { basename, extname: pathExtname } = await import('path');
          const safeSourcePath = this.resolveWorkspacePath(params.sourcePath, runtimeConfig);

          if (!existsSync(safeSourcePath)) {
            return { error: `File not found: ${params.sourcePath}` };
          }

          const stat = statSync(safeSourcePath);
          if (stat.size > 10 * 1024 * 1024) {
            return { error: 'File too large (max 10MB)' };
          }

          const origName = basename(safeSourcePath);
          const ext = pathExtname(origName).toLowerCase() || '.bin';
          const filename = `${randomUUID()}${ext}`;

          const cwd = process.cwd();
          const isMonorepoRoot = existsSync(join(cwd, 'apps', 'api')) && existsSync(join(cwd, 'apps', 'web'));
          const uploadsDir = isMonorepoRoot
            ? join(cwd, 'apps', 'web', 'public', 'uploads')
            : join(cwd, '..', 'web', 'public', 'uploads');
          if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

          copyFileSync(safeSourcePath, join(uploadsDir, filename));

          const mimeMap: Record<string, string> = {
            '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv',
            '.json': 'application/json', '.md': 'text/markdown',
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
            '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
            '.html': 'text/html', '.xml': 'application/xml',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          };
          const mimetype = mimeMap[ext] || 'application/octet-stream';
          const displayName = params.name || origName;
          const url = `/uploads/${filename}`;

          const record = await this.prisma.fileRecord.create({
            data: {
              orgId: agent.orgId,
              folderId: params.folderId || null,
              filename,
              originalName: displayName,
              mimetype,
              size: stat.size,
              url,
              uploadedBy: 'AGENT',
              uploaderId: agent.id,
            },
          });

          return { success: true, id: record.id, url, originalName: displayName, size: stat.size };
        } catch (err: any) {
          return { error: err.message };
        }
      },
    });

    // ── Convert HTML to PDF using headless Chromium ──
    tools.push({
      name: 'html_to_pdf',
      description: 'Convert an HTML file to PDF using headless Chromium. Write your report as HTML first (with write_file), then convert to PDF. The PDF is automatically saved to Files library. Returns the PDF URL for download.',
      parameters: z.object({
        htmlPath: z.string().describe('Absolute path to the HTML file, e.g. /tmp/report.html'),
        name: z.string().optional().describe('Display name for the PDF (default: derived from HTML filename)'),
        folderId: z.string().optional().describe('Folder ID to place the PDF in (default: root)'),
      }),
      execute: async (params: { htmlPath: string; name?: string; folderId?: string }) => {
        try {
          const { execFileSync } = await import('child_process');
          const { statSync, copyFileSync } = await import('fs');
          const { basename } = await import('path');
          const safeHtmlPath = this.resolveWorkspacePath(params.htmlPath, runtimeConfig);

          if (!existsSync(safeHtmlPath)) {
            return { error: `HTML file not found: ${params.htmlPath}` };
          }

          const pdfFilename = `${randomUUID()}.pdf`;
          const pdfTmpPath = `/tmp/${pdfFilename}`;

          // Convert HTML to PDF with Chromium
          const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';
          execFileSync(
            chromiumPath,
            [
              '--headless',
              '--disable-gpu',
              '--no-sandbox',
              '--disable-dev-shm-usage',
              `--print-to-pdf=${pdfTmpPath}`,
              `file://${safeHtmlPath}`,
            ],
            { timeout: 30000, stdio: 'pipe' },
          );

          if (!existsSync(pdfTmpPath)) {
            return { error: 'PDF generation failed — output file not created' };
          }

          // Copy to uploads and register in DB
          const cwd = process.cwd();
          const isMonorepoRoot = existsSync(join(cwd, 'apps', 'api')) && existsSync(join(cwd, 'apps', 'web'));
          const uploadsDir = isMonorepoRoot
            ? join(cwd, 'apps', 'web', 'public', 'uploads')
            : join(cwd, '..', 'web', 'public', 'uploads');
          if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

          copyFileSync(pdfTmpPath, join(uploadsDir, pdfFilename));
          const stat = statSync(pdfTmpPath);

          const displayName = params.name || basename(safeHtmlPath).replace(/\.html?$/i, '') + '.pdf';
          const url = `/uploads/${pdfFilename}`;

          const record = await this.prisma.fileRecord.create({
            data: {
              orgId: agent.orgId,
              folderId: params.folderId || null,
              filename: pdfFilename,
              originalName: displayName,
              mimetype: 'application/pdf',
              size: stat.size,
              url,
              uploadedBy: 'AGENT',
              uploaderId: agent.id,
            },
          });

          // Cleanup tmp
          try { const { unlinkSync } = await import('fs'); unlinkSync(pdfTmpPath); } catch {}

          return { success: true, id: record.id, url, originalName: displayName, size: stat.size };
        } catch (err: any) {
          return { error: err.message };
        }
      },
    });

    // ── Generate image with Gemini (handles base64 internally — never passes through LLM context) ──
    tools.push({
      name: 'gemini_generate_image',
      description: 'Generate an image using Google Gemini AI. Can include reference images (e.g. logo) from /uploads/. The image data is handled internally — you only provide the prompt and optional file paths. Returns saved image URL. Use agems_send_image to show the result.',
      parameters: z.object({
        prompt: z.string().describe('Text prompt describing the image to generate'),
        referenceImages: z.array(z.object({
          filePath: z.string().describe('Path to image file, e.g. /uploads/abc123.png'),
          description: z.string().optional().describe('What this image is (e.g. "company logo to embed")'),
        })).optional().describe('Reference images to include (e.g. logo). Max 3.'),
        model: z.string().optional().describe('Gemini model (default: gemini-3.1-flash-image-preview)'),
        aspectRatio: z.string().optional().describe('Aspect ratio hint in prompt, e.g. "1080x1080"'),
      }),
      execute: async (params: { prompt: string; referenceImages?: Array<{ filePath: string; description?: string }>; model?: string; aspectRatio?: string }) => {
        try {
          // Get Gemini API key from the agent's Google Gemini AI tool or settings
          let geminiApiKey: string | undefined;
          const geminiTool = await this.prisma.agentTool.findFirst({
            where: { agentId: agent.id, enabled: true, tool: { name: { contains: 'Gemini' } } },
            include: { tool: { select: { authConfig: true, config: true } } },
          });
          if (geminiTool?.tool?.authConfig) {
            const gAuth = geminiTool.tool.authConfig as any;
            const decryptedAuth = gAuth._enc ? decryptJson(gAuth._enc) as any : gAuth;
            geminiApiKey = decryptedAuth.apiKey;
          }
          if (!geminiApiKey) {
            geminiApiKey = await this.getApiKey('GOOGLE', agent.orgId);
          }
          if (!geminiApiKey) {
            return { error: 'No Google AI API key configured. Add a Google Gemini AI tool or set GOOGLE_AI_API_KEY.' };
          }

          const model = params.model || (geminiTool?.tool?.config as any)?.imageModel || 'gemini-3.1-flash-image-preview';
          const cwd = process.cwd();
          const isMonorepo = existsSync(join(cwd, 'apps', 'api')) && existsSync(join(cwd, 'apps', 'web'));
          const uploadsBase = isMonorepo ? join(cwd, 'apps', 'web', 'public') : join(cwd, '..', 'web', 'public');

          // Build Gemini request parts
          const parts: any[] = [];

          // Add reference images as inlineData
          if (params.referenceImages?.length) {
            for (const ref of params.referenceImages.slice(0, 3)) {
              let filePath = ref.filePath;
              if (filePath.startsWith('/uploads/')) {
                filePath = join(uploadsBase, filePath);
              }
              if (!existsSync(filePath)) {
                return { error: `Reference image not found: ${ref.filePath}` };
              }
              const buf = readFileSync(filePath);
              const ext = ref.filePath.split('.').pop()?.toLowerCase() || 'png';
              const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
              parts.push({
                inlineData: {
                  mimeType: mimeMap[ext] || 'image/png',
                  data: buf.toString('base64'),
                },
              });
              if (ref.description) {
                parts.push({ text: `[Above image: ${ref.description}]` });
              }
            }
          }

          // Add text prompt
          parts.push({ text: params.prompt });

          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
          const body = {
            contents: [{ parts }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          };

          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120000),
          });

          const data = await res.json();

          if (!res.ok) {
            return { error: `Gemini API error ${res.status}: ${JSON.stringify(data).substring(0, 500)}` };
          }

          // Extract and save generated images (with DB registration)
          const savedImages = this.extractAndSaveBase64Images(data, {
            orgId: agent.orgId,
            agentId: agent.id,
            promptHint: params.prompt.substring(0, 80),
          });
          if (savedImages.length === 0) {
            // Extract text response if any
            const textParts = data?.candidates?.[0]?.content?.parts?.filter((p: any) => p.text) || [];
            const textResponse = textParts.map((p: any) => p.text).join('\n');
            return { error: 'No image generated', textResponse: textResponse || 'Gemini did not return an image. Try rephrasing the prompt.' };
          }

          return {
            success: true,
            images: savedImages,
            note: 'Image saved. Use agems_send_image with the URL to show it in chat.',
          };
        } catch (err: any) {
          return { error: err.message };
        }
      },
    });

    // ── Meta page image upload (profile, cover, post photo) ──
    // Wraps the full Facebook Page image upload flow that the generic REST_API
    // tool can not do (multipart, page access token swap, set-cover round trip).
    // Reads the System User token from the Meta Ads API tool's authConfig.
    tools.push({
      name: 'meta_upload_page_image',
      description: 'Publish or upload an image to a Facebook Page or an Instagram Business account. Pass either a server upload path like /uploads/abc.jpg or a full https URL. Handles multipart upload, page-token resolution, and the Instagram container+publish dance automatically. CRITICAL: for Instagram posts the image MUST be at a public https URL that Meta can fetch — paths under /uploads/ on this server qualify. For Instagram you pass the linked Facebook Page id (NOT the IG user id) as fbPageId, and the tool will look up the connected IG account itself.',
      parameters: z.object({
        pageId: z.string().describe('Facebook Page id, e.g. 975102925697410. For Instagram posts pass the linked FB Page id, the tool resolves the IG account from it.'),
        imagePathOrUrl: z.string().describe('Either a path under /uploads/ (e.g. /uploads/abc.jpg) or a full https:// URL Meta can fetch'),
        kind: z.enum(['profile', 'cover', 'feed_photo', 'instagram_post']).describe('What to do. profile = FB page picture, cover = FB page cover photo, feed_photo = FB standalone photo post, instagram_post = publish a feed post on the linked Instagram Business account.'),
        caption: z.string().optional().describe('Caption for feed_photo or instagram_post'),
      }),
      execute: async (params: { pageId: string; imagePathOrUrl: string; kind: 'profile' | 'cover' | 'feed_photo' | 'instagram_post'; caption?: string }) => {
        try {
          // 1. Pull System User token from the agent's Meta Ads API tool
          const metaTool = await this.prisma.agentTool.findFirst({
            where: { agentId: agent.id, enabled: true, tool: { name: { contains: 'Meta', mode: 'insensitive' } } },
            include: { tool: { select: { authConfig: true } } },
          });
          if (!metaTool?.tool?.authConfig) {
            return { error: 'No Meta Ads API tool attached to this agent.' };
          }
          const rawAuth = metaTool.tool.authConfig as any;
          const authCfg = (rawAuth._enc ? decryptJson(rawAuth._enc) : rawAuth) as any;
          const suToken = authCfg.token || authCfg.apiKey || authCfg.bearerToken;
          if (!suToken) {
            return { error: 'Meta Ads API tool has no token configured.' };
          }

          // 2. Resolve page access token via me/accounts
          const accountsRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${encodeURIComponent(suToken)}`);
          const accountsData: any = await accountsRes.json();
          if (!accountsRes.ok || !accountsData.data) {
            return { error: 'me/accounts failed', details: accountsData };
          }
          const page = accountsData.data.find((p: any) => p.id === params.pageId);
          if (!page) {
            return { error: `Page ${params.pageId} not found in me/accounts. Available: ${accountsData.data.map((p: any) => `${p.id} (${p.name})`).join(', ')}` };
          }
          const pageToken: string = page.access_token;

          // 3a. Instagram post: container + publish flow, no local file needed
          if (params.kind === 'instagram_post') {
            // Resolve image to a public URL (Meta crawler must fetch it)
            let publicUrl: string;
            if (params.imagePathOrUrl.startsWith('http://') || params.imagePathOrUrl.startsWith('https://')) {
              publicUrl = params.imagePathOrUrl;
            } else {
              const cleanPath = params.imagePathOrUrl.startsWith('/') ? params.imagePathOrUrl : '/' + params.imagePathOrUrl;
              publicUrl = `https://survival.agems.ai${cleanPath}`;
            }
            // Resolve linked IG business account from the FB page
            const pageInfoRes = await fetch(`https://graph.facebook.com/v21.0/${params.pageId}?fields=instagram_business_account&access_token=${encodeURIComponent(pageToken)}`);
            const pageInfo: any = await pageInfoRes.json();
            const igId = pageInfo?.instagram_business_account?.id;
            if (!igId) return { error: `No Instagram Business account linked to FB page ${params.pageId}. Connect IG via Business Manager first.`, details: pageInfo };
            // Create media container
            const containerRes = await fetch(`https://graph.facebook.com/v21.0/${igId}/media`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `image_url=${encodeURIComponent(publicUrl)}&caption=${encodeURIComponent(params.caption || '')}&access_token=${encodeURIComponent(pageToken)}`,
            });
            const containerData: any = await containerRes.json();
            if (!containerRes.ok || !containerData.id) return { error: 'IG container creation failed', details: containerData };
            // Tiny wait so Meta finishes ingesting the image
            await new Promise((r) => setTimeout(r, 4000));
            // Publish
            const pubRes = await fetch(`https://graph.facebook.com/v21.0/${igId}/media_publish`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `creation_id=${encodeURIComponent(containerData.id)}&access_token=${encodeURIComponent(pageToken)}`,
            });
            const pubData: any = await pubRes.json();
            if (!pubRes.ok) return { error: 'IG publish failed', details: pubData, containerId: containerData.id };
            return { success: true, kind: 'instagram_post', igAccountId: igId, igPostId: pubData.id, containerId: containerData.id };
          }

          // 3. Resolve the image bytes (download if URL, otherwise read from /uploads/)
          const { promises: fsP } = await import('fs');
          const { join: pathJoin } = await import('path');
          let imageBytes: Buffer;

          if (params.imagePathOrUrl.startsWith('http://') || params.imagePathOrUrl.startsWith('https://')) {
            const dl = await fetch(params.imagePathOrUrl);
            if (!dl.ok) return { error: `Failed to download image: HTTP ${dl.status}` };
            imageBytes = Buffer.from(await dl.arrayBuffer());
          } else {
            const cwd = process.cwd();
            const isMonorepo = existsSync(pathJoin(cwd, 'apps', 'api')) && existsSync(pathJoin(cwd, 'apps', 'web'));
            const uploadsBase = isMonorepo ? pathJoin(cwd, 'apps', 'web', 'public') : pathJoin(cwd, '..', 'web', 'public');
            const cleanPath = params.imagePathOrUrl.startsWith('/') ? params.imagePathOrUrl.slice(1) : params.imagePathOrUrl;
            const localPath = pathJoin(uploadsBase, cleanPath);
            if (!existsSync(localPath)) return { error: `File not found at ${localPath}` };
            imageBytes = await fsP.readFile(localPath);
          }

          // 4. Build native multipart (Node 18+ FormData + Blob) and POST
          const endpoint =
            params.kind === 'profile'
              ? `https://graph.facebook.com/v21.0/${params.pageId}/picture`
              : `https://graph.facebook.com/v21.0/${params.pageId}/photos`;

          const form = new FormData();
          // Blob is available globally in Node 18+
          form.append('source', new Blob([new Uint8Array(imageBytes)], { type: 'image/jpeg' }), 'upload.jpg');
          form.append('access_token', pageToken);
          if (params.kind === 'cover') form.append('published', 'false');
          if (params.kind === 'feed_photo' && params.caption) form.append('caption', params.caption);

          const upRes = await fetch(endpoint, { method: 'POST', body: form });
          const upData: any = await upRes.json();
          if (!upRes.ok) return { error: 'Upload failed', details: upData };

          // 5. For cover, run the second call to actually set it
          if (params.kind === 'cover') {
            const photoId = upData.id;
            if (!photoId) return { error: 'No photo id returned from upload', details: upData };
            const setRes = await fetch(`https://graph.facebook.com/v21.0/${params.pageId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `cover=${encodeURIComponent(photoId)}&access_token=${encodeURIComponent(pageToken)}`,
            });
            const setData: any = await setRes.json();
            if (!setRes.ok) return { error: 'Cover set failed', details: setData, photoId };
            return { success: true, kind: 'cover', photoId, set: setData };
          }

          return { success: true, kind: params.kind, ...upData };
        } catch (err: any) {
          return { error: err.message || String(err) };
        }
      },
    });

    // ── Visual check: look at a web page or image and describe what you see ──
    // Uses MiniMax-Text-01 multimodal endpoint (image input → text output).
    // Mirrors the gemini_generate_image pattern: direct HTTP call, bypasses the LLM adapter,
    // so any agent on any provider can "see" a rendered page without changing their model.
    tools.push({
      name: 'visual_check',
      description: 'Look at a rendered web page (or a saved image in /uploads/) and get a text description back. Use this before approving ANY visual task: homepage edits, review pages, comparisons, hero sections, layout changes, brand asset placements. Pass a URL (the page will be screenshot-rendered in a real browser first) or a local /uploads/ path. Returns what is actually visible on the page: headings, readability, contrast issues, broken layouts, missing elements. This is the only way to verify visual output — a 200 status code means nothing.',
      parameters: z.object({
        url: z.string().describe('The page URL to render and look at, e.g. https://learnenglish.life/ or https://learnenglish.life/reviews/italki/. Alternatively an /uploads/ file path to analyze an already-saved image.'),
        question: z.string().optional().describe('What to look for. Default: general readability and contrast audit. Examples: "Any dark-on-dark text?", "Is the See Guru logo visible in the hero?", "Does the header navigation have all 5 links?", "Are all platform card headings readable?"'),
        viewportWidth: z.number().optional().describe('Viewport width in pixels, default 1400'),
      }),
      execute: async (params: { url: string; question?: string; viewportWidth?: number }) => {
        try {
          // Get MiniMax API key (same one used by the main LLM adapter for this org)
          const minimaxKey = await this.getApiKey('MINIMAX', agent.orgId);
          if (!minimaxKey) {
            return { error: 'MiniMax API key not configured. Visual check needs it for the image understanding model.' };
          }

          // Resolve the image bytes — either a local /uploads/ file or a freshly rendered screenshot.
          let imgBase64: string;
          let imgSource: string;
          const cwd = process.cwd();
          const isMonorepo = existsSync(join(cwd, 'apps', 'api')) && existsSync(join(cwd, 'apps', 'web'));
          const uploadsBase = isMonorepo ? join(cwd, 'apps', 'web', 'public') : join(cwd, '..', 'web', 'public');

          if (params.url.startsWith('/uploads/') || params.url.startsWith('uploads/')) {
            // Local image path
            const localPath = join(uploadsBase, params.url.replace(/^\/?uploads\//, 'uploads/'));
            if (!existsSync(localPath)) {
              return { error: `Image file not found: ${params.url}` };
            }
            imgBase64 = readFileSync(localPath).toString('base64');
            imgSource = `local file ${params.url}`;
          } else if (/^https?:\/\//.test(params.url)) {
            // Render via thum.io (free, no key, real browser)
            const viewport = params.viewportWidth || 1400;
            const shotUrl = `https://image.thum.io/get/width/${viewport}/noanimate/viewportWidth/${viewport}/${params.url}?cb=${Date.now()}`;
            const shotRes = await fetch(shotUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (AGEMS visual_check)' },
              signal: AbortSignal.timeout(60000),
            });
            if (!shotRes.ok) {
              return { error: `Screenshot service returned ${shotRes.status}. Try a different URL or use /uploads/ path.` };
            }
            const buf = Buffer.from(await shotRes.arrayBuffer());
            if (buf.length < 2000) {
              return { error: `Screenshot too small (${buf.length} bytes) — likely an error page, not a real render.` };
            }
            imgBase64 = buf.toString('base64');
            imgSource = `rendered screenshot of ${params.url}`;
          } else {
            return { error: 'url must start with https:// or /uploads/' };
          }

          const question = params.question || 'Describe every section heading you see on this page. Then list any readability problems: dark text on dark background, white or light text on light background, missing or invisible elements, broken layouts, overlapping content. Be specific about which element and what color combination.';

          // Call MiniMax-Text-01 multimodal endpoint directly
          const res = await fetch('https://api.minimax.io/v1/text/chatcompletion_v2', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${minimaxKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'MiniMax-Text-01',
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: question },
                    { type: 'image_url', image_url: { url: `data:image/png;base64,${imgBase64}` } },
                  ],
                },
              ],
              max_tokens: 1200,
            }),
            signal: AbortSignal.timeout(120000),
          });

          const data = await res.json();
          if (!res.ok) {
            return { error: `Visual check API error ${res.status}: ${JSON.stringify(data).substring(0, 400)}` };
          }

          const description = data?.choices?.[0]?.message?.content || '';
          if (!description) {
            return { error: 'No description returned', raw: JSON.stringify(data).substring(0, 400) };
          }

          return {
            success: true,
            source: imgSource,
            question,
            description,
          };
        } catch (err: any) {
          return { error: err.message };
        }
      },
    });

    // ── Google AdSense suite ──
    // Lets agents read AdSense earnings, list/create ad units, and fetch the embed snippet
    // (the actual <script>...</script> code) for any ad unit so they can paste it into pages.
    // Reads OAuth credentials from org settings: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN.
    {
      const adsenseTokenCache = ((this as any)._adsenseTokenCache ||= new Map<string, { token: string; expires: number }>());
      const getGoogleAccessToken = async (): Promise<string> => {
        const cached = adsenseTokenCache.get(agent.orgId);
        if (cached && cached.expires > Date.now() + 60_000) return cached.token;
        const clientId = await this.settings.get('GOOGLE_OAUTH_CLIENT_ID', agent.orgId);
        const clientSecret = await this.settings.get('GOOGLE_OAUTH_CLIENT_SECRET', agent.orgId);
        const refreshToken = await this.settings.get('GOOGLE_OAUTH_REFRESH_TOKEN', agent.orgId);
        if (!clientId || !clientSecret || !refreshToken) {
          throw new Error('Google OAuth credentials not configured (need GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN in org settings).');
        }
        const tres = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
          signal: AbortSignal.timeout(30_000),
        });
        const tdata: any = await tres.json().catch(() => ({}));
        if (!tres.ok || !tdata.access_token) {
          throw new Error(`Google token refresh failed: ${JSON.stringify(tdata).substring(0, 300)}`);
        }
        adsenseTokenCache.set(agent.orgId, { token: tdata.access_token, expires: Date.now() + ((tdata.expires_in || 3600) * 1000) });
        return tdata.access_token;
      };
      const adsenseFetch = async (path: string, init?: RequestInit): Promise<any> => {
        const token = await getGoogleAccessToken();
        const res = await fetch(`https://adsense.googleapis.com/v2${path}`, {
          ...init,
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
          signal: AbortSignal.timeout(60_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(`AdSense API ${res.status}: ${JSON.stringify(data).substring(0, 400)}`);
        }
        return data;
      };

      tools.push({
        name: 'adsense_list_ad_clients',
        description: 'List the AdSense ad clients (publisher accounts) connected to this org. Usually returns one entry such as ca-pub-XXXXXXXXX. Call this first — every other adsense_* tool needs the full ad client name (accounts/pub-X/adclients/ca-pub-X) returned here.',
        parameters: z.object({}),
        execute: async () => {
          try {
            const accounts = await adsenseFetch('/accounts');
            if (!accounts.accounts?.length) return { error: 'No AdSense accounts found' };
            const accountName = accounts.accounts[0].name;
            const clients = await adsenseFetch(`/${accountName}/adclients`);
            return { account: accountName, ad_clients: clients.adClients || [] };
          } catch (err: any) { return { error: err.message }; }
        },
      });

      tools.push({
        name: 'adsense_list_ad_units',
        description: 'List existing AdSense ad units (banner placements) under an ad client. Each entry includes name, displayName, state, and contentAdsSettings (size/type). Use the returned name with adsense_get_adcode to get the embed snippet.',
        parameters: z.object({
          adClient: z.string().describe('Full ad client name from adsense_list_ad_clients, e.g. accounts/pub-7792548915836467/adclients/ca-pub-7792548915836467'),
        }),
        execute: async (params: { adClient: string }) => {
          try {
            const data = await adsenseFetch(`/${params.adClient}/adunits`);
            return { ad_units: data.adUnits || [] };
          } catch (err: any) { return { error: err.message }; }
        },
      });

      tools.push({
        name: 'adsense_get_adcode',
        description: 'Fetch the HTML/JavaScript embed snippet for a specific AdSense ad unit. Returns the exact <script>...</script> code, ready to paste into a page or component (Astro, React, plain HTML).',
        parameters: z.object({
          adUnit: z.string().describe('Full ad unit name, e.g. accounts/pub-X/adclients/ca-pub-X/adunits/1234567890'),
        }),
        execute: async (params: { adUnit: string }) => {
          try {
            const data = await adsenseFetch(`/${params.adUnit}/adcode`);
            return { ad_code: data.adCode || '' };
          } catch (err: any) { return { error: err.message }; }
        },
      });

      tools.push({
        name: 'adsense_create_ad_unit',
        description: 'Create a new AdSense display ad unit. Use when you need a banner format that does not exist yet. After creation, call adsense_get_adcode with the returned name to get the embed snippet to paste into the site.',
        parameters: z.object({
          adClient: z.string().describe('Full ad client name from adsense_list_ad_clients'),
          displayName: z.string().describe('Human-readable name, e.g. "Homepage hero leaderboard" or "Review page sidebar 300x250"'),
          size: z.enum(['RESPONSIVE', 'FIXED']).optional().describe('RESPONSIVE (recommended, default) auto-sizes to container; FIXED uses width/height'),
          width: z.number().optional().describe('Width in px, only used when size=FIXED'),
          height: z.number().optional().describe('Height in px, only used when size=FIXED'),
        }),
        execute: async (params: any) => {
          try {
            const sizeStr = (params.size === 'FIXED' && params.width && params.height)
              ? `SIZE_${params.width}_${params.height}`
              : 'RESPONSIVE';
            const body = { displayName: params.displayName, contentAdsSettings: { type: 'DISPLAY', size: sizeStr } };
            const data = await adsenseFetch(`/${params.adClient}/adunits`, { method: 'POST', body: JSON.stringify(body) });
            return { ad_unit: data };
          } catch (err: any) { return { error: err.message }; }
        },
      });

      // Google Search Console — same OAuth, different host
      const gscFetch = async (path: string, init?: RequestInit): Promise<any> => {
        const token = await getGoogleAccessToken();
        const res = await fetch(`https://searchconsole.googleapis.com${path}`, {
          ...init,
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
          signal: AbortSignal.timeout(60_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(`Search Console API ${res.status}: ${JSON.stringify(data).substring(0, 400)}`);
        }
        return data;
      };

      // Google Analytics 4 — Data API for reports, Admin API for property listing
      const gaFetch = async (host: string, path: string, init?: RequestInit): Promise<any> => {
        const token = await getGoogleAccessToken();
        const res = await fetch(`https://${host}${path}`, {
          ...init,
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
          signal: AbortSignal.timeout(60_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(`Google Analytics API ${res.status}: ${JSON.stringify(data).substring(0, 400)}`);
        }
        return data;
      };
      const resolveGa4Property = async (param?: string): Promise<string> => {
        if (param) return param.startsWith('properties/') ? param : `properties/${param}`;
        const stored = await this.settings.get('GA4_PROPERTY_ID', agent.orgId);
        if (!stored) throw new Error('No GA4 property set. Pass propertyId or set GA4_PROPERTY_ID in org settings.');
        return stored.startsWith('properties/') ? stored : `properties/${stored}`;
      };

      tools.push({
        name: 'ga_list_properties',
        description: 'List all Google Analytics 4 properties (websites being tracked) the account can access. Returns each property name (e.g. properties/531486394), displayName, timeZone, currencyCode. Use the property name with other ga_* tools.',
        parameters: z.object({}),
        execute: async () => {
          try {
            const accs = await gaFetch('analyticsadmin.googleapis.com', '/v1beta/accounts');
            if (!accs.accounts?.length) return { error: 'No GA accounts found' };
            const all: any[] = [];
            for (const acc of accs.accounts) {
              const data = await gaFetch('analyticsadmin.googleapis.com', `/v1beta/properties?filter=parent:${acc.name}`);
              if (data.properties) all.push(...data.properties);
            }
            return { properties: all };
          } catch (err: any) { return { error: err.message }; }
        },
      });

      tools.push({
        name: 'ga_run_report',
        description: 'Run a Google Analytics 4 report: pull metrics like sessions, activeUsers, screenPageViews, conversions, totalRevenue across a date range, optionally grouped by dimensions like date, country, deviceCategory, pagePath, sessionSource, sessionMedium. Defaults to the configured site property if propertyId is omitted.',
        parameters: z.object({
          propertyId: z.string().optional().describe('GA4 property ID like 531486394 or properties/531486394. Omit to use the configured default.'),
          startDate: z.string().describe('Start date YYYY-MM-DD or relative like "7daysAgo", "yesterday", "today"'),
          endDate: z.string().describe('End date YYYY-MM-DD or relative like "today", "yesterday"'),
          metrics: z.array(z.string()).optional().describe('Metric names. Default: ["activeUsers","sessions","screenPageViews"]. Other useful: "newUsers","engagementRate","averageSessionDuration","conversions","totalRevenue","eventCount".'),
          dimensions: z.array(z.string()).optional().describe('Dimension names. Default: none (totals). Useful: "date","country","deviceCategory","pagePath","pageTitle","sessionSource","sessionMedium","sessionCampaignName".'),
          limit: z.number().optional().describe('Max rows to return, default 25'),
        }),
        execute: async (params: any) => {
          try {
            const property = await resolveGa4Property(params.propertyId);
            const body: any = {
              dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
              metrics: (params.metrics || ['activeUsers', 'sessions', 'screenPageViews']).map((name: string) => ({ name })),
              limit: params.limit || 25,
            };
            if (params.dimensions?.length) body.dimensions = params.dimensions.map((name: string) => ({ name }));
            const data = await gaFetch('analyticsdata.googleapis.com', `/v1beta/${property}:runReport`, {
              method: 'POST',
              body: JSON.stringify(body),
            });
            return data;
          } catch (err: any) { return { error: err.message }; }
        },
      });

      tools.push({
        name: 'ga_realtime',
        description: 'Get a real-time Google Analytics 4 report — who is on the site right now (last 30 minutes). Returns active users, optionally grouped by country, deviceCategory, or unifiedPageScreen (current page). Useful to check if a campaign or post just landed.',
        parameters: z.object({
          propertyId: z.string().optional().describe('GA4 property ID. Omit to use the configured default.'),
          dimensions: z.array(z.string()).optional().describe('Dimensions: country, deviceCategory, unifiedPageScreen. Default: none (single total).'),
        }),
        execute: async (params: any) => {
          try {
            const property = await resolveGa4Property(params.propertyId);
            const body: any = { metrics: [{ name: 'activeUsers' }] };
            if (params.dimensions?.length) body.dimensions = params.dimensions.map((name: string) => ({ name }));
            const data = await gaFetch('analyticsdata.googleapis.com', `/v1beta/${property}:runRealtimeReport`, {
              method: 'POST',
              body: JSON.stringify(body),
            });
            return data;
          } catch (err: any) { return { error: err.message }; }
        },
      });

      tools.push({
        name: 'gsc_list_sites',
        description: 'List all Google Search Console properties (websites) the account has access to. Returns each siteUrl and your permissionLevel. Use this first to find the property identifier (e.g. sc-domain:learnenglish.life) needed by the other gsc_* tools.',
        parameters: z.object({}),
        execute: async () => {
          try {
            const data = await gscFetch('/webmasters/v3/sites');
            return { sites: data.siteEntry || [] };
          } catch (err: any) { return { error: err.message }; }
        },
      });

      tools.push({
        name: 'gsc_search_analytics',
        description: 'Pull Google Search Console search analytics: clicks, impressions, CTR, average position. Group by query, page, country, or device. This is how you see what people search for to find the site, which pages they land on, and how the site is ranking. Data is available with ~2 day delay.',
        parameters: z.object({
          siteUrl: z.string().describe('Property identifier from gsc_list_sites, e.g. sc-domain:learnenglish.life'),
          startDate: z.string().describe('Start date YYYY-MM-DD'),
          endDate: z.string().describe('End date YYYY-MM-DD'),
          dimensions: z.array(z.enum(['query','page','country','device','date','searchAppearance'])).optional().describe('How to group rows. Default: ["query"] (top search queries). Use ["page"] to see top landing pages.'),
          rowLimit: z.number().optional().describe('Max rows to return, default 25, max 25000'),
        }),
        execute: async (params: { siteUrl: string; startDate: string; endDate: string; dimensions?: string[]; rowLimit?: number }) => {
          try {
            const body = {
              startDate: params.startDate,
              endDate: params.endDate,
              dimensions: params.dimensions || ['query'],
              rowLimit: params.rowLimit || 25,
            };
            const data = await gscFetch(`/webmasters/v3/sites/${encodeURIComponent(params.siteUrl)}/searchAnalytics/query`, {
              method: 'POST',
              body: JSON.stringify(body),
            });
            return { rows: data.rows || [], responseAggregationType: data.responseAggregationType };
          } catch (err: any) { return { error: err.message }; }
        },
      });

      tools.push({
        name: 'gsc_inspect_url',
        description: 'Inspect a specific URL in Google Search Console: is it indexed, when was it last crawled, is the sitemap referencing it, are there robots.txt or canonical issues. Use this to debug why a page is not showing up in search.',
        parameters: z.object({
          siteUrl: z.string().describe('Property identifier from gsc_list_sites, e.g. sc-domain:learnenglish.life'),
          inspectionUrl: z.string().describe('Full URL to inspect, e.g. https://learnenglish.life/reviews/see-guru/'),
        }),
        execute: async (params: { siteUrl: string; inspectionUrl: string }) => {
          try {
            const data = await gscFetch('/v1/urlInspection/index:inspect', {
              method: 'POST',
              body: JSON.stringify({ inspectionUrl: params.inspectionUrl, siteUrl: params.siteUrl }),
            });
            return data;
          } catch (err: any) { return { error: err.message }; }
        },
      });

      tools.push({
        name: 'gsc_submit_sitemap',
        description: 'Submit a sitemap.xml URL to Google Search Console so Google starts crawling it. Run once per sitemap. Returns success or an error if the sitemap is unreachable or malformed.',
        parameters: z.object({
          siteUrl: z.string().describe('Property identifier from gsc_list_sites, e.g. sc-domain:learnenglish.life'),
          sitemapUrl: z.string().describe('Full sitemap URL, e.g. https://learnenglish.life/sitemap.xml or https://learnenglish.life/sitemap-index.xml'),
        }),
        execute: async (params: { siteUrl: string; sitemapUrl: string }) => {
          try {
            await gscFetch(`/webmasters/v3/sites/${encodeURIComponent(params.siteUrl)}/sitemaps/${encodeURIComponent(params.sitemapUrl)}`, { method: 'PUT' });
            return { success: true, sitemap: params.sitemapUrl };
          } catch (err: any) { return { error: err.message }; }
        },
      });

      tools.push({
        name: 'adsense_earnings_report',
        description: 'Generate an AdSense earnings report for a date range. Returns metrics: ESTIMATED_EARNINGS, IMPRESSIONS, CLICKS, IMPRESSIONS_CTR, COST_PER_CLICK, PAGE_VIEWS. Use to track how the site is monetizing day-by-day or per ad unit.',
        parameters: z.object({
          startDate: z.string().describe('Start date YYYY-MM-DD, e.g. 2026-04-01'),
          endDate: z.string().describe('End date YYYY-MM-DD, e.g. 2026-04-07'),
          dimensions: z.array(z.string()).optional().describe('Optional dimensions to group by, e.g. ["DATE"], ["AD_UNIT_NAME"]. Default: totals only.'),
        }),
        execute: async (params: { startDate: string; endDate: string; dimensions?: string[] }) => {
          try {
            const accounts = await adsenseFetch('/accounts');
            if (!accounts.accounts?.length) return { error: 'No AdSense accounts found' };
            const accountName = accounts.accounts[0].name;
            const [sy, sm, sd] = params.startDate.split('-');
            const [ey, em, ed] = params.endDate.split('-');
            const qs = new URLSearchParams();
            qs.append('dateRange', 'CUSTOM');
            qs.append('startDate.year', sy); qs.append('startDate.month', String(parseInt(sm))); qs.append('startDate.day', String(parseInt(sd)));
            qs.append('endDate.year', ey); qs.append('endDate.month', String(parseInt(em))); qs.append('endDate.day', String(parseInt(ed)));
            for (const m of ['ESTIMATED_EARNINGS','IMPRESSIONS','CLICKS','IMPRESSIONS_CTR','COST_PER_CLICK','PAGE_VIEWS']) qs.append('metrics', m);
            for (const d of (params.dimensions || [])) qs.append('dimensions', d);
            const data = await adsenseFetch(`/${accountName}/reports:generate?${qs.toString()}`);
            return data;
          } catch (err: any) { return { error: err.message }; }
        },
      });
    }

    // ── Send photo to Telegram contact ──
    if (tgConfig?.apiId && tgConfig?.apiHash && tgConfig?.sessionString) {
      tools.push({
        name: 'tg_send_photo',
        description: 'Send a photo from the Telegram user account to a contact. The image must be in /uploads/ directory.',
        parameters: z.object({
          contact: z.string().describe('Contact name to search for'),
          imageUrl: z.string().describe('Image URL path, e.g. /uploads/abc123.jpg'),
          caption: z.string().optional().describe('Optional photo caption'),
        }),
        execute: async (params: { contact: string; imageUrl: string; caption?: string }) => {
          const accountConfig = {
            apiId: tgConfig.apiId,
            apiHash: tgConfig.apiHash,
            sessionString: tgConfig.sessionString,
          };
          return this.telegramAccount.sendPhoto(accountConfig, params.contact, params.imageUrl, params.caption);
        },
      });
    }

    // Filter out disabled built-in tools
    if (disabledTools.size > 0) {
      return tools.filter(t => !disabledTools.has(t.name));
    }
    return tools;
  }

  /** Collect MCP servers from runtimeConfig and MCP_SERVER agent tools */
  private async collectMcpServers(agentId: string, runtimeConfig: Record<string, unknown>): Promise<MCPServerConfig[]> {
    const servers: MCPServerConfig[] = [];

    // 1. From runtimeConfig.mcpServers (manually configured)
    const configServers = runtimeConfig.mcpServers as any[];
    if (Array.isArray(configServers)) {
      for (const s of configServers) {
        if (s?.name && s?.url) {
          servers.push({
            name: s.name,
            url: s.url,
            authorizationToken: s.authorizationToken ?? undefined,
            toolConfiguration: s.toolConfiguration ?? undefined,
          });
        }
      }
    }

    // 2. From MCP_SERVER type tools attached to the agent
    const mcpTools = await this.prisma.agentTool.findMany({
      where: { agentId, enabled: true, tool: { type: 'MCP_SERVER' } },
      include: { tool: true },
    });
    for (const at of mcpTools) {
      const config = at.tool.config as Record<string, any>;
      const rawAuth = (at.tool.authConfig as any) ?? {};
      const authConfig = rawAuth._enc ? decryptJson(rawAuth._enc) : rawAuth;
      if (config?.url) {
        servers.push({
          name: at.tool.name,
          url: config.url,
          authorizationToken: authConfig?.token ?? authConfig?.authorizationToken ?? undefined,
          toolConfiguration: config.toolConfiguration ?? undefined,
        });
      }
    }

    return servers;
  }

  private detectBrowserTools(tools: any[], mcpServers: MCPServerConfig[]): boolean {
    const browserKeywords = ['browser', 'playwright', 'puppeteer', 'chromium', 'selenium', 'web-browse', 'browser_use', 'browser-use'];
    for (const t of tools) {
      const name = (t.name || '').toLowerCase();
      if (browserKeywords.some(kw => name.includes(kw))) return true;
    }
    for (const s of mcpServers) {
      const name = (s.name || '').toLowerCase();
      const url = (s.url || '').toLowerCase();
      if (browserKeywords.some(kw => name.includes(kw) || url.includes(kw))) return true;
    }
    return false;
  }

  /** Fetch tools assigned to agent from database and add executable definitions */
  private async buildAgentTools(agentId: string, orgId: string, tools: any[], chatContext?: { channelId: string; agentId: string }) {
    const agentTools = await this.prisma.agentTool.findMany({
      where: { agentId, enabled: true },
      include: { tool: true },
    });

    for (const at of agentTools) {
      const tool = at.tool;
      const config = tool.config as Record<string, any>;
      // Decrypt authConfig if encrypted (backward compatible with plain JSON)
      const rawAuth = (tool.authConfig as any) ?? {};
      const authConfig = (rawAuth._enc ? decryptJson(rawAuth._enc) : rawAuth) as Record<string, any>;
      const perms = at.permissions as Record<string, boolean>;

      try {
        switch (tool.type) {
          case 'DATABASE':
            this.addDatabaseTools(tools, tool.name, config, authConfig, perms);
            break;
          case 'REST_API':
            this.addRestApiTool(tools, tool.name, config, authConfig, chatContext, agentId, orgId);
            break;
          case 'N8N':
            this.addN8nTools(tools, config, authConfig);
            break;
          case 'DIGITALOCEAN':
            this.addDigitalOceanTools(tools, authConfig);
            break;
          case 'SSH':
            this.addSshTools(tools, tool.name, config, authConfig);
            break;
          case 'FIRECRAWL':
            this.addFirecrawlTools(tools, config, authConfig);
            break;
        }
      } catch (err) {
        this.logger.warn(`Failed to build tool "${tool.name}": ${err}`);
      }
    }
  }

  /** Add SQL query tools for a DATABASE tool */
  private addDatabaseTools(tools: any[], toolName: string, config: Record<string, any>, authConfig: Record<string, any>, perms: Record<string, boolean>) {
    const safeName = toolName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const desc = config.description || toolName;

    // sql_query tool (read)
    if (perms.read !== false) {
      tools.push({
        name: `db_query_${safeName}`,
        description: `Execute a READ-ONLY SQL query on ${desc}. Returns up to 100 rows. Use this to get business data, statistics, user info, orders, lessons, etc.`,
        parameters: z.object({
          query: z.string().describe('SQL SELECT query to execute. Only SELECT queries allowed.'),
        }),
        execute: async (params: { query: string }) => {
          return this.executeSqlQuery(config, authConfig, params.query, false);
        },
      });
    }

    // sql_execute tool (write)
    if (perms.write === true) {
      tools.push({
        name: `db_execute_${safeName}`,
        description: `Execute a write SQL statement (INSERT/UPDATE/DELETE) on ${desc}.`,
        parameters: z.object({
          query: z.string().describe('SQL statement to execute (INSERT, UPDATE, DELETE).'),
        }),
        execute: async (params: { query: string }) => {
          return this.executeSqlQuery(config, authConfig, params.query, true);
        },
      });
    }

    // db_tables tool (always available if read)
    if (perms.read !== false) {
      tools.push({
        name: `db_tables_${safeName}`,
        description: `List all tables and their columns in ${desc}. Use this first to understand the database structure before writing queries.`,
        parameters: z.object({
          tableFilter: z.string().optional().describe('Optional table name filter (SQL LIKE pattern, e.g. "%user%")'),
        }),
        execute: async (params: { tableFilter?: string }) => {
          const db = config.database || 'db_prod_guru';
          let query = `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${db}'`;
          if (params.tableFilter) {
            query += ` AND TABLE_NAME LIKE '${params.tableFilter.replace(/'/g, "''")}'`;
          }
          query += ' ORDER BY TABLE_NAME, ORDINAL_POSITION LIMIT 500';
          return this.executeSqlQuery(config, authConfig, query, false);
        },
      });
    }
  }

  /** Add HTTP request tool for a REST_API tool */
  private addRestApiTool(tools: any[], toolName: string, config: Record<string, any>, authConfig: Record<string, any>, chatContext?: { channelId: string; agentId: string }, fileAgentId?: string, fileOrgId?: string) {
    const safeName = toolName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const desc = config.description || toolName;
    const baseUrl = config.url || config.baseUrl || '';

    tools.push({
      name: `api_call_${safeName}`,
      description: `Make HTTP request to ${desc}. Base URL: ${baseUrl}. Supports JSON (default), form-encoded, and multipart/form-data.`,
      parameters: z.object({
        method: z.string().describe('HTTP method: GET, POST, PUT, PATCH, DELETE'),
        path: z.string().describe('API path (appended to base URL). Example: /messages, /workflows'),
        bodyJson: z.string().optional().describe('JSON string of request body (for POST/PUT/PATCH)'),
        queryParams: z.string().optional().describe('Query parameters as JSON string, e.g. {"limit":"10","status":"active"}'),
        contentType: z.string().optional().describe('Request body format: "json" (default), "form" (application/x-www-form-urlencoded), "multipart" (multipart/form-data for file uploads)'),
        filePath: z.string().optional().describe('Absolute path to file to upload (only for multipart). Field name defaults to "file".'),
        fileField: z.string().optional().describe('Form field name for file upload (default: "file")'),
      }),
      execute: async (params: { method: string; path: string; bodyJson?: string; queryParams?: string; contentType?: string; filePath?: string; fileField?: string }) => {
        const result = await this.executeHttpRequest(baseUrl, config, authConfig, params, fileOrgId && fileAgentId ? { orgId: fileOrgId, agentId: fileAgentId, promptHint: `API ${toolName}` } : undefined);

        // Note: images are NOT auto-sent here — the agent sends them explicitly via agems_send_image with a caption

        return result;
      },
    });
  }

  /** Add N8N workflow management tools (DB-backed) */
  private addN8nTools(tools: any[], config: Record<string, any>, authConfig: Record<string, any>) {
    const url = config.url || '';
    const key = authConfig.token || authConfig.apiKey || authConfig.bearerToken || '';
    if (!url || !key) return;
    const override = { url, key };

    tools.push(
      {
        name: 'n8n_list_workflows',
        description: 'List all n8n workflows.',
        parameters: z.object({
          active: z.boolean().optional().describe('Filter by active status'),
          limit: z.number().optional().describe('Max results (default 50)'),
        }),
        execute: async (params: { active?: boolean; limit?: number }) =>
          this.n8n.listWorkflows(override, { active: params.active, limit: params.limit ?? 50 }),
      },
      {
        name: 'n8n_get_workflow',
        description: 'Get details of a specific n8n workflow by ID.',
        parameters: z.object({ workflowId: z.string().describe('Workflow ID') }),
        execute: async (params: { workflowId: string }) =>
          this.n8n.getWorkflow(params.workflowId, override),
      },
      {
        name: 'n8n_create_workflow',
        description: 'Create a new n8n workflow. Pass nodes and connections as JSON strings.',
        parameters: z.object({
          name: z.string().describe('Workflow name'),
          nodesJson: z.string().optional().describe('JSON string of node objects array'),
          connectionsJson: z.string().optional().describe('JSON string of connections object'),
        }),
        execute: async (params: { name: string; nodesJson?: string; connectionsJson?: string }) =>
          this.n8n.createWorkflow({
            name: params.name,
            nodes: params.nodesJson ? JSON.parse(params.nodesJson) : undefined,
            connections: params.connectionsJson ? JSON.parse(params.connectionsJson) : undefined,
          }, override),
      },
      {
        name: 'n8n_update_workflow',
        description: 'Update an existing n8n workflow (PUT). Pass nodes, connections, settings, staticData as JSON strings.',
        parameters: z.object({
          workflowId: z.string().describe('Workflow ID'),
          name: z.string().describe('Workflow name'),
          nodesJson: z.string().describe('JSON string of full node objects array'),
          connectionsJson: z.string().describe('JSON string of full connections object'),
          settingsJson: z.string().optional().describe('JSON string of settings object'),
          staticDataJson: z.string().optional().describe('JSON string of staticData'),
        }),
        execute: async (params: { workflowId: string; name: string; nodesJson: string; connectionsJson: string; settingsJson?: string; staticDataJson?: string }) => {
          const { workflowId, ...rest } = params;
          return this.n8n.updateWorkflow(workflowId, {
            name: rest.name,
            nodes: JSON.parse(rest.nodesJson),
            connections: JSON.parse(rest.connectionsJson),
            settings: rest.settingsJson ? JSON.parse(rest.settingsJson) : undefined,
            staticData: rest.staticDataJson ? JSON.parse(rest.staticDataJson) : undefined,
          }, override);
        },
      },
      {
        name: 'n8n_delete_workflow',
        description: 'Delete an n8n workflow.',
        parameters: z.object({ workflowId: z.string().describe('Workflow ID') }),
        execute: async (params: { workflowId: string }) =>
          this.n8n.deleteWorkflow(params.workflowId, override),
      },
      {
        name: 'n8n_activate_workflow',
        description: 'Activate or deactivate an n8n workflow.',
        parameters: z.object({
          workflowId: z.string().describe('Workflow ID'),
          active: z.boolean().describe('true to activate, false to deactivate'),
        }),
        execute: async (params: { workflowId: string; active: boolean }) =>
          params.active
            ? this.n8n.activateWorkflow(params.workflowId, override)
            : this.n8n.deactivateWorkflow(params.workflowId, override),
      },
      {
        name: 'n8n_execute_workflow',
        description: 'Manually execute/trigger an n8n workflow.',
        parameters: z.object({
          workflowId: z.string().describe('Workflow ID'),
          dataJson: z.string().optional().describe('JSON string of input data'),
        }),
        execute: async (params: { workflowId: string; dataJson?: string }) =>
          this.n8n.executeWorkflow(params.workflowId, params.dataJson ? JSON.parse(params.dataJson) : undefined, override),
      },
      {
        name: 'n8n_get_executions',
        description: 'Get recent n8n workflow executions.',
        parameters: z.object({
          workflowId: z.string().optional().describe('Filter by workflow ID'),
          status: z.enum(['error', 'success', 'waiting']).optional(),
          limit: z.number().optional().describe('Max results (default 10)'),
        }),
        execute: async (params: { workflowId?: string; status?: string; limit?: number }) =>
          this.n8n.getExecutions({ ...params, limit: params.limit ?? 10 }, override),
      },
    );
  }

  /** Add DigitalOcean infrastructure management tools (DB-backed) */
  private addDigitalOceanTools(tools: any[], authConfig: Record<string, any>) {
    const token = authConfig.token || authConfig.apiKey || authConfig.bearerToken || '';
    if (!token) return;

    const doFetch = async (path: string, method = 'GET', body?: any) => {
      const res = await fetch(`https://api.digitalocean.com/v2${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const text = (await res.text()).replace(/\u0000/g, "");
        return { error: `DO API ${res.status}: ${text}` };
      }
      if (res.status === 204) return { success: true };
      return res.json();
    };

    tools.push(
      {
        name: 'do_list_droplets',
        description: 'List all DigitalOcean droplets with their status, IP, region, size.',
        parameters: z.object({}),
        execute: async () => {
          const data: any = await doFetch('/droplets?per_page=100');
          if (data.error) return data;
          return { droplets: data.droplets?.map((d: any) => ({ id: d.id, name: d.name, status: d.status, ip: d.networks?.v4?.find((n: any) => n.type === 'public')?.ip_address, region: d.region?.slug, size: d.size_slug, memory: d.memory, vcpus: d.vcpus, disk: d.disk, image: d.image?.description || d.image?.slug })) };
        },
      },
      {
        name: 'do_droplet_action',
        description: 'Perform an action on a droplet: power_on, power_off, reboot, shutdown, power_cycle, snapshot.',
        parameters: z.object({
          dropletId: z.number().describe('Droplet ID'),
          action: z.enum(['power_on', 'power_off', 'reboot', 'shutdown', 'power_cycle', 'snapshot']).describe('Action to perform'),
          snapshotName: z.string().optional().describe('Name for snapshot (required for snapshot action)'),
        }),
        execute: async (params: { dropletId: number; action: string; snapshotName?: string }) => {
          const body: any = { type: params.action };
          if (params.action === 'snapshot' && params.snapshotName) body.name = params.snapshotName;
          return doFetch(`/droplets/${params.dropletId}/actions`, 'POST', body);
        },
      },
      {
        name: 'do_get_droplet',
        description: 'Get detailed info about a specific droplet including monitoring metrics.',
        parameters: z.object({
          dropletId: z.number().describe('Droplet ID'),
        }),
        execute: async (params: { dropletId: number }) => doFetch(`/droplets/${params.dropletId}`),
      },
      {
        name: 'do_list_domains',
        description: 'List all domains managed in DigitalOcean DNS.',
        parameters: z.object({}),
        execute: async () => doFetch('/domains?per_page=100'),
      },
      {
        name: 'do_domain_records',
        description: 'List or manage DNS records for a domain. Actions: list, create, update, delete.',
        parameters: z.object({
          domain: z.string().describe('Domain name (e.g. example.com)'),
          action: z.enum(['list', 'create', 'update', 'delete']).describe('Action'),
          recordId: z.number().optional().describe('Record ID (for update/delete)'),
          record: z.object({
            type: z.string().optional().describe('A, AAAA, CNAME, MX, TXT, NS, SRV'),
            name: z.string().optional().describe('Record name (@ for root)'),
            data: z.string().optional().describe('Record value'),
            ttl: z.number().optional().describe('TTL in seconds (default 3600)'),
            priority: z.number().optional().describe('Priority (for MX/SRV)'),
          }).optional().describe('Record data (for create/update)'),
        }),
        execute: async (params: { domain: string; action: string; recordId?: number; record?: any }) => {
          switch (params.action) {
            case 'list': return doFetch(`/domains/${params.domain}/records?per_page=100`);
            case 'create': return doFetch(`/domains/${params.domain}/records`, 'POST', params.record);
            case 'update':
              if (!params.recordId) return { error: 'recordId required for update' };
              return doFetch(`/domains/${params.domain}/records/${params.recordId}`, 'PUT', params.record);
            case 'delete':
              if (!params.recordId) return { error: 'recordId required for delete' };
              return doFetch(`/domains/${params.domain}/records/${params.recordId}`, 'DELETE');
            default: return { error: 'Invalid action' };
          }
        },
      },
      {
        name: 'do_monitoring',
        description: 'Get droplet monitoring metrics: cpu, memory, bandwidth, disk I/O. Returns data for charts.',
        parameters: z.object({
          dropletId: z.string().describe('Droplet ID'),
          metric: z.enum(['cpu', 'memory_free', 'memory_available', 'memory_total', 'bandwidth_public_inbound', 'bandwidth_public_outbound', 'disk_read', 'disk_write']).describe('Metric to query'),
          startHoursAgo: z.number().optional().describe('Start time as hours ago (default 1)'),
        }),
        execute: async (params: { dropletId: string; metric: string; startHoursAgo?: number }) => {
          const hoursAgo = params.startHoursAgo ?? 1;
          const end = Math.floor(Date.now() / 1000);
          const start = end - hoursAgo * 3600;
          const metricMap: Record<string, string> = {
            cpu: 'v1/insights/droplet/cpu', memory_free: 'v1/insights/droplet/memory_free',
            memory_available: 'v1/insights/droplet/memory_available', memory_total: 'v1/insights/droplet/memory_total',
            bandwidth_public_inbound: 'v1/insights/droplet/bandwidth', bandwidth_public_outbound: 'v1/insights/droplet/bandwidth',
            disk_read: 'v1/insights/droplet/disk_read', disk_write: 'v1/insights/droplet/disk_write',
          };
          const endpoint = metricMap[params.metric] || metricMap.cpu;
          let url = `/monitoring/metrics/droplet/${endpoint}?host_id=${params.dropletId}&start=${start}&end=${end}`;
          if (params.metric === 'bandwidth_public_inbound') url += '&direction=inbound&interface=public';
          if (params.metric === 'bandwidth_public_outbound') url += '&direction=outbound&interface=public';
          return doFetch(url);
        },
      },
      {
        name: 'do_list_databases',
        description: 'List managed database clusters in DigitalOcean.',
        parameters: z.object({}),
        execute: async () => doFetch('/databases'),
      },
      {
        name: 'do_account',
        description: 'Get DigitalOcean account info: email, balance, droplet limit.',
        parameters: z.object({}),
        execute: async () => {
          const [account, balance] = await Promise.all([doFetch('/account'), doFetch('/customers/my/balance')]);
          return { account: (account as any).account, balance };
        },
      },
    );
  }

  /** Add SSH remote execution tools (DB-backed) */
  private addSshTools(tools: any[], toolName: string, config: Record<string, any>, authConfig: Record<string, any>) {
    const safeName = toolName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const host = config.host || '';
    const port = config.port || 22;
    const username = authConfig.username || 'root';
    const privateKey = authConfig.privateKey || '';
    const password = authConfig.password || '';
    const desc = config.description || `${username}@${host}`;

    if (!host) return;

    const execSsh = async (command: string, timeoutSec = 30): Promise<any> => {
      const { Client } = await import('ssh2');
      return new Promise((resolve) => {
        const conn = new Client();
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          conn.end();
          resolve({ stdout: stdout.substring(0, 50000), stderr: stderr.substring(0, 5000), error: 'Timeout', exitCode: -1 });
        }, timeoutSec * 1000);

        conn.on('ready', () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              clearTimeout(timer);
              conn.end();
              resolve({ error: err.message });
              return;
            }
            stream.on('data', (data: Buffer) => { stdout += data.toString(); });
            stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
            stream.on('close', (code: number) => {
              clearTimeout(timer);
              conn.end();
              resolve({ stdout: stdout.substring(0, 50000), stderr: stderr.substring(0, 5000), exitCode: code });
            });
          });
        });
        conn.on('error', (err) => {
          clearTimeout(timer);
          resolve({ error: err.message });
        });

        const connectOpts: any = { host, port, username, readyTimeout: 10000 };
        if (privateKey) {
          connectOpts.privateKey = privateKey;
        } else if (password) {
          connectOpts.password = password;
        }
        conn.connect(connectOpts);
      });
    };

    tools.push(
      {
        name: `ssh_exec_${safeName}`,
        description: `Execute a command on remote server ${desc} via SSH. Use for deployments, server management, file operations, service restarts, etc.`,
        parameters: z.object({
          command: z.string().describe('Shell command to execute on the remote server'),
          timeout: z.number().optional().describe('Timeout in seconds (default 30, max 300)'),
        }),
        execute: async (params: { command: string; timeout?: number }) => {
          const timeout = Math.min(params.timeout ?? 30, 300);
          return execSsh(params.command, timeout);
        },
      },
      {
        name: `ssh_upload_${safeName}`,
        description: `Upload a file to remote server ${desc} via SFTP. Write content directly to a remote path.`,
        parameters: z.object({
          remotePath: z.string().describe('Absolute path on the remote server (e.g. /var/www/site/index.html)'),
          content: z.string().describe('File content to write'),
        }),
        execute: async (params: { remotePath: string; content: string }) => {
          const { Client } = await import('ssh2');
          return new Promise((resolve) => {
            const conn = new Client();
            const timer = setTimeout(() => { conn.end(); resolve({ error: 'Timeout' }); }, 30000);

            conn.on('ready', () => {
              conn.sftp((err, sftp) => {
                if (err) { clearTimeout(timer); conn.end(); resolve({ error: err.message }); return; }
                const stream = sftp.createWriteStream(params.remotePath);
                stream.on('close', () => { clearTimeout(timer); conn.end(); resolve({ success: true, path: params.remotePath, size: Buffer.byteLength(params.content) }); });
                stream.on('error', (e: Error) => { clearTimeout(timer); conn.end(); resolve({ error: e.message }); });
                stream.end(params.content);
              });
            });
            conn.on('error', (err) => { clearTimeout(timer); resolve({ error: err.message }); });

            const connectOpts: any = { host, port, username, readyTimeout: 10000 };
            if (privateKey) connectOpts.privateKey = privateKey;
            else if (password) connectOpts.password = password;
            conn.connect(connectOpts);
          });
        },
      },
      {
        name: `ssh_download_${safeName}`,
        description: `Download/read a file from remote server ${desc} via SFTP.`,
        parameters: z.object({
          remotePath: z.string().describe('Absolute path on the remote server'),
          maxSize: z.number().optional().describe('Max bytes to read (default 100000)'),
        }),
        execute: async (params: { remotePath: string; maxSize?: number }) => {
          const { Client } = await import('ssh2');
          const maxSize = params.maxSize ?? 100000;
          return new Promise((resolve) => {
            const conn = new Client();
            const timer = setTimeout(() => { conn.end(); resolve({ error: 'Timeout' }); }, 30000);

            conn.on('ready', () => {
              conn.sftp((err, sftp) => {
                if (err) { clearTimeout(timer); conn.end(); resolve({ error: err.message }); return; }
                let data = '';
                const stream = sftp.createReadStream(params.remotePath);
                stream.on('data', (chunk: Buffer) => { data += chunk.toString(); if (data.length > maxSize) stream.destroy(); });
                stream.on('close', () => { clearTimeout(timer); conn.end(); resolve({ content: data.substring(0, maxSize), size: data.length, truncated: data.length > maxSize }); });
                stream.on('error', (e: Error) => { clearTimeout(timer); conn.end(); resolve({ error: e.message }); });
              });
            });
            conn.on('error', (err) => { clearTimeout(timer); resolve({ error: err.message }); });

            const connectOpts: any = { host, port, username, readyTimeout: 10000 };
            if (privateKey) connectOpts.privateKey = privateKey;
            else if (password) connectOpts.password = password;
            conn.connect(connectOpts);
          });
        },
      },
    );
  }

  /** Add Firecrawl web scraping/crawling tools */
  private addFirecrawlTools(tools: any[], config: Record<string, any>, authConfig: Record<string, any>) {
    const apiKey = authConfig.token || authConfig.apiKey || authConfig.bearerToken || '';
    const baseUrl = config.url || 'https://api.firecrawl.dev/v2';
    if (!apiKey) return;

    const fcFetch = async (endpoint: string, body: Record<string, any>): Promise<any> => {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || `HTTP ${res.status}`, status: res.status };
      return data;
    };

    tools.push(
      {
        name: 'firecrawl_scrape',
        description: 'Scrape a single web page and extract its content as clean markdown, HTML, or structured data. Great for reading articles, documentation, product pages, etc.',
        parameters: z.object({
          url: z.string().describe('URL to scrape'),
          formats: z.array(z.string()).optional().describe('Output formats: markdown (default), html, rawHtml, links, screenshot'),
          onlyMainContent: z.boolean().optional().describe('Extract only main content, skip headers/footers (default: true)'),
          waitFor: z.number().optional().describe('Wait milliseconds before extracting (for JS-heavy pages)'),
        }),
        execute: async (params: { url: string; formats?: string[]; onlyMainContent?: boolean; waitFor?: number }) => {
          const body: any = { url: params.url };
          if (params.formats) body.formats = params.formats;
          if (params.onlyMainContent !== undefined) body.onlyMainContent = params.onlyMainContent;
          if (params.waitFor) body.waitFor = params.waitFor;
          const result = await fcFetch('/scrape', body);
          // Truncate large responses
          if (result?.data?.markdown && result.data.markdown.length > 50000) {
            result.data.markdown = result.data.markdown.substring(0, 50000) + '\n\n[...truncated]';
          }
          return result;
        },
      },
      {
        name: 'firecrawl_search',
        description: 'Search the web and get full page content from results. Combines search engine results with Firecrawl scraping to get clean, readable content.',
        parameters: z.object({
          query: z.string().describe('Search query (max 500 chars)'),
          limit: z.number().optional().describe('Max results (1-20, default 5)'),
          lang: z.string().optional().describe('Language code, e.g. "en", "he", "ru"'),
          country: z.string().optional().describe('Country code, e.g. "US", "IL", "DE"'),
          scrapeContent: z.boolean().optional().describe('Scrape full page content of results (default: true)'),
        }),
        execute: async (params: { query: string; limit?: number; lang?: string; country?: string; scrapeContent?: boolean }) => {
          const body: any = { query: params.query, limit: Math.min(params.limit ?? 5, 20) };
          if (params.country) body.country = params.country;
          if (params.lang) body.lang = params.lang;
          if (params.scrapeContent !== false) body.scrapeOptions = { formats: ['markdown'] };
          const result = await fcFetch('/search', body);
          // Truncate large markdown in results
          if (result?.data) {
            for (const item of (Array.isArray(result.data) ? result.data : result.data.web || [])) {
              if (item?.markdown && item.markdown.length > 10000) {
                item.markdown = item.markdown.substring(0, 10000) + '\n\n[...truncated]';
              }
            }
          }
          return result;
        },
      },
      {
        name: 'firecrawl_crawl',
        description: 'Crawl an entire website starting from a URL. Discovers and scrapes multiple pages. Returns a job ID — use firecrawl_crawl_status to check results.',
        parameters: z.object({
          url: z.string().describe('Starting URL to crawl'),
          limit: z.number().optional().describe('Max pages to crawl (default 10, max 100)'),
          maxDepth: z.number().optional().describe('Max link depth from start URL (default 2)'),
          includePaths: z.array(z.string()).optional().describe('Regex patterns — only crawl matching URLs'),
          excludePaths: z.array(z.string()).optional().describe('Regex patterns — skip matching URLs'),
        }),
        execute: async (params: { url: string; limit?: number; maxDepth?: number; includePaths?: string[]; excludePaths?: string[] }) => {
          const body: any = {
            url: params.url,
            limit: Math.min(params.limit ?? 10, 100),
            maxDiscoveryDepth: params.maxDepth ?? 2,
            scrapeOptions: { formats: ['markdown'] },
          };
          if (params.includePaths) body.includePaths = params.includePaths;
          if (params.excludePaths) body.excludePaths = params.excludePaths;
          return fcFetch('/crawl', body);
        },
      },
      {
        name: 'firecrawl_crawl_status',
        description: 'Check the status of a Firecrawl crawl job and get results.',
        parameters: z.object({
          jobId: z.string().describe('Crawl job ID returned by firecrawl_crawl'),
        }),
        execute: async (params: { jobId: string }) => {
          const res = await fetch(`${baseUrl}/crawl/${params.jobId}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(30000),
          });
          const data = await res.json();
          // Truncate markdown in crawl results
          if (data?.data) {
            for (const page of data.data) {
              if (page?.markdown && page.markdown.length > 20000) {
                page.markdown = page.markdown.substring(0, 20000) + '\n\n[...truncated]';
              }
            }
          }
          return data;
        },
      },
      {
        name: 'firecrawl_map',
        description: 'Discover and catalog all URLs on a website. Fast way to get site structure without scraping content.',
        parameters: z.object({
          url: z.string().describe('Website URL to map'),
          search: z.string().optional().describe('Filter URLs by relevance to this search term'),
          limit: z.number().optional().describe('Max URLs to return (default 100, max 5000)'),
          includeSubdomains: z.boolean().optional().describe('Include subdomain URLs (default: true)'),
        }),
        execute: async (params: { url: string; search?: string; limit?: number; includeSubdomains?: boolean }) => {
          const body: any = { url: params.url, limit: Math.min(params.limit ?? 100, 5000) };
          if (params.search) body.search = params.search;
          if (params.includeSubdomains !== undefined) body.includeSubdomains = params.includeSubdomains;
          return fcFetch('/map', body);
        },
      },
    );
  }

  /** Execute SQL query using mysql2 */
  private async executeSqlQuery(config: Record<string, any>, authConfig: Record<string, any>, query: string, allowWrite: boolean) {
    if (typeof query !== 'string' || query.trim().length === 0) {
      return { error: 'SQL query is required.' };
    }
    const trimmedQuery = query.trim();
    // Safety: block write operations if not allowed
    const upperQuery = trimmedQuery.toUpperCase();
    if (!allowWrite && !upperQuery.startsWith('SELECT') && !upperQuery.startsWith('SHOW') && !upperQuery.startsWith('DESCRIBE') && !upperQuery.startsWith('EXPLAIN')) {
      return { error: 'Only SELECT/SHOW/DESCRIBE/EXPLAIN queries are allowed in read-only mode.' };
    }
    if (trimmedQuery.includes('\0')) {
      return { error: 'SQL query contains invalid null bytes.' };
    }
    if (trimmedQuery.includes(';')) {
      return { error: 'Multiple SQL statements are not allowed.' };
    }
    // Block dangerous operations
    if (/\b(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i.test(trimmedQuery)) {
      return { error: 'DDL operations (DROP, TRUNCATE, ALTER, CREATE, GRANT, REVOKE) are blocked.' };
    }

    try {
      const mysql = await import('mysql2/promise');
      const conn = await mysql.createConnection({
        host: config.host || 'localhost',
        port: config.port || 3306,
        user: authConfig.username || 'root',
        password: authConfig.password || '',
        database: config.database || '',
        connectTimeout: 5000,
        multipleStatements: false,
      });

      try {
        const cleanQuery = trimmedQuery;
        const needsLimit = !allowWrite && !cleanQuery.toUpperCase().includes('LIMIT');
        const [rows] = await conn.execute(cleanQuery + (needsLimit ? ' LIMIT 100' : ''));
        const result = Array.isArray(rows) ? rows : [{ affectedRows: (rows as any).affectedRows }];
        return { data: result.slice(0, 100), rowCount: result.length };
      } finally {
        await conn.end();
      }
    } catch (err: any) {
      return { error: err.message };
    }
  }

  /** Execute HTTP request for REST_API tools — supports JSON, form-encoded, and multipart */
  private async executeHttpRequest(
    baseUrl: string,
    config: Record<string, any>,
    authConfig: Record<string, any>,
    params: { method: string; path: string; bodyJson?: string; queryParams?: string; contentType?: string; filePath?: string; fileField?: string },
    fileContext?: { orgId: string; agentId: string; promptHint?: string },
  ) {
    try {
      let url = baseUrl.replace(/\/$/, '') + params.path;

      if (params.queryParams) {
        const qp = JSON.parse(params.queryParams);
        // Serialize nested objects as JSON strings (URLSearchParams would produce [object Object])
        const parts: string[] = [];
        for (const [k, v] of Object.entries(qp)) {
          parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : String(v))}`);
        }
        url += (url.includes('?') ? '&' : '?') + parts.join('&');
      }

      const headers: Record<string, string> = {};
      const ct = params.contentType || 'json';

      // Set Content-Type (multipart sets its own boundary via FormData)
      if (ct === 'json') {
        headers['Content-Type'] = 'application/json';
      } else if (ct === 'form') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      // multipart: don't set Content-Type — fetch sets it with boundary automatically

      // Apply auth
      if (authConfig.token) {
        headers['Authorization'] = `Bearer ${authConfig.token}`;
      } else if (authConfig.apiKey) {
        // Try common API key patterns
        if (baseUrl.includes('anthropic')) {
          headers['x-api-key'] = authConfig.apiKey;
          headers['anthropic-version'] = '2023-06-01';
        } else if (baseUrl.includes('googleapis') || baseUrl.includes('generativelanguage')) {
          url += (url.includes('?') ? '&' : '?') + `key=${authConfig.apiKey}`;
        } else if (baseUrl.includes('sendgrid')) {
          headers['Authorization'] = `Bearer ${authConfig.apiKey}`;
        } else {
          headers['Authorization'] = `Bearer ${authConfig.apiKey}`;
        }
      } else if (authConfig.botToken && baseUrl.includes('telegram')) {
        // Telegram: inject bot token into URL path
        url = url.replace('api.telegram.org/', `api.telegram.org/bot${authConfig.botToken}/`);
      } else if (authConfig.username && authConfig.password) {
        const b64 = Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64');
        headers['Authorization'] = `Basic ${b64}`;
      } else if (authConfig.privateKey && authConfig.keyId && authConfig.issuerId) {
        // App Store Connect JWT auth (ES256) — generate short-lived token from private key
        const crypto = require('crypto');
        const now = Math.floor(Date.now() / 1000);
        const jwtHeader = Buffer.from(JSON.stringify({ alg: 'ES256', kid: authConfig.keyId, typ: 'JWT' })).toString('base64url');
        const jwtPayload = Buffer.from(JSON.stringify({ iss: authConfig.issuerId, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })).toString('base64url');
        const signingInput = jwtHeader + '.' + jwtPayload;
        const pk = crypto.createPrivateKey({ key: authConfig.privateKey.replace(/ -----END/g, "-----END").trim(), format: 'pem', type: 'pkcs8' });
        const sig = crypto.sign('sha256', Buffer.from(signingInput), { key: pk, dsaEncoding: 'ieee-p1363' });
        const jwtToken = signingInput + '.' + sig.toString('base64url');
        headers['Authorization'] = `Bearer ${jwtToken}`;
      }

      const fetchOpts: RequestInit = {
        method: params.method.toUpperCase(),
        headers,
        signal: AbortSignal.timeout(60000),
      };

      if (['POST', 'PUT', 'PATCH'].includes(fetchOpts.method as string)) {
        if (ct === 'multipart' && params.filePath) {
          // Multipart/form-data — file upload
          const { readFileSync, existsSync: fsExists } = await import('fs');
          const { basename, join: pathJoin } = await import('path');

          // Resolve /uploads/... paths to actual disk location
          let resolvedPath = params.filePath;
          if (resolvedPath.startsWith('/uploads/') && !fsExists(resolvedPath)) {
            const cwd = process.cwd();
            const isMonorepo = fsExists(pathJoin(cwd, 'apps', 'api'));
            const diskPath = isMonorepo
              ? pathJoin(cwd, 'apps', 'web', 'public', resolvedPath)
              : pathJoin(cwd, '..', 'web', 'public', resolvedPath);
            if (fsExists(diskPath)) resolvedPath = diskPath;
          }

          const formData = new globalThis.FormData();
          const fileBuffer = readFileSync(resolvedPath);
          const fileName = basename(params.filePath);
          const extMatch = fileName.match(/\.(\w+)$/);
          const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' };
          const mimeType = (extMatch && mimeMap[extMatch[1].toLowerCase()]) || 'application/octet-stream';
          const blob = new globalThis.Blob([fileBuffer], { type: mimeType });
          formData.append(params.fileField || 'file', blob, fileName);

          // Add extra body fields to form if provided
          if (params.bodyJson) {
            const extra = JSON.parse(params.bodyJson);
            for (const [k, v] of Object.entries(extra)) {
              formData.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
            }
          }

          fetchOpts.body = formData as any;
          // Remove Content-Type so fetch auto-sets multipart boundary
          delete (fetchOpts.headers as Record<string, string>)['Content-Type'];
        } else if (ct === 'form' && params.bodyJson) {
          // URL-encoded form data
          const bodyObj = JSON.parse(params.bodyJson);
          const formParts: string[] = [];
          for (const [k, v] of Object.entries(bodyObj)) {
            formParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : String(v))}`);
          }
          fetchOpts.body = formParts.join('&');
        } else if (params.bodyJson) {
          // Default JSON body
          fetchOpts.body = params.bodyJson;
        }
      }

      const res = await fetch(url, fetchOpts);

      // Handle gzip responses (e.g. Apple Sales Reports returns application/a-gzip)
      let text: string;
      const respCt = res.headers.get("content-type") || "";
      if (respCt.includes("gzip") || respCt.includes("octet-stream")) {
        try {
          const zlib = require("zlib");
          const buf = Buffer.from(await res.arrayBuffer());
          const decompressed = zlib.gunzipSync(buf);
          text = decompressed.toString("utf-8").replace(/\u0000/g, "");
        } catch {
          text = (await res.text()).replace(/\u0000/g, "");
        }
      } else {
        text = (await res.text()).replace(/\u0000/g, "");
      }

      let data: any;
      try { data = JSON.parse(text); } catch { data = text.substring(0, 10000); }

      if (!res.ok) {
        return { error: `HTTP ${res.status}`, data: typeof data === 'string' ? data.substring(0, 2000) : data };
      }

      // Extract and save base64 images (e.g. from Gemini image generation)
      const savedImages = this.extractAndSaveBase64Images(data, fileContext);

      // Truncate large responses
      const str = JSON.stringify(data);
      if (str.length > 100000) {
        if (savedImages.length > 0) {
          return { status: res.status, savedImages, note: 'Response contained images that were saved to disk. Full JSON response was too large and omitted.' };
        }
        // Try to return a valid partial response for arrays (e.g. Meta Ads data.data[])
        if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
          const partial = { ...data, data: data.data.slice(0, 10) };
          const partialStr = JSON.stringify(partial);
          if (partialStr.length <= 100000) {
            return { data: partial, truncated: true, total: data.data.length, returned: Math.min(10, data.data.length), note: `Response too large (${str.length} chars). Showing first 10 of ${data.data.length} items. Use limit parameter to reduce results.` };
          }
        }
        return { error: `Response too large (${str.length} chars). Use fewer fields or add limit parameter to reduce response size.`, truncated: true };
      }
      return { status: res.status, data, ...(savedImages.length > 0 && { savedImages }) };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  /** Extract base64 image data from API responses (e.g. Gemini), save to disk AND register in DB */
  private extractAndSaveBase64Images(data: any, fileContext?: { orgId: string; agentId: string; promptHint?: string }): Array<{ url: string; mimeType: string; size: number }> {
    const saved: Array<{ url: string; mimeType: string; size: number }> = [];
    if (!data || typeof data !== 'object') return saved;

    try {
      // Gemini response format: candidates[].content.parts[].inlineData.{data, mimeType}
      const candidates = data.candidates || [];
      for (const candidate of candidates) {
        const parts = candidate?.content?.parts || [];
        for (let i = 0; i < parts.length; i++) {
          const inlineData = parts[i]?.inlineData;
          if (inlineData?.data && inlineData?.mimeType?.startsWith('image/')) {
            const ext = inlineData.mimeType === 'image/png' ? '.png' : inlineData.mimeType === 'image/webp' ? '.webp' : '.jpg';
            const filename = `${randomUUID()}${ext}`;

            const cwd = process.cwd();
            const isMonorepoRoot = existsSync(join(cwd, 'apps', 'api')) && existsSync(join(cwd, 'apps', 'web'));
            const uploadsDir = isMonorepoRoot
              ? join(cwd, 'apps', 'web', 'public', 'uploads')
              : join(cwd, '..', 'web', 'public', 'uploads');

            if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

            const buf = Buffer.from(inlineData.data, 'base64');
            writeFileSync(join(uploadsDir, filename), buf);

            saved.push({ url: `/uploads/${filename}`, mimeType: inlineData.mimeType, size: buf.length });

            // Replace the base64 data in-place so JSON.stringify is small
            parts[i].inlineData = { mimeType: inlineData.mimeType, savedTo: `/uploads/${filename}` };

            // Register in DB so file is visible in /files and findable by agents
            if (fileContext?.orgId) {
              const hint = fileContext.promptHint?.substring(0, 80) || 'Generated image';
              this.prisma.fileRecord.create({
                data: {
                  orgId: fileContext.orgId,
                  filename,
                  originalName: `${hint}${ext}`,
                  mimetype: inlineData.mimeType,
                  size: buf.length,
                  url: `/uploads/${filename}`,
                  uploadedBy: 'AGENT',
                  uploaderId: fileContext.agentId,
                },
              }).catch(() => {}); // fire-and-forget, don't block
            }
          }
        }
      }
    } catch {
      // Non-Gemini response or unexpected structure — ignore
    }

    return saved;
  }

  private async executeBash(command: string, timeout: number, runtimeConfig: Record<string, unknown>) {
    if (!this.hasHostAccessEnabled(runtimeConfig)) return { error: 'Host command execution is disabled for this agent' };
    const { execSync } = await import('child_process');
    const blockedCommands = runtimeConfig.blockedCommands as string[] | undefined;
    const allowedCommands = runtimeConfig.allowedCommands as string[] | undefined;
    const cwd = this.getHostWorkspaceRoot(runtimeConfig);

    const firstWord = command.trim().split(/\s+/)[0];
    const blocked = blockedCommands ?? ['rm', 'rmdir', 'dd', 'mkfs', 'shutdown', 'reboot', 'kill', 'killall'];
    if (blocked.includes(firstWord)) return { error: `Command '${firstWord}' is blocked` };
    if (allowedCommands && !allowedCommands.includes(firstWord)) return { error: `Command '${firstWord}' not allowed` };

    // Prevent agents from accessing Docker socket or host repo (admin-only resources)
    const sensitivePatterns = ['docker.sock', 'host-repo', '/app/host-repo', '.env'];
    const cmdLower = command.toLowerCase();
    for (const pattern of sensitivePatterns) {
      if (cmdLower.includes(pattern)) return { error: `Access to '${pattern}' is blocked for security` };
    }
    if (firstWord === 'docker') return { error: `Command 'docker' is blocked for agents` };

    try {
      const output = execSync(command, { timeout: timeout * 1000, cwd, maxBuffer: 1024 * 1024, encoding: 'utf-8' });
      return { stdout: output.substring(0, 50000) };
    } catch (err: any) {
      return { error: err.message, stderr: err.stderr?.substring(0, 10000) };
    }
  }

  private async readFile(filePath: string, maxLines: number, runtimeConfig: Record<string, unknown>) {
    const { readFileSync, statSync } = await import('fs');
    const { extname } = await import('path');
    try {
      const safePath = this.resolveWorkspacePath(filePath, runtimeConfig);
      const stats = statSync(safePath);
      if (stats.size > 10 * 1024 * 1024) return { error: 'File too large (>10MB)' };

      const ext = extname(safePath).toLowerCase();

      // PDF: extract text via pdftotext
      if (ext === '.pdf') {
        const { execFileSync } = await import('child_process');
        try {
          const text = execFileSync('pdftotext', [safePath, '-'], {
            maxBuffer: 5 * 1024 * 1024,
            timeout: 15000,
            encoding: 'utf-8',
          });
          const lines = text.split('\n');
          return { content: lines.slice(0, maxLines).join('\n'), totalLines: lines.length, type: 'pdf' };
        } catch (pdfErr: any) {
          return { error: `Failed to extract PDF text: ${pdfErr.message}` };
        }
      }

      const content = readFileSync(safePath, 'utf-8');
      const lines = content.split('\n');
      return { content: lines.slice(0, maxLines).join('\n'), totalLines: lines.length };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  private async writeFile(path: string, content: string, runtimeConfig: Record<string, unknown>) {
    const { writeFileSync } = await import('fs');
    try {
      const safePath = this.resolveWorkspacePath(path, runtimeConfig);
      writeFileSync(safePath, content, 'utf-8');
      return { success: true, path: safePath };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  /** Get LLM API key: Settings table first, then env vars fallback */
  private async getApiKey(provider: string, orgId?: string): Promise<string | undefined> {
    const settingsMap: Record<string, string> = { ANTHROPIC: 'llm_key_anthropic', OPENAI: 'llm_key_openai', GOOGLE: 'llm_key_google', DEEPSEEK: 'llm_key_deepseek', MISTRAL: 'llm_key_mistral', MINIMAX: 'llm_key_minimax', GLM: 'llm_key_glm', XAI: 'llm_key_xai', COHERE: 'llm_key_cohere', PERPLEXITY: 'llm_key_perplexity', TOGETHER: 'llm_key_together', FIREWORKS: 'llm_key_fireworks', GROQ: 'llm_key_groq', MOONSHOT: 'llm_key_moonshot', QWEN: 'llm_key_qwen', AI21: 'llm_key_ai21', SAMBANOVA: 'llm_key_sambanova' };
    const envMap: Record<string, string> = { ANTHROPIC: 'ANTHROPIC_API_KEY', OPENAI: 'OPENAI_API_KEY', GOOGLE: 'GOOGLE_AI_API_KEY', DEEPSEEK: 'DEEPSEEK_API_KEY', MISTRAL: 'MISTRAL_API_KEY', MINIMAX: 'MINIMAX_API_KEY', GLM: 'GLM_API_KEY', XAI: 'XAI_API_KEY', COHERE: 'COHERE_API_KEY', PERPLEXITY: 'PERPLEXITY_API_KEY', TOGETHER: 'TOGETHER_API_KEY', FIREWORKS: 'FIREWORKS_API_KEY', GROQ: 'GROQ_API_KEY', MOONSHOT: 'MOONSHOT_API_KEY', QWEN: 'QWEN_API_KEY', AI21: 'AI21_API_KEY', SAMBANOVA: 'SAMBANOVA_API_KEY' };

    const sk = settingsMap[provider];
    if (sk) {
      // Try org-specific key first, then global
      if (orgId) { const v = await this.settings.get(sk, orgId); if (v) return v; }
      const v = await this.settings.get(sk); if (v) return v;
    }
    const ev = envMap[provider];
    return ev ? process.env[ev] : undefined;
  }

  /** Get list of built-in runtime tools for an agent (names + descriptions only, no executors) */
  async getBuiltinToolNames(agentId: string): Promise<Array<{ name: string; description: string; category: string; enabled: boolean }>> {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: { skills: { include: { skill: true } }, tools: { include: { tool: true } }, repositories: { include: { repo: true } } },
    });
    if (!agent) return [];

    const runtimeConfig = agent.runtimeConfig as Record<string, unknown> ?? {};
    const mode = runtimeConfig.mode ?? 'CLAUDE_CODE';
    const disabledTools = new Set<string>((runtimeConfig.disabledBuiltinTools as string[]) || []);
    const result: Array<{ name: string; description: string; category: string; enabled: boolean }> = [];

    const add = (name: string, description: string, category: string) => {
      result.push({ name, description, category, enabled: !disabledTools.has(name) });
    };

    // Skills
    const enabledSkills = agent.skills?.filter((s: any) => s.enabled !== false && s.skill?.name) || [];
    if (enabledSkills.length > 0) {
      add('use_skill', `Load skill knowledge (${enabledSkills.map((s: any) => s.skill.name).join(', ')})`, 'Skills');
    }

    // System — bash requires allowHostAccess; file I/O available to all
    if (this.hasHostAccessEnabled(runtimeConfig)) {
      add('bash_command', 'Execute bash commands', 'System');
    }
    add('read_file', 'Read file contents (text, PDF)', 'System');
    add('write_file', 'Write content to file (with optional saveToFiles flag)', 'System');

    // Memory — persistent knowledge store
    add('memory_read', 'Read persistent memory entries', 'Memory');
    add('memory_write', 'Save to persistent memory', 'Memory');
    add('memory_delete', 'Delete memory entry', 'Memory');

    // Connected tools (DB, REST API, N8N, DigitalOcean)
    for (const at of agent.tools || []) {
      const tool = (at as any).tool;
      if (!tool) continue;
      const safeName = tool.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const perms = (at as any).permissions || {};
      if (tool.type === 'DATABASE') {
        if (perms.read !== false) {
          add(`db_query_${safeName}`, `SQL query on ${tool.name}`, 'Database');
          add(`db_tables_${safeName}`, `List tables in ${tool.name}`, 'Database');
        }
        if (perms.write === true) {
          add(`db_execute_${safeName}`, `SQL write on ${tool.name}`, 'Database');
        }
      } else if (tool.type === 'REST_API') {
        add(`api_call_${safeName}`, `HTTP request to ${tool.name}`, 'API');
      } else if (tool.type === 'N8N') {
        for (const t of ['n8n_list_workflows', 'n8n_get_workflow', 'n8n_create_workflow', 'n8n_update_workflow', 'n8n_delete_workflow', 'n8n_activate_workflow', 'n8n_execute_workflow', 'n8n_get_executions']) {
          add(t, t.replace(/n8n_/g, '').replace(/_/g, ' '), 'N8N');
        }
      } else if (tool.type === 'DIGITALOCEAN') {
        for (const t of ['do_list_droplets', 'do_get_droplet', 'do_droplet_action', 'do_list_domains', 'do_domain_records', 'do_monitoring', 'do_list_databases', 'do_account']) {
          add(t, t.replace(/do_/g, '').replace(/_/g, ' '), 'DigitalOcean');
        }
      } else if (tool.type === 'SSH') {
        const sn = tool.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        add(`ssh_exec_${sn}`, `Execute command on ${tool.name}`, 'SSH');
        add(`ssh_upload_${sn}`, `Upload file to ${tool.name}`, 'SSH');
        add(`ssh_download_${sn}`, `Download file from ${tool.name}`, 'SSH');
      } else if (tool.type === 'FIRECRAWL') {
        add('firecrawl_scrape', 'Scrape a web page to markdown', 'Firecrawl');
        add('firecrawl_search', 'Search the web and get page content', 'Firecrawl');
        add('firecrawl_crawl', 'Crawl an entire website', 'Firecrawl');
        add('firecrawl_crawl_status', 'Check crawl job status', 'Firecrawl');
        add('firecrawl_map', 'Discover all URLs on a website', 'Firecrawl');
      }
    }

    // Telegram
    const tgConfig = agent.telegramConfig as Record<string, any> | null;
    if (tgConfig?.apiId && tgConfig?.apiHash && tgConfig?.sessionString) {
      for (const t of ['tg_send_message', 'tg_read_messages', 'tg_find_contact', 'tg_list_dialogs', 'tg_send_photo']) {
        add(t, t.replace(/tg_/g, '').replace(/_/g, ' '), 'Telegram');
      }
    }

    // Repositories
    const agentRepos = (agent as any).repositories?.filter((ar: any) => ar.enabled && ar.repo) || [];
    if (agentRepos.length > 0) {
      add('repo_list', 'List available repositories', 'Repositories');
      add('repo_search', 'Search code in repositories', 'Repositories');
      add('repo_read_file', 'Read file from repository', 'Repositories');
      add('repo_structure', 'List repository file tree', 'Repositories');
      add('repo_file_summary', 'Get structural summary of a file', 'Repositories');
      add('repo_find_definition', 'Find code definitions', 'Repositories');
    }

    // AGEMS built-in
    add('agems_manage_agents', 'List, get, update agents', 'AGEMS Platform');
    add('agems_manage_skills', 'Manage agent skills assignments', 'AGEMS Platform');
    add('agems_tasks', 'View, create, update tasks', 'AGEMS Platform');
    add('agems_channels', 'Send messages, list channels, DM agents', 'AGEMS Platform');
    add('agems_meetings', 'Schedule and manage meetings', 'AGEMS Platform');
    add('agems_approvals', 'Request and resolve approvals between agents/humans', 'AGEMS Platform');
    add('agems_send_image', 'Send image to chat channel', 'AGEMS Platform');
    add('agems_send_file', 'Send any file to chat as downloadable attachment', 'AGEMS Platform');
    add('list_org_files', 'List and search uploaded files in the organisation', 'AGEMS Platform');
    add('save_to_files', 'Save a file to Files library (/files page) for user access', 'AGEMS Platform');
    add('html_to_pdf', 'Convert HTML file to PDF and save to Files library', 'AGEMS Platform');
    add('gemini_generate_image', 'Generate images with Gemini AI (supports logo/reference images)', 'AGEMS Platform');
    add('meta_upload_page_image', 'Upload or publish an image to a Facebook Page or linked Instagram Business account. Supports profile picture, cover photo, FB feed photo post, and Instagram post (kind=instagram_post — pass the FB Page id, the tool resolves the connected IG account itself). Handles multipart upload, token swap, and the IG container+publish dance.', 'AGEMS Platform');
    add('visual_check', 'Look at a rendered web page or saved image and describe what is visible (headings, readability, contrast issues, broken layouts). Use before approving visual tasks.', 'AGEMS Platform');
    add('adsense_list_ad_clients', 'List AdSense ad clients (publisher accounts) for this org. Call first to get the ad client name needed by other adsense tools.', 'AGEMS Platform');
    add('adsense_list_ad_units', 'List existing AdSense ad units (banner placements) under an ad client. Returns name, displayName, state, size for each.', 'AGEMS Platform');
    add('adsense_get_adcode', 'Fetch the HTML/JavaScript embed snippet for a specific AdSense ad unit, ready to paste into a page or component.', 'AGEMS Platform');
    add('adsense_create_ad_unit', 'Create a new AdSense display ad unit (responsive or fixed size). Returns the new unit name to use with adsense_get_adcode.', 'AGEMS Platform');
    add('adsense_earnings_report', 'Generate an AdSense earnings report (estimated earnings, impressions, clicks, CTR, CPC, page views) for a date range, optionally grouped by dimensions like DATE or AD_UNIT_NAME.', 'AGEMS Platform');
    add('gsc_list_sites', 'List Google Search Console properties (websites) the org has access to. Call first to find the property identifier needed by other gsc_* tools.', 'AGEMS Platform');
    add('gsc_search_analytics', 'Pull GSC search analytics: clicks, impressions, CTR, average position, grouped by query / page / country / device.', 'AGEMS Platform');
    add('gsc_inspect_url', 'Inspect a specific URL in Google Search Console: indexed status, last crawl, sitemap and robots state.', 'AGEMS Platform');
    add('gsc_submit_sitemap', 'Submit a sitemap.xml URL to Google Search Console so Google starts crawling it.', 'AGEMS Platform');
    add('ga_list_properties', 'List Google Analytics 4 properties (websites tracked) the org can access.', 'AGEMS Platform');
    add('ga_run_report', 'Run a GA4 report: sessions, users, page views, conversions, revenue across a date range, optionally grouped by date / country / device / page / source / medium.', 'AGEMS Platform');
    add('ga_realtime', 'Get a real-time GA4 report — who is on the site right now (last 30 minutes), optionally grouped by country / device / current page.', 'AGEMS Platform');
    add('dashboard_manage_widget', 'Manage dashboard widgets', 'AGEMS Platform');

    return result;
  }

  /** Toggle a built-in tool on/off for an agent */
  async toggleBuiltinTool(agentId: string, toolName: string, enabled: boolean) {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new Error('Agent not found');

    const runtimeConfig = (agent.runtimeConfig as Record<string, unknown>) ?? {};
    const disabled = new Set<string>((runtimeConfig.disabledBuiltinTools as string[]) || []);

    if (enabled) {
      disabled.delete(toolName);
    } else {
      disabled.add(toolName);
    }

    await this.prisma.agent.update({
      where: { id: agentId },
      data: { runtimeConfig: { ...runtimeConfig, disabledBuiltinTools: Array.from(disabled) } },
    });

    return { success: true, toolName, enabled };
  }

  private estimateCost(provider: string, tokens: { input: number; output: number }): number {
    const rates: Record<string, { input: number; output: number }> = {
      ANTHROPIC: { input: 15, output: 75 }, OPENAI: { input: 10, output: 30 }, GOOGLE: { input: 7, output: 21 },
      DEEPSEEK: { input: 0.14, output: 0.28 }, MISTRAL: { input: 2, output: 6 }, MINIMAX: { input: 1, output: 4 }, GLM: { input: 0.7, output: 2.8 },
      XAI: { input: 3, output: 15 }, COHERE: { input: 2.5, output: 10 }, PERPLEXITY: { input: 1, output: 5 }, TOGETHER: { input: 0.8, output: 0.8 }, FIREWORKS: { input: 0.9, output: 0.9 }, GROQ: { input: 0.05, output: 0.08 }, MOONSHOT: { input: 0.7, output: 2.8 }, QWEN: { input: 0.5, output: 2 }, AI21: { input: 2, output: 8 }, SAMBANOVA: { input: 0.1, output: 0.4 },
    };
    const rate = rates[provider] ?? { input: 10, output: 30 };
    return (tokens.input * rate.input + tokens.output * rate.output) / 1_000_000;
  }
}
