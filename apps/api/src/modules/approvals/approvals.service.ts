import { Injectable, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import { CommsService } from '../comms/comms.service';
import { APPROVAL_PRESETS } from './approval-presets';
import { categorizeToolName, describeToolCall, assessRiskLevel } from './tool-categories';

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
    private comms: CommsService,
  ) {}

  private async getAgentInOrg(agentId: string, orgId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, orgId },
      select: { id: true, orgId: true, name: true },
    });
    if (!agent) throw new ForbiddenException('Agent not found in this organization');
    return agent;
  }

  private async getApprovalInOrg(requestId: string, orgId: string) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId },
      include: {
        agent: { select: { id: true, name: true, avatar: true, orgId: true } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.agent.orgId !== orgId) throw new ForbiddenException('Approval request not found in this organization');
    return request;
  }

  async getPolicy(agentId: string, orgId: string) {
    await this.getAgentInOrg(agentId, orgId);
    return this.prisma.approvalPolicy.findUnique({ where: { agentId } });
  }

  async upsertPolicy(agentId: string, input: any, orgId: string) {
    await this.getAgentInOrg(agentId, orgId);

    const data = {
      preset: input.preset,
      readMode: input.readMode ?? null,
      writeMode: input.writeMode ?? null,
      deleteMode: input.deleteMode ?? null,
      executeMode: input.executeMode ?? null,
      sendMode: input.sendMode ?? null,
      adminMode: input.adminMode ?? null,
      toolOverrides: input.toolOverrides ?? undefined,
      approverType: input.approverType ?? null,
      approverId: input.approverId ?? null,
      autoApproveAfterMin: input.autoApproveAfterMin ?? null,
      autoApproveLowRisk: input.autoApproveLowRisk ?? false,
      costThresholdUsd: input.costThresholdUsd ?? null,
    };

    return this.prisma.approvalPolicy.upsert({
      where: { agentId },
      create: { agentId, ...data },
      update: data,
    });
  }

  async applyPreset(agentId: string, preset: string, orgId: string) {
    return this.upsertPolicy(agentId, {
      preset,
      readMode: null,
      writeMode: null,
      deleteMode: null,
      executeMode: null,
      sendMode: null,
      adminMode: null,
      toolOverrides: null,
    }, orgId);
  }

  resolveMode(
    policy: any | null,
    toolName: string,
    category: string,
    agentToolApprovalMode?: string,
  ): string {
    if (agentToolApprovalMode && agentToolApprovalMode !== 'FREE') {
      return agentToolApprovalMode;
    }

    if (!policy) return 'FREE';

    const toolOverrides = (policy.toolOverrides as Record<string, string>) ?? {};
    if (toolOverrides[toolName]) return toolOverrides[toolName];

    const categoryModeKey = `${category.toLowerCase()}Mode` as string;
    const categoryMode = (policy as any)[categoryModeKey];
    if (categoryMode) return categoryMode;

    const presetMap = APPROVAL_PRESETS[policy.preset];
    if (presetMap && presetMap[category]) return presetMap[category];

    return 'FREE';
  }

  resolveModeForTool(policy: any | null, toolName: string, agentToolMode?: string): string {
    const category = categorizeToolName(toolName);
    return this.resolveMode(policy, toolName, category, agentToolMode);
  }

  async createRequest(input: {
    agentId: string;
    executionId?: string;
    toolName: string;
    toolInput: any;
    channelId?: string;
    taskId?: string;
    requestedFromType?: string;
    requestedFromId?: string;
    category?: string;
    riskLevel?: string;
    description?: string;
  }) {
    const category = input.category || categorizeToolName(input.toolName);
    const riskLevel = input.riskLevel || assessRiskLevel(input.toolName, category, input.toolInput);
    const description = input.description || describeToolCall(input.toolName, input.toolInput);

    const request = await this.prisma.approvalRequest.create({
      data: {
        agentId: input.agentId,
        executionId: input.executionId,
        toolName: input.toolName,
        toolInput: input.toolInput,
        category: category as any,
        riskLevel: riskLevel as any,
        description,
        channelId: input.channelId,
        taskId: input.taskId,
        requestedFromType: (input.requestedFromType as any) || null,
        requestedFromId: input.requestedFromId || null,
      },
      include: { agent: { select: { id: true, name: true, avatar: true, orgId: true } } },
    });

    this.events.emit('approval.requested', request);
    this.events.emit('audit.create', {
      actorType: 'AGENT',
      actorId: input.agentId,
      action: 'CREATE',
      resourceType: 'approval_request',
      resourceId: request.id,
      details: { toolName: input.toolName, category, riskLevel },
    });

    return request;
  }

  async findById(requestId: string) {
    return this.prisma.approvalRequest.findUnique({ where: { id: requestId } });
  }

  async resolveRequest(
    requestId: string,
    status: 'APPROVED' | 'REJECTED',
    resolvedByType: string,
    resolvedById: string,
    orgId: string,
    rejectionReason?: string,
  ) {
    const request = await this.getApprovalInOrg(requestId, orgId);
    if (request.status !== 'PENDING') {
      throw new Error(`Request already resolved: ${request.status}`);
    }

    const updated = await this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status,
        resolvedByType: resolvedByType as any,
        resolvedById,
        resolvedAt: new Date(),
        rejectionReason: rejectionReason || null,
      },
      include: { agent: { select: { id: true, name: true, orgId: true } } },
    });

    this.events.emit('audit.create', {
      actorType: resolvedByType,
      actorId: resolvedById,
      action: status === 'APPROVED' ? 'APPROVE' : 'REJECT',
      resourceType: 'approval_request',
      resourceId: requestId,
      details: { toolName: request.toolName, agentId: request.agentId },
    });

    this.events.emit('approval.resolved', { request: updated, status });

    if (status === 'APPROVED') {
      await this.handleApproved(request);
    } else {
      await this.handleRejected(request, rejectionReason);
    }

    return updated;
  }

  private async handleApproved(request: any) {
    if (request.executionId) {
      const pendingCount = await this.prisma.approvalRequest.count({
        where: { executionId: request.executionId, status: 'PENDING' },
      });

      if (pendingCount === 0) {
        const resumeMessage = `Your previous request to use "${request.toolName}" has been approved. Please proceed with the approved action. Parameters: ${JSON.stringify(request.toolInput)}`;

        const approvedRequests = await this.prisma.approvalRequest.findMany({
          where: { executionId: request.executionId, status: 'APPROVED' },
          select: { toolName: true },
        });
        const approvedTools = [...new Set(approvedRequests.map((r) => r.toolName))];

        this.events.emit('approval.resume', {
          agentId: request.agentId,
          executionId: request.executionId,
          channelId: request.channelId,
          taskId: request.taskId,
          resumeMessage,
          approvedTools,
        });

        await this.prisma.agentExecution.update({
          where: { id: request.executionId },
          data: { status: 'COMPLETED', endedAt: new Date() },
        });
      }
    }

    if (request.toolName === 'telegram_access') {
      const input = request.toolInput as any;
      if (input?.telegramDbChatId) {
        await this.prisma.telegramChat.update({
          where: { id: input.telegramDbChatId },
          data: { isApproved: true },
        });
        this.events.emit('telegram.chat.approved', {
          telegramDbChatId: input.telegramDbChatId,
          agentId: request.agentId,
          telegramChatId: Number(input.telegramChatId),
        });
      }
    }

    if (request.channelId) {
      await this.comms.sendMessage(
        request.channelId,
        { content: `Approved: ${request.description}`, contentType: 'TEXT' },
        'SYSTEM',
        'system',
      );
    }

    if (request.taskId) {
      await this.prisma.task.updateMany({
        where: { id: request.taskId, status: { in: ['PENDING', 'BLOCKED'] } },
        data: { status: 'IN_PROGRESS' },
      });
    }
  }

  private async handleRejected(request: any, reason?: string) {
    if (request.toolName === 'telegram_access') {
      const input = request.toolInput as any;
      if (input?.telegramDbChatId) {
        this.events.emit('telegram.chat.rejected', {
          telegramDbChatId: input.telegramDbChatId,
          agentId: request.agentId,
          telegramChatId: Number(input.telegramChatId),
        });
      }
    }

    if (request.channelId) {
      const msg = `Rejected: ${request.description}${reason ? `. Reason: ${reason}` : ''}`;
      await this.comms.sendMessage(
        request.channelId,
        { content: msg, contentType: 'TEXT' },
        'SYSTEM',
        'system',
      );
    }

    if (request.executionId) {
      await this.prisma.agentExecution.update({
        where: { id: request.executionId },
        data: {
          status: 'FAILED',
          error: `Approval rejected: ${reason || 'No reason given'}`,
          endedAt: new Date(),
        },
      });
    }

    if (request.taskId) {
      await this.prisma.task.updateMany({
        where: { id: request.taskId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        data: { status: 'BLOCKED' },
      });
    }
  }

  async sendApprovalMessage(request: any, channelId: string) {
    const agent = request.agent ?? await this.prisma.agent.findUnique({
      where: { id: request.agentId },
      select: { name: true, avatar: true },
    });

    const message = await this.comms.sendMessage(
      channelId,
      {
        content: JSON.stringify({
          type: 'APPROVAL_REQUEST',
          approvalId: request.id,
          agentName: agent?.name || 'Agent',
          agentAvatar: agent?.avatar,
          toolName: request.toolName,
          description: request.description,
          category: request.category,
          riskLevel: request.riskLevel,
          toolInput: request.toolInput,
          status: 'PENDING',
        }),
        contentType: 'ACTION',
        metadata: { actionType: 'APPROVAL_REQUEST', approvalId: request.id },
      },
      'SYSTEM',
      'system',
    );

    await this.prisma.approvalRequest.update({
      where: { id: request.id },
      data: { messageId: message.id },
    });

    return message;
  }

  async findAll(filters: any, orgId: string) {
    const where: any = { agent: { orgId } };
    if (filters.agentId) where.agentId = filters.agentId;
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.riskLevel) where.riskLevel = filters.riskLevel;
    if (filters.requestedFromType) where.requestedFromType = filters.requestedFromType;
    if (filters.requestedFromId) where.requestedFromId = filters.requestedFromId;

    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 20;

    const [data, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where,
        include: { agent: { select: { id: true, name: true, avatar: true, orgId: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string, orgId: string) {
    return this.getApprovalInOrg(id, orgId);
  }

  async getPendingCount(orgId: string) {
    return this.prisma.approvalRequest.count({ where: { status: 'PENDING', agent: { orgId } } });
  }

  async getPendingForApprover(approverType: string, approverId: string, orgId: string) {
    return this.prisma.approvalRequest.findMany({
      where: {
        status: 'PENDING',
        requestedFromType: approverType as any,
        requestedFromId: approverId,
        agent: { orgId },
      },
      include: { agent: { select: { id: true, name: true, avatar: true, orgId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async bulkResolve(ids: string[], status: 'APPROVED' | 'REJECTED', resolvedByType: string, resolvedById: string, orgId: string, reason?: string) {
    let count = 0;
    for (const id of ids) {
      try {
        await this.resolveRequest(id, status, resolvedByType, resolvedById, orgId, reason);
        count++;
      } catch (e) {
        this.logger.warn(`Failed to ${status.toLowerCase()} request ${id}: ${e}`);
      }
    }
    return count;
  }

  async addComment(requestId: string, authorType: string, authorId: string, content: string, orgId: string) {
    await this.getApprovalInOrg(requestId, orgId);

    const comment = await this.prisma.approvalComment.create({
      data: {
        requestId,
        authorType: authorType as any,
        authorId,
        content,
      },
    });

    this.events.emit('approval.commented', { requestId, comment });

    return comment;
  }

  async listComments(requestId: string, orgId: string) {
    await this.getApprovalInOrg(requestId, orgId);

    return this.prisma.approvalComment.findMany({
      where: { requestId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
