import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { DEFAULT_SKILLS } from '../settings/default-skills';

@Injectable()
export class SkillsService {
  constructor(private prisma: PrismaService) {}

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

  async findOneSkill(id: string) {
    const skill = await this.prisma.skill.findUnique({ where: { id }, include: { agents: { include: { agent: { select: { id: true, name: true } } } } } });
    if (!skill) throw new NotFoundException('Skill not found');
    return skill;
  }

  async updateSkill(id: string, input: any) {
    const skill = await this.prisma.skill.findUnique({ where: { id } });
    if (!skill) throw new NotFoundException('Skill not found');
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

  async deleteSkill(id: string) {
    const skill = await this.prisma.skill.findUnique({ where: { id } });
    if (!skill) throw new NotFoundException('Skill not found');
    return this.prisma.skill.delete({ where: { id } });
  }

  async getDefaultSkills() {
    return DEFAULT_SKILLS.map(s => ({ name: s.name, slug: s.slug, description: s.description, type: s.type }));
  }

  async importDefaultSkills(orgId: string, slugs?: string[]) {
    const toImport = slugs
      ? DEFAULT_SKILLS.filter(s => slugs.includes(s.slug))
      : DEFAULT_SKILLS;

    // Check which slugs already exist in this org
    const existing = await this.prisma.skill.findMany({
      where: { orgId },
      select: { slug: true },
    });
    const existingSlugs = new Set(existing.map(s => s.slug));

    const created: string[] = [];
    const skipped: string[] = [];

    for (const s of toImport) {
      if (existingSlugs.has(s.slug)) {
        skipped.push(s.slug);
        continue;
      }
      await this.prisma.skill.create({
        data: {
          orgId,
          name: s.name,
          slug: s.slug,
          description: s.description,
          content: s.content,
          version: s.version,
          type: s.type,
          entryPoint: s.entryPoint,
        },
      });
      created.push(s.slug);
    }

    return { created: created.length, skipped: skipped.length, details: { created, skipped } };
  }

  async assignSkillToAgent(agentId: string, skillId: string, config?: any) {
    return this.prisma.agentSkill.create({
      data: { agentId, skillId, config: config ?? {} },
    });
  }

  async removeSkillFromAgent(agentId: string, skillId: string) {
    const as = await this.prisma.agentSkill.findFirst({ where: { agentId, skillId } });
    if (!as) throw new NotFoundException('Agent-skill link not found');
    return this.prisma.agentSkill.delete({ where: { id: as.id } });
  }
}
