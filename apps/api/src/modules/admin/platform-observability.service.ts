import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { RedisLockService } from '../../common/redis-lock.service';

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'critical';
  uptime: number;
  timestamp: Date;
  checks: {
    database: HealthCheck;
    redis: HealthCheck;
    agents: AgentHealth;
    executions: ExecutionHealth;
    storage: StorageHealth;
  };
}

export interface HealthCheck {
  status: 'up' | 'down' | 'slow';
  latencyMs?: number;
  error?: string;
}

export interface AgentHealth {
  total: number;
  active: number;
  paused: number;
  error: number;
  failedExecutions: number;
  pendingApprovals: number;
}

export interface ExecutionHealth {
  running: number;
  queued: number;
  stuck: number;
  completedLast24h: number;
  failedLast24h: number;
  avgDurationMs: number;
}

export interface StorageHealth {
  usedMb: number;
  availableMb: number;
  percentUsed: number;
  uploadsCount: number;
}

export interface StuckExecution {
  id: string;
  agentId: string;
  agentName: string;
  orgId: string;
  startedAt: Date;
  durationMs: number;
}

@Injectable()
export class PlatformObservabilityService {
  private readonly logger = new Logger(PlatformObservabilityService.name);
  private readonly startTime = Date.now();

  constructor(
    private prisma: PrismaService,
    private redis: RedisLockService,
  ) {}

