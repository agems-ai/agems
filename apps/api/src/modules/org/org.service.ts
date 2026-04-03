import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { BootstrapService } from '../bootstrap/bootstrap.service';

@Injectable()
export class OrgService {
  private readonly logger = new Logger(OrgService.name);

  constructor(
    private prisma: PrismaService,
    private bootstrap: BootstrapService,
  ) {}

  // ── Organization Management ──

  async getOrganization(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        _count: { select: { agents: true, tools: true, channels: true, tasks: true } },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async updateOrganization(orgId: string, input: { name?: string; slug?: string; metadata?: any }) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');
    return this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.slug && { slug: input.slug }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
      },
    });
  }

  async getMembers(orgId: string) {
    return this.prisma.orgMember.findMany({
      where: { orgId },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, createdAt: true } } },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async inviteMember(orgId: string, email: string, role: string = 'MEMBER', inviterId?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('User not found. They need to register first.');

    const existing = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: user.id } },
    });
    if (existing) throw new ConflictException('User is already a member');

    const member = await this.prisma.orgMember.create({
      data: { orgId, userId: user.id, role: role as any },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    });

    // Auto-create OrgPosition under inviter's position
    const existingPosition = await this.prisma.orgPosition.findFirst({
      where: { orgId, userId: user.id },
    });
    if (!existingPosition) {
      const inviterPosition = inviterId
        ? await this.prisma.orgPosition.findFirst({ where: { orgId, userId: inviterId } })
        : null;
      await this.prisma.orgPosition.create({
        data: {
          orgId,
          title: user.name,
          holderType: 'HUMAN',
          userId: user.id,
          parentId: inviterPosition?.id ?? null,
        },
      });
    }

    return member;
  }

  async updateMemberRole(orgId: string, userId: string, role: string) {
    const member = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!member) throw new NotFoundException('Member not found');
    return this.prisma.orgMember.update({
      where: { id: member.id },
      data: { role: role as any },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  async removeMember(orgId: string, userId: string) {
    const member = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!member) throw new NotFoundException('Member not found');

    // Remove associated OrgPosition(s) for this user
    await this.prisma.orgPosition.deleteMany({
      where: { orgId, userId },
    });

    return this.prisma.orgMember.delete({ where: { id: member.id } });
  }

  // ── Create & Clone Organization ──

  async createOrg(
    userId: string,
    name: string,
    cloneFromOrgId?: string,
    cloneEntities?: string[],
  ) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const org = await this.prisma.organization.create({
      data: {
        name,
        slug: `${slug}-${Date.now().toString(36)}`,
        plan: 'FREE',
      },
    });

    // Add creator as ADMIN
    await this.prisma.orgMember.create({
      data: { orgId: org.id, userId, role: 'ADMIN' },
    });

    // Auto-create root OrgPosition for the creator
    const creator = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await this.prisma.orgPosition.create({
      data: {
        orgId: org.id,
        title: creator?.name ?? 'CEO',
        holderType: 'HUMAN',
        userId,
      },
    });

    // Clone entities from source org if requested
    if (cloneFromOrgId && cloneEntities?.length) {
      await this.cloneEntities(cloneFromOrgId, org.id, userId, cloneEntities);
    }

    // Bootstrap Gemma for the new org
    await this.bootstrap.bootstrapOrg(org.id, userId);

    return org;
  }

  private async cloneEntities(fromOrgId: string, toOrgId: string, userId: string, entities: string[]) {
    const idMap = new Map<string, string>(); // old ID -> new ID

    // Clone tools (before settings, so idMap has tool IDs for widget remapping)
    if (entities.includes('tools')) {
      const tools = await this.prisma.tool.findMany({ where: { orgId: fromOrgId } });
      for (const t of tools) {
        const newTool = await this.prisma.tool.create({
          data: {
            orgId: toOrgId, name: t.name, type: t.type,
            config: t.config as any,
            authType: t.authType,
            authConfig: t.authConfig as any,
          },
        });
        idMap.set(t.id, newTool.id);
      }
      this.logger.log(`Cloned ${tools.length} tools`);
    }

    // Clone settings (after tools, so dashboard_widgets can remap tool IDs)
    if (entities.includes('settings')) {
      const settings = await this.prisma.setting.findMany({ where: { orgId: fromOrgId } });
      for (const s of settings) {
        let value = s.value;
        // Remap tool IDs inside dashboard_widgets code
        if (s.key === 'dashboard_widgets' && idMap.size > 0) {
          for (const [oldId, newId] of idMap.entries()) {
            value = value.split(oldId).join(newId);
          }
        }
        await this.prisma.setting.create({
          data: { orgId: toOrgId, key: s.key, value },
        });
      }
      this.logger.log(`Cloned ${settings.length} settings`);
    }

    // Clone skills
    if (entities.includes('skills')) {
      const skills = await this.prisma.skill.findMany({ where: { orgId: fromOrgId } });
      for (const s of skills) {
        const newSkill = await this.prisma.skill.create({
          data: {
            orgId: toOrgId, name: s.name, slug: `${s.slug}-${Date.now().toString(36)}`,
            description: s.description, content: s.content,
            version: s.version, type: s.type, entryPoint: s.entryPoint,
            configSchema: s.configSchema as any,
          },
        });
        idMap.set(s.id, newSkill.id);
      }
      this.logger.log(`Cloned ${skills.length} skills`);
    }

    // Clone agents (with tool/skill assignments)
    if (entities.includes('agents')) {
      const agents = await this.prisma.agent.findMany({
        where: { orgId: fromOrgId },
        include: { tools: true, skills: true },
      });
      for (const a of agents) {
        const newAgent = await this.prisma.agent.create({
          data: {
            orgId: toOrgId, name: a.name, slug: `${a.slug}-${Date.now().toString(36)}`,
            avatar: a.avatar, type: a.type, status: a.status,
            llmProvider: a.llmProvider, llmModel: a.llmModel,
            llmConfig: a.llmConfig as any, systemPrompt: a.systemPrompt,
            mission: a.mission, values: a.values as any,
            runtimeConfig: a.runtimeConfig as any, ownerId: userId,
            metadata: a.metadata as any,
          },
        });
        idMap.set(a.id, newAgent.id);

        // Assign cloned tools
        for (const at of a.tools) {
          const newToolId = idMap.get(at.toolId);
          if (newToolId) {
            await this.prisma.agentTool.create({
              data: { agentId: newAgent.id, toolId: newToolId, permissions: at.permissions as any, enabled: at.enabled },
            });
          }
        }
        // Assign cloned skills
        for (const as_ of a.skills) {
          const newSkillId = idMap.get(as_.skillId);
          if (newSkillId) {
            await this.prisma.agentSkill.create({
              data: { agentId: newAgent.id, skillId: newSkillId, enabled: as_.enabled },
            });
          }
        }
      }
      this.logger.log(`Cloned ${agents.length} agents`);
    }

    // Clone employees (org members)
    if (entities.includes('employees')) {
      const members = await this.prisma.orgMember.findMany({ where: { orgId: fromOrgId } });
      for (const m of members) {
        if (m.userId === userId) continue; // Already added as ADMIN
        const exists = await this.prisma.orgMember.findUnique({
          where: { orgId_userId: { orgId: toOrgId, userId: m.userId } },
        });
        if (!exists) {
          await this.prisma.orgMember.create({
            data: { orgId: toOrgId, userId: m.userId, role: m.role },
          });
        }
      }
      this.logger.log(`Cloned ${members.length} members`);
    }

    // Clone channels (with participants)
    if (entities.includes('channels')) {
      const channels = await this.prisma.channel.findMany({
        where: { orgId: fromOrgId },
        include: { participants: true },
      });
      for (const ch of channels) {
        const newChannel = await this.prisma.channel.create({
          data: {
            orgId: toOrgId, name: ch.name, type: ch.type,
            metadata: ch.metadata as any,
          },
        });
        idMap.set(ch.id, newChannel.id);
        for (const p of ch.participants) {
          const mappedId = p.participantType === 'AGENT' ? (idMap.get(p.participantId) || p.participantId) : p.participantId;
          await this.prisma.channelParticipant.create({
            data: {
              channelId: newChannel.id,
              participantType: p.participantType,
              participantId: mappedId,
              role: p.role,
            },
          });
        }
      }
      this.logger.log(`Cloned ${channels.length} channels`);
    }

    // Clone messages
    if (entities.includes('messages')) {
      const channels = await this.prisma.channel.findMany({ where: { orgId: fromOrgId }, select: { id: true } });
      let msgCount = 0;
      for (const ch of channels) {
        const newChannelId = idMap.get(ch.id);
        if (!newChannelId) continue;
        const messages = await this.prisma.message.findMany({
          where: { channelId: ch.id },
          orderBy: { createdAt: 'asc' },
        });
        for (const m of messages) {
          const senderId = m.senderType === 'AGENT' ? (idMap.get(m.senderId) || m.senderId) : m.senderId;
          await this.prisma.message.create({
            data: {
              channelId: newChannelId, senderType: m.senderType, senderId,
              content: m.content, contentType: m.contentType,
              metadata: m.metadata as any, createdAt: m.createdAt,
            },
          });
          msgCount++;
        }
      }
      this.logger.log(`Cloned ${msgCount} messages`);
    }

    // Clone tasks (with comments, preserving parent-child)
    if (entities.includes('tasks')) {
      const tasks = await this.prisma.task.findMany({
        where: { orgId: fromOrgId },
        include: { comments: true },
        orderBy: { createdAt: 'asc' },
      });
      // First pass: create all tasks without parents
      for (const t of tasks) {
        const assigneeId = t.assigneeType === 'AGENT' ? (idMap.get(t.assigneeId) || t.assigneeId) : t.assigneeId;
        const creatorId = t.creatorType === 'AGENT' ? (idMap.get(t.creatorId) || t.creatorId) : t.creatorId;
        const newTask = await this.prisma.task.create({
          data: {
            orgId: toOrgId, title: t.title, description: t.description,
            status: t.status, priority: t.priority, type: t.type,
            cronExpression: t.cronExpression,
            creatorType: t.creatorType, creatorId,
            assigneeType: t.assigneeType, assigneeId,
            result: t.result as any, deadline: t.deadline,
            completedAt: t.completedAt, metadata: t.metadata as any,
          },
        });
        idMap.set(t.id, newTask.id);
        // Clone comments
        for (const c of t.comments) {
          const authorId = c.authorType === 'AGENT' ? (idMap.get(c.authorId) || c.authorId) : c.authorId;
          await this.prisma.taskComment.create({
            data: {
              taskId: newTask.id, authorType: c.authorType, authorId,
              content: c.content, metadata: c.metadata as any,
            },
          });
        }
      }
      // Second pass: set parent tasks
      for (const t of tasks) {
        if (t.parentTaskId && idMap.has(t.parentTaskId)) {
          await this.prisma.task.update({
            where: { id: idMap.get(t.id)! },
            data: { parentTaskId: idMap.get(t.parentTaskId) },
          });
        }
      }
      this.logger.log(`Cloned ${tasks.length} tasks`);
    }

    // Clone meetings (with participants, entries, decisions, task links)
    if (entities.includes('meetings')) {
      const meetings = await this.prisma.meeting.findMany({
        where: { orgId: fromOrgId },
        include: { participants: true, entries: true, decisions: true, tasks: true },
      });
      for (const m of meetings) {
        const creatorId = m.creatorType === 'AGENT' ? (idMap.get(m.creatorId) || m.creatorId) : m.creatorId;
        const newMeeting = await this.prisma.meeting.create({
          data: {
            orgId: toOrgId, title: m.title, agenda: m.agenda,
            status: m.status, scheduledAt: m.scheduledAt,
            startedAt: m.startedAt, endedAt: m.endedAt,
            creatorType: m.creatorType, creatorId,
            summary: m.summary,
          },
        });
        for (const p of m.participants) {
          const pid = p.participantType === 'AGENT' ? (idMap.get(p.participantId) || p.participantId) : p.participantId;
          await this.prisma.meetingParticipant.create({
            data: { meetingId: newMeeting.id, participantType: p.participantType, participantId: pid, role: p.role },
          });
        }
        for (const e of m.entries) {
          const speakerId = e.speakerType === 'AGENT' ? (idMap.get(e.speakerId) || e.speakerId) : e.speakerId;
          await this.prisma.meetingEntry.create({
            data: { meetingId: newMeeting.id, speakerType: e.speakerType, speakerId, content: e.content, entryType: e.entryType, order: e.order },
          });
        }
        for (const d of m.decisions) {
          await this.prisma.meetingDecision.create({
            data: { meetingId: newMeeting.id, description: d.description, votesFor: d.votesFor, votesAgainst: d.votesAgainst, votesAbstain: d.votesAbstain, result: d.result },
          });
        }
        for (const mt of m.tasks) {
          const newTaskId = idMap.get(mt.taskId);
          if (newTaskId) {
            await this.prisma.meetingTask.create({ data: { meetingId: newMeeting.id, taskId: newTaskId } });
          }
        }
      }
      this.logger.log(`Cloned ${meetings.length} meetings`);
    }

    // Clone approval policies
    if (entities.includes('approvals')) {
      const policies = await this.prisma.approvalPolicy.findMany({
        where: { agent: { orgId: fromOrgId } },
      });
      for (const p of policies) {
        const newAgentId = idMap.get(p.agentId);
        if (!newAgentId) continue;
        await this.prisma.approvalPolicy.create({
          data: {
            agentId: newAgentId, preset: p.preset,
            readMode: p.readMode, writeMode: p.writeMode, deleteMode: p.deleteMode,
            executeMode: p.executeMode, sendMode: p.sendMode, adminMode: p.adminMode,
            toolOverrides: p.toolOverrides as any,
            approverType: p.approverType, approverId: p.approverId,
            autoApproveAfterMin: p.autoApproveAfterMin,
            autoApproveLowRisk: p.autoApproveLowRisk,
            costThresholdUsd: p.costThresholdUsd,
          },
        });
      }
      this.logger.log(`Cloned ${policies.length} approval policies`);
    }

    // Clone files & folders
    if (entities.includes('files')) {
      const folders = await this.prisma.folder.findMany({ where: { orgId: fromOrgId } });
      // First pass: create without parents
      for (const f of folders) {
        const newFolder = await this.prisma.folder.create({
          data: { orgId: toOrgId, name: f.name, isSystem: f.isSystem },
        });
        idMap.set(f.id, newFolder.id);
      }
      // Second pass: set parents
      for (const f of folders) {
        if (f.parentId && idMap.has(f.parentId)) {
          await this.prisma.folder.update({
            where: { id: idMap.get(f.id)! },
            data: { parentId: idMap.get(f.parentId) },
          });
        }
      }
      // Clone file records (metadata only — actual files are shared)
      const files = await this.prisma.fileRecord.findMany({ where: { orgId: fromOrgId } });
      for (const f of files) {
        await this.prisma.fileRecord.create({
          data: {
            orgId: toOrgId,
            folderId: f.folderId ? idMap.get(f.folderId) : null,
            filename: `${Date.now().toString(36)}-${f.originalName.replace(/[^a-zA-Z0-9.-]/g, '_')}`,
            originalName: f.originalName, mimetype: f.mimetype,
            size: f.size, url: f.url,
            uploadedBy: f.uploadedBy,
            uploaderId: f.uploadedBy === 'AGENT' ? (idMap.get(f.uploaderId || '') || f.uploaderId) : f.uploaderId,
            metadata: f.metadata as any,
          },
        });
      }
      this.logger.log(`Cloned ${folders.length} folders, ${files.length} files`);
    }

    // Clone agent executions
    if (entities.includes('executions')) {
      const agents = await this.prisma.agent.findMany({ where: { orgId: fromOrgId }, select: { id: true } });
      let execCount = 0;
      for (const a of agents) {
        const newAgentId = idMap.get(a.id);
        if (!newAgentId) continue;
        const executions = await this.prisma.agentExecution.findMany({
          where: { agentId: a.id },
          orderBy: { startedAt: 'asc' },
        });
        for (const e of executions) {
          await this.prisma.agentExecution.create({
            data: {
              agentId: newAgentId, status: e.status,
              triggerType: e.triggerType, triggerId: e.triggerId,
              input: e.input as any, output: e.output as any,
              toolCalls: e.toolCalls as any,
              tokensUsed: e.tokensUsed, costUsd: e.costUsd,
              error: e.error, startedAt: e.startedAt, endedAt: e.endedAt,
            },
          });
          execCount++;
        }
      }
      this.logger.log(`Cloned ${execCount} agent executions`);
    }

    // Clone org positions
    if (entities.includes('company')) {
      const positions = await this.prisma.orgPosition.findMany({ where: { orgId: fromOrgId } });
      // First pass: create without parent
      for (const p of positions) {
        const newPos = await this.prisma.orgPosition.create({
          data: {
            orgId: toOrgId, title: p.title, department: p.department,
            holderType: p.holderType,
            agentId: p.agentId ? idMap.get(p.agentId) : null,
            userId: p.userId,
          },
        });
        idMap.set(p.id, newPos.id);
      }
      // Second pass: set parents
      for (const p of positions) {
        if (p.parentId && idMap.has(p.parentId)) {
          await this.prisma.orgPosition.update({
            where: { id: idMap.get(p.id)! },
            data: { parentId: idMap.get(p.parentId) },
          });
        }
      }
      this.logger.log(`Cloned ${positions.length} positions`);
    }
  }

  // ── Positions ──

  async createPosition(input: any) {
    return this.prisma.orgPosition.create({
      data: {
        orgId: input.orgId,
        title: input.title,
        department: input.department,
        parentId: input.parentId,
        holderType: input.holderType ?? 'HUMAN',
        agentId: input.agentId,
        userId: input.userId,
      },
      include: { agent: { select: { id: true, name: true, avatar: true } }, user: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  async findAllPositions(orgId?: string) {
    return this.prisma.orgPosition.findMany({
      where: { ...(orgId && { orgId }) },
      include: {
        agent: { select: { id: true, name: true, avatar: true, status: true } },
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
        children: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getTree(orgId?: string) {
    const positions = await this.prisma.orgPosition.findMany({
      where: { ...(orgId && { orgId }) },
      include: {
        agent: { select: { id: true, name: true, avatar: true, status: true } },
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    const map = new Map<string, any>();
    const roots: any[] = [];

    for (const pos of positions) {
      map.set(pos.id, { ...pos, children: [] });
    }

    for (const pos of positions) {
      const node = map.get(pos.id);
      if (pos.parentId && map.has(pos.parentId)) {
        map.get(pos.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async updatePosition(id: string, input: any, orgId?: string) {
    const pos = await this.prisma.orgPosition.findUnique({ where: { id } });
    if (!pos) throw new NotFoundException('Position not found');
    if (orgId && pos.orgId !== orgId) throw new NotFoundException('Position not found');
    return this.prisma.orgPosition.update({
      where: { id },
      data: {
        ...(input.title && { title: input.title }),
        ...(input.department !== undefined && { department: input.department }),
        ...(input.parentId !== undefined && { parentId: input.parentId }),
      },
      include: { agent: { select: { id: true, name: true } }, user: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  async deletePosition(id: string, orgId?: string) {
    const pos = await this.prisma.orgPosition.findUnique({ where: { id } });
    if (!pos) throw new NotFoundException('Position not found');
    if (orgId && pos.orgId !== orgId) throw new NotFoundException('Position not found');
    return this.prisma.orgPosition.delete({ where: { id } });
  }

  async assignHolder(positionId: string, holderType: string, agentId?: string, userId?: string, orgId?: string) {
    const pos = await this.prisma.orgPosition.findUnique({ where: { id: positionId } });
    if (!pos) throw new NotFoundException('Position not found');
    if (orgId && pos.orgId !== orgId) throw new NotFoundException('Position not found');
    return this.prisma.orgPosition.update({
      where: { id: positionId },
      data: {
        holderType: holderType as any,
        agentId: holderType === 'HUMAN' ? null : agentId,
        userId: holderType === 'AGENT' ? null : userId,
      },
      include: { agent: { select: { id: true, name: true } }, user: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  // ── Export / Import ──

  private readonly SECRET_FIELDS = [
    'passwordHash', 'password_hash', 'keyHash', 'key_hash',
    'authConfig', 'auth_config', 'telegramConfig', 'telegram_config',
    'botToken', 'apiKey', 'apiSecret', 'sessionString',
  ];

  private scrubSecrets(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map(item => this.scrubSecrets(item));
    if (typeof obj === 'object') {
      const cleaned: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (this.SECRET_FIELDS.includes(key)) {
          cleaned[key] = '[REDACTED]';
        } else {
          cleaned[key] = this.scrubSecrets(value);
        }
      }
      return cleaned;
    }
    return obj;
  }

  async exportOrg(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    const [agents, tools, skills, goals, projects, tasks, settings, positions] = await Promise.all([
      this.prisma.agent.findMany({
        where: { orgId },
        include: { tools: true, skills: true },
      }),
      this.prisma.tool.findMany({ where: { orgId } }),
      this.prisma.skill.findMany({ where: { orgId } }),
      this.prisma.goal.findMany({ where: { orgId } }),
      this.prisma.project.findMany({ where: { orgId } }),
      this.prisma.task.findMany({ where: { orgId } }),
      this.prisma.setting.findMany({ where: { orgId } }),
      this.prisma.orgPosition.findMany({ where: { orgId } }),
    ]);

    const exportData = {
      exportVersion: '1.0',
      exportedAt: new Date().toISOString(),
      organization: { name: org.name, slug: org.slug, plan: org.plan, metadata: org.metadata },
      agents: this.scrubSecrets(agents),
      tools: this.scrubSecrets(tools),
      skills,
      goals,
      projects,
      tasks,
      settings,
      positions,
    };

    return exportData;
  }

  async importOrg(orgId: string, data: any) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    if (!data || !data.exportVersion) {
      throw new ConflictException('Invalid import data: missing exportVersion');
    }

    const idMap = new Map<string, string>();
    const stats = { settings: 0, tools: 0, skills: 0, agents: 0, goals: 0, projects: 0, tasks: 0, positions: 0, skipped: 0 };

    // Import settings (skip duplicates by key)
    if (data.settings?.length) {
      for (const s of data.settings) {
        const existing = await this.prisma.setting.findFirst({
          where: { orgId, key: s.key },
        });
        if (existing) { stats.skipped++; continue; }
        await this.prisma.setting.create({
          data: { orgId, key: s.key, value: s.value },
        });
        stats.settings++;
      }
    }

    // Import tools (skip duplicates by name)
    if (data.tools?.length) {
      for (const t of data.tools) {
        const existing = await this.prisma.tool.findFirst({
          where: { orgId, name: t.name },
        });
        if (existing) { idMap.set(t.id, existing.id); stats.skipped++; continue; }
        const newTool = await this.prisma.tool.create({
          data: {
            orgId, name: t.name, type: t.type,
            config: t.config ?? {},
            authType: t.authType,
            authConfig: t.authConfig === '[REDACTED]' ? {} : t.authConfig,
          },
        });
        idMap.set(t.id, newTool.id);
        stats.tools++;
      }
    }

    // Import skills (skip duplicates by name)
    if (data.skills?.length) {
      for (const s of data.skills) {
        const existing = await this.prisma.skill.findFirst({
          where: { orgId, name: s.name },
        });
        if (existing) { idMap.set(s.id, existing.id); stats.skipped++; continue; }
        const newSkill = await this.prisma.skill.create({
          data: {
            orgId, name: s.name,
            slug: `${s.slug}-${Date.now().toString(36)}`,
            description: s.description ?? '',
            content: s.content ?? '',
            version: s.version ?? '1.0',
            type: s.type ?? 'CUSTOM',
            entryPoint: s.entryPoint ?? 'index',
            configSchema: s.configSchema,
          },
        });
        idMap.set(s.id, newSkill.id);
        stats.skills++;
      }
    }

    // Import agents (skip duplicates by name)
    if (data.agents?.length) {
      for (const a of data.agents) {
        const existing = await this.prisma.agent.findFirst({
          where: { orgId, name: a.name },
        });
        if (existing) { idMap.set(a.id, existing.id); stats.skipped++; continue; }

        // Find an owner for the agent (first admin member of the org)
        const adminMember = await this.prisma.orgMember.findFirst({
          where: { orgId, role: 'ADMIN' },
        });
        if (!adminMember) continue;

        const newAgent = await this.prisma.agent.create({
          data: {
            orgId, name: a.name,
            slug: `${a.slug}-${Date.now().toString(36)}`,
            avatar: a.avatar, type: a.type ?? 'AUTONOMOUS',
            status: 'DRAFT',
            llmProvider: a.llmProvider, llmModel: a.llmModel,
            llmConfig: a.llmConfig ?? {},
            systemPrompt: a.systemPrompt ?? '',
            mission: a.mission, values: a.values,
            runtimeConfig: a.runtimeConfig ?? {},
            ownerId: adminMember.userId,
            metadata: a.metadata,
          },
        });
        idMap.set(a.id, newAgent.id);
        stats.agents++;

        // Re-link tools
        if (a.tools?.length) {
          for (const at of a.tools) {
            const newToolId = idMap.get(at.toolId);
            if (newToolId) {
              const existing = await this.prisma.agentTool.findFirst({
                where: { agentId: newAgent.id, toolId: newToolId },
              });
              if (!existing) {
                await this.prisma.agentTool.create({
                  data: { agentId: newAgent.id, toolId: newToolId, permissions: at.permissions ?? {}, enabled: at.enabled ?? true },
                });
              }
            }
          }
        }

        // Re-link skills
        if (a.skills?.length) {
          for (const as_ of a.skills) {
            const newSkillId = idMap.get(as_.skillId);
            if (newSkillId) {
              const existing = await this.prisma.agentSkill.findFirst({
                where: { agentId: newAgent.id, skillId: newSkillId },
              });
              if (!existing) {
                await this.prisma.agentSkill.create({
                  data: { agentId: newAgent.id, skillId: newSkillId, enabled: as_.enabled ?? true },
                });
              }
            }
          }
        }
      }
    }

    // Import goals (skip duplicates by title)
    if (data.goals?.length) {
      for (const g of data.goals) {
        const existing = await this.prisma.goal.findFirst({
          where: { orgId, title: g.title },
        });
        if (existing) { stats.skipped++; continue; }
        await this.prisma.goal.create({
          data: {
            orgId, title: g.title, description: g.description,
            status: g.status ?? 'PLANNED', priority: g.priority ?? 'MEDIUM',
            ownerType: g.ownerType ?? 'HUMAN', ownerId: g.ownerId,
            agentId: g.agentId ? idMap.get(g.agentId) : undefined,
          },
        });
        stats.goals++;
      }
    }

    // Import projects (skip duplicates by name)
    if (data.projects?.length) {
      for (const p of data.projects) {
        const existing = await this.prisma.project.findFirst({
          where: { orgId, name: p.name },
        });
        if (existing) { stats.skipped++; continue; }
        await this.prisma.project.create({
          data: {
            orgId, name: p.name, description: p.description,
            status: p.status ?? 'PLANNED', priority: p.priority ?? 'MEDIUM',
            leadType: p.leadType ?? 'HUMAN', leadId: p.leadId,
            progress: p.progress ?? 0,
          },
        });
        stats.projects++;
      }
    }

    // Import positions (skip duplicates by title)
    if (data.positions?.length) {
      for (const p of data.positions) {
        const existing = await this.prisma.orgPosition.findFirst({
          where: { orgId, title: p.title },
        });
        if (existing) { idMap.set(p.id, existing.id); stats.skipped++; continue; }
        const newPos = await this.prisma.orgPosition.create({
          data: {
            orgId, title: p.title, department: p.department,
            holderType: p.holderType ?? 'HUMAN',
            agentId: p.agentId ? idMap.get(p.agentId) : undefined,
          },
        });
        idMap.set(p.id, newPos.id);
        stats.positions++;
      }
      // Second pass: set parent references
      for (const p of data.positions) {
        if (p.parentId && idMap.has(p.id) && idMap.has(p.parentId)) {
          await this.prisma.orgPosition.update({
            where: { id: idMap.get(p.id)! },
            data: { parentId: idMap.get(p.parentId) },
          });
        }
      }
    }

    this.logger.log(`Import complete: ${JSON.stringify(stats)}`);
    return { message: 'Import complete', stats };
  }
}
