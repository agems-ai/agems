import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';

// Import adapter types inline to avoid build issues if package not yet linked
type AdapterType = 'CLAUDE_CODE' | 'CODEX' | 'CURSOR' | 'GEMINI_CLI' | 'OPENCLAW' | 'OPENCODE' | 'PI' | 'HTTP' | 'PROCESS';

const ADAPTER_META: Array<{ type: AdapterType; name: string; description: string }> = [
  { type: 'CLAUDE_CODE', name: 'Claude Code', description: 'Anthropic Claude Code CLI - AI coding agent with file editing, bash, and search tools' },
  { type: 'CODEX', name: 'OpenAI Codex', description: 'OpenAI Codex CLI - AI coding agent with auto-edit and full-auto modes' },
  { type: 'CURSOR', name: 'Cursor', description: 'Cursor IDE agent - AI coding within Cursor IDE with background mode support' },
  { type: 'GEMINI_CLI', name: 'Gemini CLI', description: 'Google Gemini CLI - AI agent with sandbox mode and multimodal support' },
  { type: 'OPENCLAW', name: 'OpenClaw', description: 'OpenClaw agent - Docker-based agent accessed via SSE gateway' },
  { type: 'OPENCODE', name: 'OpenCode', description: 'OpenCode AI agent - Multi-provider coding agent with model detection' },
  { type: 'PI', name: 'Pi', description: 'Pi agent - AI coding agent with model selection' },
  { type: 'HTTP', name: 'HTTP Webhook', description: 'Generic HTTP adapter - Send tasks to any REST endpoint' },
  { type: 'PROCESS', name: 'Process', description: 'Generic shell command adapter - Run any CLI tool or script as an agent' },
];

/**
 * Adapters that take a URL or a command from config. They are never executed from these endpoints:
 * HTTP/OPENCLAW would let a caller make the API host call internal addresses, PROCESS runs a command.
 */
const DANGEROUS_ADAPTERS = new Set<AdapterType>(['HTTP', 'PROCESS', 'OPENCLAW']);

