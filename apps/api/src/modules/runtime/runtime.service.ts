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
import { AgentRunner, type RunResult, type UserMessage, type MessagePart } from '@agems/ai';
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';

@Injectable()
export class RuntimeService {
  private readonly logger = new Logger(RuntimeService.name);
  /** Per-channel execution locks: prevents duplicate agent runs when messages arrive during execution */
  private readonly executionLocks = new Map<string, Promise<void>>();
  /** Queued messages: stores the latest message received while a channel is locked */
  private readonly pendingMessages = new Map<string, { channelId: string; message: any }>();
  /** Abort controllers for running executions — keyed by executionId */
  private readonly abortControllers = new Map<string, AbortController>();

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
  ) {}

  /** Handle stop execution request from UI */
  @OnEvent('agent.execution.stop')
  handleStopExecution(payload: { channelId?: string; executionId?: string }) {
    if (payload.executionId) {
      const stopped = this.stopExecution(payload.executionId);
      this.logger.log(`Stop execution ${payload.executionId}: ${stopped ? 'stopped' : 'not found'}`);
    } else {
      const stopped = this.stopChannel(payload.channelId || '');
      this.logger.log(`Stop all executions in channel ${payload.channelId}: ${stopped} stopped`);
    }
  }

  /** Track recent agent-to-agent exchanges per channel to prevent infinite loops */
  private readonly agentExchangeCount = new Map<string, { count: number; resetAt: number }>();
  private readonly MAX_AGENT_EXCHANGES = 4; // max agent-to-agent rounds per channel per window
  private readonly AGENT_EXCHANGE_WINDOW_MS = 5 * 60 * 1000; // 5 minute window

  /** When a message arrives, trigger agent responses */
  @OnEvent('message.new')
  async handleChannelMessage(payload: { channelId: string; message: any }) {
    const { channelId, message } = payload;

    // SYSTEM messages never trigger agents
    if (message.senderType === 'SYSTEM') return;

    // Agent-to-agent loop prevention
    if (message.senderType === 'AGENT') {
      const exchKey = `a2a:${channelId}`;
      const now = Date.now();
      const exch = this.agentExchangeCount.get(exchKey);
      if (exch && now < exch.resetAt) {
        if (exch.count >= this.MAX_AGENT_EXCHANGES) {
          this.logger.debug(`Agent-to-agent limit reached in channel ${channelId}, skipping`);
          return;
        }
        exch.count++;
      } else {
        this.agentExchangeCount.set(exchKey, { count: 1, resetAt: now + this.AGENT_EXCHANGE_WINDOW_MS });
      }
    }

    // Execution queue guard: if agents are already executing in this channel,
    // queue the latest message so it's processed after the current execution finishes
    const lockKey = `channel:${channelId}`;
    if (this.executionLocks.has(lockKey)) {
      this.logger.log(`Queuing message in channel ${channelId} — agents are already executing`);
      this.pendingMessages.set(lockKey, { channelId, message });
      return;
    }

    // Find active agent participants
    const participants = await this.prisma.channelParticipant.findMany({
      where: { channelId, participantType: 'AGENT' },
    });
    if (participants.length === 0) return;

    const agents: any[] = [];
    for (const p of participants) {
      try {
        // Skip sender agent — don't let agent respond to itself
        if (message.senderType === 'AGENT' && p.participantId === message.senderId) continue;
        const agent = await this.agentsService.findOne(p.participantId);
        if (agent.status === 'ACTIVE') agents.push(agent);
      } catch {}
    }
    if (agents.length === 0) return;

    // Acquire the lock for this channel
    let releaseLock: () => void;
    const lockPromise = new Promise<void>(resolve => { releaseLock = resolve; });
    this.executionLocks.set(lockKey, lockPromise);

    try {
      // Sequential dialogue: each agent sees previous agents' replies
      // For agent-to-agent: only 1 round to prevent loops
      // For human messages: 2 rounds so agents can react to each other
      const maxRounds = message.senderType === 'AGENT' ? 1 : (agents.length > 1 ? 2 : 1);

      for (let round = 0; round < maxRounds; round++) {
        for (const agent of agents) {
          try {
            let context = await this.buildConversationContext(channelId, agent, agents);

            // Strip image parts for non-vision providers (DeepSeek, Mistral, etc.)
            const nonVisionProviders = ['DEEPSEEK', 'MISTRAL', 'OLLAMA'];
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
            const executionMeta = (skillCalls.length > 0 || toolCalls.length > 0 || thinking.length > 0 || loopDetected || result.iterations > 1) ? {
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
          } catch (err) {
            this.logger.error(`Agent ${agent.id} failed in channel ${channelId}: ${err}`);
          }
        }
      }
    } finally {
      this.executionLocks.delete(lockKey);
      releaseLock!();

      // Process the latest queued message if any arrived during execution
      const pending = this.pendingMessages.get(lockKey);
      if (pending) {
        this.pendingMessages.delete(lockKey);
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

    return merged;
  }

  /** When a human adds a meeting entry, trigger agent participants to respond */
  @OnEvent('meeting.entry.human')
  async handleMeetingEntry(payload: { meetingId: string; entry: any }) {
    const { meetingId, entry } = payload;

    if (entry.speakerType !== 'HUMAN' || entry.entryType !== 'SPEECH') return;

    const participants = await this.prisma.meetingParticipant.findMany({
      where: { meetingId, participantType: 'AGENT' },
    });
    if (participants.length === 0) return;

    const agents: any[] = [];
    for (const p of participants) {
      try {
        const agent = await this.agentsService.findOne(p.participantId);
        if (agent.status === 'ACTIVE') agents.push(agent);
      } catch {}
    }
    if (agents.length === 0) return;

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { title: true, agenda: true },
    });

    // Emit expected agent count so frontend knows how many responses to wait for
    this.events.emit('meeting.agents.pending', { meetingId, count: agents.length });

    // Run all agents in parallel for faster responses
    await Promise.allSettled(agents.map(async (agent) => {
      try {
        const context = await this.buildMeetingContext(meetingId, agent, agents, meeting);

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

        // Create a visible error entry so the user knows what happened
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
  }

  private async buildMeetingContext(meetingId: string, currentAgent: any, allAgents: any[], meeting: any): Promise<string> {
    const entries = await this.prisma.meetingEntry.findMany({
      where: { meetingId }, orderBy: { order: 'asc' }, take: 50,
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
    return `You are ${currentAgent.name}, participating in a meeting "${meeting?.title || 'Meeting'}".${agenda}\n\nTranscript:\n${lines.join('\n')}\n\nRespond as ${currentAgent.name}. Be concise and professional. Focus on the topic discussed. Share your expertise if relevant.`;
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
    try {
      const tools = await this.buildTools(agent, context);

      // Inject extra tools (e.g. Telegram-specific tools)
      if (context?.extraTools?.length) {
        tools.push(...context.extraTools);
      }

      // Wrap tools with approval checks
      const wrappedTools = await this.wrapToolsWithApproval(
        tools, agent.id, execution.id, context?.channelId, context?.taskId, context?.approvedTools,
      );

      const runtimeConfig = agent.runtimeConfig as Record<string, unknown> ?? {};
      const llmConfig = agent.llmConfig as Record<string, unknown> ?? {};

      const apiKey = await this.getApiKey(agent.llmProvider);

      // If no API key configured, return a helpful welcome message instead of failing
      if (!apiKey) {
        const noKeyMessage = `Hello! I'm ${agent.name}, your AGEMS assistant.\n\nTo start working, I need an API key for any LLM provider. You can choose based on your needs and budget:\n\n**Popular options:**\n• **Google Gemini** — great free tier, good for getting started → [ai.google.dev](https://ai.google.dev)\n• **Anthropic Claude** — excellent reasoning and coding → [console.anthropic.com](https://console.anthropic.com)\n• **OpenAI GPT** — versatile, widely supported → [platform.openai.com](https://platform.openai.com)\n• **DeepSeek** — very affordable, strong performance → [platform.deepseek.com](https://platform.deepseek.com)\n\n**How to set up:**\n1. Get an API key from any provider above\n2. Go to **Settings** → **LLM Keys** and paste your key\n3. Come back here and I'm ready!\n\n**Want to change your model later?**\nGo to **Agents** → select me → change **LLM Provider** and **Model** anytime.\n\nPick what works for you — I'll work with any of them!`;
        await this.prisma.agentExecution.update({
          where: { id: execution.id },
          data: { status: 'COMPLETED', output: { text: noKeyMessage }, endedAt: new Date() },
        });
        return { text: noKeyMessage, toolCalls: [], tokensUsed: 0, costUsd: 0, waitingForApproval: false, thinking: [] as string[], iterations: 0, loopDetected: false, executionId: execution.id };
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
      executionTimeout = setTimeout(() => {
        this.logger.warn(`Agent ${agent.name}: execution timeout (30 min) — aborting`);
        abortController.abort();
      }, 30 * 60 * 1000);

      const runner = new AgentRunner({
        provider: {
          provider: agent.llmProvider as any,
          model: agent.llmModel,
          apiKey,
        },
        systemPrompt: await this.buildSystemPrompt(agent),
        tools: liveTools,
        maxIterations: (runtimeConfig.maxIterations as number) ?? 150,
        maxTokens: (llmConfig.maxTokens as number) ?? 4096,
        temperature: (llmConfig.temperature as number) ?? 0.7,
        thinkingBudget: (llmConfig.thinkingBudget as number) ?? 4000,
      });

      // Stream thinking & text chunks to frontend in real-time
      const streamCallbacks = context?.channelId ? {
        onThinkingChunk: (chunk: string) => {
          this.events.emit('agent.thinking.chunk', {
            channelId: context.channelId, agentId, executionId: execution.id, chunk,
          });
        },
        onTextChunk: (chunk: string) => {
          this.events.emit('agent.text.chunk', {
            channelId: context.channelId, agentId, executionId: execution.id, chunk,
          });
        },
      } : undefined;

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

      // Clear execution timeout
      clearTimeout(executionTimeout);

      this.logger.log(`Agent ${agent.name}: ${result.toolCalls?.length || 0} tool calls, ${result.iterations} iterations, text=${result.text?.substring(0, 80)}...`);

      // Clean up abort controller
      this.abortControllers.delete(execution.id);

      // Emit execution done for real-time UI
      if (context?.channelId) {
        this.events.emit('agent.execution.done', {
          channelId: context.channelId, agentId, executionId: execution.id,
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
          },
        });

        return { executionId: execution.id, ...result, waitingForApproval: true };
      }

      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: 'COMPLETED',
          output: { text: result.text },
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

      return { executionId: execution.id, ...result, waitingForApproval: false };
    } catch (error) {
      clearTimeout(executionTimeout);
      this.abortControllers.delete(execution.id);
      const isAborted = error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));
      const errorMessage = isAborted ? 'Execution timed out or stopped' : (error instanceof Error ? error.message : String(error));
      this.logger.log(isAborted ? `Agent ${agentId} execution stopped by user` : `Agent ${agentId} execution failed: ${errorMessage}`);

      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: { status: isAborted ? 'CANCELLED' as any : 'FAILED', error: errorMessage, endedAt: new Date() },
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
  stopExecution(executionId: string): boolean {
    const controller = this.abortControllers.get(executionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(executionId);
      return true;
    }
    return false;
  }

  /** Stop all running executions in a channel */
  stopChannel(channelId: string): number {
    // We need to find executions by channel — check running executions
    let stopped = 0;
    for (const [execId, controller] of this.abortControllers) {
      controller.abort();
      this.abortControllers.delete(execId);
      stopped++;
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
  ): Promise<any[]> {
    const policy = await this.approvals.getPolicy(agentId);

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

  /** Build full system prompt: AGEMS preamble (from DB) + autonomy directive + company context + skill names (loaded on demand via use_skill tool) + agent's own system prompt */
  private async buildSystemPrompt(agent: any): Promise<string> {
    const [agemsPreamble, companyContext, autonomyLevel] = await Promise.all([
      this.settings.getAgemsPreamble(),
      this.settings.getCompanyContext(),
      this.settings.getAutonomyLevel(),
    ]);
    const autonomyDirective = this.settings.getAutonomyDirective(autonomyLevel);

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

    // Inject persistent KNOWLEDGE memories into prompt
    let memoryContext = '';
    try {
      const memories = await this.prisma.agentMemory.findMany({
        where: { agentId: agent.id, type: 'KNOWLEDGE' },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      if (memories.length > 0) {
        const entries = memories.map(m => `- ${m.content}`).join('\n');
        memoryContext = `\n=== YOUR PERSISTENT MEMORY ===\nThese are facts you saved from previous conversations. Use memory_write to add new knowledge, memory_delete to remove outdated entries.\n${entries}\n=== END MEMORY ===\n\n`;
      }
    } catch { /* memory table might not exist yet */ }

    return agemsPreamble + '\n' + autonomyDirective + '\n\n' + companyContext + skillsContext + memoryContext + agent.systemPrompt;
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

    // ── System tools (bash, file I/O) — available to ALL agents ──
    {
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

      tools.push({
        name: 'read_file',
        description: 'Read the contents of a file. Supports text files and PDF (auto-extracts text from PDF).',
        parameters: z.object({
          path: z.string().describe('Absolute path to the file'),
          maxLines: z.number().optional().describe('Max lines to read (default 200)'),
        }),
        execute: async (params: { path: string; maxLines?: number }) => {
          return this.readFile(params.path, params.maxLines ?? 200);
        },
      });

      tools.push({
        name: 'write_file',
        description: 'Write content to a file (creates or overwrites).',
        parameters: z.object({
          path: z.string().describe('Absolute path to the file'),
          content: z.string().describe('Content to write'),
        }),
        execute: async (params: { path: string; content: string }) => {
          return this.writeFile(params.path, params.content);
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
            return { success: true };
          } catch {
            return { error: 'Memory entry not found' };
          }
        },
      });
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
- "list" — list all agents with id, name, mission (role description), status, llmProvider, llmModel
- "get" — get agent details by id
- "update" — update agent fields (name, llmProvider, llmModel, systemPrompt, status, llmConfig, runtimeConfig)
Use this to change agent models, prompts, configs, or check agent status.`,
      parameters: z.object({
        action: z.enum(['list', 'get', 'update']).describe('Action to perform'),
        agentId: z.string().optional().describe('Agent ID (required for get/update)'),
        updates: z.object({
          name: z.string().optional(),
          llmProvider: z.string().optional().describe('ANTHROPIC, OPENAI, GOOGLE, DEEPSEEK, MISTRAL'),
          llmModel: z.string().optional().describe('e.g. claude-sonnet-4-5, gpt-4o, etc.'),
          systemPrompt: z.string().optional(),
          llmConfig: z.string().optional().describe('JSON string of llmConfig overrides'),
          runtimeConfig: z.string().optional().describe('JSON string of runtimeConfig overrides'),
        }).optional().describe('Fields to update (for update action)'),
      }),
      execute: async (params: { action: string; agentId?: string; updates?: any }) => {
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
              select: { id: true, name: true, slug: true, status: true, llmProvider: true, llmModel: true, llmConfig: true, runtimeConfig: true, systemPrompt: true, mission: true },
            });
            return a || { error: 'Agent not found' };
          }
          case 'update': {
            if (!params.agentId) return { error: 'agentId is required' };
            if (!params.updates) return { error: 'updates object is required' };
            // Verify agent belongs to same org
            const target = await this.prisma.agent.findFirst({ where: { id: params.agentId, orgId: agent.orgId } });
            if (!target) return { error: 'Agent not found' };
            const data: any = {};
            if (params.updates.name) data.name = params.updates.name;
            if (params.updates.llmProvider) data.llmProvider = params.updates.llmProvider;
            if (params.updates.llmModel) data.llmModel = params.updates.llmModel;
            if (params.updates.systemPrompt) data.systemPrompt = params.updates.systemPrompt;
            if (params.updates.llmConfig) data.llmConfig = JSON.parse(params.updates.llmConfig);
            if (params.updates.runtimeConfig) data.runtimeConfig = JSON.parse(params.updates.runtimeConfig);
            if (Object.keys(data).length === 0) return { error: 'No valid fields to update' };
            const updated = await this.prisma.agent.update({
              where: { id: params.agentId },
              data,
              select: { id: true, name: true, llmProvider: true, llmModel: true },
            });
            return { success: true, agent: updated };
          }
          default:
            return { error: 'Invalid action. Use: list, get, update' };
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
            if (!params.recipientId) return { error: 'recipientId is required' };
            if (!params.message) return { error: 'message is required' };
            const recipientType = params.recipientType || 'AGENT';
            // Find existing DM channel between this agent and recipient
            const existingChannel = await this.prisma.channel.findFirst({
              where: {
                type: 'DIRECT',
                AND: [
                  { participants: { some: { participantType: 'AGENT', participantId: agent.id } } },
                  { participants: { some: { participantType: recipientType, participantId: params.recipientId } } },
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
                const ra = await this.prisma.agent.findUnique({ where: { id: params.recipientId }, select: { name: true } });
                if (ra) recipientName = ra.name;
              } else {
                const ru = await this.prisma.user.findUnique({ where: { id: params.recipientId }, select: { name: true } });
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
                      { participantType: recipientType, participantId: params.recipientId },
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
            const pending = await this.approvals.getPendingForApprover('AGENT', agent.id);
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
            const result = await this.approvals.findAll(filters);
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
            geminiApiKey = (geminiTool.tool.authConfig as any).apiKey;
          }
          if (!geminiApiKey) {
            geminiApiKey = await this.getApiKey('GOOGLE');
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

  /** Fetch tools assigned to agent from database and add executable definitions */
  private async buildAgentTools(agentId: string, orgId: string, tools: any[], chatContext?: { channelId: string; agentId: string }) {
    const agentTools = await this.prisma.agentTool.findMany({
      where: { agentId, enabled: true },
      include: { tool: true },
    });

    for (const at of agentTools) {
      const tool = at.tool;
      const config = tool.config as Record<string, any>;
      const authConfig = (tool.authConfig as Record<string, any>) ?? {};
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
    const baseUrl = config.url || '';

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
        const text = await res.text();
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

  /** Execute SQL query using mysql2 */
  private async executeSqlQuery(config: Record<string, any>, authConfig: Record<string, any>, query: string, allowWrite: boolean) {
    // Safety: block write operations if not allowed
    const upperQuery = query.trim().toUpperCase();
    if (!allowWrite && !upperQuery.startsWith('SELECT') && !upperQuery.startsWith('SHOW') && !upperQuery.startsWith('DESCRIBE') && !upperQuery.startsWith('EXPLAIN')) {
      return { error: 'Only SELECT/SHOW/DESCRIBE/EXPLAIN queries are allowed in read-only mode.' };
    }
    // Block dangerous operations
    if (/\b(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i.test(query)) {
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
      });

      try {
        const cleanQuery = query.replace(/;\s*$/, '');
        const needsLimit = !allowWrite && !cleanQuery.trim().toUpperCase().includes('LIMIT');
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
      const text = await res.text();

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
    const { execSync } = await import('child_process');
    const blockedCommands = runtimeConfig.blockedCommands as string[] | undefined;
    const allowedCommands = runtimeConfig.allowedCommands as string[] | undefined;
    const cwd = runtimeConfig.workingDirectory as string || '/tmp';

    const firstWord = command.trim().split(/\s+/)[0];
    const blocked = blockedCommands ?? ['rm', 'rmdir', 'dd', 'mkfs', 'shutdown', 'reboot', 'kill', 'killall'];
    if (blocked.includes(firstWord)) return { error: `Command '${firstWord}' is blocked` };
    if (allowedCommands && !allowedCommands.includes(firstWord)) return { error: `Command '${firstWord}' not allowed` };

    try {
      const output = execSync(command, { timeout: timeout * 1000, cwd, maxBuffer: 1024 * 1024, encoding: 'utf-8' });
      return { stdout: output.substring(0, 50000) };
    } catch (err: any) {
      return { error: err.message, stderr: err.stderr?.substring(0, 10000) };
    }
  }

  private async readFile(filePath: string, maxLines: number) {
    const { readFileSync, statSync } = await import('fs');
    const { extname } = await import('path');
    try {
      const stats = statSync(filePath);
      if (stats.size > 10 * 1024 * 1024) return { error: 'File too large (>10MB)' };

      const ext = extname(filePath).toLowerCase();

      // PDF: extract text via pdftotext
      if (ext === '.pdf') {
        const { execSync } = await import('child_process');
        try {
          const text = execSync(`pdftotext "${filePath}" -`, {
            maxBuffer: 5 * 1024 * 1024,
            timeout: 15000,
          }).toString('utf-8');
          const lines = text.split('\n');
          return { content: lines.slice(0, maxLines).join('\n'), totalLines: lines.length, type: 'pdf' };
        } catch (pdfErr: any) {
          return { error: `Failed to extract PDF text: ${pdfErr.message}` };
        }
      }

      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      return { content: lines.slice(0, maxLines).join('\n'), totalLines: lines.length };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  private async writeFile(path: string, content: string) {
    const { writeFileSync } = await import('fs');
    try {
      writeFileSync(path, content, 'utf-8');
      return { success: true, path };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  /** Get LLM API key: Settings table first, then env vars fallback */
  private async getApiKey(provider: string): Promise<string | undefined> {
    const settingsMap: Record<string, string> = { ANTHROPIC: 'llm_key_anthropic', OPENAI: 'llm_key_openai', GOOGLE: 'llm_key_google', DEEPSEEK: 'llm_key_deepseek', MISTRAL: 'llm_key_mistral' };
    const envMap: Record<string, string> = { ANTHROPIC: 'ANTHROPIC_API_KEY', OPENAI: 'OPENAI_API_KEY', GOOGLE: 'GOOGLE_AI_API_KEY', DEEPSEEK: 'DEEPSEEK_API_KEY', MISTRAL: 'MISTRAL_API_KEY' };

    const sk = settingsMap[provider];
    if (sk) { const v = await this.settings.get(sk); if (v) return v; }
    const ev = envMap[provider];
    return ev ? process.env[ev] : undefined;
  }

  /** Get list of built-in runtime tools for an agent (names + descriptions only, no executors) */
  async getBuiltinToolNames(agentId: string): Promise<Array<{ name: string; description: string; category: string; enabled: boolean }>> {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: { skills: { include: { skill: true } }, tools: { include: { tool: true } } },
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

    // System — available to all agents
    add('bash_command', 'Execute bash commands', 'System');
    add('read_file', 'Read file contents (text, PDF)', 'System');
    add('write_file', 'Write content to file', 'System');

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
      }
    }

    // Telegram
    const tgConfig = agent.telegramConfig as Record<string, any> | null;
    if (tgConfig?.apiId && tgConfig?.apiHash && tgConfig?.sessionString) {
      for (const t of ['tg_send_message', 'tg_read_messages', 'tg_find_contact', 'tg_list_dialogs', 'tg_send_photo']) {
        add(t, t.replace(/tg_/g, '').replace(/_/g, ' '), 'Telegram');
      }
    }

    // AGEMS built-in
    add('agems_manage_agents', 'List, get, update agents', 'AGEMS Platform');
    add('agems_manage_skills', 'Manage agent skills assignments', 'AGEMS Platform');
    add('agems_tasks', 'View, create, update tasks', 'AGEMS Platform');
    add('agems_channels', 'Send messages, list channels, DM agents', 'AGEMS Platform');
    add('agems_meetings', 'Schedule and manage meetings', 'AGEMS Platform');
    add('agems_approvals', 'Request and resolve approvals between agents/humans', 'AGEMS Platform');
    add('agems_send_image', 'Send image to chat channel', 'AGEMS Platform');
    add('list_org_files', 'List and search uploaded files in the organisation', 'AGEMS Platform');
    add('gemini_generate_image', 'Generate images with Gemini AI (supports logo/reference images)', 'AGEMS Platform');
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
      DEEPSEEK: { input: 0.14, output: 0.28 }, MISTRAL: { input: 2, output: 6 },
    };
    const rate = rates[provider] ?? { input: 10, output: 30 };
    return (tokens.input * rate.input + tokens.output * rate.output) / 1_000_000;
  }
}
