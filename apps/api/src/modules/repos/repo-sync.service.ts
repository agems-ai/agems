import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ReposService } from './repos.service';

@Injectable()
export class RepoSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RepoSyncService.name);
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private prisma: PrismaService,
    private reposService: ReposService,
  ) {}

  async onModuleInit() {
    this.intervalId = setInterval(() => this.tick(), 60_000);
    setTimeout(() => this.clonePendingRepos(), 5_000);
    this.logger.log('Repo sync scheduler started');
  }

  onModuleDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private async tick() {
    try {
      await this.checkSyncSchedule();
    } catch (err) {
      this.logger.error(`Repo sync tick error: ${err}`);
    }
  }

  private async clonePendingRepos() {
    try {
      const pending = await this.prisma.repository.findMany({
        where: { syncStatus: 'PENDING' },
        orderBy: { createdAt: 'asc' },
      });

      for (const repo of pending) {
        try {
          await this.reposService.cloneRepo(repo.id);
        } catch (err: any) {
          this.logger.error(`Failed to clone pending repo ${repo.slug}: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`clonePendingRepos error: ${err.message}`);
    }
  }

  private async checkSyncSchedule() {
    const repos = await this.prisma.repository.findMany({
      where: {
        syncSchedule: { not: null },
        syncStatus: 'SYNCED',
      },
    });

    const now = new Date();
    for (const repo of repos) {
      if (repo.syncSchedule && this.cronMatches(repo.syncSchedule, now)) {
        this.logger.log(`Scheduled sync for repo ${repo.slug}`);
        try {
          await this.reposService.pullRepo(repo.id);
        } catch (err: any) {
          this.logger.error(`Scheduled pull failed for ${repo.slug}: ${err.message}`);
        }
      }
    }
  }

  private cronMatches(expression: string, date: Date): boolean {
    try {
      const parts = expression.trim().split(/\s+/);
      if (parts.length !== 5) return false;

      const [minExpr, hourExpr, dayExpr, monthExpr, dowExpr] = parts;
      const minute = date.getMinutes();
      const hour = date.getHours();
      const day = date.getDate();
      const month = date.getMonth() + 1;
      const dow = date.getDay(); // 0=Sunday

      return (
        this.fieldMatches(minExpr, minute, 0, 59) &&
        this.fieldMatches(hourExpr, hour, 0, 23) &&
        this.fieldMatches(dayExpr, day, 1, 31) &&
        this.fieldMatches(monthExpr, month, 1, 12) &&
        this.fieldMatches(dowExpr, dow, 0, 7)
      );
    } catch {
      return false;
    }
  }

  private fieldMatches(expr: string, value: number, _min: number, _max: number): boolean {
    if (expr === '*') return true;

    if (expr.startsWith('*/')) {
      const step = parseInt(expr.slice(2));
      return !isNaN(step) && step > 0 && value % step === 0;
    }

    const parts = expr.split(',');
    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        if (!isNaN(start) && !isNaN(end) && value >= start && value <= end) return true;
      } else {
        if (parseInt(part) === value) return true;
      }
    }
    return false;
  }
}
