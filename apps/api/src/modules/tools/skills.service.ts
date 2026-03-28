import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class SkillsService {
  constructor(private prisma: PrismaService) {}

  private async getSkillRecord(id: string, orgId?: string) {
    const skill = await this.prisma.skill.findUnique({
      where: { id },
      include: { agents: { include: { agent: { select: { id: true, name: true } } } } },
    });
    if (!skill) throw new NotFoundException('Skill not found');
    if ((skill.orgId ?? undefined) !== (orgId ?? undefined)) {
      throw new ForbiddenException('Skill not found in this organization');
    }
    return skill;
  }

  private async assertAgentInOrg(agentId: string, orgId?: string) {
    if (!orgId) throw new ForbiddenException('Organization is required');
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, orgId }, select: { id: true } });
    if (!agent) throw new ForbiddenException('Agent not found in this organization');
  }

  async createSkill(input: any, orgId?: string) {
    return this.prisma.skill.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        content: input.content ?? '',
        version: input.version ?? '1.0.0',
        type: input.type ?? 'BUILTIN',
        entryPoint: input.entryPoint ?? '',
        configSchema: input.configSchema,
        ...(orgId && { orgId }),
      },
    });
  }

  async findAllSkills(filters: any, orgId?: string) {
    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 20;
    const where = {
      ...(orgId && { orgId }),
      ...(filters.type && { type: filters.type }),
      ...(filters.search && { name: { contains: filters.search, mode: 'insensitive' as const } }),
    };
    const [data, total] = await Promise.all([
      this.prisma.skill.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' }, include: { _count: { select: { agents: true } } } }),
      this.prisma.skill.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOneSkill(id: string, orgId?: string) {
    return this.getSkillRecord(id, orgId);
  }

  async updateSkill(id: string, input: any, orgId?: string) {
    const skill = await this.getSkillRecord(id, orgId);
    return this.prisma.skill.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.slug !== undefined && { slug: input.slug }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.content !== undefined && { content: input.content }),
        ...(input.version !== undefined && { version: input.version }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.entryPoint !== undefined && { entryPoint: input.entryPoint }),
        ...(input.configSchema !== undefined && { configSchema: input.configSchema }),
      },
    });
  }

  async deleteSkill(id: string, orgId?: string) {
    const skill = await this.getSkillRecord(id, orgId);
    return this.prisma.skill.delete({ where: { id } });
  }

  async exportSkills(orgId?: string) {
    const skills = await this.prisma.skill.findMany({
      where: orgId ? { orgId } : {},
      orderBy: { createdAt: 'desc' },
    });
    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      skills: skills.map(({ id, orgId: _org, createdAt: _c, ...rest }) => rest),
    };
  }

  async importSkills(input: any, orgId?: string) {
    const items = Array.isArray(input) ? input : input.skills ?? [input];
    const results: { created: number; skipped: number; errors: string[] } = { created: 0, skipped: 0, errors: [] };

    for (const item of items) {
      if (!item.name || !item.slug) {
        results.errors.push(`Missing name or slug: ${JSON.stringify(item).slice(0, 80)}`);
        continue;
      }
      const existing = await this.prisma.skill.findFirst({ where: { slug: item.slug, orgId: orgId ?? null } });
      if (existing) {
        results.skipped++;
        continue;
      }
      try {
        await this.prisma.skill.create({
          data: {
            name: item.name,
            slug: item.slug,
            description: item.description || '',
            content: item.content ?? '',
            version: item.version ?? '1.0.0',
            type: item.type ?? 'CUSTOM',
            entryPoint: item.entryPoint ?? '',
            configSchema: item.configSchema,
            ...(orgId && { orgId }),
          },
        });
        results.created++;
      } catch (e: any) {
        results.errors.push(`Failed to create "${item.name}": ${e.message}`);
      }
    }
    return results;
  }

  async assignSkillToAgent(agentId: string, skillId: string, config?: any, orgId?: string) {
    await this.assertAgentInOrg(agentId, orgId);
    await this.getSkillRecord(skillId, orgId);
    return this.prisma.agentSkill.create({
      data: { agentId, skillId, config: config ?? {} },
    });
  }

  async removeSkillFromAgent(agentId: string, skillId: string, orgId?: string) {
    await this.assertAgentInOrg(agentId, orgId);
    await this.getSkillRecord(skillId, orgId);
    const as = await this.prisma.agentSkill.findFirst({ where: { agentId, skillId } });
    if (!as) throw new NotFoundException('Agent-skill link not found');
    return this.prisma.agentSkill.delete({ where: { id: as.id } });
  }
}
