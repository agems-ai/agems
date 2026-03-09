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

  async inviteMember(orgId: string, email: string, role: string = 'MEMBER') {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('User not found. They need to register first.');

    const existing = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: user.id } },
    });
    if (existing) throw new ConflictException('User is already a member');

    return this.prisma.orgMember.create({
      data: { orgId, userId: user.id, role: role as any },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    });
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

    // Clone settings
    if (entities.includes('settings')) {
      const settings = await this.prisma.setting.findMany({ where: { orgId: fromOrgId } });
      for (const s of settings) {
        await this.prisma.setting.create({
          data: { orgId: toOrgId, key: s.key, value: s.value },
        });
      }
      this.logger.log(`Cloned ${settings.length} settings`);
    }

    // Clone tools
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
}
