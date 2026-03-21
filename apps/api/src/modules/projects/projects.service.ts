import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async create(input: any, userId: string, orgId: string) {
    const project = await this.prisma.project.create({
      data: {
        name: input.name,
        description: input.description,
        status: input.status ?? 'PLANNED',
        priority: input.priority ?? 'MEDIUM',
        leadType: input.leadType,
        leadId: input.leadId,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
        progress: input.progress ?? 0,
        metadata: input.metadata as any,
        orgId,
      },
    });

    this.events.emit('project.created', project);
    return project;
  }

  async findAll(filters: any, orgId: string) {
    const { status, priority, leadType, leadId } = filters;
    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 20;
    const where = {
      orgId,
      ...(status && { status }),
      ...(priority && { priority }),
      ...(leadType && { leadType }),
      ...(leadId && { leadId }),
    };

    const [data, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.project.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOne(id: string, orgId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        tasks: { select: { id: true } },
        goals: { select: { id: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.orgId !== orgId) throw new ForbiddenException('Project belongs to another organization');

    const { tasks, goals, ...rest } = project;
    return { ...rest, tasksCount: tasks.length, goalsCount: goals.length };
  }

  async update(id: string, input: any, orgId: string) {
    await this.findOne(id, orgId);
    const project = await this.prisma.project.update({
      where: { id },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.status && { status: input.status }),
        ...(input.priority && { priority: input.priority }),
        ...(input.leadType && { leadType: input.leadType }),
        ...(input.leadId && { leadId: input.leadId }),
        ...(input.startDate !== undefined && { startDate: input.startDate ? new Date(input.startDate) : null }),
        ...(input.targetDate !== undefined && { targetDate: input.targetDate ? new Date(input.targetDate) : null }),
        ...(input.progress !== undefined && { progress: input.progress }),
        ...(input.metadata !== undefined && { metadata: input.metadata as any }),
        ...(input.status === 'COMPLETED' && { completedAt: new Date() }),
      },
    });

    this.events.emit('project.updated', project);
    return project;
  }

  async remove(id: string, orgId: string) {
    await this.findOne(id, orgId);
    await this.prisma.project.delete({ where: { id } });
    this.events.emit('project.deleted', { id, orgId });
    return { success: true };
  }

  async getStats(id: string, orgId: string) {
    await this.findOne(id, orgId);

    const [tasksByStatus, goalsByStatus] = await Promise.all([
      this.prisma.task.groupBy({
        by: ['status'],
        where: { projectId: id },
        _count: { id: true },
      }),
      this.prisma.goal.groupBy({
        by: ['status'],
        where: { projectId: id },
        _count: { id: true },
      }),
    ]);

    return {
      tasks: tasksByStatus.reduce(
        (acc, item) => ({ ...acc, [item.status]: item._count.id }),
        {} as Record<string, number>,
      ),
      goals: goalsByStatus.reduce(
        (acc, item) => ({ ...acc, [item.status]: item._count.id }),
        {} as Record<string, number>,
      ),
    };
  }
}
