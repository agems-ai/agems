import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class GoalsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async create(input: any, userId: string, orgId: string) {
    const goal = await this.prisma.goal.create({
      data: {
        title: input.title,
        description: input.description || null,
        status: input.status ?? 'PLANNED',
        priority: input.priority ?? 'MEDIUM',
        parentId: input.parentId || null,
        ownerType: input.ownerType ?? 'HUMAN',
        ownerId: input.ownerId || userId,
        agentId: input.agentId || null,
        projectId: input.projectId || null,
        progress: input.progress ?? 0,
        targetDate: input.targetDate ? new Date(input.targetDate) : null,
        metadata: input.metadata ?? null,
        orgId,
      },
    });

    this.events.emit('goal.created', goal);
    return goal;
  }

  async findAll(filters: any, orgId: string) {
    const { status, priority, parentId, projectId, ownerType, ownerId } = filters;
    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 20;
    const where = {
      orgId,
      ...(status && { status }),
      ...(priority && { priority }),
      ...(parentId !== undefined && { parentId: parentId || null }),
      ...(projectId && { projectId }),
      ...(ownerType && { ownerType }),
      ...(ownerId && { ownerId }),
    };

    const [data, total] = await Promise.all([
      this.prisma.goal.findMany({
        where,
        include: {
          children: { select: { id: true, title: true, status: true, progress: true } },
          tasks: { select: { id: true, title: true, status: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.goal.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOne(id: string, orgId: string) {
    const goal = await this.prisma.goal.findUnique({
      where: { id },
      include: {
        children: true,
        parent: { select: { id: true, title: true } },
        tasks: { orderBy: { createdAt: 'asc' } },
        agent: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });
    if (!goal) throw new NotFoundException('Goal not found');
    if (goal.orgId !== orgId) throw new ForbiddenException('Goal belongs to another organization');
    return goal;
  }

  async update(id: string, input: any, orgId: string) {
    await this.findOne(id, orgId);
    const goal = await this.prisma.goal.update({
      where: { id },
      data: {
        ...(input.title && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.status && { status: input.status }),
        ...(input.priority && { priority: input.priority }),
        ...(input.parentId !== undefined && { parentId: input.parentId || null }),
        ...(input.ownerType && { ownerType: input.ownerType }),
        ...(input.ownerId && { ownerId: input.ownerId }),
        ...(input.agentId !== undefined && { agentId: input.agentId || null }),
        ...(input.projectId !== undefined && { projectId: input.projectId || null }),
        ...(input.progress !== undefined && { progress: input.progress }),
        ...(input.targetDate !== undefined && { targetDate: input.targetDate ? new Date(input.targetDate) : null }),
        ...(input.metadata !== undefined && { metadata: input.metadata as any }),
        ...(input.status === 'ACHIEVED' && { achievedAt: new Date() }),
      },
    });

    this.events.emit('goal.updated', goal);
    return goal;
  }

  async delete(id: string, orgId: string) {
    await this.findOne(id, orgId);
    await this.prisma.goal.delete({ where: { id } });
    this.events.emit('goal.deleted', { id, orgId });
    return { success: true };
  }

  async getTree(orgId: string) {
    const goals = await this.prisma.goal.findMany({
      where: { orgId },
      include: {
        tasks: { select: { id: true, title: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return this.buildTree(goals);
  }

  private buildTree(goals: any[]) {
    const map = new Map<string, any>();
    const roots: any[] = [];

    for (const goal of goals) {
      map.set(goal.id, { ...goal, children: [] });
    }

    for (const goal of goals) {
      const node = map.get(goal.id);
      if (goal.parentId && map.has(goal.parentId)) {
        map.get(goal.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}
