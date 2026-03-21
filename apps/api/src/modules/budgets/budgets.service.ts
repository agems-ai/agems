import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class BudgetsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async create(
    input: {
      agentId: string;
      monthlyLimitUsd: number;
      periodStart?: string;
      periodEnd?: string;
      softAlertPercent?: number;
      hardStopEnabled?: boolean;
      metadata?: any;
    },
    userId: string,
    orgId: string,
  ) {
    // Verify agent belongs to org
    const agent = await this.prisma.agent.findUnique({ where: { id: input.agentId } });
    if (!agent || agent.orgId !== orgId) throw new NotFoundException('Agent not found');

    // Default to current month if not provided
    const now = new Date();
    const periodStart = input.periodStart
      ? new Date(input.periodStart)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = input.periodEnd
      ? new Date(input.periodEnd)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const budget = await this.prisma.agentBudget.create({
      data: {
        agentId: input.agentId,
        monthlyLimitUsd: input.monthlyLimitUsd,
        currentSpendUsd: 0,
        periodStart,
        periodEnd,
        softAlertPercent: input.softAlertPercent ?? 80,
        hardStopEnabled: input.hardStopEnabled ?? true,
        metadata: input.metadata ?? null,
      },
      include: { agent: { select: { id: true, name: true, slug: true } } },
    });

    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: userId, action: 'CREATE',
      resourceType: 'budget', resourceId: budget.id, orgId,
    });

    return budget;
  }

  async findAll(filters: { agentId?: string; page?: string; pageSize?: string }, orgId: string) {
    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 20;

    const where = {
      agent: { orgId },
      ...(filters.agentId && { agentId: filters.agentId }),
    };

    const [data, total] = await Promise.all([
      this.prisma.agentBudget.findMany({
        where,
        include: {
          agent: { select: { id: true, name: true, slug: true, status: true } },
          _count: { select: { incidents: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.agentBudget.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOne(id: string, orgId: string) {
    const budget = await this.prisma.agentBudget.findUnique({
      where: { id },
      include: {
        agent: { select: { id: true, name: true, slug: true, status: true, orgId: true } },
        incidents: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!budget) throw new NotFoundException('Budget not found');
    if (budget.agent.orgId !== orgId) throw new NotFoundException('Budget not found');
    return budget;
  }

  async update(
    id: string,
    input: {
      monthlyLimitUsd?: number;
      softAlertPercent?: number;
      hardStopEnabled?: boolean;
      metadata?: any;
    },
    userId: string,
    orgId: string,
  ) {
    const existing = await this.findOne(id, orgId);

    const budget = await this.prisma.agentBudget.update({
      where: { id },
      data: {
        ...(input.monthlyLimitUsd !== undefined && { monthlyLimitUsd: input.monthlyLimitUsd }),
        ...(input.softAlertPercent !== undefined && { softAlertPercent: input.softAlertPercent }),
        ...(input.hardStopEnabled !== undefined && { hardStopEnabled: input.hardStopEnabled }),
        ...(input.metadata !== undefined && { metadata: input.metadata as any }),
      },
      include: { agent: { select: { id: true, name: true, slug: true } } },
    });

    // If limit was raised above current spend, clear hard stop
    if (
      input.monthlyLimitUsd !== undefined &&
      input.monthlyLimitUsd > existing.currentSpendUsd &&
      existing.hardStopTriggered
    ) {
      await this.prisma.agentBudget.update({
        where: { id },
        data: { hardStopTriggered: false },
      });

      await this.prisma.budgetIncident.create({
        data: {
          budgetId: id,
          type: 'MANUAL_OVERRIDE',
          message: `Budget limit raised from $${existing.monthlyLimitUsd} to $${input.monthlyLimitUsd}, hard stop cleared`,
          spendUsd: existing.currentSpendUsd,
          limitUsd: input.monthlyLimitUsd,
        },
      });
    }

    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: userId, action: 'UPDATE',
      resourceType: 'budget', resourceId: budget.id, orgId,
    });

    return budget;
  }

  async recordSpend(id: string, amount: number, description?: string, orgId?: string) {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

    const budget = await this.findOne(id, orgId!);

    // Check hard stop
    if (budget.hardStopTriggered) {
      throw new BadRequestException('Budget hard stop is active. Increase limit or reset budget.');
    }

    const newSpend = budget.currentSpendUsd + amount;
    const spendPercent = (newSpend / budget.monthlyLimitUsd) * 100;

    // Update spend
    const updated = await this.prisma.agentBudget.update({
      where: { id },
      data: { currentSpendUsd: newSpend },
      include: { agent: { select: { id: true, name: true, slug: true } } },
    });

    // Check soft alert threshold
    if (spendPercent >= budget.softAlertPercent && !budget.alertSent) {
      await this.prisma.agentBudget.update({
        where: { id },
        data: { alertSent: true },
      });

      await this.prisma.budgetIncident.create({
        data: {
          budgetId: id,
          type: 'SOFT_ALERT',
          message: description
            ? `Soft alert at ${spendPercent.toFixed(1)}%: ${description}`
            : `Spend reached ${spendPercent.toFixed(1)}% of $${budget.monthlyLimitUsd} limit`,
          spendUsd: newSpend,
          limitUsd: budget.monthlyLimitUsd,
        },
      });

      this.events.emit('budget.soft-alert', {
        budgetId: id,
        agentId: budget.agentId,
        agentName: updated.agent.name,
        spendUsd: newSpend,
        limitUsd: budget.monthlyLimitUsd,
        percent: spendPercent,
      });
    }

    // Check hard stop threshold
    if (spendPercent >= 100 && budget.hardStopEnabled && !budget.hardStopTriggered) {
      await this.prisma.agentBudget.update({
        where: { id },
        data: { hardStopTriggered: true },
      });

      await this.prisma.budgetIncident.create({
        data: {
          budgetId: id,
          type: 'HARD_STOP',
          message: description
            ? `Hard stop at ${spendPercent.toFixed(1)}%: ${description}`
            : `Spend exceeded 100% of $${budget.monthlyLimitUsd} limit, agent paused`,
          spendUsd: newSpend,
          limitUsd: budget.monthlyLimitUsd,
        },
      });

      // Emit agent.pause event to pause the agent
      this.events.emit('agent.pause', {
        agentId: budget.agentId,
        reason: 'BUDGET_EXCEEDED',
        budgetId: id,
      });

      this.events.emit('budget.hard-stop', {
        budgetId: id,
        agentId: budget.agentId,
        agentName: updated.agent.name,
        spendUsd: newSpend,
        limitUsd: budget.monthlyLimitUsd,
      });
    }

    return updated;
  }

  async reset(
    id: string,
    input: { periodStart: string; periodEnd: string },
    userId: string,
    orgId: string,
  ) {
    const existing = await this.findOne(id, orgId);

    // Record reset incident
    await this.prisma.budgetIncident.create({
      data: {
        budgetId: id,
        type: 'BUDGET_RESET',
        message: `Budget reset. Previous spend: $${existing.currentSpendUsd} / $${existing.monthlyLimitUsd}`,
        spendUsd: existing.currentSpendUsd,
        limitUsd: existing.monthlyLimitUsd,
      },
    });

    const budget = await this.prisma.agentBudget.update({
      where: { id },
      data: {
        currentSpendUsd: 0,
        periodStart: new Date(input.periodStart),
        periodEnd: new Date(input.periodEnd),
        alertSent: false,
        hardStopTriggered: false,
      },
      include: { agent: { select: { id: true, name: true, slug: true } } },
    });

    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: userId, action: 'UPDATE',
      resourceType: 'budget', resourceId: budget.id,
      details: { action: 'BUDGET_RESET' }, orgId,
    });

    return budget;
  }

  async getSummary(orgId: string) {
    const budgets = await this.prisma.agentBudget.findMany({
      where: { agent: { orgId } },
      include: { agent: { select: { id: true, name: true, slug: true, status: true } } },
    });

    const totalSpend = budgets.reduce((sum, b) => sum + b.currentSpendUsd, 0);
    const totalLimit = budgets.reduce((sum, b) => sum + b.monthlyLimitUsd, 0);
    const agentsOverBudget = budgets.filter(
      (b) => b.currentSpendUsd >= b.monthlyLimitUsd,
    );
    const agentsNearLimit = budgets.filter(
      (b) =>
        !agentsOverBudget.includes(b) &&
        (b.currentSpendUsd / b.monthlyLimitUsd) * 100 >= b.softAlertPercent,
    );

    return {
      totalBudgets: budgets.length,
      totalSpendUsd: totalSpend,
      totalLimitUsd: totalLimit,
      utilizationPercent: totalLimit > 0 ? (totalSpend / totalLimit) * 100 : 0,
      agentsOverBudget: agentsOverBudget.map((b) => ({
        agentId: b.agentId,
        agentName: b.agent.name,
        spendUsd: b.currentSpendUsd,
        limitUsd: b.monthlyLimitUsd,
        percent: (b.currentSpendUsd / b.monthlyLimitUsd) * 100,
        hardStopTriggered: b.hardStopTriggered,
      })),
      agentsNearLimit: agentsNearLimit.map((b) => ({
        agentId: b.agentId,
        agentName: b.agent.name,
        spendUsd: b.currentSpendUsd,
        limitUsd: b.monthlyLimitUsd,
        percent: (b.currentSpendUsd / b.monthlyLimitUsd) * 100,
      })),
    };
  }

  async getIncidents(
    budgetId: string,
    filters: { page?: string; pageSize?: string },
    orgId: string,
  ) {
    // Verify budget belongs to org
    await this.findOne(budgetId, orgId);

    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 20;

    const where = { budgetId };

    const [data, total] = await Promise.all([
      this.prisma.budgetIncident.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.budgetIncident.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }
}
