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
  /** Prevent concurrent execution of same agent for tasks */
  private readonly runningAgents = new Set<string>();
  /** Review cycle counter — triggers review every N ticks */
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

  private async isEnabled(): Promise<boolean> {
    const val = await this.settings.get('task_agents_enabled');
    return val !== 'false';
  }

  async onModuleInit() {
    await this.startScheduler();
    this.logger.log('Task scheduler initialized');
  }

  onModuleDestroy() {
    this.stopScheduler();
  }

  private async getIntervalMs(): Promise<number> {
    const val = await this.settings.get('task_scheduler_interval');
    const seconds = val ? parseInt(val) : 60;
    return (isNaN(seconds) || seconds < 10 ? 60 : seconds) * 1000;
  }

  private async startScheduler() {
    this.stopScheduler();
    const intervalMs = await this.getIntervalMs();
    this.intervalId = setInterval(() => this.tick(), intervalMs);
    this.logger.log(`Task scheduler started (${intervalMs / 1000}s interval)`);
  }

  private stopScheduler() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Restart scheduler when interval setting changes */
  @OnEvent('setting.task_scheduler_interval')
  async onIntervalChanged() {
    await this.startScheduler();
  }

  /** Main scheduler tick — recurring resets + pending task pickup + review cycles */
  private async tick() {
    try {
      if (!(await this.isEnabled())) return;
      await this.checkRecurringTasks();
      await this.pickupPendingAgentTasks();

      // Review cycle: runs every N ticks (based on task_review_interval setting)
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

  /** When a new task is created for an agent, auto-trigger execution */
  @OnEvent('task.created')
  async onTaskCreated(task: any) {
    if (task.assigneeType !== 'AGENT' || !task.assigneeId) return;
    // Small delay to let the transaction complete
    setTimeout(async () => {
      if (!(await this.isEnabled())) return;
      this.executeAgentTask(task);
    }, 2000);
  }

  /** When a comment is added to a task, trigger the assigned agent to respond */
  @OnEvent('task.comment')
  async onTaskComment(payload: { taskId: string; comment: any }) {
    try {
      if (!(await this.isEnabled())) return;

      const { taskId, comment } = payload;

      // Don't trigger for system comments
      if (comment.authorType === 'SYSTEM') return;

      // Find the task
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

      // Determine which agent(s) should respond:
      // - If comment is from someone other than assignee → notify assignee
      // - If comment is from someone other than creator → notify creator (if agent)
      const agentsToNotify = new Set<string>();

      if (task.assigneeType === 'AGENT' && task.assigneeId &&
          !(comment.authorType === 'AGENT' && comment.authorId === task.assigneeId)) {
        agentsToNotify.add(task.assigneeId);
      }

      if (task.creatorType === 'AGENT' && task.creatorId &&
          !(comment.authorType === 'AGENT' && comment.authorId === task.creatorId)) {
        agentsToNotify.add(task.creatorId);
      }

      // Also notify reviewer if exists
      const meta = (task.metadata || {}) as any;
      if (meta.reviewerId && meta.reviewerType === 'AGENT' &&
          !(comment.authorType === 'AGENT' && comment.authorId === meta.reviewerId)) {
        agentsToNotify.add(meta.reviewerId);
      }

      for (const agentId of agentsToNotify) {
        if (this.runningAgents.has(agentId)) continue;

        // Resolve comment author name
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

  /** When task status changes, handle review flow automation */
  @OnEvent('task.updated')
  async onTaskUpdated(task: any) {
    try {
      // When executor sets IN_REVIEW, auto-assign a reviewer and trigger them
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

        // Trigger the reviewer agent to actually review the task
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
          }, 3000); // Small delay so DB transaction settles
        }
      }

      // When task COMPLETED with expectedResult but no resultCheckAt, set default check
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

  // ══════════════════════════════════════════════════════════
  // REVIEW CYCLE ENGINE
  // ══════════════════════════════════════════════════════════

  /** Run review cycle: find agents with actionable work and trigger review execution */
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

  /** Find agents that have actionable review work */
  private async findAgentsWithReviewWork(): Promise<string[]> {
    const agents = new Set<string>();

    // 1. Agents with IN_PROGRESS tasks (need to progress)
    const inProgress = await this.prisma.task.findMany({
      where: { assigneeType: 'AGENT', status: 'IN_PROGRESS' },
      select: { assigneeId: true },
      distinct: ['assigneeId' as any],
    });
    inProgress.forEach(t => agents.add(t.assigneeId));

    // 2. Tasks in IN_REVIEW — find reviewerIds from metadata
    const inReview = await this.prisma.task.findMany({
      where: { status: { in: ['IN_REVIEW', 'IN_TESTING'] } },
      select: { metadata: true },
    });
    for (const t of inReview) {
      const meta = t.metadata as any;
      if (meta?.reviewerId) agents.add(meta.reviewerId);
    }

    // 3. Tasks in VERIFIED — creators need to sign off
    const verified = await this.prisma.task.findMany({
      where: { status: 'VERIFIED', creatorType: 'AGENT' },
      select: { creatorId: true },
      distinct: ['creatorId' as any],
    });
    verified.forEach(t => agents.add(t.creatorId));

    // 4. Completed tasks with pending result checks
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

  /** Execute review cycle for a single agent */
  private async executeReviewCycle(agentId: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, name: true, status: true, orgId: true },
    });
    if (!agent || agent.status !== 'ACTIVE') return;

    // Check daily budget
    const budgetOk = await this.checkReviewBudget(agentId);
    if (!budgetOk) {
      this.logger.debug(`Agent ${agent.name} exceeded daily review budget, skipping`);
      return;
    }

    this.runningAgents.add(agentId);

    try {
      const reviewPrompt = await this.buildReviewPrompt(agentId);
      if (!reviewPrompt) return; // No actionable work

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

  /** Build structured review prompt listing all actionable items for the agent */
  private async buildReviewPrompt(agentId: string): Promise<string | null> {
    const sections: string[] = [];

    // 1. Tasks I'm executing (IN_PROGRESS)
    const myInProgress = await this.prisma.task.findMany({
      where: { assigneeType: 'AGENT', assigneeId: agentId, status: 'IN_PROGRESS' },
      select: { id: true, title: true, priority: true, deadline: true, description: true },
      take: 10,
    });
    if (myInProgress.length > 0) {
      sections.push('=== YOUR IN_PROGRESS TASKS (make progress) ===');
      for (const t of myInProgress) {
        sections.push(`- [${t.id}] "${t.title}" (${t.priority}${t.deadline ? `, deadline: ${t.deadline.toISOString()}` : ''})`);
        if (t.description) sections.push(`  Description: ${t.description.substring(0, 200)}`);
      }
      sections.push('ACTION: Progress these tasks. Add comments with updates. Set IN_REVIEW when your work is done.');
      sections.push('');
    }

    // 2. Tasks I need to review (IN_REVIEW/IN_TESTING where I'm reviewer)
    const allReviewTasks = await this.prisma.task.findMany({
      where: { status: { in: ['IN_REVIEW', 'IN_TESTING'] } },
      select: { id: true, title: true, metadata: true, assigneeId: true, status: true },
    });
    const myReviews = allReviewTasks.filter(t => (t.metadata as any)?.reviewerId === agentId);
    if (myReviews.length > 0) {
      sections.push('=== TASKS TO REVIEW (you are the reviewer) ===');
      for (const t of myReviews) {
        sections.push(`- [${t.id}] "${t.title}" (status: ${t.status})`);
      }
      sections.push('ACTION: Review each task using agems_tasks get. Check work quality. If good → update status to VERIFIED. If issues → set IN_PROGRESS with comment.');
      sections.push('');
    }

    // 3. Tasks I created that are VERIFIED (need my sign-off)
    const verified = await this.prisma.task.findMany({
      where: { creatorType: 'AGENT', creatorId: agentId, status: 'VERIFIED' },
      select: { id: true, title: true, metadata: true },
      take: 10,
    });
    if (verified.length > 0) {
      sections.push('=== TASKS YOU CREATED — AWAITING YOUR SIGN-OFF (VERIFIED) ===');
      for (const t of verified) {
        const meta = t.metadata as any;
        sections.push(`- [${t.id}] "${t.title}"${meta?.expectedResult ? ` (expected: ${meta.expectedResult})` : ''}`);
      }
      sections.push('ACTION: Check if expected results were achieved. If yes → set COMPLETED. If no → set IN_PROGRESS with explanation.');
      sections.push('');
    }

    // 4. Completed tasks with pending result checks
    const completedTasks = await this.prisma.task.findMany({
      where: { status: 'COMPLETED', creatorType: 'AGENT', creatorId: agentId },
      select: { id: true, title: true, metadata: true },
    });
    const now = new Date();
    const maxChecks = parseInt(await this.settings.get('task_result_check_max') || '3');
    const dueChecks = completedTasks.filter(t => {
      const meta = t.metadata as any;
      return meta?.resultCheckAt && !meta?.resultChecked && new Date(meta.resultCheckAt) <= now && (meta.resultCheckCount || 0) < maxChecks;
    });
    if (dueChecks.length > 0) {
      sections.push('=== RESULT VERIFICATION DUE ===');
      for (const t of dueChecks) {
        const meta = t.metadata as any;
        sections.push(`- [${t.id}] "${t.title}" (expected: ${meta?.expectedResult || 'not specified'}, check #${(meta?.resultCheckCount || 0) + 1})`);
      }
      sections.push('ACTION: Verify if expected results were actually achieved. Use your tools to measure/verify.');
      sections.push('If achieved → update task metadata: resultChecked=true. If NOT achieved → create follow-up tasks to address gaps.');
      sections.push('');
    }

    if (sections.length === 0) return null;

    return [
      '=== SCHEDULED REVIEW CYCLE ===',
      'This is your periodic review. Check and act on the items below.',
      'Use agems_tasks to view details, add comments, and update statuses.',
      'Use agems_channels to message team members if needed.',
      '',
      ...sections,
      '=== END REVIEW CYCLE ===',
    ].join('\n');
  }

  /** Check if agent has exceeded daily review budget */
  private async checkReviewBudget(agentId: string): Promise<boolean> {
    try {
      const budgetStr = await this.settings.get('task_review_daily_budget_usd');
      const budget = budgetStr ? parseFloat(budgetStr) : 1.0;
      if (budget <= 0) return true; // No limit

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const result = await this.prisma.agentExecution.aggregate({
        where: {
          agentId,
          triggerType: 'SCHEDULE',
          startedAt: { gte: todayStart },
        },
        _sum: { costUsd: true },
      });

      const spent = result._sum.costUsd || 0;
      return spent < budget;
    } catch {
      return true; // On error, allow execution
    }
  }

  /** Find suitable reviewer agent for a task */
  private async findReviewer(task: any): Promise<{ id: string; name: string } | null> {
    // 1. If creator is an agent and not the executor, use creator
    if (task.creatorType === 'AGENT' && task.creatorId !== task.assigneeId) {
      const creator = await this.prisma.agent.findUnique({
        where: { id: task.creatorId },
        select: { id: true, name: true, status: true },
      });
      if (creator?.status === 'ACTIVE') return creator;
    }

    // 2. Look for QA agent (Olivia or any agent with QA in mission)
    const qaAgent = await this.prisma.agent.findFirst({
      where: {
        status: 'ACTIVE',
        id: { not: task.assigneeId },
        OR: [
          { mission: { contains: 'QA', mode: 'insensitive' } },
          { mission: { contains: 'quality', mode: 'insensitive' } },
          { name: { equals: 'Olivia' } },
        ],
      },
      select: { id: true, name: true },
    });
    if (qaAgent) return qaAgent;

    // 3. No reviewer found — task will stay in IN_REVIEW until manually handled
    return null;
  }

  /** Generic helper: trigger an agent with a prompt in context of a task */
  private async triggerAgentForTask(agentId: string, task: any, prompt: string) {
    if (!(await this.isEnabled())) return;

    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, name: true, status: true, orgId: true },
    });
    if (!agent || agent.status !== 'ACTIVE') return;

    // Check if tasks module is enabled for this agent's org
    if (!(await this.settings.isModuleEnabled('tasks', agent.orgId))) return;

    if (this.runningAgents.has(agentId)) {
      this.logger.debug(`Agent ${agent.name} is busy, skipping task trigger`);
      return;
    }

    this.runningAgents.add(agentId);

    try {
      const channelId = await this.findOrCreateAgentChannel(agentId, agent.name, agent.orgId);

      this.logger.log(`Triggering agent ${agent.name} for task "${task.title}"`);

      const result = await this.runtime.execute(
        agentId,
        prompt,
        { type: 'TASK', id: task.id },
        { channelId, taskId: task.id },
      );

      if (result.text?.trim() && channelId) {
        await this.comms.sendMessage(
          channelId,
          { content: result.text.trim(), contentType: 'TEXT' },
          'AGENT',
          agentId,
        );
      }

      // Add response as task comment
      if (result.text?.trim()) {
        await this.prisma.taskComment.create({
          data: {
            taskId: task.id,
            authorType: 'AGENT',
            authorId: agentId,
            content: result.text.trim().substring(0, 2000),
          },
        });
      }
    } catch (err) {
      this.logger.error(`Task trigger failed for ${agent.name}: ${err}`);
    } finally {
      this.runningAgents.delete(agentId);
    }
  }

  // ══════════════════════════════════════════════════════════
  // EXISTING METHODS
  // ══════════════════════════════════════════════════════════

  /** Execute a single task for an agent */
  private async executeAgentTask(task: any) {
    const agentId = task.assigneeId;

    // Skip if agent is already running a task
    if (this.runningAgents.has(agentId)) {
      this.logger.debug(`Agent ${agentId} is busy, task "${task.title}" stays PENDING`);
      return;
    }

    // Check agent exists and is active
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, name: true, status: true, orgId: true },
    });
    if (!agent || agent.status !== 'ACTIVE') return;

    // Check if tasks module is enabled for this agent's org
    if (!(await this.settings.isModuleEnabled('tasks', agent.orgId))) return;

    this.runningAgents.add(agentId);

    try {
      // Set task to IN_PROGRESS
      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: 'IN_PROGRESS' },
      });

      // Find or create a DM channel for this agent to report in
      const channelId = await this.findOrCreateAgentChannel(agentId, agent.name, agent.orgId);

      // Build task prompt
      const taskPrompt = this.buildTaskPrompt(task);

      this.logger.log(`Executing task "${task.title}" for agent ${agent.name}`);

      const result = await this.runtime.execute(
        agentId,
        taskPrompt,
        { type: 'TASK', id: task.id },
        { channelId, taskId: task.id },
      );

      // Post result to channel
      if (result.text?.trim() && channelId) {
        await this.comms.sendMessage(
          channelId,
          { content: result.text.trim(), contentType: 'TEXT' },
          'AGENT',
          agentId,
        );
      }

      // Add completion comment
      if (result.text?.trim()) {
        await this.prisma.taskComment.create({
          data: {
            taskId: task.id,
            authorType: 'AGENT',
            authorId: agentId,
            content: result.text.trim().substring(0, 2000),
          },
        });
      }

      this.logger.log(`Task "${task.title}" executed by ${agent.name}: ${result.text?.substring(0, 100) || '(no text)'}`);
    } catch (err) {
      this.logger.error(`Task execution failed for "${task.title}": ${err}`);
      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: 'FAILED' },
      }).catch(() => {});
      await this.prisma.taskComment.create({
        data: {
          taskId: task.id,
          authorType: 'SYSTEM',
          authorId: 'system',
          content: `Execution failed: ${String(err).substring(0, 500)}`,
        },
      }).catch(() => {});
    } finally {
      this.runningAgents.delete(agentId);
    }
  }

  /** Pickup PENDING tasks assigned to agents that haven't been executed yet */
  private async pickupPendingAgentTasks() {
    try {
      const pendingTasks = await this.prisma.task.findMany({
        where: {
          assigneeType: 'AGENT',
          status: 'PENDING',
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        take: 10,
      });

      for (const task of pendingTasks) {
        if (!this.runningAgents.has(task.assigneeId)) {
          // Don't await — let tasks run concurrently for different agents
          this.executeAgentTask(task).catch(err =>
            this.logger.error(`Failed to pickup task ${task.id}: ${err}`),
          );
        }
      }
    } catch (err) {
      this.logger.error('Error picking up pending tasks', err);
    }
  }

  /** Check RECURRING tasks with COMPLETED status — reset to PENDING if cron matches */
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

  /** Build a task execution prompt for the agent */
  private buildTaskPrompt(task: any): string {
    const meta = (task.metadata || {}) as any;
    const parts = [
      `=== TASK ASSIGNED TO YOU ===`,
      `Task ID: ${task.id}`,
      `Title: ${task.title}`,
    ];
    if (task.description) parts.push(`Description: ${task.description}`);
    parts.push(`Priority: ${task.priority}`);
    parts.push(`Type: ${task.type}`);
    if (task.deadline) parts.push(`Deadline: ${new Date(task.deadline).toISOString()}`);
    if (task.parentTaskId) parts.push(`Parent Task: ${task.parentTaskId}`);
    if (meta.expectedResult) parts.push(`Expected Result: ${meta.expectedResult}`);
    parts.push(``);
    parts.push(`INSTRUCTIONS:`);
    parts.push(`1. Work on this task using your available tools.`);
    parts.push(`2. Add comments with your progress using agems_tasks action="add_comment".`);
    parts.push(`3. When your work is DONE, set status to IN_REVIEW (NOT COMPLETED).`);
    parts.push(`   A reviewer will verify your work before it can be completed.`);
    parts.push(`4. If you need approval from a human, use the agems_approvals tool to request it.`);
    parts.push(`5. If the task requires other agents, create subtasks using agems_tasks action="create".`);
    parts.push(`6. If the task is blocked, set status to BLOCKED with a comment explaining why.`);
    parts.push(`7. Use agems_channels to notify relevant team members about your progress.`);
    parts.push(`=== END TASK ===`);
    return parts.join('\n');
  }

  /** Find or create a broadcast channel for agent task output */
  private async findOrCreateAgentChannel(agentId: string, agentName: string, orgId: string): Promise<string> {
    // Look for existing agent task channel
    const existing = await this.prisma.channel.findFirst({
      where: {
        type: 'DIRECT',
        orgId,
        participants: {
          some: { participantType: 'AGENT', participantId: agentId },
        },
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    // Create a new channel for agent
    const channel = await this.prisma.channel.create({
      data: {
        orgId,
        name: `${agentName} Tasks`,
        type: 'DIRECT',
        participants: {
          create: { participantType: 'AGENT', participantId: agentId },
        },
      },
    });
    return channel.id;
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

  private fieldMatches(expr: string, value: number, min: number, max: number): boolean {
    if (expr === '*') return true;

    // Handle */N (step)
    if (expr.startsWith('*/')) {
      const step = parseInt(expr.slice(2));
      return !isNaN(step) && step > 0 && value % step === 0;
    }

    // Handle comma-separated values
    const parts = expr.split(',');
    for (const part of parts) {
      // Handle ranges (e.g., 1-5)
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
