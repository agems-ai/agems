import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import type { CreateTaskInput, UpdateTaskInput, TaskFilters } from '@agems/shared';
import type { ActorType } from '@agems/shared';

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async create(input: CreateTaskInput, creatorType: ActorType, creatorId: string, orgId: string) {
    const task = await this.prisma.task.create({
      data: {
        title: input.title,
        description: input.description,
        priority: input.priority ?? 'MEDIUM',
        type: input.type ?? 'ONE_TIME',
        cronExpression: input.cronExpression,
        creatorType,
        creatorId,
        assigneeType: input.assigneeType,
        assigneeId: input.assigneeId,
        parentTaskId: input.parentTaskId,
        projectId: (input as any).projectId || null,
        goalId: (input as any).goalId || null,
        progress: (input as any).progress ?? 0,
        deadline: input.deadline ? new Date(input.deadline) : undefined,
        metadata: input.metadata as any,
        orgId,
      },
    });

    this.events.emit('task.created', task);
    return task;
  }

  async findAll(filters: TaskFilters, orgId?: string) {
    const { status, priority, assigneeType, assigneeId } = filters;
    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 20;
    const where = {
      ...(status && { status }),
      ...(priority && { priority }),
      ...(assigneeType && { assigneeType }),
      ...(assigneeId && { assigneeId }),
      ...(orgId && { orgId }),
    };

    const [data, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: {
          subtasks: { select: { id: true, title: true, status: true } },
          project: { select: { id: true, name: true } },
          goal: { select: { id: true, title: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.task.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOne(id: string, orgId?: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        subtasks: true,
        parentTask: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } },
        goal: { select: { id: true, title: true } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (orgId && task.orgId !== orgId) throw new ForbiddenException('Task belongs to another organization');
    return task;
  }

  async addComment(taskId: string, authorType: string, authorId: string, content: string, metadata?: any, orgId?: string) {
    await this.findOne(taskId, orgId);
    const comment = await this.prisma.taskComment.create({
      data: {
        taskId,
        authorType: authorType as any,
        authorId,
        content,
        metadata: metadata || undefined,
      },
    });
    this.events.emit('task.comment', { taskId, comment });
    return comment;
  }

  async getComments(taskId: string) {
    return this.prisma.taskComment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(id: string, input: UpdateTaskInput, orgId?: string) {
    await this.findOne(id, orgId);
    const task = await this.prisma.task.update({
      where: { id },
      data: {
        ...(input.title && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.status && { status: input.status }),
        ...(input.priority && { priority: input.priority }),
        ...(input.assigneeType && { assigneeType: input.assigneeType }),
        ...(input.assigneeId && { assigneeId: input.assigneeId }),
        ...(input.type && { type: input.type }),
        ...(input.cronExpression !== undefined && { cronExpression: input.cronExpression || null }),
        ...((input as any).projectId !== undefined && { projectId: (input as any).projectId || null }),
        ...((input as any).goalId !== undefined && { goalId: (input as any).goalId || null }),
        ...((input as any).progress !== undefined && { progress: (input as any).progress }),
        ...(input.deadline && { deadline: new Date(input.deadline) }),
        ...(input.result && { result: input.result as any }),
        ...(input.status === 'COMPLETED' && { completedAt: new Date(), progress: 100 }),
      },
    });

    this.events.emit('task.updated', task);
    return task;
  }

  async deleteTask(id: string, orgId: string) {
    await this.findOne(id, orgId);
    // Delete related records first
    await this.prisma.taskComment.deleteMany({ where: { taskId: id } });
    await this.prisma.taskLabel.deleteMany({ where: { taskId: id } });
    await this.prisma.taskAttachment.deleteMany({ where: { taskId: id } });
    await this.prisma.taskWorkProduct.deleteMany({ where: { taskId: id } });
    await this.prisma.taskReadState.deleteMany({ where: { taskId: id } }).catch(() => {});
    // Delete subtasks
    await this.prisma.task.deleteMany({ where: { parentTaskId: id } });
    // Delete the task itself
    return this.prisma.task.delete({ where: { id } });
  }

  async assign(id: string, assigneeType: string, assigneeId: string, userId: string) {
    const task = await this.findOne(id);
    const updated = await this.prisma.task.update({
      where: { id },
      data: { assigneeType: assigneeType as any, assigneeId },
    });

    this.events.emit('audit.create', {
      actorType: 'HUMAN',
      actorId: userId,
      action: 'TASK_ASSIGN',
      resourceType: 'task',
      resourceId: id,
      details: { assigneeType, assigneeId },
    });

    return updated;
  }

  async decompose(id: string, userId: string, orgId: string) {
    const task = await this.findOne(id, orgId);
    // Generate subtask suggestions based on task title/description
    const subtaskTitles = this.generateSubtasks(task.title, task.description);

    const subtasks = await Promise.all(
      subtaskTitles.map((title, i) =>
        this.prisma.task.create({
          data: {
            title,
            priority: task.priority as any,
            creatorType: 'SYSTEM',
            creatorId: 'system',
            assigneeType: task.assigneeType as any,
            assigneeId: task.assigneeId,
            parentTaskId: id,
            orgId,
          },
        }),
      ),
    );

    this.events.emit('audit.create', {
      actorType: 'HUMAN',
      actorId: userId,
      action: 'TASK_DECOMPOSE',
      resourceType: 'task',
      resourceId: id,
      details: { subtaskCount: subtasks.length },
    });

    return subtasks;
  }

  private generateSubtasks(title: string, description?: string | null): string[] {
    // Simple heuristic decomposition. In production, use LLM.
    const prefix = title.length > 40 ? title.slice(0, 40) + '...' : title;
    return [
      `Research & plan: ${prefix}`,
      `Implement: ${prefix}`,
      `Test & validate: ${prefix}`,
      `Review & finalize: ${prefix}`,
    ];
  }

  // ── Labels ──────────────────────────────────────────────────────────

  async createLabel(name: string, color: string, orgId: string) {
    return this.prisma.label.create({
      data: { name, color, orgId },
    });
  }

  async listLabels(orgId: string) {
    return this.prisma.label.findMany({
      where: { orgId },
      orderBy: { name: 'asc' },
    });
  }

  async deleteLabel(labelId: string, orgId: string) {
    const label = await this.prisma.label.findUnique({ where: { id: labelId } });
    if (!label) throw new NotFoundException('Label not found');
    if (label.orgId !== orgId) throw new ForbiddenException('Label belongs to another organization');
    await this.prisma.taskLabel.deleteMany({ where: { labelId } });
    return this.prisma.label.delete({ where: { id: labelId } });
  }

  async addLabelToTask(taskId: string, labelId: string, orgId: string) {
    await this.findOne(taskId, orgId);
    return this.prisma.taskLabel.create({
      data: { taskId, labelId },
    });
  }

  async removeLabelFromTask(taskId: string, labelId: string, orgId: string) {
    await this.findOne(taskId, orgId);
    return this.prisma.taskLabel.delete({
      where: { taskId_labelId: { taskId, labelId } },
    });
  }

  // ── Attachments ─────────────────────────────────────────────────────

  async addAttachment(
    taskId: string,
    input: { filename: string; originalName: string; mimetype: string; size: number; url: string },
    uploadedBy: string,
    uploaderId: string,
    orgId: string,
  ) {
    await this.findOne(taskId, orgId);
    return this.prisma.taskAttachment.create({
      data: {
        taskId,
        filename: input.filename,
        originalName: input.originalName,
        mimetype: input.mimetype,
        size: input.size,
        url: input.url,
        uploadedBy: uploadedBy as any,
        uploaderId,
      },
    });
  }

  async listAttachments(taskId: string, orgId: string) {
    await this.findOne(taskId, orgId);
    return this.prisma.taskAttachment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async removeAttachment(taskId: string, attachmentId: string, orgId: string) {
    await this.findOne(taskId, orgId);
    const attachment = await this.prisma.taskAttachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) throw new NotFoundException('Attachment not found');
    if (attachment.taskId !== taskId) throw new ForbiddenException('Attachment does not belong to this task');
    return this.prisma.taskAttachment.delete({ where: { id: attachmentId } });
  }

  // ── Work Products ──────────────────────────────────────────────────

  async createWorkProduct(
    taskId: string,
    input: { title: string; description?: string; type: string; content?: string; metadata?: any },
    createdBy: string,
    createdById: string,
    orgId: string,
  ) {
    await this.findOne(taskId, orgId);
    return this.prisma.taskWorkProduct.create({
      data: {
        taskId,
        title: input.title,
        description: input.description,
        type: input.type as any,
        content: input.content,
        metadata: input.metadata as any,
        createdBy: createdBy as any,
        createdById,
      },
    });
  }

  async listWorkProducts(taskId: string, orgId: string) {
    await this.findOne(taskId, orgId);
    return this.prisma.taskWorkProduct.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async removeWorkProduct(taskId: string, productId: string, orgId: string) {
    await this.findOne(taskId, orgId);
    const product = await this.prisma.taskWorkProduct.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Work product not found');
    if (product.taskId !== taskId) throw new ForbiddenException('Work product does not belong to this task');
    return this.prisma.taskWorkProduct.delete({ where: { id: productId } });
  }

  // ── Read States (Inbox) ─────────────────────────────────────────────

  async markAsRead(taskId: string, userId: string, orgId: string) {
    await this.findOne(taskId, orgId);
    return this.prisma.taskReadState.upsert({
      where: { taskId_userId: { taskId, userId } },
      create: { taskId, userId, readAt: new Date() },
      update: { readAt: new Date() },
    });
  }

  async markAsUnread(taskId: string, userId: string, orgId: string) {
    await this.findOne(taskId, orgId);
    return this.prisma.taskReadState.delete({
      where: { taskId_userId: { taskId, userId } },
    }).catch(() => {
      // Already unread, no-op
      return { taskId, userId, deleted: true };
    });
  }

  async getUnreadTasks(userId: string, orgId: string) {
    const tasks = await this.prisma.task.findMany({
      where: {
        orgId,
        OR: [
          { assigneeId: userId },
          { creatorId: userId },
        ],
        readStates: {
          none: { userId },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return tasks;
  }
}
