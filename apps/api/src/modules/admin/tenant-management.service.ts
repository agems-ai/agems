import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import type { Prisma } from '@agems/db';

export type OrganizationPlan = 'FREE' | 'STARTER' | 'PRO' | 'BUSINESS' | 'ENTERPRISE';
export type OrgStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED';

export interface OrganizationDetails {
  id: string;
  name: string;
  slug: string;
  plan: OrganizationPlan;
  status: OrgStatus;
  createdAt: Date;
  metadata?: Record<string, unknown>;
  owner: { id: string; name: string; email: string };
  stats: {
    members: number;
    agents: number;
    channels: number;
    tasks: number;
    totalSpent: number;
  };
  subscription?: {
    status: string;
    currentPeriodEnd?: Date;
  };
  integrations: {
    hasStripe: boolean;
    hasTelegram: boolean;
    hasN8n: boolean;
    hasApiKeys: boolean;
  };
}

export interface TenantUsage {
  orgId: string;
  periodStart: Date;
  periodEnd: Date;
  agentExecutions: number;
  activeAgents: number;
  messagesSent: number;
  tasksCreated: number;
  memberCount: number;
}

@Injectable()
export class TenantManagementService {
  private readonly logger = new Logger(TenantManagementService.name);

  constructor(private prisma: PrismaService) {}

  async getOrganization(id: string): Promise<OrganizationDetails> {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true } } }, where: { role: 'ADMIN' }, take: 1 },
        _count: {
          select: { members: true, agents: true, channels: true, tasks: true },
        },
      },
    });

    if (!org) throw new NotFoundException('Organization not found');

    const [totalSpent, subscription, integrations] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { orgId: id, status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.subscription.findFirst({ where: { orgId: id } }),
      this.getOrgIntegrations(id),
    ]);

    const metadata = org.metadata as Record<string, unknown> | null;
    const ownerMember = org.members[0];

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan as OrganizationPlan,
      status: (metadata?.status as OrgStatus) ?? 'ACTIVE',
      createdAt: org.createdAt,
      metadata: metadata ?? undefined,
      owner: ownerMember?.user ?? { id: '', name: 'Unknown', email: '' },
      stats: {
        members: org._count.members,
        agents: org._count.agents,
        channels: org._count.channels,
        tasks: org._count.tasks,
        totalSpent: (totalSpent._sum.amount ?? 0) / 100,
      },
      subscription: subscription
        ? { status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd ?? undefined }
        : undefined,
      integrations,
    };
  }

  async listOrganizations(options: {
    page?: number;
    pageSize?: number;
    plan?: OrganizationPlan;
    status?: OrgStatus;
    search?: string;
    sortBy?: 'createdAt' | 'name' | 'plan';
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ data: OrganizationDetails[]; total: number }> {
    const {
      page = 1, pageSize = 20, plan, status, search,
      sortBy = 'createdAt', sortOrder = 'desc',
    } = options;

    const where: Prisma.OrganizationWhereInput = {};
    if (plan) where.plan = plan;
    if (status) where.metadata = { path: ['status'], equals: status };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [orgs, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true } } }, where: { role: 'ADMIN' }, take: 1 },
          _count: { select: { members: true, agents: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.organization.count({ where }),
    ]);

    const data = orgs.map((org) => {
      const metadata = org.metadata as Record<string, unknown> | null;
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        plan: org.plan as OrganizationPlan,
        status: (metadata?.status as OrgStatus) ?? 'ACTIVE',
        createdAt: org.createdAt,
        owner: org.members[0]?.user ?? { id: '', name: 'Unknown', email: '' },
        stats: { members: org._count.members, agents: org._count.agents, channels: 0, tasks: 0, totalSpent: 0 },
        integrations: { hasStripe: false, hasTelegram: false, hasN8n: false, hasApiKeys: false },
      } as OrganizationDetails;
    });

    return { data, total };
  }

  async suspendOrganization(id: string, reason: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');

    await this.prisma.organization.update({
      where: { id },
      data: {
        metadata: {
          ...(org.metadata as object ?? {}),
          status: 'SUSPENDED',
          suspendedReason: reason,
          suspendedAt: new Date().toISOString(),
        },
      },
    });
    this.logger.log(`Organization ${id} suspended: ${reason}`);
  }

  async banOrganization(id: string, reason: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');

    await this.prisma.organization.update({
      where: { id },
      data: {
        metadata: {
          ...(org.metadata as object ?? {}),
          status: 'BANNED',
          bannedReason: reason,
          bannedAt: new Date().toISOString(),
        },
      },
    });
    this.logger.warn(`Organization ${id} banned: ${reason}`);
  }

  async unbanOrganization(id: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');

    await this.prisma.organization.update({
      where: { id },
      data: {
        metadata: {
          ...(org.metadata as Record<string, unknown> ?? {}),
          status: 'ACTIVE',
          unbannedAt: new Date().toISOString(),
        },
      },
    });
    this.logger.log(`Organization ${id} unbanned`);
  }

  async changePlan(id: string, newPlan: OrganizationPlan, reason: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id },
      data: { plan: newPlan },
    });
    this.logger.log(`Organization ${id} plan changed to ${newPlan}: ${reason}`);
  }

  async deleteOrganization(id: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id },
      data: {
        metadata: { status: 'DELETED', deletedAt: new Date().toISOString() },
      },
    });
    this.logger.warn(`Organization ${id} marked for deletion`);
  }

  async getUsageStats(orgId: string, days = 30): Promise<TenantUsage> {
    const periodEnd = new Date();
    const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [executions, agents, messages, tasks, members] = await Promise.all([
      this.prisma.agentExecution.count({
        where: { agent: { orgId }, startedAt: { gte: periodStart } },
      }),
      this.prisma.agent.count({ where: { orgId, status: 'ACTIVE' } }),
      this.prisma.message.count({
        where: { channel: { orgId }, createdAt: { gte: periodStart } },
      }),
      this.prisma.task.count({
        where: { orgId, createdAt: { gte: periodStart } },
      }),
      this.prisma.orgMember.count({ where: { orgId } }),
    ]);

    return {
      orgId,
      periodStart,
      periodEnd,
      agentExecutions: executions,
      activeAgents: agents,
      messagesSent: messages,
      tasksCreated: tasks,
      memberCount: members,
    };
  }

  private async getOrgIntegrations(orgId: string): Promise<{
    hasStripe: boolean;
    hasTelegram: boolean;
    hasN8n: boolean;
    hasApiKeys: boolean;
  }> {
    const [stripe, telegram, n8n, apiKeys] = await Promise.all([
      this.prisma.payment.findFirst({ where: { orgId } }),
      this.prisma.telegramChat.findFirst({ where: { agent: { orgId } } }),
      this.prisma.setting.findFirst({ where: { orgId, key: { contains: 'n8n' } } }),
      this.prisma.agentApiKey.findFirst({ where: { agent: { orgId } } }),
    ]);

    return {
      hasStripe: !!stripe,
      hasTelegram: !!telegram,
      hasN8n: !!n8n,
      hasApiKeys: !!apiKeys,
    };
  }
}
