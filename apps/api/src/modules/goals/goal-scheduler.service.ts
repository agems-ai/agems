import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import { RuntimeService } from '../runtime/runtime.service';
import { CommsService } from '../comms/comms.service';
import { SettingsService, ModuleConfig } from '../settings/settings.service';

@Injectable()
export class GoalSchedulerService {
  private readonly logger = new Logger(GoalSchedulerService.name);
  private readonly runningAgents = new Set<string>();

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => RuntimeService))
    private runtime: RuntimeService,
    @Inject(forwardRef(() => CommsService))
    private comms: CommsService,
    private settings: SettingsService,
  ) {}

  /** When a new goal is created, auto-trigger an agent based on module settings */
  @OnEvent('goal.created')
  async onGoalCreated(goal: any) {
    // Small delay to let the transaction complete
    setTimeout(() => this.handleGoalCreated(goal).catch(err =>
      this.logger.error(`Failed to handle goal.created: ${err}`),
    ), 3000);
  }

  private async handleGoalCreated(goal: any) {
    // 1. Check if goals module is enabled for this org
    if (!(await this.settings.isModuleEnabled('goals', goal.orgId))) return;

    // 2. Get goals module config
    const config = await this.settings.getAllModulesConfig(goal.orgId);
    const goalsConfig = config.modules.goals;

    // 3. Activity level 1 (Passive) = never auto-trigger
    if (goalsConfig.activityLevel <= 1) return;

    // 4. Find which agent should handle this goal
    let agentId = goal.agentId;

    if (!agentId) {
      // Activity level 2 (Reactive) = only trigger if explicitly assigned
      if (goalsConfig.activityLevel <= 2) return;

      // Activity 3+ = find first available active agent in the org
      const agent = await this.prisma.agent.findFirst({
        where: { orgId: goal.orgId, status: 'ACTIVE' },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!agent) {
        this.logger.debug(`No active agents in org ${goal.orgId} for goal "${goal.title}"`);
        return;
      }
      agentId = agent.id;

      // Assign agent to the goal and set status to ACTIVE
      await this.prisma.goal.update({
        where: { id: goal.id },
        data: { agentId, status: 'ACTIVE' },
      });
    }

    // 5. Execute agent with goal prompt
    await this.executeGoalAgent(agentId, goal, goalsConfig);
  }

  private async executeGoalAgent(agentId: string, goal: any, goalsConfig: ModuleConfig) {
    if (this.runningAgents.has(agentId)) {
      this.logger.debug(`Agent ${agentId} is busy, skipping goal trigger`);
      return;
    }

    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, name: true, status: true, orgId: true },
    });
    if (!agent || agent.status !== 'ACTIVE') return;

    this.runningAgents.add(agentId);

    try {
      const channelId = await this.findOrCreateAgentChannel(agentId, agent.name, agent.orgId);
      const prompt = this.buildGoalPrompt(goal, goalsConfig);

      this.logger.log(`Triggering agent ${agent.name} for goal "${goal.title}" (autonomy: ${goalsConfig.autonomyLevel}, activity: ${goalsConfig.activityLevel})`);

      const result = await this.runtime.execute(
        agentId,
        prompt,
        { type: 'EVENT', id: goal.id },
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
      this.logger.error(`Goal execution failed for agent ${agent.name}: ${err}`);
    } finally {
      this.runningAgents.delete(agentId);
    }
  }

  /** Build goal prompt — instructions vary by autonomy level */
  private buildGoalPrompt(goal: any, goalsConfig: ModuleConfig): string {
    const parts = [
      `=== NEW GOAL ASSIGNED TO YOU ===`,
      `Goal ID: ${goal.id}`,
      `Title: ${goal.title}`,
    ];
    if (goal.description) parts.push(`Description: ${goal.description}`);
    parts.push(`Priority: ${goal.priority}`);
    parts.push(`Status: ${goal.status}`);
    if (goal.targetDate) parts.push(`Target Date: ${new Date(goal.targetDate).toISOString()}`);
    parts.push('');

    const autonomy = goalsConfig.autonomyLevel;

    if (autonomy <= 2) {
      // Solo / Lean — do it yourself
      parts.push(`INSTRUCTIONS:`);
      parts.push(`1. Analyze this goal and break it into concrete, actionable tasks.`);
      parts.push(`2. Create tasks for yourself using agems_tasks action="create" with assigneeType="AGENT" and your own ID as assigneeId.`);
      parts.push(`3. Set expectedResult on each task so progress can be tracked.`);
      parts.push(`4. Start working on the highest priority task immediately.`);
      parts.push(`5. As you complete tasks, update goal progress.`);
    } else if (autonomy === 3) {
      // Balanced — assess and decide
      parts.push(`INSTRUCTIONS:`);
      parts.push(`1. Analyze this goal's complexity and what expertise it requires.`);
      parts.push(`2. Use agems_tasks action="get_team" to see available agents and humans.`);
      parts.push(`3. If this is a simple goal within your expertise — create tasks for yourself and execute.`);
      parts.push(`4. If this goal requires multiple disciplines (design, code, copy, analytics, etc.):`);
      parts.push(`   a. Create a parent task for yourself as coordinator.`);
      parts.push(`   b. Create subtasks assigned to the appropriate specialists.`);
      parts.push(`   c. Message each assignee in their channel explaining the goal and their part.`);
      parts.push(`5. If the team lacks needed specialists — report what roles are missing in your channel.`);
      parts.push(`6. Track progress and update the goal status as work completes.`);
    } else {
      // Team-first / Full collaboration — MUST delegate
      parts.push(`INSTRUCTIONS (TEAM MODE — you are the COORDINATOR, not the executor):`);
      parts.push(`1. FIRST: Use agems_tasks action="get_team" to see ALL available agents and humans.`);
      parts.push(`2. Analyze what expertise this goal requires (development, design, copywriting, SEO, analytics, QA, etc.).`);
      parts.push(`3. If the team lacks needed specialists — clearly state what roles are missing in your channel.`);
      parts.push(`4. Create a PARENT task for yourself as coordinator/owner of this goal.`);
      parts.push(`5. Break the goal into SUBTASKS by specialty and assign each to the best team member:`);
      parts.push(`   - Copy/text tasks → copywriter or content specialist`);
      parts.push(`   - Design/UX tasks → designer`);
      parts.push(`   - Code/technical tasks → developer`);
      parts.push(`   - Analytics/data tasks → analyst`);
      parts.push(`   - QA/review tasks → QA specialist`);
      parts.push(`6. Use agems_channels to message EACH assignee with:`);
      parts.push(`   - The goal context (what we're trying to achieve)`);
      parts.push(`   - Their specific subtask and expected deliverables`);
      parts.push(`   - Timeline and priority`);
      parts.push(`7. Do NOT do the specialist work yourself — your job is to coordinate and track.`);
      parts.push(`8. Monitor subtask completion and update goal progress accordingly.`);
    }

    parts.push('');
    parts.push(`=== END GOAL ===`);
    return parts.join('\n');
  }

  /** Find or create a channel for agent to report goal progress */
  private async findOrCreateAgentChannel(agentId: string, agentName: string, orgId: string): Promise<string> {
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
}
