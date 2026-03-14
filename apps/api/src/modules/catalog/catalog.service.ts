import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  // ── Agents ──

  async listAgents(filters: any) {
    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 20;
    const where: any = {};
    if (filters.type) where.type = filters.type;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { tags: { hasSome: [filters.search] } },
      ];
    }
    if (filters.tag) where.tags = { has: filters.tag };
    const [data, total] = await Promise.all([
      this.prisma.catalogAgent.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { downloads: 'desc' } }),
      this.prisma.catalogAgent.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getAgent(id: string) {
    const item = await this.prisma.catalogAgent.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog agent not found');
    return item;
  }

  async publishAgent(input: any, orgName: string, email?: string) {
    const existing = await this.prisma.catalogAgent.findUnique({ where: { slug: input.slug } });
    if (existing) {
      return this.prisma.catalogAgent.update({
        where: { slug: input.slug },
        data: {
          name: input.name,
          avatar: input.avatar,
          type: input.type ?? 'AUTONOMOUS',
          description: input.description ?? '',
          systemPrompt: input.systemPrompt ?? '',
          mission: input.mission,
          llmProvider: input.llmProvider ?? 'ANTHROPIC',
          llmModel: input.llmModel ?? 'claude-sonnet-4-20250514',
          llmConfig: input.llmConfig ?? {},
          runtimeConfig: input.runtimeConfig ?? {},
          values: input.values,
          metadata: input.metadata,
          tags: input.tags ?? [],
          toolSlugs: input.toolSlugs ?? [],
          skillSlugs: input.skillSlugs ?? [],
          authorOrg: orgName,
          authorEmail: email,
        },
      });
    }
    return this.prisma.catalogAgent.create({
      data: {
        slug: input.slug,
        name: input.name,
        avatar: input.avatar,
        type: input.type ?? 'AUTONOMOUS',
        description: input.description ?? '',
        systemPrompt: input.systemPrompt ?? '',
        mission: input.mission,
        llmProvider: input.llmProvider ?? 'ANTHROPIC',
        llmModel: input.llmModel ?? 'claude-sonnet-4-20250514',
        llmConfig: input.llmConfig ?? {},
        runtimeConfig: input.runtimeConfig ?? {},
        values: input.values,
        metadata: input.metadata,
        tags: input.tags ?? [],
        toolSlugs: input.toolSlugs ?? [],
        skillSlugs: input.skillSlugs ?? [],
        authorOrg: orgName,
        authorEmail: email,
      },
    });
  }

  async importAgent(id: string, orgId: string, ownerId: string) {
    const item = await this.getAgent(id);

    // Generate unique slug (global unique constraint)
    const suffix = Math.random().toString(36).substring(2, 10);
    let slug = item.slug;
    const existingSlug = await this.prisma.agent.findFirst({ where: { slug } });
    if (existingSlug) slug = `${item.slug}-${suffix}`;

    const agent = await this.prisma.agent.create({
      data: {
        orgId,
        name: item.name,
        slug,
        avatar: item.avatar,
        type: item.type,
        systemPrompt: item.systemPrompt,
        mission: item.mission,
        llmProvider: item.llmProvider,
        llmModel: item.llmModel,
        llmConfig: item.llmConfig as any,
        runtimeConfig: item.runtimeConfig as any,
        values: item.values as any,
        metadata: item.metadata as any,
        ownerId,
      },
    });

    // Import linked skills from catalog
    if (item.skillSlugs?.length) {
      for (const skillSlug of item.skillSlugs) {
        try {
          // Check if skill already exists in org
          let skill = await this.prisma.skill.findFirst({ where: { slug: skillSlug, orgId } });
          if (!skill) {
            // Try to find in catalog and import
            const catalogSkill = await this.prisma.catalogSkill.findUnique({ where: { slug: skillSlug } });
            if (catalogSkill) {
              const sSuffix = Math.random().toString(36).substring(2, 10);
              let sSlug = catalogSkill.slug;
              const existingS = await this.prisma.skill.findFirst({ where: { slug: sSlug } });
              if (existingS && existingS.orgId !== orgId) sSlug = `${catalogSkill.slug}-${sSuffix}`;
              else if (existingS) { skill = existingS; }

              if (!skill) {
                skill = await this.prisma.skill.create({
                  data: {
                    orgId, name: catalogSkill.name, slug: sSlug,
                    description: catalogSkill.description, content: catalogSkill.content,
                    version: catalogSkill.version, type: catalogSkill.type,
                    entryPoint: catalogSkill.entryPoint, configSchema: catalogSkill.configSchema as any,
                  },
                });
                await this.prisma.catalogSkill.update({ where: { slug: skillSlug }, data: { downloads: { increment: 1 } } });
              }
            }
          }
          if (skill) {
            await this.prisma.agentSkill.create({ data: { agentId: agent.id, skillId: skill.id } });
          }
        } catch { /* skip if linking fails */ }
      }
    }

    // Import linked tools from catalog
    if (item.toolSlugs?.length) {
      for (const toolSlug of item.toolSlugs) {
        try {
          // Check if tool already exists in org by name
          let tool = await this.prisma.tool.findFirst({ where: { name: toolSlug, orgId } });
          if (!tool) {
            // Try slug as-is, then as lowercased hyphenated name
            const normalizedSlug = toolSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            let catalogTool = await this.prisma.catalogTool.findUnique({ where: { slug: toolSlug } });
            if (!catalogTool) catalogTool = await this.prisma.catalogTool.findUnique({ where: { slug: normalizedSlug } });
            if (catalogTool) {
              // Check if already exists by name+type
              tool = await this.prisma.tool.findFirst({ where: { name: catalogTool.name, type: catalogTool.type, orgId } });
              if (!tool) {
                tool = await this.prisma.tool.create({
                  data: {
                    orgId, name: catalogTool.name, type: catalogTool.type,
                    config: catalogTool.configTemplate as any,
                    authType: catalogTool.authType, authConfig: {},
                  },
                });
                await this.prisma.catalogTool.update({ where: { slug: toolSlug }, data: { downloads: { increment: 1 } } });
              }
            }
          }
          if (tool) {
            await this.prisma.agentTool.create({
              data: { agentId: agent.id, toolId: tool.id, permissions: { read: true, write: false, execute: true } },
            });
          }
        } catch { /* skip if linking fails */ }
      }
    }

    await this.prisma.catalogAgent.update({ where: { id }, data: { downloads: { increment: 1 } } });
    return agent;
  }

  async deleteAgent(id: string) {
    const item = await this.prisma.catalogAgent.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog agent not found');
    return this.prisma.catalogAgent.delete({ where: { id } });
  }

  // ── Skills ──

  async listSkills(filters: any) {
    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 20;
    const where: any = {};
    if (filters.type) where.type = filters.type;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { tags: { hasSome: [filters.search] } },
      ];
    }
    if (filters.tag) where.tags = { has: filters.tag };
    const [data, total] = await Promise.all([
      this.prisma.catalogSkill.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { downloads: 'desc' } }),
      this.prisma.catalogSkill.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getSkill(id: string) {
    const item = await this.prisma.catalogSkill.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog skill not found');
    return item;
  }

  async publishSkill(input: any, orgName: string, email?: string) {
    const existing = await this.prisma.catalogSkill.findUnique({ where: { slug: input.slug } });
    if (existing) {
      return this.prisma.catalogSkill.update({
        where: { slug: input.slug },
        data: {
          name: input.name,
          description: input.description ?? '',
          content: input.content ?? '',
          version: input.version ?? '1.0.0',
          type: input.type ?? 'CUSTOM',
          entryPoint: input.entryPoint ?? '',
          configSchema: input.configSchema,
          tags: input.tags ?? [],
          authorOrg: orgName,
          authorEmail: email,
        },
      });
    }
    return this.prisma.catalogSkill.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description ?? '',
        content: input.content ?? '',
        version: input.version ?? '1.0.0',
        type: input.type ?? 'CUSTOM',
        entryPoint: input.entryPoint ?? '',
        configSchema: input.configSchema,
        tags: input.tags ?? [],
        authorOrg: orgName,
        authorEmail: email,
      },
    });
  }

  async importSkill(id: string, orgId: string) {
    const item = await this.getSkill(id);

    // Generate unique slug (global unique constraint)
    const suffix = Math.random().toString(36).substring(2, 10);
    let slug = item.slug;
    const existingSlug = await this.prisma.skill.findFirst({ where: { slug } });
    if (existingSlug) slug = `${item.slug}-${suffix}`;

    const skill = await this.prisma.skill.create({
      data: {
        orgId,
        name: item.name,
        slug,
        description: item.description,
        content: item.content,
        version: item.version,
        type: item.type,
        entryPoint: item.entryPoint,
        configSchema: item.configSchema as any,
      },
    });
    await this.prisma.catalogSkill.update({ where: { id }, data: { downloads: { increment: 1 } } });
    return skill;
  }

  async deleteSkill(id: string) {
    const item = await this.prisma.catalogSkill.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog skill not found');
    return this.prisma.catalogSkill.delete({ where: { id } });
  }

  // ── Tools ──

  async listTools(filters: any) {
    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 20;
    const where: any = {};
    if (filters.type) where.type = filters.type;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { tags: { hasSome: [filters.search] } },
      ];
    }
    if (filters.tag) where.tags = { has: filters.tag };
    const [data, total] = await Promise.all([
      this.prisma.catalogTool.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { downloads: 'desc' } }),
      this.prisma.catalogTool.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getTool(id: string) {
    const item = await this.prisma.catalogTool.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog tool not found');
    return item;
  }

  async publishTool(input: any, orgName: string, email?: string) {
    const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = await this.prisma.catalogTool.findUnique({ where: { slug } });
    if (existing) {
      return this.prisma.catalogTool.update({
        where: { slug },
        data: {
          name: input.name,
          description: input.description ?? '',
          type: input.type,
          configTemplate: input.configTemplate ?? {},
          authType: input.authType,
          tags: input.tags ?? [],
          authorOrg: orgName,
          authorEmail: email,
        },
      });
    }
    return this.prisma.catalogTool.create({
      data: {
        slug,
        name: input.name,
        description: input.description ?? '',
        type: input.type,
        configTemplate: input.configTemplate ?? {},
        authType: input.authType,
        tags: input.tags ?? [],
        authorOrg: orgName,
        authorEmail: email,
      },
    });
  }

  async importTool(id: string, orgId: string) {
    const item = await this.getTool(id);
    const tool = await this.prisma.tool.create({
      data: {
        orgId,
        name: item.name,
        type: item.type,
        config: item.configTemplate as any,
        authType: item.authType,
        authConfig: {},
      },
    });
    await this.prisma.catalogTool.update({ where: { id }, data: { downloads: { increment: 1 } } });
    return tool;
  }

  async deleteTool(id: string) {
    const item = await this.prisma.catalogTool.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog tool not found');
    return this.prisma.catalogTool.delete({ where: { id } });
  }
}
