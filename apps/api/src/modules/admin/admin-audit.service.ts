import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export type AdminActionType =
  | 'ORG_CREATE'
  | 'ORG_UPDATE'
  | 'ORG_DELETE'
  | 'ORG_BAN'
  | 'ORG_UNBAN'
  | 'ORG_PLAN_CHANGE'
  | 'USER_PASSWORD_RESET'
  | 'USER_SUSPEND'
  | 'USER_UNSUSPEND'
  | 'USER_DELETE'
  | 'AGENT_DISABLE'
  | 'SYSTEM_CONFIG_CHANGE'
  | 'FEATURE_FLAG_CHANGE'
  | 'SUBSCRIPTION_OVERRIDE'
  | 'IMPERSONATION_START'
  | 'IMPERSONATION_END'
  | 'DATA_EXPORT'
  | 'MANUAL_REFUND'
  | 'RATE_LIMIT_OVERRIDE';

export interface AdminAuditEntry {
  id: string;
  adminId: string;
  adminEmail: string;
  action: AdminActionType;
  targetType: 'org' | 'user' | 'agent' | 'system';
  targetId?: string;
  details: Record<string, unknown>;
  reason?: string;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

export interface AuditFilters {
  adminId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  startDate?: Date;
  endDate?: Date;
}

@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async logAction(input: {
    adminId: string;
    adminEmail?: string;
    action: string;
    targetType: string;
    targetId?: string;
    details?: Record<string, unknown>;
    reason?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<AdminAuditEntry> {
    const entry = await this.prisma.auditLog.create({
      data: {
        actorType: 'SYSTEM' as any,
        actorId: input.adminId,
        action: input.action as any,
        resourceType: input.targetType,
        resourceId: input.targetId || '',
        details: {
          ...(input.details ?? {}),
          reason: input.reason,
          ip: input.ip,
          userAgent: input.userAgent,
          adminEmail: input.adminEmail,
        } as any,
      },
    });

    this.logger.log(`Admin action: ${input.adminEmail ?? input.adminId} -> ${input.action} on ${input.targetType}:${input.targetId ?? 'N/A'}`);

    return {
      id: entry.id,
      adminId: entry.actorId,
      adminEmail: input.adminEmail ?? '',
      action: entry.action as AdminActionType,
      targetType: entry.resourceType as 'org' | 'user' | 'agent' | 'system',
      targetId: entry.resourceId ?? undefined,
      details: input.details ?? {},
      reason: input.reason,
      ip: input.ip,
      userAgent: input.userAgent,
      createdAt: entry.createdAt,
    };
  }

  async getAuditLog(filters: AuditFilters, page = 1, pageSize = 50): Promise<{
    data: AdminAuditEntry[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where: Record<string, unknown> = {};

    if (filters.adminId) where.actorId = filters.adminId;
    if (filters.action) where.action = filters.action;
    if (filters.targetType) where.resourceType = filters.targetType;
    if (filters.targetId) where.resourceId = filters.targetId;
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) (where.createdAt as Record<string, Date>).gte = filters.startDate;
      if (filters.endDate) (where.createdAt as Record<string, Date>).lte = filters.endDate;
    }

    const [entries, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: entries.map((e) => ({
        id: e.id,
        adminId: e.actorId,
        adminEmail: (e.details as any)?.adminEmail ?? 'unknown',
        action: e.action as unknown as AdminActionType,
        targetType: e.resourceType as 'org' | 'user' | 'agent' | 'system',
        targetId: e.resourceId ?? undefined,
        details: e.details as Record<string, unknown>,
        reason: (e.details as any)?.reason,
        ip: (e.details as any)?.ip,
        userAgent: (e.details as any)?.userAgent,
        createdAt: e.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getActionsByTarget(targetType: string, targetId: string): Promise<AdminAuditEntry[]> {
    const entries = await this.prisma.auditLog.findMany({
      where: { resourceType: targetType, resourceId: targetId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return entries.map((e) => ({
      id: e.id,
      adminId: e.actorId,
      adminEmail: (e.details as any)?.adminEmail ?? 'unknown',
      action: e.action as unknown as AdminActionType,
      targetType: e.resourceType as 'org' | 'user' | 'agent' | 'system',
      targetId: e.resourceId ?? undefined,
      details: e.details as Record<string, unknown>,
      reason: (e.details as any)?.reason,
      ip: (e.details as any)?.ip,
      userAgent: (e.details as any)?.userAgent,
      createdAt: e.createdAt,
    }));
  }

  async getAdminStats(adminId: string, days = 30): Promise<{
    totalActions: number;
    actionsByType: Record<string, number>;
    recentActions: number;
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const entries = await this.prisma.auditLog.findMany({
      where: { actorId: adminId, createdAt: { gte: since } },
    });

    const actionsByType: Record<string, number> = {};
    for (const e of entries) {
      actionsByType[e.action] = (actionsByType[e.action] || 0) + 1;
    }

    return {
      totalActions: entries.length,
      actionsByType,
      recentActions: entries.filter((e) => Date.now() - e.createdAt.getTime() < 24 * 60 * 60 * 1000).length,
    };
  }
}