/** Emails of platform operators (PLATFORM_ADMIN_EMAILS, comma separated). Org ADMIN is not enough: every signup is ADMIN of its own org. */
export function platformAdminEmails(list: string | undefined = process.env.PLATFORM_ADMIN_EMAILS): string[] {
  return (list || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** External adapters run agent CLIs on the API host, so they are off unless ADAPTERS_ENABLED=true. */
export function adaptersEnabled(flag: string | undefined = process.env.ADAPTERS_ENABLED): boolean {
  return (flag || '').trim().toLowerCase() === 'true';
}

function assertPromptInput(prompt: unknown, context: unknown) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new BadRequestException('prompt is required');
  if (context !== undefined && context !== null && typeof context !== 'string') throw new BadRequestException('context must be a string');
}

/** Runs an adapter; invalid input (AdapterConfigError) is a 400, not a 500. */
async function runAdapter(adapter: any, input: Record<string, unknown>) {
  try {
    return await adapter.execute(input);
  } catch (err: any) {
    if (err?.name === 'AdapterConfigError') throw new BadRequestException(err.message);
    throw err;
  }
}

@Injectable()
export class AdaptersService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  listAdapters() {
    return ADAPTER_META;
  }

  /**
   * Access to anything that starts a process or calls out: the feature flag must be on and the caller must be a
   * platform admin (PLATFORM_ADMIN_EMAILS). Checked on every availability and execute call.
   */
  async assertAccess(userId: string | undefined): Promise<void> {
    if (!adaptersEnabled()) {
      throw new ForbiddenException('External adapters are disabled on this server');
    }
    const allowList = platformAdminEmails();
    if (!userId || allowList.length === 0) {
      throw new ForbiddenException('Only a platform admin can use external adapters');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user?.email || !allowList.includes(user.email.trim().toLowerCase())) {
      throw new ForbiddenException('Only a platform admin can use external adapters');
    }
  }

  private getAdapterType(type: string): AdapterType {
    const adapterType = type as AdapterType;
    if (!ADAPTER_META.some((item) => item.type === adapterType)) {
      throw new BadRequestException('Unknown adapter type');
    }
    return adapterType;
  }

  private assertSafeAdapterType(type: AdapterType) {
    if (DANGEROUS_ADAPTERS.has(type)) {
      throw new ForbiddenException(`${type} adapters cannot be executed directly from this endpoint`);
    }
  }

  async checkAllAvailability() {
    const results: Record<string, any> = {};

    await Promise.all(
      ADAPTER_META.map(async ({ type }) => {
        try {
          const adapter = await this.createAdapter(type, {});
          results[type] = await adapter.checkAvailability();
        } catch (err: any) {
          results[type] = { available: false, error: err.message };
        }
      })
    );

    return results;
  }

  /** Caller config is never used here: an availability probe must not reach a caller-chosen URL or command. */
  async checkAvailability(type: string) {
    const adapter = await this.createAdapter(this.getAdapterType(type), {});
    return adapter.checkAvailability();
  }

  async execute(
    type: string,
    prompt: string,
    options: {
      config?: Record<string, any>;
      taskId?: string;
      context?: string;
      userId: string;
      orgId: string;
    },
  ) {
    const adapterType = this.getAdapterType(type);
    this.assertSafeAdapterType(adapterType);
    assertPromptInput(prompt, options.context);
    const config = options.config ?? {};
    if (typeof config !== 'object' || Array.isArray(config)) throw new BadRequestException('config must be an object');
    const adapter = await this.createAdapter(adapterType, config);
    const result = await runAdapter(adapter, {
      prompt,
      taskId: options.taskId,
      context: options.context,
    });
    return { executionId: null, ...result };
  }

  async executeForAgent(
    agentId: string,
    prompt: string,
    options: {
      taskId?: string;
      context?: string;
      userId: string;
      orgId: string;
    },
  ) {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.orgId !== options.orgId) throw new BadRequestException('Access denied');
    if (!agent.adapterType) throw new BadRequestException('Agent has no external adapter configured');
    if (!ADAPTER_META.some((item) => item.type === agent.adapterType) || DANGEROUS_ADAPTERS.has(agent.adapterType as AdapterType)) {
      throw new ForbiddenException('This agent uses a privileged adapter and cannot be executed from this endpoint');
    }

    assertPromptInput(prompt, options.context);
    const adapter = await this.createAdapter(
      agent.adapterType as AdapterType,
      (agent.adapterConfig as Record<string, any>) || {},
    );

    // Create execution record
    const execution = await this.prisma.agentExecution.create({
      data: {
        agentId: agent.id,
        status: 'RUNNING',
        triggerType: 'MANUAL',
        triggerId: options.taskId,
        input: { prompt, adapterType: agent.adapterType },
        startedAt: new Date(),
      },
    });

    try {
      // Inject agent's system prompt and skills as context
      const skills = await this.prisma.agentSkill.findMany({
        where: { agentId: agent.id, enabled: true },
        include: { skill: true },
      });

      const fullContext = [
        agent.systemPrompt ? `System Instructions:\n${agent.systemPrompt}` : '',
        agent.mission ? `Mission:\n${agent.mission}` : '',
        options.context || '',
      ].filter(Boolean).join('\n\n');

      const result = await runAdapter(adapter, {
        prompt,
        taskId: options.taskId,
        context: fullContext,
        skills: skills.map(s => s.skill.name),
      });

      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: result.success ? 'COMPLETED' : 'FAILED',
          output: result as any,
          toolCalls: result.toolCalls as any,
          tokensUsed: result.tokensUsed,
          costUsd: result.costUsd,
          error: result.error,
          endedAt: new Date(),
        },
      });

      this.events.emit('adapter.execution.completed', {
        executionId: execution.id,
        agentId: agent.id,
        result,
      });

      return { executionId: execution.id, ...result };
    } catch (err: any) {
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: { status: 'FAILED', error: err.message, endedAt: new Date() },
      });
      throw err;
    }
  }

  private async createAdapter(type: AdapterType, config: Record<string, any>): Promise<any> {
    // No inline fallback: a second copy of the spawn logic is how shell:true and the full process env came back.
    let factory: { create(type: string, config: Record<string, any>): any };
    try {
      factory = (await import('@agems/adapters')).AdapterFactory;
    } catch {
      throw new ServiceUnavailableException('External adapters are not installed on this server');
    }
    try {
      return factory.create(type, config);
    } catch (err: any) {
      if (err?.name === 'AdapterConfigError') throw new BadRequestException(err.message);
      throw err;
    }
  }
}
