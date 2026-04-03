import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { AGEMS_DEFAULT_PREAMBLE } from '../settings/agems-defaults';

const GEMMA_SYSTEM_PROMPT = `You are Gemma — the AGEMS Platform Administrator.
You manage the AGEMS platform itself (the system where agents run), NOT the business work of other agents.

## Your role
- Manage the AGEMS platform: agent configuration, tools, skills, system settings
- Help human admins configure agents, debug platform issues, manage system settings
- Answer questions about how the AGEMS platform works
- You have access to ALL tools in the system for platform administration purposes

## What you DO:
- Fix platform issues ONLY when a human admin asks you to
- Help onboard new agents (create, configure, assign tools/skills)
- Answer "how does AGEMS work?" questions from humans and agents
- Database queries for platform diagnostics ONLY when asked by humans

## What you DO NOT DO:
- You do NOT monitor other agents' activities, API calls, or errors
- You do NOT tell other agents to stop, pause, or slow down
- You do NOT review, judge, or comment on other agents' work quality
- You are NOT a supervisor, manager, monitor, or watchdog

## Communication style
- Be concise and action-oriented
- When asked for data, query the database directly and present results clearly
- Match the language of the user`;

@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureMetaAgentLegacy();
    await this.ensureAllPositions();
  }

  /** Bootstrap a new organization: create Gemma, default settings, direct channels */
  async bootstrapOrg(orgId: string, ownerId: string) {
    // Check if org already has a META agent
    const existingMeta = await this.prisma.agent.findFirst({
      where: { orgId, type: 'META' },
    });
    if (existingMeta) {
      this.logger.log(`Org ${orgId} already has META agent "${existingMeta.name}"`);
      return existingMeta;
    }

    // Create Gemma
    const slug = `gemma-meta-${orgId.slice(0, 8)}`;
    const agent = await this.prisma.agent.create({
      data: {
        orgId,
        name: 'Gemma',
        slug,
        avatar: '/avatars/gemma.png',
        type: 'META',
        status: 'ACTIVE',
        llmProvider: 'GOOGLE',
        llmModel: 'gemini-3.1-pro-preview',
        llmConfig: { temperature: 0.7, maxTokens: 8192 },
        systemPrompt: GEMMA_SYSTEM_PROMPT,
        mission: 'AGEMS Platform Administrator — manages platform configuration, tools, and system settings.',
        values: ['efficiency', 'accuracy', 'helpfulness'],
        runtimeConfig: {
          mode: 'CLAUDE_CODE',
          maxIterations: 50,
          timeoutMs: 120000,
          agemsApiAccess: true,
          agemsPermissions: [
            'agents.read', 'agents.write', 'agents.create',
            'tasks.read', 'tasks.write', 'tasks.create',
            'meetings.read', 'meetings.write', 'meetings.create',
            'comms.read', 'comms.write',
            'tools.read', 'tools.write',
            'org.read', 'org.write',
          ],
        },
        ownerId,
        metadata: { isSystemAgent: true, bootstrapped: true },
      },
    });
    this.logger.log(`META agent "Gemma" created for org ${orgId} (${agent.id})`);

    // Assign all org tools and skills
    await this.assignAllToolsAndSkills(agent.id, orgId);

    // Create org position
    await this.ensurePosition(agent.id, orgId);

    // Create direct channels with all org members
    await this.ensureDirectChannels(agent.id, orgId);

    // Seed default preamble setting
    const existingPreamble = await this.prisma.setting.findFirst({
      where: { orgId, key: 'agems_preamble' },
    });
    if (!existingPreamble) {
      await this.prisma.setting.create({
        data: { orgId, key: 'agems_preamble', value: AGEMS_DEFAULT_PREAMBLE },
      });
      this.logger.log(`Default preamble seeded for org ${orgId}`);
    }

    return agent;
  }

  /** Legacy bootstrap for first org (backward compat) */
  private async ensureMetaAgentLegacy() {
    // Check if any META agent already exists
    const existing = await this.prisma.agent.findFirst({
      where: { type: 'META' },
    });
    if (existing) {
      this.logger.log(`META agent "${existing.name}" already exists (${existing.id})`);
      await this.assignAllToolsAndSkills(existing.id, existing.orgId);
      await this.ensurePosition(existing.id);
      return;
    }

    // Find owner (first ADMIN user with an org membership)
    const admin = await this.prisma.user.findFirst({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
      include: { memberships: { take: 1 } },
    });
    if (!admin) {
      this.logger.warn('No ADMIN user found — skipping META agent bootstrap.');
      return;
    }
    const orgId = admin.memberships[0]?.orgId;
    if (!orgId) {
      this.logger.warn('No organization found for ADMIN — skipping META agent bootstrap.');
      return;
    }

    await this.bootstrapOrg(orgId, admin.id);
  }

  private async assignAllToolsAndSkills(agentId: string, orgId?: string) {
    // Assign ALL tools (org-scoped if orgId provided)
    const tools = await this.prisma.tool.findMany({
      where: orgId ? { orgId } : undefined,
      select: { id: true },
    });
    for (const tool of tools) {
      await this.prisma.agentTool.upsert({
        where: { agentId_toolId: { agentId, toolId: tool.id } },
        create: {
          agentId,
          toolId: tool.id,
          permissions: { read: true, write: true, execute: true },
          enabled: true,
        },
        update: {
          permissions: { read: true, write: true, execute: true },
          enabled: true,
        },
      });
    }

    // Assign ALL skills (org-scoped or global)
    const skills = await this.prisma.skill.findMany({
      where: orgId ? { OR: [{ orgId }, { orgId: null }] } : undefined,
      select: { id: true },
    });
    for (const skill of skills) {
      await this.prisma.agentSkill.upsert({
        where: { agentId_skillId: { agentId, skillId: skill.id } },
        create: { agentId, skillId: skill.id, enabled: true },
        update: { enabled: true },
      });
    }

    this.logger.log(`Gemma: ${tools.length} tools, ${skills.length} skills assigned`);
  }

  private async ensurePosition(agentId: string, orgId?: string) {
    const existing = await this.prisma.orgPosition.findFirst({
      where: { agentId },
    });
    if (existing) return;

    // Find CEO position to set as parent
    const ceoPosition = await this.prisma.orgPosition.findFirst({
      where: { title: 'CEO' },
    });

    await this.prisma.orgPosition.create({
      data: {
        orgId: orgId!,
        title: 'AGEMS Platform Administrator',
        department: 'Operations',
        holderType: 'AGENT',
        agentId,
        parentId: ceoPosition?.id ?? null,
      },
    });
    this.logger.log('Gemma: OrgPosition "AGEMS Platform Administrator" created');
  }

  private async ensureDirectChannels(agentId: string, orgId?: string) {
    // Only create channels for members of this org
    const members = orgId
      ? await this.prisma.orgMember.findMany({ where: { orgId }, select: { userId: true } })
      : await this.prisma.user.findMany({ select: { id: true } }).then(u => u.map(x => ({ userId: x.id })));
    const users = members.map(m => ({ id: m.userId }));
    for (const user of users) {
      // Check if direct channel already exists
      const existing = await this.prisma.channel.findFirst({
        where: {
          type: 'DIRECT',
          participants: {
            every: {
              OR: [
                { participantType: 'AGENT', participantId: agentId },
                { participantType: 'HUMAN', participantId: user.id },
              ],
            },
          },
        },
        include: { participants: true },
      });
      if (existing && existing.participants.length === 2) continue;

      const channel = await this.prisma.channel.create({
        data: {
          orgId: orgId!,
          type: 'DIRECT',
          participants: {
            create: [
              { participantType: 'AGENT', participantId: agentId, role: 'MEMBER' },
              { participantType: 'HUMAN', participantId: user.id, role: 'MEMBER' },
            ],
          },
        },
      });
      this.logger.log(`Gemma: Direct channel created with user ${user.id} -> ${channel.id}`);
    }
  }

  /** Ensure all existing agents and org members have OrgPositions */
  private async ensureAllPositions() {
    const orgs = await this.prisma.organization.findMany({ select: { id: true } });

    for (const org of orgs) {
      const orgId = org.id;

      // 1. Ensure all org members have positions
      const members = await this.prisma.orgMember.findMany({
        where: { orgId },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { joinedAt: 'asc' },
      });

      // First member (earliest joined) is the root — find or create their position first
      let rootPositionId: string | null = null;

      for (const member of members) {
        const existing = await this.prisma.orgPosition.findFirst({
          where: { orgId, userId: member.userId },
        });
        if (existing) {
          if (!rootPositionId) rootPositionId = existing.id;
          continue;
        }

        const pos = await this.prisma.orgPosition.create({
          data: {
            orgId,
            title: member.user.name,
            holderType: 'HUMAN',
            userId: member.userId,
            parentId: rootPositionId, // first member has no parent, rest go under first
          },
        });
        if (!rootPositionId) rootPositionId = pos.id;
        this.logger.log(`Auto-created position for user "${member.user.name}" in org ${orgId}`);
      }

      // 2. Ensure all agents have positions
      const agents = await this.prisma.agent.findMany({
        where: { orgId },
        select: { id: true, name: true, ownerId: true, parentAgentId: true },
        orderBy: { createdAt: 'asc' },
      });

      for (const agent of agents) {
        const existing = await this.prisma.orgPosition.findFirst({
          where: { agentId: agent.id },
        });
        if (existing) continue;

        // Determine parent: prefer parent agent's position, then owner's position, then root
        let parentId: string | null = null;
        if (agent.parentAgentId) {
          const parentPos = await this.prisma.orgPosition.findFirst({
            where: { agentId: agent.parentAgentId },
          });
          parentId = parentPos?.id ?? null;
        }
        if (!parentId && agent.ownerId) {
          const ownerPos = await this.prisma.orgPosition.findFirst({
            where: { orgId, userId: agent.ownerId },
          });
          parentId = ownerPos?.id ?? null;
        }
        if (!parentId) {
          parentId = rootPositionId;
        }

        await this.prisma.orgPosition.create({
          data: {
            orgId,
            title: agent.name,
            holderType: 'AGENT',
            agentId: agent.id,
            parentId,
          },
        });
        this.logger.log(`Auto-created position for agent "${agent.name}" in org ${orgId}`);
      }
    }

    this.logger.log('ensureAllPositions complete');
  }
}
