import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class ExecutionCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExecutionCleanupService.name);
  private intervalId: NodeJS.Timeout | null = null;

  /** Executions RUNNING longer than this are considered stale */
  private readonly STALE_RUNNING_MINUTES = 35;
  /** WAITING_HITL longer than this auto-cancel */
  private readonly STALE_HITL_HOURS = 24;
  /** Cleanup runs every 5 minutes */
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    // On startup: clean up executions left RUNNING from a previous server session
    await this.cleanupStaleExecutions('startup');
    // Start periodic cleanup
    this.intervalId = setInterval(() => this.cleanupStaleExecutions('periodic'), this.CLEANUP_INTERVAL_MS);
    this.logger.log('Execution cleanup service started (5min interval)');
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async cleanupStaleExecutions(trigger: 'startup' | 'periodic') {
    try {
      const now = new Date();

      // 1. Stale RUNNING executions.
      //    On startup: ALL RUNNING records are zombies — the previous container died,
      //    so anything still flagged RUNNING has no live process behind it.
      //    On periodic: only flag executions older than STALE_RUNNING_MINUTES (35 min).
      const where: any = { status: 'RUNNING' };
      if (trigger === 'periodic') {
        where.startedAt = { lt: new Date(now.getTime() - this.STALE_RUNNING_MINUTES * 60 * 1000) };
      }
      const staleRunning = await this.prisma.agentExecution.updateMany({
        where,
        data: {
          status: 'FAILED',
          error: trigger === 'startup'
            ? 'Server restarted while execution was running'
            : 'Execution timed out (stale cleanup)',
          endedAt: now,
        },
      });

      // 2. Stale WAITING_HITL (older than 24 hours)
      const hitlCutoff = new Date(now.getTime() - this.STALE_HITL_HOURS * 60 * 60 * 1000);
      const staleHitl = await this.prisma.agentExecution.updateMany({
        where: {
          status: 'WAITING_HITL',
          startedAt: { lt: hitlCutoff },
        },
        data: {
          status: 'CANCELLED',
          error: 'Approval request expired (24h timeout)',
          endedAt: now,
        },
      });

      const total = staleRunning.count + staleHitl.count;
      if (total > 0) {
        this.logger.log(
          `Cleaned up ${total} stale executions (${staleRunning.count} RUNNING, ${staleHitl.count} WAITING_HITL) [${trigger}]`,
        );
      }
    } catch (error) {
      this.logger.error(`Execution cleanup failed: ${error}`);
    }
  }
}
