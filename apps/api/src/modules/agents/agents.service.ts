import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { CreateAgentInput, UpdateAgentInput, AgentFilters } from '@agems/shared';

@Injectable()
export class AgentsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
    private settings: SettingsService,
  ) {}

  async create(input: CreateAgentInput, ownerId: string, orgId: string) {
    // Apply org defaults if provider/model not specified
    const llmProvider = input.llmProvider || await this.settings.get('default_llm_provider', orgId) || 'ANTHROPIC';
    const llmModel = input.llmModel || await this.settings.get('default_model', orgId) || 'claude-sonnet-4-5-20250929';

    const agent = await this.prisma.agent.create({
      data: {
        orgId,
        name: input.name,
        slug: input.slug,
        avatar: input.avatar,
        type: input.type ?? 'AUTONOMOUS',
        llmProvider,
        llmModel,
        llmConfig: (input.llmConfig ?? {}) as any,
        systemPrompt: input.systemPrompt,
        mission: input.mission,
        values: (input.values ?? []) as any,
        runtimeConfig: (input.runtimeConfig ?? {}) as any,
        ownerId,
        metadata: input.metadata as any,
      },
      include: { owner: { select: { id: true, name: true, email: true } } },
    });

    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: ownerId, action: 'CREATE',
      resourceType: 'agent', resourceId: agent.id, orgId,
    });
    this.events.emit('agent.created', { id: agent.id, name: agent.name });
    return agent;
  }

  async findAll(filters: AgentFilters, orgId: string) {
    const { status, type, llmProvider, search } = filters;
    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 100;
    const where = {
      orgId,
      ...(status && { status }),
      ...(type && { type }),
      ...(llmProvider && { llmProvider }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { slug: { contains: search, mode: 'insensitive' as const } },
          { mission: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.agent.findMany({
        where,
        include: {
          owner: { select: { id: true, name: true } },
          positions: { select: { title: true }, take: 1 },
          _count: { select: { skills: true, tools: true, childAgents: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.agent.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOne(id: string, orgId?: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        positions: { select: { title: true }, take: 1 },
        skills: { include: { skill: true } },
        tools: { include: { tool: true } },
        responsibilities: true,
        parentAgent: { select: { id: true, name: true, slug: true } },
        childAgents: { select: { id: true, name: true, slug: true, status: true } },
        _count: { select: { memory: true, executions: true, metrics: true } },
      },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    if (orgId && agent.orgId !== orgId) throw new NotFoundException('Agent not found');
    return agent;
  }

  async update(id: string, input: UpdateAgentInput, userId: string, orgId: string) {
    await this.findOne(id, orgId);

    const agent = await this.prisma.agent.update({
      where: { id },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.slug && { slug: input.slug }),
        ...(input.avatar !== undefined && { avatar: input.avatar }),
        ...(input.type && { type: input.type }),
        ...(input.llmProvider && { llmProvider: input.llmProvider }),
        ...(input.llmModel && { llmModel: input.llmModel }),
        ...(input.llmConfig && { llmConfig: input.llmConfig as any }),
        ...(input.systemPrompt && { systemPrompt: input.systemPrompt }),
        ...(input.mission !== undefined && { mission: input.mission }),
        ...(input.values && { values: input.values as any }),
        ...(input.runtimeConfig && { runtimeConfig: input.runtimeConfig as any }),
        ...(input.telegramConfig !== undefined && { telegramConfig: input.telegramConfig as any }),
        ...(input.metadata && { metadata: input.metadata as any }),
        version: { increment: 1 },
      },
      include: { owner: { select: { id: true, name: true, email: true } } },
    });

    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: userId, action: 'UPDATE',
      resourceType: 'agent', resourceId: agent.id, orgId,
    });
    if (input.telegramConfig !== undefined) {
      this.events.emit('agent.telegram-config-changed', { id });
    }
    return agent;
  }

  async activate(id: string, userId: string, orgId: string) {
    await this.findOne(id, orgId);
    const agent = await this.prisma.agent.update({ where: { id }, data: { status: 'ACTIVE' } });
    this.events.emit('agent.status-changed', { id, status: 'ACTIVE' });
    return agent;
  }

  async pause(id: string, userId: string, orgId: string) {
    await this.findOne(id, orgId);
    const agent = await this.prisma.agent.update({ where: { id }, data: { status: 'PAUSED' } });
    this.events.emit('agent.status-changed', { id, status: 'PAUSED' });
    return agent;
  }

  async archive(id: string, userId: string, orgId: string) {
    await this.findOne(id, orgId);
    const agent = await this.prisma.agent.update({ where: { id }, data: { status: 'ARCHIVED' } });
    this.events.emit('agent.status-changed', { id, status: 'ARCHIVED' });
    return agent;
  }

  async unarchive(id: string, userId: string, orgId: string) {
    await this.findOne(id, orgId);
    const agent = await this.prisma.agent.update({ where: { id }, data: { status: 'PAUSED' } });
    this.events.emit('agent.status-changed', { id, status: 'PAUSED' });
    return agent;
  }

  async getMetrics(id: string, orgId: string) {
    await this.findOne(id, orgId);
    return this.prisma.agentMetric.findMany({ where: { agentId: id }, orderBy: { periodEnd: 'desc' }, take: 100 });
  }

  async getMemory(id: string, orgId: string) {
    await this.findOne(id, orgId);
    return this.prisma.agentMemory.findMany({ where: { agentId: id }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async createMemory(agentId: string, input: { content: string; type?: string; metadata?: any }, orgId: string) {
    await this.findOne(agentId, orgId);
    return this.prisma.agentMemory.create({
      data: { agentId, type: (input.type as any) ?? 'KNOWLEDGE', content: input.content, metadata: input.metadata },
    });
  }

  async updateMemory(memoryId: string, input: { content?: string; type?: string; metadata?: any }, orgId: string) {
    const memory = await this.prisma.agentMemory.findUnique({ where: { id: memoryId } });
    if (!memory) throw new NotFoundException('Memory not found');
    await this.findOne(memory.agentId, orgId);
    return this.prisma.agentMemory.update({
      where: { id: memoryId },
      data: {
        ...(input.content !== undefined && { content: input.content }),
        ...(input.type && { type: input.type as any }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
      },
    });
  }

  async deleteMemory(memoryId: string, orgId: string) {
    const memory = await this.prisma.agentMemory.findUnique({ where: { id: memoryId } });
    if (!memory) throw new NotFoundException('Memory not found');
    await this.findOne(memory.agentId, orgId);
    return this.prisma.agentMemory.delete({ where: { id: memoryId } });
  }

  async getExecutions(id: string, orgId: string, limit = 20) {
    await this.findOne(id, orgId);
    return this.prisma.agentExecution.findMany({ where: { agentId: id }, orderBy: { startedAt: 'desc' }, take: limit });
  }

  async getCostStats(id: string, orgId: string, period: 'daily' | 'weekly' | 'monthly' = 'daily', days = 30) {
    await this.findOne(id, orgId);

    const since = new Date();
    since.setDate(since.getDate() - days);

    const executions = await this.prisma.agentExecution.findMany({
      where: { agentId: id, startedAt: { gte: since }, costUsd: { not: null } },
      select: { startedAt: true, costUsd: true, tokensUsed: true, status: true },
      orderBy: { startedAt: 'asc' },
    });

    // Aggregate by period
    const buckets: Record<string, { cost: number; tokens: number; executions: number }> = {};

    for (const ex of executions) {
      const d = new Date(ex.startedAt);
      let key: string;
      if (period === 'daily') {
        key = d.toISOString().slice(0, 10);
      } else if (period === 'weekly') {
        const day = d.getDay();
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - day);
        key = weekStart.toISOString().slice(0, 10);
      } else {
        key = d.toISOString().slice(0, 7);
      }

      if (!buckets[key]) buckets[key] = { cost: 0, tokens: 0, executions: 0 };
      buckets[key].cost += ex.costUsd ?? 0;
      buckets[key].tokens += ex.tokensUsed ?? 0;
      buckets[key].executions += 1;
    }

    const timeline = Object.entries(buckets).map(([date, data]) => ({ date, ...data }));

    // Totals
    const totalCost = executions.reduce((s, e) => s + (e.costUsd ?? 0), 0);
    const totalTokens = executions.reduce((s, e) => s + (e.tokensUsed ?? 0), 0);
    const totalExecutions = executions.length;

    return { timeline, totalCost, totalTokens, totalExecutions, period, days };
  }

  async spawn(parentId: string, input: any, ownerId: string, orgId: string) {
    const parent = await this.findOne(parentId, orgId);
    const child = await this.prisma.agent.create({
      data: {
        orgId: parent.orgId,
        name: input.name || `${parent.name} - Child`,
        slug: input.slug || `${parent.slug}-child-${Date.now()}`,
        type: input.type || parent.type,
        llmProvider: input.llmProvider || parent.llmProvider,
        llmModel: input.llmModel || parent.llmModel,
        llmConfig: (input.llmConfig || parent.llmConfig) as any,
        systemPrompt: input.systemPrompt || parent.systemPrompt,
        mission: input.mission,
        values: (input.values || parent.values) as any,
        runtimeConfig: (input.runtimeConfig || parent.runtimeConfig) as any,
        parentAgentId: parentId,
        ownerId,
      },
      include: { parentAgent: { select: { id: true, name: true, slug: true } } },
    });

    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: ownerId, action: 'CREATE',
      resourceType: 'agent', resourceId: child.id,
      details: { parentAgentId: parentId, spawned: true }, orgId,
    });
    return child;
  }

  async getHierarchy(id: string, orgId: string) {
    const agent = await this.findOne(id, orgId);
    const parentChain: any[] = [];
    let current = agent;
    while (current.parentAgent) {
      parentChain.unshift(current.parentAgent);
      const parent = await this.prisma.agent.findUnique({
        where: { id: current.parentAgent.id },
        include: { parentAgent: { select: { id: true, name: true, slug: true } } },
      });
      if (!parent) break;
      current = parent as any;
    }

    const descendants = await this.prisma.agent.findMany({
      where: { parentAgentId: id, ...(orgId && { orgId }) },
      select: { id: true, name: true, slug: true, status: true, type: true },
    });

    return { agent: { id: agent.id, name: agent.name, slug: agent.slug }, parentChain, children: descendants };
  }

  async exportAgents(orgId: string) {
    const agents = await this.prisma.agent.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      agents: agents.map(({ id, orgId: _org, ownerId: _o, createdAt: _c, ...rest }) => rest),
    };
  }

  async importAgents(input: any, userId: string, orgId: string) {
    const items = Array.isArray(input) ? input : input.agents ?? [input];
    const results: { created: number; skipped: number; errors: string[] } = { created: 0, skipped: 0, errors: [] };

    for (const item of items) {
      if (!item.name || !item.slug) {
        results.errors.push(`Missing name or slug: ${JSON.stringify(item).slice(0, 80)}`);
        continue;
      }
      const existing = await this.prisma.agent.findFirst({ where: { slug: item.slug, orgId } });
      if (existing) {
        results.skipped++;
        continue;
      }
      try {
        await this.prisma.agent.create({
          data: {
            name: item.name,
            slug: item.slug,
            avatar: item.avatar,
            type: item.type ?? 'AUTONOMOUS',
            llmProvider: item.llmProvider ?? 'ANTHROPIC',
            llmModel: item.llmModel ?? 'claude-sonnet-4-20250514',
            llmConfig: item.llmConfig ?? {},
            systemPrompt: item.systemPrompt ?? '',
            mission: item.mission,
            values: item.values ?? [],
            runtimeConfig: item.runtimeConfig ?? {},
            metadata: item.metadata,
            orgId,
            ownerId: userId,
          },
        });
        results.created++;
      } catch (e: any) {
        results.errors.push(`Failed to create "${item.name}": ${e.message}`);
      }
    }
    return results;
  }

  async delegate(parentId: string, childId: string, taskInput: any, userId: string, orgId: string) {
    const parent = await this.findOne(parentId, orgId);
    const task = await this.prisma.task.create({
      data: {
        orgId: parent.orgId,
        title: taskInput.title,
        description: taskInput.description,
        priority: taskInput.priority || 'MEDIUM',
        assigneeType: 'AGENT',
        assigneeId: childId,
        creatorType: 'HUMAN',
        creatorId: userId,
        parentTaskId: taskInput.parentTaskId,
      },
    });

    this.events.emit('audit.create', {
      actorType: 'AGENT', actorId: parentId, action: 'TASK_DELEGATE',
      resourceType: 'task', resourceId: task.id,
      details: { delegatedTo: childId }, orgId,
    });
    return task;
  }

  // --- Config Revisions ---

  async getConfigRevisions(agentId: string, orgId: string) {
    await this.findOne(agentId, orgId);
    return this.prisma.agentConfigRevision.findMany({
      where: { agentId },
      orderBy: { version: 'desc' },
      take: 50,
    });
  }

  async rollbackConfig(agentId: string, version: number, userId: string, orgId: string) {
    await this.findOne(agentId, orgId);

    const revision = await this.prisma.agentConfigRevision.findUnique({
      where: { agentId_version: { agentId, version } },
    });
    if (!revision) throw new NotFoundException(`Config revision v${version} not found`);

    const snapshot = revision.snapshot as Record<string, any>;
    const agent = await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        name: snapshot.name,
        systemPrompt: snapshot.systemPrompt,
        mission: snapshot.mission,
        llmProvider: snapshot.llmProvider,
        llmModel: snapshot.llmModel,
        llmConfig: snapshot.llmConfig ?? {},
        runtimeConfig: snapshot.runtimeConfig ?? {},
        values: snapshot.values ?? [],
        metadata: snapshot.metadata ?? {},
        version: { increment: 1 },
      },
      include: { owner: { select: { id: true, name: true, email: true } } },
    });

    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: userId, action: 'ROLLBACK',
      resourceType: 'agent', resourceId: agentId,
      details: { rolledBackToVersion: version }, orgId,
    });

    return agent;
  }

  // --- API Keys ---

  async createApiKey(agentId: string, input: { name: string; expiresAt?: string }, userId: string, orgId: string) {
    await this.findOne(agentId, orgId);

    const rawKey = crypto.randomBytes(32).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 8);

    const apiKey = await this.prisma.agentApiKey.create({
      data: {
        agentId,
        name: input.name,
        keyHash,
        keyPrefix,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });

    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: userId, action: 'CREATE',
      resourceType: 'agent_api_key', resourceId: apiKey.id, orgId,
    });

    return {
      id: apiKey.id,
      agentId: apiKey.agentId,
      name: apiKey.name,
      key: rawKey,
      keyPrefix: apiKey.keyPrefix,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    };
  }

  async getApiKeys(agentId: string, orgId: string) {
    await this.findOne(agentId, orgId);
    return this.prisma.agentApiKey.findMany({
      where: { agentId },
      select: {
        id: true,
        agentId: true,
        name: true,
        keyPrefix: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeApiKey(agentId: string, keyId: string, userId: string, orgId: string) {
    await this.findOne(agentId, orgId);

    const apiKey = await this.prisma.agentApiKey.findFirst({
      where: { id: keyId, agentId },
    });
    if (!apiKey) throw new NotFoundException('API key not found');
    if (apiKey.revokedAt) throw new BadRequestException('API key is already revoked');

    const revoked = await this.prisma.agentApiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
      select: {
        id: true,
        agentId: true,
        name: true,
        keyPrefix: true,
        revokedAt: true,
      },
    });

    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: userId, action: 'REVOKE',
      resourceType: 'agent_api_key', resourceId: keyId, orgId,
    });

    return revoked;
  }
}
