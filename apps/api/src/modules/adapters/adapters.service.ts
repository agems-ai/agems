import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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

@Injectable()
export class AdaptersService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  listAdapters() {
    return ADAPTER_META;
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

  async checkAvailability(type: string, config?: Record<string, any>) {
    const adapter = await this.createAdapter(type as AdapterType, config || {});
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
    const adapter = await this.createAdapter(type as AdapterType, options.config || {});

    // Create execution record
    const execution = await this.prisma.agentExecution.create({
      data: {
        agentId: options.userId, // placeholder for direct adapter execution
        status: 'RUNNING',
        triggerType: 'MANUAL',
        triggerId: options.taskId,
        input: { prompt, adapterType: type, config: options.config },
        startedAt: new Date(),
      },
    });

    try {
      const result = await adapter.execute({
        prompt,
        taskId: options.taskId,
        context: options.context,
      });

      // Update execution record
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: result.success ? 'COMPLETED' : 'FAILED',
          output: result as any,
          tokensUsed: result.tokensUsed,
          costUsd: result.costUsd,
          error: result.error,
          endedAt: new Date(),
        },
      });

      this.events.emit('adapter.execution.completed', { executionId: execution.id, type, result });

      return { executionId: execution.id, ...result };
    } catch (err: any) {
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: 'FAILED',
          error: err.message,
          endedAt: new Date(),
        },
      });
      throw err;
    }
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

      const result = await adapter.execute({
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
    // Dynamic import to avoid hard dependency on adapters package
    try {
      const { AdapterFactory } = await import('@agems/adapters');
      return AdapterFactory.create(type, config);
    } catch {
      // Fallback: inline adapter creation if package not linked
      const { spawn } = await import('child_process');

      const CLI_MAP: Record<string, string> = {
        CLAUDE_CODE: 'claude',
        CODEX: 'codex',
        CURSOR: 'cursor',
        GEMINI_CLI: 'gemini',
        OPENCODE: 'opencode',
        PI: 'pi',
      };

      if (type === 'HTTP') {
        return {
          checkAvailability: async () => {
            if (!config.url) return { available: false, error: 'URL not configured' };
            try {
              await fetch(config.url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
              return { available: true };
            } catch (e: any) {
              return { available: false, error: e.message };
            }
          },
          execute: async (input: any) => {
            const res = await fetch(config.url, {
              method: config.method || 'POST',
              headers: { 'Content-Type': 'application/json', ...config.headers },
              body: JSON.stringify({ prompt: input.prompt, context: input.context }),
            });
            const text = await res.text();
            return { success: res.ok, output: text, durationMs: 0 };
          },
        };
      }

      if (type === 'PROCESS') {
        return {
          checkAvailability: async () => ({ available: !!config.command, error: config.command ? undefined : 'No command' }),
          execute: async (input: any) => {
            return new Promise<any>((resolve) => {
              const proc = spawn(config.command, config.args || [], {
                cwd: config.workingDir || process.cwd(),
                shell: true,
                env: { ...process.env, AGEMS_PROMPT: input.prompt },
              });
              let stdout = '';
              proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
              proc.on('close', (code: number | null) => {
                resolve({ success: code === 0, output: stdout, durationMs: 0 });
              });
              if (proc.stdin) { proc.stdin.write(input.prompt); proc.stdin.end(); }
            });
          },
        };
      }

      const cliName = CLI_MAP[type];
      if (!cliName) {
        throw new Error(`Adapter type ${type} not available. Install @agems/adapters package.`);
      }

      return {
        checkAvailability: async () => {
          return new Promise<any>((resolve) => {
            const proc = spawn(cliName, ['--version'], { shell: true });
            let out = '';
            proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
            proc.on('close', (code: number | null) => {
              resolve(code === 0 ? { available: true, version: out.trim() } : { available: false, error: `${cliName} not found` });
            });
            proc.on('error', () => resolve({ available: false, error: `${cliName} not installed` }));
          });
        },
        execute: async (input: any) => {
          return new Promise<any>((resolve) => {
            const args = ['--print', input.prompt];
            const proc = spawn(cliName, args, {
              cwd: config.workingDir || process.cwd(),
              shell: true,
              env: { ...process.env, ...config.env },
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
            proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
            proc.on('close', (code: number | null) => {
              resolve({ success: code === 0, output: stdout, error: code !== 0 ? stderr : undefined, durationMs: 0 });
            });
            proc.on('error', (e: Error) => resolve({ success: false, error: e.message, output: '', durationMs: 0 }));
          });
        },
      };
    }
  }
}
