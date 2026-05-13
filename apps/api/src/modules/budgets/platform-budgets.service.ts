import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';

export type BudgetWindow = 'HOURLY' | 'DAILY' | 'MONTHLY';

export interface PlatformBudgetCheckResult {
  blocked: boolean;
  reason?: string;
  window?: BudgetWindow;
  spendUsd?: number;
  limitUsd?: number;
  percent?: number;
}

/**
 * PlatformBudgetsService — org-wide budget limits with higher priority than agent limits.
 *
 * Semantics:
 *  - One PlatformBudget row per org (unique org_id).
 *  - Three independent windows: hourly, daily, monthly. Each nullable — NULL means no platform cap.
 *  - Hourly/daily spend is computed on-the-fly from agent_executions (source of truth).
 *  - Monthly spend is tracked in current_spend_usd and incremented via recordSpend().
 *  - If hard_stop_triggered=true OR any active window's spend ≥ its limit, the platform blocks
 *    ALL agent executions in the org (checked before agent-level limits in runtime.service.ts).
 */
@Injectable()
export class PlatformBudgetsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  /** Get the platform budget for an org (null if none configured) */
  async findByOrg(orgId: string) {
    return this.prisma.platformBudget.findUnique({
      where: { orgId },
      include: {
        incidents: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
  }

  /** Compute current spend for all three windows (hourly + daily from executions, monthly from counter) */
  async getSpendBreakdown(orgId: string) {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 3600_000);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const pb = await this.prisma.platformBudget.findUnique({ where: { orgId } });

    const [hourly, daily] = await Promise.all([
      this.prisma.agentExecution.aggregate({
        where: { agent: { orgId }, startedAt: { gte: hourAgo } },
        _sum: { costUsd: true },
      }),
      this.prisma.agentExecution.aggregate({
        where: { agent: { orgId }, startedAt: { gte: todayStart } },
        _sum: { costUsd: true },
      }),
    ]);

    const hourlySpend = hourly._sum.costUsd ?? 0;
    const dailySpend = daily._sum.costUsd ?? 0;
    const monthlySpend = pb?.currentSpendUsd ?? 0;

    return {
      hourly: { spend: hourlySpend, limit: pb?.hourlyLimitUsd ?? null },
      daily: { spend: dailySpend, limit: pb?.dailyLimitUsd ?? null },
      monthly: {
        spend: monthlySpend,
        limit: pb?.monthlyLimitUsd ?? null,
        periodStart: pb?.periodStart ?? null,
        periodEnd: pb?.periodEnd ?? null,
      },
      hardStopTriggered: pb?.hardStopTriggered ?? false,
      softAlertPercent: pb?.softAlertPercent ?? 80,
    };
  }

  /**
   * Pre-execution platform gate. Called BEFORE the agent-level check.
   * Returns { blocked: true, reason } if any active platform window is exceeded.
   */
  async checkLimit(orgId: string): Promise<PlatformBudgetCheckResult> {
    const pb = await this.prisma.platformBudget.findUnique({ where: { orgId } });
    if (!pb) return { blocked: false };

    // Hard stop flag overrides everything until manually cleared/reset
    if (pb.hardStopTriggered) {
      return {
        blocked: true,
        reason: 'Platform hard stop is active. Raise limits or reset the platform budget.',
        window: 'MONTHLY',
        spendUsd: pb.currentSpendUsd,
        limitUsd: pb.monthlyLimitUsd ?? 0,
      };
    }

    const breakdown = await this.getSpendBreakdown(orgId);
    const windows: Array<{ name: BudgetWindow; spend: number; limit: number | null }> = [
      { name: 'HOURLY',  spend: breakdown.hourly.spend,  limit: breakdown.hourly.limit },
      { name: 'DAILY',   spend: breakdown.daily.spend,   limit: breakdown.daily.limit },
      { name: 'MONTHLY', spend: breakdown.monthly.spend, limit: breakdown.monthly.limit },
    ];

    for (const w of windows) {
      if (w.limit !== null && w.limit > 0 && w.spend >= w.limit) {
        return {
          blocked: true,
          reason: `Platform ${w.name.toLowerCase()} budget reached ($${w.spend.toFixed(2)} / $${w.limit.toFixed(2)}).`,
          window: w.name,
          spendUsd: w.spend,
          limitUsd: w.limit,
          percent: (w.spend / w.limit) * 100,
        };
      }
    }

    return { blocked: false };
  }

  /** Create or update the platform budget for an org (upsert — one row per org) */
  async upsert(
    orgId: string,
    input: {
      hourlyLimitUsd?: number | null;
      dailyLimitUsd?: number | null;
      monthlyLimitUsd?: number | null;
      softAlertPercent?: number;
      hardStopEnabled?: boolean;
      periodStart?: string;
      periodEnd?: string;
      metadata?: any;
    },
    userId: string,
  ) {
    const now = new Date();
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const existing = await this.prisma.platformBudget.findUnique({ where: { orgId } });

    const data = {
      ...(input.hourlyLimitUsd !== undefined && { hourlyLimitUsd: input.hourlyLimitUsd }),
      ...(input.dailyLimitUsd !== undefined && { dailyLimitUsd: input.dailyLimitUsd }),
      ...(input.monthlyLimitUsd !== undefined && { monthlyLimitUsd: input.monthlyLimitUsd }),
      ...(input.softAlertPercent !== undefined && { softAlertPercent: input.softAlertPercent }),
      ...(input.hardStopEnabled !== undefined && { hardStopEnabled: input.hardStopEnabled }),
      ...(input.metadata !== undefined && { metadata: input.metadata as any }),
      ...(input.periodStart && { periodStart: new Date(input.periodStart) }),
      ...(input.periodEnd && { periodEnd: new Date(input.periodEnd) }),
    };

    let budget;
    if (existing) {
      // If any monthly limit raised above current spend, clear hard stop
      const newMonthly = input.monthlyLimitUsd ?? existing.monthlyLimitUsd;
      const clearStop =
        existing.hardStopTriggered &&
        newMonthly !== null &&
        newMonthly !== undefined &&
        newMonthly > existing.currentSpendUsd;

      budget = await this.prisma.platformBudget.update({
        where: { orgId },
        data: {
          ...data,
          ...(clearStop && { hardStopTriggered: false, alertSent: false }),
        },
      });

      if (clearStop) {
        await this.prisma.platformBudgetIncident.create({
          data: {
            platformBudgetId: budget.id,
            type: 'MANUAL_OVERRIDE',
            scope: 'MONTHLY',
            message: `Monthly limit raised to $${newMonthly}; hard stop cleared`,
            spendUsd: existing.currentSpendUsd,
            limitUsd: newMonthly,
          },
        });
      }
    } else {
      budget = await this.prisma.platformBudget.create({
        data: {
          orgId,
          hourlyLimitUsd: input.hourlyLimitUsd ?? null,
          dailyLimitUsd: input.dailyLimitUsd ?? null,
          monthlyLimitUsd: input.monthlyLimitUsd ?? null,
          softAlertPercent: input.softAlertPercent ?? 80,
          hardStopEnabled: input.hardStopEnabled ?? true,
          periodStart: input.periodStart ? new Date(input.periodStart) : defaultStart,
          periodEnd: input.periodEnd ? new Date(input.periodEnd) : defaultEnd,
          metadata: input.metadata ?? null,
          currentSpendUsd: 0,
        },
      });
    }

    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: userId, action: existing ? 'UPDATE' : 'CREATE',
      resourceType: 'platform_budget', resourceId: budget.id, orgId,
    });

    return budget;
  }

  /**
   * Increment monthly spend counter and check all three windows for soft-alert / hard-stop.
   * Called after every agent execution.
   *
   * Reliability: monthly counter increment uses an atomic SQL `UPDATE … SET col = col + $n`
   * so concurrent recordSpend() calls do not lose updates. Hourly/daily spend is recomputed
   * fresh from agent_executions to catch overshoots from parallel executions that all passed
   * the gate just before any of them reported cost.
   */
  async recordSpend(orgId: string, amount: number, description?: string) {
    if (amount <= 0) return null;
    const pb = await this.prisma.platformBudget.findUnique({ where: { orgId } });
    if (!pb) return null; // No platform budget configured — nothing to track

    // Atomic increment of monthly counter — `UPDATE col = col + $n` is safe under concurrency.
    await this.prisma.$executeRaw`UPDATE platform_budgets SET current_spend_usd = current_spend_usd + ${amount}, updated_at = NOW() WHERE id = ${pb.id}`;
    const afterMonthly = (await this.prisma.platformBudget.findUnique({ where: { id: pb.id } }))!;

    // Soft alert on monthly
    const monthlyLimit = afterMonthly.monthlyLimitUsd;
    const monthlyPct = monthlyLimit && monthlyLimit > 0 ? (afterMonthly.currentSpendUsd / monthlyLimit) * 100 : 0;
    if (monthlyLimit && monthlyPct >= afterMonthly.softAlertPercent && !afterMonthly.alertSent) {
      await this.prisma.platformBudget.update({ where: { id: pb.id }, data: { alertSent: true } });
      await this.prisma.platformBudgetIncident.create({
        data: {
          platformBudgetId: pb.id,
          type: 'SOFT_ALERT',
          scope: 'MONTHLY',
          message: description
            ? `Platform monthly soft alert at ${monthlyPct.toFixed(1)}%: ${description}`
            : `Platform monthly spend reached ${monthlyPct.toFixed(1)}% of $${monthlyLimit} limit`,
          spendUsd: afterMonthly.currentSpendUsd,
          limitUsd: monthlyLimit,
        },
      });
      this.events.emit('platform-budget.soft-alert', {
        orgId, scope: 'MONTHLY', spendUsd: afterMonthly.currentSpendUsd, limitUsd: monthlyLimit, percent: monthlyPct,
      });
    }

    // Re-check all three windows for hard-stop (covers race-condition overshoot from parallel
    // executions where every one passed checkLimit before the first recordSpend landed).
    if (afterMonthly.hardStopEnabled && !afterMonthly.hardStopTriggered) {
      const breakdown = await this.getSpendBreakdown(orgId);
      const windows: Array<{ scope: BudgetWindow; spend: number; limit: number | null }> = [
        { scope: 'HOURLY',  spend: breakdown.hourly.spend,  limit: breakdown.hourly.limit },
        { scope: 'DAILY',   spend: breakdown.daily.spend,   limit: breakdown.daily.limit },
        { scope: 'MONTHLY', spend: breakdown.monthly.spend, limit: breakdown.monthly.limit },
      ];
      for (const w of windows) {
        if (w.limit !== null && w.limit > 0 && w.spend >= w.limit) {
          await this.prisma.platformBudget.update({
            where: { id: pb.id },
            data: { hardStopTriggered: true },
          });
          await this.prisma.platformBudgetIncident.create({
            data: {
              platformBudgetId: pb.id,
              type: 'HARD_STOP',
              scope: w.scope,
              message: description
                ? `Platform ${w.scope.toLowerCase()} hard stop: ${description}`
                : `Platform ${w.scope.toLowerCase()} spend ($${w.spend.toFixed(2)}) exceeded limit ($${w.limit.toFixed(2)}) — all agents paused`,
              spendUsd: w.spend,
              limitUsd: w.limit,
            },
          });
          this.events.emit('platform-budget.hard-stop', {
            orgId, scope: w.scope, spendUsd: w.spend, limitUsd: w.limit,
          });
          break; // One hard stop is enough; further windows would just be duplicate incidents
        }
      }
    }

    return afterMonthly;
  }

  /** Manual monthly reset (clears counter, alerts, hard stop) */
  async reset(orgId: string, input: { periodStart?: string; periodEnd?: string }, userId: string) {
    const pb = await this.prisma.platformBudget.findUnique({ where: { orgId } });
    if (!pb) throw new NotFoundException('Platform budget not configured');

    await this.prisma.platformBudgetIncident.create({
      data: {
        platformBudgetId: pb.id,
        type: 'BUDGET_RESET',
        scope: 'MONTHLY',
        message: `Platform budget reset. Previous spend: $${pb.currentSpendUsd} / $${pb.monthlyLimitUsd ?? 'unlimited'}`,
        spendUsd: pb.currentSpendUsd,
        limitUsd: pb.monthlyLimitUsd ?? 0,
      },
    });

    const now = new Date();
    const updated = await this.prisma.platformBudget.update({
      where: { orgId },
      data: {
        currentSpendUsd: 0,
        alertSent: false,
        hardStopTriggered: false,
        periodStart: input.periodStart ? new Date(input.periodStart)
          : new Date(now.getFullYear(), now.getMonth(), 1),
        periodEnd: input.periodEnd ? new Date(input.periodEnd)
          : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
      },
    });

    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: userId, action: 'UPDATE',
      resourceType: 'platform_budget', resourceId: updated.id, orgId,
      details: { action: 'PLATFORM_BUDGET_RESET' },
    });

    return updated;
  }

  /** Incident history */
  async getIncidents(orgId: string, filters: { page?: string; pageSize?: string }) {
    const pb = await this.prisma.platformBudget.findUnique({ where: { orgId } });
    if (!pb) return { data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 20;

    const [data, total] = await Promise.all([
      this.prisma.platformBudgetIncident.findMany({
        where: { platformBudgetId: pb.id },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.platformBudgetIncident.count({ where: { platformBudgetId: pb.id } }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }
}
