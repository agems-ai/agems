import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import type { CreateAgentInput, UpdateAgentInput, AgentFilters } from '@agems/shared';

@Injectable()
export class AgentsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async create(input: CreateAgentInput, ownerId: string, orgId: string) {
    const agent = await this.prisma.agent.create({
      data: {
        orgId,
        name: input.name,
        slug: input.slug,
        avatar: input.avatar,
        type: input.type ?? 'AUTONOMOUS',
        llmProvider: input.llmProvider,
        llmModel: input.llmModel,
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

  async findAll(filters: AgentFilters, orgId?: string) {
    const { status, type, llmProvider, search } = filters;
    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 100;
    const where = {
      ...(orgId && { orgId }),
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

  async update(id: string, input: UpdateAgentInput, userId: string, orgId?: string) {
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

  async activate(id: string, userId: string, orgId?: string) {
    await this.findOne(id, orgId);
    const agent = await this.prisma.agent.update({ where: { id }, data: { status: 'ACTIVE' } });
    this.events.emit('agent.status-changed', { id, status: 'ACTIVE' });
    return agent;
  }

  async pause(id: string, userId: string, orgId?: string) {
    await this.findOne(id, orgId);
    const agent = await this.prisma.agent.update({ where: { id }, data: { status: 'PAUSED' } });
    this.events.emit('agent.status-changed', { id, status: 'PAUSED' });
    return agent;
  }

  async archive(id: string, userId: string, orgId?: string) {
    await this.findOne(id, orgId);
    const agent = await this.prisma.agent.update({ where: { id }, data: { status: 'ARCHIVED' } });
    this.events.emit('agent.status-changed', { id, status: 'ARCHIVED' });
    return agent;
  }

  async getMetrics(id: string) {
    return this.prisma.agentMetric.findMany({ where: { agentId: id }, orderBy: { periodEnd: 'desc' }, take: 100 });
  }

  async getMemory(id: string) {
    return this.prisma.agentMemory.findMany({ where: { agentId: id }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async createMemory(agentId: string, input: { content: string; type?: string; metadata?: any }) {
    return this.prisma.agentMemory.create({
      data: { agentId, type: (input.type as any) ?? 'KNOWLEDGE', content: input.content, metadata: input.metadata },
    });
  }

  async updateMemory(memoryId: string, input: { content?: string; type?: string; metadata?: any }) {
    return this.prisma.agentMemory.update({
      where: { id: memoryId },
      data: {
        ...(input.content !== undefined && { content: input.content }),
        ...(input.type && { type: input.type as any }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
      },
    });
  }

  async deleteMemory(memoryId: string) {
    return this.prisma.agentMemory.delete({ where: { id: memoryId } });
  }

  async getExecutions(id: string, limit = 20) {
    return this.prisma.agentExecution.findMany({ where: { agentId: id }, orderBy: { startedAt: 'desc' }, take: limit });
  }

  async spawn(parentId: string, input: any, ownerId: string, orgId?: string) {
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

  async getHierarchy(id: string, orgId?: string) {
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

  async delegate(parentId: string, childId: string, taskInput: any, userId: string, orgId?: string) {
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
}