  async getSystemHealth(): Promise<SystemHealth> {
    const [dbCheck, redisCheck, agentHealth, execHealth, storageHealth] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.getAgentHealth(),
      this.getExecutionHealth(),
      this.getStorageHealth(),
    ]);

    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';

    if (dbCheck.status === 'down' || redisCheck.status === 'down') {
      status = 'critical';
    } else if (
      dbCheck.status === 'slow' ||
      redisCheck.status === 'slow' ||
      execHealth.stuck > 10 ||
      agentHealth.error > 5
    ) {
      status = 'degraded';
    }

    return {
      status,
      uptime: Date.now() - this.startTime,
      timestamp: new Date(),
      checks: {
        database: dbCheck,
        redis: redisCheck,
        agents: agentHealth,
        executions: execHealth,
        storage: storageHealth,
      },
    };
  }

  private async checkDatabase(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const latencyMs = Date.now() - start;
      return latencyMs > 500 ? { status: 'slow', latencyMs } : { status: 'up', latencyMs };
    } catch (err) {
      return { status: 'down', error: err instanceof Error ? err.message : 'Database connection failed' };
    }
  }

  private async checkRedis(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      const client = this.redis.getClient();
      await client.ping();
      const latencyMs = Date.now() - start;
      return latencyMs > 100 ? { status: 'slow', latencyMs } : { status: 'up', latencyMs };
    } catch (err) {
      return { status: 'down', error: err instanceof Error ? err.message : 'Redis connection failed' };
    }
  }

  private async getAgentHealth(): Promise<AgentHealth> {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [agents, byStatus, failedExecs, pendingApprovals] = await Promise.all([
      this.prisma.agent.count(),
      this.prisma.agent.groupBy({ by: ['status'], _count: true }),
      this.prisma.agentExecution.count({
        where: { status: 'FAILED', startedAt: { gte: dayAgo } },
      }),
      this.prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
    ]);

    const statusCounts = new Map(byStatus.map((s) => [s.status, s._count]));

    return {
      total: agents,
      active: statusCounts.get('ACTIVE') ?? 0,
      paused: statusCounts.get('PAUSED') ?? 0,
      error: statusCounts.get('ERROR') ?? 0,
      failedExecutions: failedExecs,
      pendingApprovals,
    };
  }

  private async getExecutionHealth(): Promise<ExecutionHealth> {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const stuckThreshold = 30 * 60 * 1000;

    const [running, completed, failed, stuck, recent] = await Promise.all([
      this.prisma.agentExecution.count({ where: { status: 'RUNNING' } }),
      this.prisma.agentExecution.count({
        where: { status: 'COMPLETED', startedAt: { gte: dayAgo } },
      }),
      this.prisma.agentExecution.count({
        where: { status: 'FAILED', startedAt: { gte: dayAgo } },
      }),
      this.prisma.agentExecution.count({
        where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - stuckThreshold) } },
      }),
      this.prisma.agentExecution.findMany({
        where: { startedAt: { gte: hourAgo }, status: 'COMPLETED' },
        select: { startedAt: true, endedAt: true },
      }),
    ]);

    const avgDurationMs =
      recent.length > 0
        ? recent.reduce((sum, e) => {
            const duration = e.endedAt ? e.endedAt.getTime() - e.startedAt.getTime() : 0;
            return sum + duration;
          }, 0) / recent.length
        : 0;

    return { running, queued: 0, stuck, completedLast24h: completed, failedLast24h: failed, avgDurationMs };
  }

  private async getStorageHealth(): Promise<StorageHealth> {
    const uploadsCount = await this.prisma.fileRecord.count();
    return { usedMb: uploadsCount * 0.1, availableMb: 10000, percentUsed: 0.1, uploadsCount };
  }

  async getStuckExecutions(thresholdMinutes = 30): Promise<StuckExecution[]> {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    const executions = await this.prisma.agentExecution.findMany({
      where: { status: 'RUNNING', startedAt: { lt: threshold } },
      include: { agent: { select: { id: true, name: true, orgId: true } } },
      take: 50,
    });

    return executions.map((e) => ({
      id: e.id,
      agentId: e.agentId,
      agentName: e.agent.name,
      orgId: e.agent.orgId,
      startedAt: e.startedAt,
      durationMs: Date.now() - e.startedAt.getTime(),
    }));
  }

  async cancelStuckExecution(executionId: string): Promise<void> {
    await this.prisma.agentExecution.update({
      where: { id: executionId },
      data: { status: 'CANCELLED', endedAt: new Date() },
    });
    this.logger.warn(`Cancelled stuck execution: ${executionId}`);
  }

  async getQueueStats(): Promise<{ name: string; waiting: number; active: number; completed: number; failed: number; delayed: number }[]> {
    const client = this.redis.getClient();
    const queues: { name: string; waiting: number; active: number; completed: number; failed: number; delayed: number }[] = [];
    const queueNames = ['default', 'tasks', 'approvals', 'notifications'];

    for (const name of queueNames) {
      try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          client.llen(`bull:${name}:waiting`),
          client.llen(`bull:${name}:active`),
          client.get(`bull:${name}:completed`),
          client.get(`bull:${name}:failed`),
          client.llen(`bull:${name}:delayed`),
        ]);

        queues.push({
          name,
          waiting: waiting ?? 0,
          active: active ?? 0,
          completed: parseInt(completed ?? '0', 10),
          failed: parseInt(failed ?? '0', 10),
          delayed: delayed ?? 0,
        });
      } catch {
        queues.push({ name, waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
      }
    }

    return queues;
  }

  async getPlatformMetrics(days = 7): Promise<{
    period: { start: Date; end: Date };
    agents: { created: number; active: number; failed: number };
    executions: { total: number; avgDuration: number; successRate: number };
    revenue: { total: number; mrr: number };
    users: { new: number; total: number };
  }> {
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const end = new Date();

    const [
      agentsCreated, agentsActive, agentsFailed,
      executionsTotal, executionsCompleted,
      revenueTotal, usersNew, usersTotal,
    ] = await Promise.all([
      this.prisma.agent.count({ where: { createdAt: { gte: start } } }),
      this.prisma.agent.count({ where: { status: 'ACTIVE' } }),
      this.prisma.agentExecution.count({ where: { status: 'FAILED', startedAt: { gte: start } } }),
      this.prisma.agentExecution.count({ where: { startedAt: { gte: start } } }),
      this.prisma.agentExecution.count({ where: { status: 'COMPLETED', startedAt: { gte: start } } }),
      this.prisma.payment.aggregate({ where: { status: 'COMPLETED', createdAt: { gte: start } }, _sum: { amount: true } }),
      this.prisma.user.count({ where: { createdAt: { gte: start } } }),
      this.prisma.user.count(),
    ]);

    return {
      period: { start, end },
      agents: { created: agentsCreated, active: agentsActive, failed: agentsFailed },
      executions: {
        total: executionsTotal,
        avgDuration: 0,
        successRate: executionsTotal > 0 ? (executionsCompleted / executionsTotal) * 100 : 0,
      },
      revenue: {
        total: (revenueTotal._sum.amount ?? 0) / 100,
        mrr: ((revenueTotal._sum.amount ?? 0) / 100 / days) * 30,
      },
      users: { new: usersNew, total: usersTotal },
    };
  }
}
