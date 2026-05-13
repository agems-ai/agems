import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { PlatformBudgetsService } from './platform-budgets.service';

/**
 * BudgetResetScheduler — periodically auto-clears hard_stop_triggered on PlatformBudget rows
 * when the window that originally tripped it has rolled over (new hour / new day / new month).
 *
 * Why: hard_stop_triggered is a single boolean. If it tripped because of HOURLY overshoot at
 * 14:59, an admin shouldn't have to manually un-stick it at 15:00 — the hourly window is fresh
 * and spend is back to $0 in that window. Same logic for daily/monthly rollover.
 *
 * Implementation: every 60s walk all rows with hard_stop_triggered=true and call checkLimit
 * with the flag ignored. If no window is currently over-budget, clear the flag and record a
 * MANUAL_OVERRIDE incident (so audit trail shows it was an auto-reset).
 *
 * The 60s tick is cheap because the table has one row per org and the typical query plan is
 * an index lookup on org_id.
 */
@Injectable()
export class BudgetResetScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BudgetResetScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 60_000;

  constructor(
    private prisma: PrismaService,
    private platformBudgets: PlatformBudgetsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.tick().catch((err) => this.logger.error(err)), this.intervalMs);
    this.logger.log(`Budget reset scheduler started (${this.intervalMs / 1000}s interval)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Walk all stuck rows; clear hard_stop_triggered if current windows are no longer over-budget. */
  private async tick() {
    const stuck = await this.prisma.platformBudget.findMany({
      where: { hardStopTriggered: true },
      select: { id: true, orgId: true, currentSpendUsd: true, monthlyLimitUsd: true },
    });
    if (stuck.length === 0) return;

    for (const pb of stuck) {
      try {
        // Temporarily ignore the flag to compute fresh window state
        const breakdown = await this.platformBudgets.getSpendBreakdown(pb.orgId);
        const stillOver =
          (breakdown.hourly.limit !== null && breakdown.hourly.limit > 0 && breakdown.hourly.spend >= breakdown.hourly.limit) ||
          (breakdown.daily.limit !== null && breakdown.daily.limit > 0 && breakdown.daily.spend >= breakdown.daily.limit) ||
          (breakdown.monthly.limit !== null && breakdown.monthly.limit > 0 && breakdown.monthly.spend >= breakdown.monthly.limit);

        if (!stillOver) {
          await this.prisma.platformBudget.update({
            where: { id: pb.id },
            data: { hardStopTriggered: false, alertSent: false },
          });
          await this.prisma.platformBudgetIncident.create({
            data: {
              platformBudgetId: pb.id,
              type: 'MANUAL_OVERRIDE',
              scope: 'MONTHLY',
              message: 'Auto-reset: all windows under their limits after rollover.',
              spendUsd: breakdown.monthly.spend,
              limitUsd: breakdown.monthly.limit ?? 0,
            },
          });
          this.logger.log(`Cleared hard_stop_triggered for org=${pb.orgId} (windows back under limit)`);
        }
      } catch (err) {
        this.logger.error(`Auto-reset failed for org=${pb.orgId}: ${(err as Error).message}`);
      }
    }
  }
}
