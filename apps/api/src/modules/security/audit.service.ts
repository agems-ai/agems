import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';

interface AuditEvent {
  actorType: 'AGENT' | 'HUMAN' | 'SYSTEM';
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  orgId?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  @OnEvent('audit.create')
  async handleAuditEvent(event: AuditEvent) {
    await this.prisma.auditLog.create({
      data: {
        actorType: event.actorType,
        actorId: event.actorId,
        action: event.action as any,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        details: event.details as any,
        ipAddress: event.ipAddress,
        ...(event.orgId && { orgId: event.orgId }),
      },
    });
  }

  async findAll(filters: {
    actorId?: string;
    actorType?: string;
    action?: string;
    resourceType?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }, orgId?: string) {
    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 50;
    const where: any = {
      ...(filters.actorId && { actorId: filters.actorId }),
      ...(filters.actorType && { actorType: filters.actorType }),
      ...(filters.action && { action: filters.action }),
      ...(filters.resourceType && { resourceType: filters.resourceType }),
      ...(orgId && { orgId }),
      ...((filters.from || filters.to) && {
        createdAt: {
          ...(filters.from && { gte: new Date(filters.from) }),
          ...(filters.to && { lte: new Date(filters.to) }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  // ── Access Rules ──

  async createAccessRule(input: any, orgId?: string) {
    return this.prisma.accessRule.create({
      data: {
        agentId: input.agentId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        permissionLevel: input.permissionLevel as any,
        grantedByType: input.grantedByType as any,
        grantedById: input.grantedById,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        ...(orgId && { orgId }),
      },
    });
  }

  async findAllAccessRules(agentId?: string, orgId?: string) {
    return this.prisma.accessRule.findMany({
      where: { ...(agentId && { agentId }), ...(orgId && { orgId }) },
      include: { agent: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteAccessRule(id: string) {
    return this.prisma.accessRule.delete({ where: { id } });
  }
}
