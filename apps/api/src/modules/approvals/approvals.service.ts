import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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

  // ── Policy Management ──

  async getPolicy(agentId: string) {
    return this.prisma.approvalPolicy.findUnique({ where: { agentId } });
  }

  async upsertPolicy(agentId: string, input: any) {
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

  async applyPreset(agentId: string, preset: string) {
    return this.upsertPolicy(agentId, {
      preset,
      readMode: null,
      writeMode: null,
      deleteMode: null,
      executeMode: null,
      sendMode: null,
      adminMode: null,
      toolOverrides: null,
    });
  }

  // ── Mode Resolution ──

  /**
   * Resolve the effective approval mode for a tool.
   * Priority: agentTool override → policy tool override → policy category → preset → FREE
   */
  resolveMode(
    policy: any | null,
    toolName: string,
    category: string,
    agentToolApprovalMode?: string,
  ): string {
    // 1. Per-tool assignment override (AgentTool.approvalMode)
    if (agentToolApprovalMode && agentToolApprovalMode !== 'FREE') {
      return agentToolApprovalMode;
    }

    if (!policy) return 'FREE';

    // 2. Policy per-tool override
    const toolOverrides = (policy.toolOverrides as Record<string, string>) ?? {};
    if (toolOverrides[toolName]) return toolOverrides[toolName];

    // 3. Policy per-category override
    const categoryModeKey = `${category.toLowerCase()}Mode` as string;
    const categoryMode = (policy as any)[categoryModeKey];
    if (categoryMode) return categoryMode;

    // 4. Preset default
    const presetMap = APPROVAL_PRESETS[policy.preset];
    if (presetMap && presetMap[category]) return presetMap[category];

    // 5. Fallback
    return 'FREE';
  }

  /**
   * Resolve mode using tool name only (fetches category internally).
   */
  resolveModeForTool(policy: any | null, toolName: string, agentToolMode?: string): string {
    const category = categorizeToolName(toolName);
    return this.resolveMode(policy, toolName, category, agentToolMode);
  }

  // ── Request Management ──

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
      include: { agent: { select: { id: true, name: true, avatar: true } } },
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

  async resolveRequest(
    requestId: string,
    status: 'APPROVED' | 'REJECTED',
    resolvedByType: string,
    resolvedById: string,
    rejectionReason?: string,
  ) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId },
      include: { agent: { select: { id: true, name: true } } },
    });

    if (!request) throw new NotFoundException('Approval request not found');
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
      include: { agent: { select: { id: true, name: true } } },
    });

    // Audit log
    this.events.emit('audit.create', {
      actorType: resolvedByType,
      actorId: resolvedById,
      action: status === 'APPROVED' ? 'APPROVE' : 'REJECT',
      resourceType: 'approval_request',
      resourceId: requestId,
      details: { toolName: request.toolName, agentId: request.agentId },
    });

    // Emit event for WebSocket broadcast
    this.events.emit('approval.resolved', { request: updated, status });

    if (status === 'APPROVED') {
      await this.handleApproved(request);
    } else {
      await this.handleRejected(request, rejectionReason);
    }

    return updated;
  }

  private async handleApproved(request: any) {
    // Check if all pending approvals for this execution are resolved
    if (request.executionId) {
      const pendingCount = await this.prisma.approvalRequest.count({
        where: { executionId: request.executionId, status: 'PENDING' },
      });

      if (pendingCount === 0) {
        // All approvals resolved — trigger re-execution
        const resumeMessage = `Your previous request to use "${request.toolName}" has been approved. Please proceed with the approved action. Parameters: ${JSON.stringify(request.toolInput)}`;

        // Collect all approved tool names for this execution
        const approvedRequests = await this.prisma.approvalRequest.findMany({
          where: { executionId: request.executionId, status: 'APPROVED' },
          select: { toolName: true },
        });
        const approvedTools = [...new Set(approvedRequests.map(r => r.toolName))];

        // Emit event for RuntimeService to handle the resume
        this.events.emit('approval.resume', {
          agentId: request.agentId,
          executionId: request.executionId,
          channelId: request.channelId,
          taskId: request.taskId,
          resumeMessage,
          approvedTools,
        });

        // Mark original execution as completed
        await this.prisma.agentExecution.update({
          where: { id: request.executionId },
          data: { status: 'COMPLETED', endedAt: new Date() },
        });
      }
    }

    // Handle Telegram access approval
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

    // Send approval notification to channel
    if (request.channelId) {
      await this.comms.sendMessage(
        request.channelId,
        { content: `Approved: ${request.description}`, contentType: 'TEXT' },
        'SYSTEM',
        'system',
      );
    }

    // Resume task after approval
    if (request.taskId) {
      await this.prisma.task.updateMany({
        where: { id: request.taskId, status: { in: ['PENDING', 'BLOCKED'] } },
        data: { status: 'IN_PROGRESS' },
      });
    }
  }

  private async handleRejected(request: any, reason?: string) {
    // Handle Telegram access rejection
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

    // Notify channel
    if (request.channelId) {
      const msg = `Rejected: ${request.description}${reason ? `. Reason: ${reason}` : ''}`;
      await this.comms.sendMessage(
        request.channelId,
        { content: msg, contentType: 'TEXT' },
        'SYSTEM',
        'system',
      );
    }

    // Mark execution as failed
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

    // If approval rejected, block the task
    if (request.taskId) {
      await this.prisma.task.updateMany({
        where: { id: request.taskId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        data: { status: 'BLOCKED' },
      });
    }
  }

  // ── Send Approval Card to Chat ──

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

    // Store message ID for later updates
    await this.prisma.approvalRequest.update({
      where: { id: request.id },
      data: { messageId: message.id },
    });

    return message;
  }

  // ── Queries ──

  async findAll(filters: any) {
    const where: any = {};
    if (filters.orgId) where.agent = { orgId: filters.orgId };
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
        include: { agent: { select: { id: true, name: true, avatar: true } } },
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

  async findOne(id: string) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id },
      include: { agent: { select: { id: true, name: true, avatar: true } } },
    });
    if (!request) throw new NotFoundException('Approval request not found');
    return request;
  }

  async getPendingCount() {
    return this.prisma.approvalRequest.count({ where: { status: 'PENDING' } });
  }

  async getPendingForApprover(approverType: string, approverId: string) {
    return this.prisma.approvalRequest.findMany({
      where: { status: 'PENDING', requestedFromType: approverType as any, requestedFromId: approverId },
      include: { agent: { select: { id: true, name: true, avatar: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async bulkResolve(ids: string[], status: 'APPROVED' | 'REJECTED', resolvedByType: string, resolvedById: string, reason?: string) {
    let count = 0;
    for (const id of ids) {
      try {
        await this.resolveRequest(id, status, resolvedByType, resolvedById, reason);
        count++;
      } catch (e) {
        this.logger.warn(`Failed to ${status.toLowerCase()} request ${id}: ${e}`);
      }
    }
    return count;
  }
}
