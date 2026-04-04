import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

export interface BillingOverview {
  totalRevenue: number;
  mrr: number;
  arr: number;
  activeSubscriptions: number;
  failedPayments: number;
  refunds: number;
  churnRate: number;
  avgRevenuePerUser: number;
}

@Injectable()
export class BillingManagementService {
  private readonly logger = new Logger(BillingManagementService.name);

  constructor(private prisma: PrismaService) {}

  async getBillingOverview(): Promise<BillingOverview> {
    const [
      totalRevenue,
      activeSubscriptions,
      failedPayments,
      refundedPayments,
      totalOrgs,
    ] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.subscription.count({ where: { status: 'active' } }),
      this.prisma.payment.count({ where: { status: 'FAILED' } }),
      this.prisma.payment.count({ where: { status: 'REFUNDED' } }),
      this.prisma.organization.count(),
    ]);

    const revenue = (totalRevenue._sum.amount ?? 0) / 100;
    const mrr = revenue / Math.max(1, 12);
    const churnRate = activeSubscriptions > 0 ? (failedPayments / activeSubscriptions) * 100 : 0;

    return {
      totalRevenue: revenue,
      mrr,
      arr: mrr * 12,
      activeSubscriptions,
      failedPayments,
      refunds: refundedPayments,
      churnRate,
      avgRevenuePerUser: totalOrgs > 0 ? revenue / totalOrgs : 0,
    };
  }

  async getPayments(options: {
    page?: number;
    pageSize?: number;
    status?: string;
    orgId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{ data: Record<string, unknown>[]; total: number }> {
    const { page = 1, pageSize = 20, status, orgId, startDate, endDate } = options;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (orgId) where.orgId = orgId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Record<string, Date>).gte = startDate;
      if (endDate) (where.createdAt as Record<string, Date>).lte = endDate;
    }

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: { org: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data: payments.map((p) => ({
        id: p.id,
        orgId: p.orgId,
        orgName: p.org?.name ?? 'Unknown',
        email: p.email ?? '',
        amount: p.amount / 100,
        currency: p.currency,
        status: p.status,
        product: p.product ?? '',
        createdAt: p.createdAt,
        metadata: p.metadata as Record<string, unknown> | null,
      })),
      total,
    };
  }

  async getSubscriptions(options: {
    page?: number;
    pageSize?: number;
    status?: string;
    plan?: string;
  }): Promise<{ data: Record<string, unknown>[]; total: number }> {
    const { page = 1, pageSize = 20, status, plan } = options;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (plan) where.plan = plan;

    const [subscriptions, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        include: { org: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.subscription.count({ where }),
    ]);

    return {
      data: subscriptions.map((s) => ({
        id: s.id,
        orgId: s.orgId,
        orgName: s.org?.name ?? 'Unknown',
        plan: s.plan,
        status: s.status,
        currentPeriodStart: s.currentPeriodStart ?? s.createdAt,
        currentPeriodEnd: s.currentPeriodEnd ?? new Date(),
      })),
      total,
    };
  }

  async processRefund(paymentId: string, amount?: number, reason?: string): Promise<{
    success: boolean;
    paymentId: string;
    refundedAmount?: number;
    error?: string;
  }> {
    try {
      const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
      if (!payment) {
        return { success: false, paymentId, error: 'Payment not found' };
      }

      const refundAmount = amount ?? payment.amount;

      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'REFUNDED',
          metadata: {
            ...(payment.metadata as object ?? {}),
            refundedAmount: refundAmount,
            refundedAt: new Date().toISOString(),
            refundReason: reason,
          },
        },
      });

      this.logger.log(`Refund processed: ${paymentId}, amount: ${refundAmount / 100}`);

      return {
        success: true,
        paymentId,
        refundedAmount: refundAmount / 100,
      };
    } catch (err) {
      this.logger.error(`Refund failed: ${paymentId}`, err);
      return {
        success: false,
        paymentId,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  async overrideSubscription(
    orgId: string,
    overrides: { plan?: string; status?: string; currentPeriodEnd?: Date },
  ): Promise<void> {
    const subscription = await this.prisma.subscription.findFirst({ where: { orgId } });

    if (subscription) {
      const data: Record<string, unknown> = {};
      if (overrides.plan) data.plan = overrides.plan;
      if (overrides.status) data.status = overrides.status;
      if (overrides.currentPeriodEnd) data.currentPeriodEnd = overrides.currentPeriodEnd;

      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data,
      });

      this.logger.log(`Subscription overridden for org ${orgId}: ${JSON.stringify(overrides)}`);
    } else {
      this.logger.warn(`No subscription found for org ${orgId}, cannot override`);
    }
  }

  async getRevenueByPlan(): Promise<{ plan: string; count: number; revenue: number }[]> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { status: 'active' },
    });

    const planRevenue = new Map<string, { count: number; revenue: number }>();

    const planPrices: Record<string, number> = {
      FREE: 0,
      STARTER: 29,
      PRO: 99,
      BUSINESS: 299,
      ENTERPRISE: 999,
    };

    for (const sub of subscriptions) {
      const current = planRevenue.get(sub.plan) ?? { count: 0, revenue: 0 };
      current.count++;
      current.revenue += planPrices[sub.plan] ?? 0;
      planRevenue.set(sub.plan, current);
    }

    return Array.from(planRevenue.entries()).map(([plan, data]) => ({
      plan,
      count: data.count,
      revenue: data.revenue,
    }));
  }
}
