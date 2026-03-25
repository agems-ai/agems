import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import { RuntimeService } from '../runtime/runtime.service';
import { CommsService } from '../comms/comms.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class TaskSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskSchedulerService.name);
  private intervalId: NodeJS.Timeout | null = null;
  private _isTicking = false;
  private readonly runningAgents = new Set<string>();
  private reviewTickCounter = 0;

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
    @Inject(forwardRef(() => RuntimeService))
    private runtime: RuntimeService,
    @Inject(forwardRef(() => CommsService))
    private comms: CommsService,
    private settings: SettingsService,
  ) {}

  async onModuleInit() {
    await this.startScheduler();
    this.logger.log('Task scheduler initialized');
  }

  onModuleDestroy() {
    this.stopScheduler();
  }

  private async isEnabled(): Promise<boolean> {
    const val = await this.settings.get('task_agents_enabled');
    return val !== 'false';
  }

  private async getIntervalMs(): Promise<number> {
    const val = await this.settings.get('task_scheduler_interval');
    const seconds = val ? parseInt(val) : 60;
    return (isNaN(seconds) || seconds < 10 ? 60 : seconds) * 1000;
  }

  private async startScheduler() {
    if (this._isTicking) return;
    this.stopScheduler();

    const intervalMs = await this.getIntervalMs();
    this.intervalId = setInterval(async () => {
      if (this._isTicking) return;
      this._isTicking = true;
      try {
        await this.tick();
      } finally {
        this._isTicking = false;
      }
    }, intervalMs);

    this.logger.log(`Task scheduler started (${intervalMs / 1000}s interval)`);
  }

  private stopScheduler() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  @OnEvent('setting.task_scheduler_interval')
  async onIntervalChanged() {
    await this.startScheduler();
  }

  private async tick() {
    try {
      if (!(await this.isEnabled())) return;
      await this.checkRecurringTasks();
      await this.pickupPendingAgentTasks();

      this.reviewTickCounter++;
      const intervalMs = await this.getIntervalMs();
      const reviewIntervalSec = parseInt(await this.settings.get('task_review_interval') || '300');
      const reviewEveryNTicks = Math.max(1, Math.round((reviewIntervalSec * 1000) / intervalMs));
      if (this.reviewTickCounter >= reviewEveryNTicks) {
        this.reviewTickCounter = 0;
        this.logger.log(`Review cycle starting (every ${reviewEveryNTicks} ticks / ${reviewIntervalSec}s)`);
        await this.runReviewCycle();
      }
    } catch (err) {
      this.logger.error(`Tick error: ${err}`);
    }
  }

  @OnEvent('task.created')
  async onTaskCreated(task: any) {
    if (task.assigneeType !== 'AGENT' || !task.assigneeId) return;
    setTimeout(async () => {
      if (!(await this.isEnabled())) return;
      this.executeAgentTask(task);
    }, 2000);
  }

  @OnEvent('task.comment')
  async onTaskComment(payload: { taskId: string; comment: any }) {
    try {
      if (!(await this.isEnabled())) return;

      const { taskId, comment } = payload;
      if (comment.authorType === 'SYSTEM') return;

      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        select: {
          id: true, title: true, status: true, description: true,
          assigneeType: true, assigneeId: true,
          creatorType: true, creatorId: true,
          metadata: true,
        },
      });
      if (!task) return;

      const agentsToNotify = new Set<string>();
      if (task.assigneeType === 'AGENT' && task.assigneeId &&
          !(comment.authorType === 'AGENT' && comment.authorId === task.assigneeId)) {
        agentsToNotify.add(task.assigneeId);
      }
      if (task.creatorType === 'AGENT' && task.creatorId &&
          !(comment.authorType === 'AGENT' && comment.authorId === task.creatorId)) {
        agentsToNotify.add(task.creatorId);
      }

      const meta = (task.metadata || {}) as any;
      if (meta.reviewerId && meta.reviewerType === 'AGENT' &&
          !(comment.authorType === 'AGENT' && comment.authorId === meta.reviewerId)) {
        agentsToNotify.add(meta.reviewerId);
      }

      for (const agentId of agentsToNotify) {
        if (this.runningAgents.has(agentId)) continue;

        let authorName = comment.authorId;
        if (comment.authorType === 'AGENT') {
          const a = await this.prisma.agent.findUnique({ where: { id: comment.authorId }, select: { name: true } });
          if (a) authorName = a.name;
        } else if (comment.authorType === 'HUMAN') {
          const u = await this.prisma.user.findUnique({ where: { id: comment.authorId }, select: { name: true } });
          if (u) authorName = u.name || comment.authorId;
        }

        const prompt = [
          `=== NEW COMMENT ON TASK ===`,
          `Task ID: ${task.id}`,
          `Task: "${task.title}" (status: ${task.status})`,
          `Comment by ${comment.authorType} "${authorName}":`,
          `"${comment.content}"`,
          ``,
          `Respond to this comment. If action is needed, take it using your tools.`,
          `Use agems_tasks action="add_comment" to reply on the task.`,
          `=== END ===`,
        ].join('\n');

        this.triggerAgentForTask(agentId, task, prompt).catch(err =>
          this.logger.error(`Failed to trigger agent ${agentId} for comment: ${err}`),
        );
      }
    } catch (err) {
      this.logger.error(`Error in onTaskComment: ${err}`);
    }
  }

  @OnEvent('task.updated')
  async onTaskUpdated(task: any) {
    try {
      if (task.status === 'IN_REVIEW') {
        const meta = (task.metadata || {}) as any;
        let reviewerId = meta.reviewerId;
        if (!reviewerId) {
          const reviewer = await this.findReviewer(task);
          if (reviewer) {
            reviewerId = reviewer.id;
            await this.prisma.task.update({
              where: { id: task.id },
              data: { metadata: { ...meta, reviewerId: reviewer.id, reviewerType: 'AGENT' } },
            });
            this.logger.log(`Auto-assigned reviewer ${reviewer.name} to task "${task.title}"`);
          }
        }

        if (reviewerId && !this.runningAgents.has(reviewerId)) {
          const reviewPrompt = [
            `=== TASK READY FOR YOUR REVIEW ===`,
            `Task ID: ${task.id}`,
            `Title: "${task.title}"`,
            task.description ? `Description: ${task.description}` : '',
            ``,
            `The executor has finished work and set this task to IN_REVIEW.`,
            `1. Use agems_tasks action="get" to review the task details and comments.`,
            `2. Evaluate the quality and completeness of the work.`,
            `3. If satisfactory → update status to VERIFIED.`,
            `4. If issues found → update status to IN_PROGRESS with a comment explaining what needs to be fixed.`,
            `=== END ===`,
          ].filter(Boolean).join('\n');

          setTimeout(() => {
            this.triggerAgentForTask(reviewerId, task, reviewPrompt).catch(err =>
              this.logger.error(`Failed to trigger reviewer ${reviewerId}: ${err}`),
            );
          }, 3000);
        }
      }

      if (task.status === 'COMPLETED') {
        const meta = (task.metadata || {}) as any;
        if (meta.expectedResult && !meta.resultCheckAt) {
          const checkDays = parseInt(await this.settings.get('task_result_check_days') || '7');
          const checkDate = new Date();
          checkDate.setDate(checkDate.getDate() + checkDays);
          await this.prisma.task.update({
            where: { id: task.id },
            data: {
              metadata: {
                ...meta,
                resultCheckAt: checkDate.toISOString(),
                resultChecked: false,
                resultCheckCount: 0,
              },
            },
          });
          this.logger.log(`Scheduled result check for task "${task.title}" on ${checkDate.toISOString()}`);
        }
      }
    } catch (err) {
      this.logger.error(`Error in onTaskUpdated: ${err}`);
    }
  }

  // ─── REVIEW CYCLE ──────────────────────────────────────────────

  private async runReviewCycle() {
    try {
      const batchSize = parseInt(await this.settings.get('task_review_batch_size') || '3');
      const agentsWithWork = await this.findAgentsWithReviewWork();

      if (agentsWithWork.length === 0) {
        this.logger.log('Review cycle: no agents with actionable work');
        return;
      }

      this.logger.log(`Review cycle: ${agentsWithWork.length} agents with work, processing ${Math.min(batchSize, agentsWithWork.length)}`);

      const batch = agentsWithWork.slice(0, batchSize);
      for (const agentId of batch) {
        if (this.runningAgents.has(agentId)) continue;
        this.executeReviewCycle(agentId).catch(err =>
          this.logger.error(`Review cycle failed for agent ${agentId}: ${err}`),
        );
      }
    } catch (err) {
      this.logger.error('Error running review cycle', err);
    }
  }

  private async findAgentsWithReviewWork(): Promise<string[]> {
    const agents = new Set<string>();

    const inProgress = await this.prisma.task.findMany({
      where: { assigneeType: 'AGENT', status: 'IN_PROGRESS' },
      select: { assigneeId: true },
      distinct: ['assigneeId' as any],
    });
    inProgress.forEach(t => agents.add(t.assigneeId));

    const inReview = await this.prisma.task.findMany({
      where: { status: { in: ['IN_REVIEW', 'IN_TESTING'] } },
      select: { metadata: true },
    });
    for (const t of inReview) {
      const meta = t.metadata as any;
      if (meta?.reviewerId) agents.add(meta.reviewerId);
    }

    const verified = await this.prisma.task.findMany({
      where: { status: 'VERIFIED', creatorType: 'AGENT' },
      select: { creatorId: true },
      distinct: ['creatorId' as any],
    });
    verified.forEach(t => agents.add(t.creatorId));

    const completed = await this.prisma.task.findMany({
      where: { status: 'COMPLETED', creatorType: 'AGENT' },
      select: { creatorId: true, metadata: true },
    });
    const now = new Date();
    for (const t of completed) {
      const meta = t.metadata as any;
      if (meta?.resultCheckAt && !meta?.resultChecked && new Date(meta.resultCheckAt) <= now) {
        agents.add(t.creatorId);
      }
    }

    return [...agents];
  }

  private async executeReviewCycle(agentId: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, name: true, status: true, orgId: true },
    });
    if (!agent || agent.status !== 'ACTIVE') return;

    const budgetOk = await this.checkReviewBudget(agentId);
    if (!budgetOk) {
      this.logger.debug(`Agent ${agent.name} exceeded daily review budget, skipping`);
      return;
    }

    this.runningAgents.add(agentId);

    try {
      const reviewPrompt = await this.buildReviewPrompt(agentId);
      if (!reviewPrompt) return;

      const channelId = await this.findOrCreateAgentChannel(agentId, agent.name, agent.orgId);

      this.logger.log(`Review cycle for agent ${agent.name}`);

      const result = await this.runtime.execute(
        agentId,
        reviewPrompt,
        { type: 'SCHEDULE', id: 'review-cycle' },
        { channelId },
      );

      if (result.text?.trim() && channelId) {
        await this.comms.sendMessage(
          channelId,
          { content: result.text.trim(), contentType: 'TEXT' },
          'AGENT',
          agentId,
        );
      }
    } catch (err) {
      this.logger.error(`Review cycle failed for ${agent.name}: ${err}`);
    } finally {
      this.runningAgents.delete(agentId);
    }
  }

  // ─── CRON ──────────────────────────────────────────────

  private async checkRecurringTasks() {
    try {
      const recurringTasks = await this.prisma.task.findMany({
        where: {
          type: 'RECURRING',
          status: 'COMPLETED',
          cronExpression: { not: null },
        },
      });

      const now = new Date();

      for (const task of recurringTasks) {
        if (this.cronMatches(task.cronExpression!, now)) {
          await this.prisma.task.update({
            where: { id: task.id },
            data: { status: 'PENDING', completedAt: null },
          });
          this.logger.log(`Reset recurring task "${task.title}" (${task.id}) to PENDING`);
        }
      }
    } catch (err) {
      this.logger.error('Error checking recurring tasks', err);
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
      let dow = date.getDay();

      return (
        this.fieldMatches(minExpr, minute, 0, 59) &&
        this.fieldMatches(hourExpr, hour, 0, 23) &&
        this.fieldMatches(dayExpr, day, 1, 31) &&
        this.fieldMatches(monthExpr, month, 1, 12) &&
        this.fieldMatches(dowExpr, dow, 0, 6)
      );
    } catch {
      return false;
    }
  }

  private fieldMatches(expr: string, value: number, min: number, max: number): boolean {
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

  // ─── AGENT TASK EXECUTION ──────────────────────────────────────────────

  private async pickupPendingAgentTasks() {
    const tasks = await this.prisma.task.findMany({
      where: { status: 'PENDING', assigneeType: 'AGENT' },
    });
    for (const t of tasks) {
      this.executeAgentTask(t).catch(err =>
        this.logger.error(`Failed to execute agent task ${t.id}: ${err}`),
      );
    }
  }

  private async executeAgentTask(task: any) {
    if (!task.assigneeId || this.runningAgents.has(task.assigneeId)) return;
    this.runningAgents.add(task.assigneeId);

    try {
      const prompt = this.buildTaskPrompt(task);
      const channelId = await this.findOrCreateAgentChannel(task.assigneeId, task.assigneeId, task.assigneeOrgId);

      const result = await this.runtime.execute(task.assigneeId, prompt, { type: 'SCHEDULE', id: task.id }, { channelId });

      if (result.text?.trim() && channelId) {
        await this.comms.sendMessage(channelId, { content: result.text.trim(), contentType: 'TEXT' }, 'AGENT', task.assigneeId);
      }
    } catch (err) {
      this.logger.error(`Error executing task ${task.id} for agent ${task.assigneeId}: ${err}`);
    } finally {
      this.runningAgents.delete(task.assigneeId);
    }
  }

  private buildTaskPrompt(task: any): string {
    return [
      `=== TASK TO EXECUTE ===`,
      `Task ID: ${task.id}`,
      `Title: "${task.title}"`,
      task.description ? `Description: ${task.description}` : '',
      ``,
      `Use available tools to complete this task.`,
      `Update status using agems_tasks action="update_status"`,
      `Add comments if needed using agems_tasks action="add_comment"`,
      `=== END ===`,
    ].filter(Boolean).join('\n');
  }

  private async triggerAgentForTask(agentId: string, task: any, prompt: string) {
    if (this.runningAgents.has(agentId)) return;
    this.runningAgents.add(agentId);
    try {
      const channelId = await this.findOrCreateAgentChannel(agentId, agentId, task.orgId);
      const result = await this.runtime.execute(agentId, prompt, { type: 'EVENT', id: task.id }, { channelId });
      if (result.text?.trim() && channelId) {
        await this.comms.sendMessage(channelId, { content: result.text.trim(), contentType: 'TEXT' }, 'AGENT', agentId);
      }
    } catch (err) {
      this.logger.error(`triggerAgentForTask error for agent ${agentId}: ${err}`);
    } finally {
      this.runningAgents.delete(agentId);
    }
  }

  private async findOrCreateAgentChannel(agentId: string, name: string, orgId: string) {
    // упрощённо возвращаем уникальный канал
    return `agent-channel-${agentId}`;
  }

  private async checkReviewBudget(agentId: string): Promise<boolean> {
    // заглушка: всегда true
    return true;
  }

  private async buildReviewPrompt(agentId: string): Promise<string> {
    return `=== REVIEW PROMPT ===\nAgent ${agentId} review tasks here\n=== END ===`;
  }

  private async findReviewer(task: any) {
    // заглушка
    const a = await this.prisma.agent.findFirst({ where: { status: 'ACTIVE' } });
    return a;
  }
}
