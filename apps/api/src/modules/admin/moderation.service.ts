import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

export interface ModerationEntry {
  id: string;
  type: 'rate_limit' | 'block' | 'flag' | 'suspicious';
  targetType: 'org' | 'user' | 'ip';
  targetId: string;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  createdAt: Date;
}

export interface SuspiciousActivity {
  type: string;
  orgId?: string;
  userId?: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  severity: 'low' | 'medium' | 'high';
}

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(private prisma: PrismaService) {}

  async blockOrg(orgId: string, reason: string, severity: 'high' | 'critical' = 'high'): Promise<void> {
    await this.prisma.setting.upsert({
      where: { orgId_key: { orgId: '', key: `blocked:org:${orgId}` } },
      create: {
        key: `blocked:org:${orgId}`,
        value: JSON.stringify({ reason, severity, blockedAt: new Date().toISOString() }),
      },
      update: {
        value: JSON.stringify({ reason, severity, blockedAt: new Date().toISOString() }),
      },
    });

    this.logger.warn(`Organization blocked: ${orgId} - ${reason}`);
  }

  async unblockOrg(orgId: string): Promise<void> {
    await this.prisma.setting.deleteMany({
      where: { key: `blocked:org:${orgId}` },
    });
    this.logger.log(`Organization unblocked: ${orgId}`);
  }

  async isOrgBlocked(orgId: string): Promise<boolean> {
    const block = await this.prisma.setting.findFirst({
      where: { key: `blocked:org:${orgId}` },
    });
    return !!block;
  }

  async blockUser(userId: string, reason: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { orgId_key: { orgId: '', key: `blocked:user:${userId}` } },
      create: {
        key: `blocked:user:${userId}`,
        value: JSON.stringify({ reason, blockedAt: new Date().toISOString() }),
      },
      update: {
        value: JSON.stringify({ reason, blockedAt: new Date().toISOString() }),
      },
    });

    this.logger.warn(`User blocked: ${userId} - ${reason}`);
  }

  async unblockUser(userId: string): Promise<void> {
    await this.prisma.setting.deleteMany({
      where: { key: `blocked:user:${userId}` },
    });
    this.logger.log(`User unblocked: ${userId}`);
  }

  async isUserBlocked(userId: string): Promise<boolean> {
    const block = await this.prisma.setting.findFirst({
      where: { key: `blocked:user:${userId}` },
    });
    return !!block;
  }

  async setRateLimit(
    targetType: 'org' | 'user',
    targetId: string,
    limits: {
      requestsPerMinute?: number;
      requestsPerHour?: number;
      requestsPerDay?: number;
      agentExecutionsPerHour?: number;
    },
    durationMinutes?: number,
  ): Promise<void> {
    await this.prisma.setting.upsert({
      where: { orgId_key: { orgId: '', key: `ratelimit:${targetType}:${targetId}` } },
      create: {
        key: `ratelimit:${targetType}:${targetId}`,
        value: JSON.stringify({
          ...limits,
          createdAt: new Date().toISOString(),
          expiresAt: durationMinutes ? new Date(Date.now() + durationMinutes * 60 * 1000).toISOString() : null,
        }),
      },
      update: {
        value: JSON.stringify({
          ...limits,
          createdAt: new Date().toISOString(),
          expiresAt: durationMinutes ? new Date(Date.now() + durationMinutes * 60 * 1000).toISOString() : null,
        }),
      },
    });

    this.logger.log(`Rate limit set for ${targetType}:${targetId}`);
  }

  async getRateLimit(targetType: string, targetId: string): Promise<Record<string, unknown> | null> {
    const setting = await this.prisma.setting.findFirst({
      where: { key: `ratelimit:${targetType}:${targetId}` },
    });

    if (!setting) return null;
    return JSON.parse(setting.value as string);
  }

  async detectSuspiciousActivity(orgId?: string, hours = 24): Promise<SuspiciousActivity[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const activities: SuspiciousActivity[] = [];

    const [rapidExecs, manyFailures, manyRegistrations] = await Promise.all([
      this.prisma.agentExecution.groupBy({
        by: ['agentId'],
        where: { startedAt: { gte: since }, status: 'RUNNING' },
        _count: true,
      }),
      this.prisma.agentExecution.groupBy({
        by: ['agentId'],
        where: { startedAt: { gte: since }, status: 'FAILED' },
        _count: true,
      }),
      this.prisma.user.groupBy({
        by: ['email'],
        where: { createdAt: { gte: since } },
        _count: true,
      }),
    ]);

    for (const exec of rapidExecs) {
      if (exec._count > 100) {
        activities.push({
          type: 'rapid_executions',
          orgId,
          count: exec._count,
          firstSeen: since,
          lastSeen: new Date(),
          severity: exec._count > 500 ? 'high' : 'medium',
        });
      }
    }

    for (const fail of manyFailures) {
      if (fail._count > 20) {
        activities.push({
          type: 'many_failures',
          orgId,
          count: fail._count,
          firstSeen: since,
          lastSeen: new Date(),
          severity: fail._count > 50 ? 'high' : 'medium',
        });
      }
    }

    for (const reg of manyRegistrations) {
      if (reg._count > 5) {
        activities.push({
          type: 'bulk_registration',
          count: reg._count,
          firstSeen: since,
          lastSeen: new Date(),
          severity: reg._count > 20 ? 'high' : 'medium',
        });
      }
    }

    return activities;
  }

  async getModerationLog(): Promise<ModerationEntry[]> {
    const settings = await this.prisma.setting.findMany({
      where: {
        OR: [
          { key: { startsWith: 'blocked:' } },
          { key: { startsWith: 'ratelimit:' } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    return settings.map((s) => {
      const parts = s.key.split(':');
      const value = JSON.parse(s.value as string);

      return {
        id: s.id,
        type: parts[0] === 'blocked' ? 'block' : 'rate_limit',
        targetType: parts[1] as 'org' | 'user',
        targetId: parts[2],
        reason: value.reason ?? 'N/A',
        severity: value.severity ?? 'medium',
        createdAt: s.createdAt,
      } as ModerationEntry;
    });
  }

  async getBlockedOrgs(): Promise<{ id: string; reason: string; blockedAt: Date }[]> {
    const settings = await this.prisma.setting.findMany({
      where: { key: { startsWith: 'blocked:org:' } },
    });

    return settings.map((s) => {
      const value = JSON.parse(s.value as string);
      return {
        id: s.key.replace('blocked:org:', ''),
        reason: value.reason,
        blockedAt: new Date(value.blockedAt),
      };
    });
  }

  async getBlockedUsers(): Promise<{ id: string; reason: string; blockedAt: Date }[]> {
    const settings = await this.prisma.setting.findMany({
      where: { key: { startsWith: 'blocked:user:' } },
    });

    return settings.map((s) => {
      const value = JSON.parse(s.value as string);
      return {
        id: s.key.replace('blocked:user:', ''),
        reason: value.reason,
        blockedAt: new Date(value.blockedAt),
      };
    });
  }
}
