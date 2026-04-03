import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

const CATALOG_API_URL = process.env.CATALOG_API_URL || '';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  private get isRemote(): boolean {
    return !!CATALOG_API_URL;
  }

  private async fetchRemote<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${CATALOG_API_URL}/api/catalog${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `Remote catalog error: ${res.status}`);
    }
    return res.json();
  }

  // ── Agents ──

  async listAgents(filters: any) {
    if (this.isRemote) {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', filters.page);
      if (filters.pageSize) params.set('pageSize', filters.pageSize);
      if (filters.search) params.set('search', filters.search);
      if (filters.type) params.set('type', filters.type);
      if (filters.tag) params.set('tag', filters.tag);
      const qs = params.toString();
      return this.fetchRemote(`/agents${qs ? '?' + qs : ''}`);
    }
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
    if (this.isRemote) return this.fetchRemote(`/agents/${id}`);
    const item = await this.prisma.catalogAgent.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog agent not found');

    // Resolve linked skills and tools by slugs
    let linkedSkills: any[] = [];
    let linkedTools: any[] = [];
    if (item.skillSlugs?.length) {
      linkedSkills = await this.prisma.catalogSkill.findMany({
        where: { slug: { in: item.skillSlugs } },
        select: { id: true, slug: true, name: true, description: true, type: true, version: true },
      });
    }
    if (item.toolSlugs?.length) {
      linkedTools = await this.prisma.catalogTool.findMany({
        where: { slug: { in: item.toolSlugs } },
        select: { id: true, slug: true, name: true, description: true, type: true, authType: true },
      });
    }
    return { ...item, linkedSkills, linkedTools };
  }

  async publishAgent(input: any, orgName: string, email?: string) {
    if (this.isRemote) {
      return this.fetchRemote('/agents/publish', {
        method: 'POST',
        body: JSON.stringify({ ...input, authorOrg: orgName, authorEmail: email }),
      });
    }
    const existing = await this.prisma.catalogAgent.findUnique({ where: { slug: input.slug } });
    if (existing) {
      return this.prisma.catalogAgent.update({
        where: { slug: input.slug },
        data: {
          name: input.name, avatar: input.avatar, type: input.type ?? 'AUTONOMOUS',
          description: input.description ?? '', systemPrompt: input.systemPrompt ?? '',
          mission: input.mission, llmProvider: input.llmProvider ?? 'ANTHROPIC',
          llmModel: input.llmModel ?? 'claude-sonnet-4-20250514', llmConfig: input.llmConfig ?? {},
          runtimeConfig: input.runtimeConfig ?? {}, values: input.values, metadata: input.metadata,
          tags: input.tags ?? [], toolSlugs: input.toolSlugs ?? [], skillSlugs: input.skillSlugs ?? [],
          authorOrg: orgName, authorEmail: email,
        },
      });
    }
    return this.prisma.catalogAgent.create({
      data: {
        slug: input.slug, name: input.name, avatar: input.avatar, type: input.type ?? 'AUTONOMOUS',
        description: input.description ?? '', systemPrompt: input.systemPrompt ?? '',
        mission: input.mission, llmProvider: input.llmProvider ?? 'ANTHROPIC',
        llmModel: input.llmModel ?? 'claude-sonnet-4-20250514', llmConfig: input.llmConfig ?? {},
        runtimeConfig: input.runtimeConfig ?? {}, values: input.values, metadata: input.metadata,
        tags: input.tags ?? [], toolSlugs: input.toolSlugs ?? [], skillSlugs: input.skillSlugs ?? [],
        authorOrg: orgName, authorEmail: email,
      },
    });
  }

  async importAgent(id: string, orgId: string, ownerId: string) {
    const item: any = await this.getAgent(id);

    const suffix = Math.random().toString(36).substring(2, 10);
    let slug = item.slug;
    const existingSlug = await this.prisma.agent.findFirst({ where: { slug } });
    if (existingSlug) slug = `${item.slug}-${suffix}`;

    const agent = await this.prisma.agent.create({
      data: {
        orgId, name: item.name, slug, avatar: item.avatar, type: item.type,
        systemPrompt: item.systemPrompt, mission: item.mission,
        llmProvider: item.llmProvider, llmModel: item.llmModel,
        llmConfig: item.llmConfig as any, runtimeConfig: item.runtimeConfig as any,
        values: item.values as any, metadata: item.metadata as any, ownerId,
        status: 'ACTIVE',
      },
    });

    // Auto-create OrgPosition under owner's position
    const ownerPosition = await this.prisma.orgPosition.findFirst({ where: { orgId, userId: ownerId } });
    await this.prisma.orgPosition.create({
      data: { orgId, title: agent.name, holderType: 'AGENT', agentId: agent.id, parentId: ownerPosition?.id ?? null },
    });

    // Import linked skills — reuse existing in same org, create only if missing
    if (item.skillSlugs?.length) {
      for (const skillSlug of item.skillSlugs) {
        try {
          // Check if skill already exists in this org
          let skill = await this.prisma.skill.findFirst({ where: { slug: skillSlug, orgId } });
          if (!skill) {
            // Fetch from catalog
            let catalogSkill: any;
            if (this.isRemote) {
              const res: any = await this.fetchRemote(`/skills?search=${encodeURIComponent(skillSlug)}&pageSize=10`);
              catalogSkill = res.data?.find((s: any) => s.slug === skillSlug);
            } else {
              catalogSkill = await this.prisma.catalogSkill.findUnique({ where: { slug: skillSlug } });
            }
            if (catalogSkill) {
              skill = await this.prisma.skill.create({
                data: {
                  orgId, name: catalogSkill.name, slug: catalogSkill.slug,
                  description: catalogSkill.description, content: catalogSkill.content,
                  version: catalogSkill.version, type: catalogSkill.type,
                  entryPoint: catalogSkill.entryPoint, configSchema: catalogSkill.configSchema as any,
                },
              });
            }
          }
          if (skill) {
            const existing = await this.prisma.agentSkill.findFirst({ where: { agentId: agent.id, skillId: skill.id } });
            if (!existing) {
              await this.prisma.agentSkill.create({ data: { agentId: agent.id, skillId: skill.id } });
            }
          }
        } catch { /* skip if linking fails */ }
      }
    }

    // Import linked tools — reuse existing in same org, create only if missing
    if (item.toolSlugs?.length) {
      for (const toolSlug of item.toolSlugs) {
        try {
          const normalizedSlug = toolSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          // Check if tool already exists in this org (by name or slug match)
          let tool = await this.prisma.tool.findFirst({ where: { name: toolSlug, orgId } });
          if (!tool) {
            // Fetch from catalog
            let catalogTool: any;
            if (this.isRemote) {
              const res: any = await this.fetchRemote(`/tools?search=${encodeURIComponent(toolSlug)}&pageSize=10`);
              catalogTool = res.data?.find((t: any) => t.slug === toolSlug || t.slug === normalizedSlug);
            } else {
              catalogTool = await this.prisma.catalogTool.findUnique({ where: { slug: toolSlug } });
              if (!catalogTool) catalogTool = await this.prisma.catalogTool.findUnique({ where: { slug: normalizedSlug } });
            }
            if (catalogTool) {
              // Check again by catalog name+type (could differ from slug)
              tool = await this.prisma.tool.findFirst({ where: { name: catalogTool.name, type: catalogTool.type, orgId } });
              if (!tool) {
                tool = await this.prisma.tool.create({
                  data: {
                    orgId, name: catalogTool.name, type: catalogTool.type,
                    config: catalogTool.configTemplate as any,
                    authType: catalogTool.authType, authConfig: {},
                  },
                });
              }
            }
          }
          if (tool) {
            const existing = await this.prisma.agentTool.findFirst({ where: { agentId: agent.id, toolId: tool.id } });
            if (!existing) {
              await this.prisma.agentTool.create({
                data: { agentId: agent.id, toolId: tool.id, permissions: { read: true, write: false, execute: true } },
              });
            }
          }
        } catch { /* skip if linking fails */ }
      }
    }

    // Increment downloads
    if (this.isRemote) {
      this.fetchRemote(`/agents/${id}/import`, { method: 'POST' }).catch(() => {});
    } else {
      await this.prisma.catalogAgent.update({ where: { id }, data: { downloads: { increment: 1 } } });
    }
    return agent;
  }

  async deleteAgent(id: string) {
    if (this.isRemote) return this.fetchRemote(`/agents/${id}`, { method: 'DELETE' });
    const item = await this.prisma.catalogAgent.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog agent not found');
    return this.prisma.catalogAgent.delete({ where: { id } });
  }

  // ── Skills ──

  async listSkills(filters: any) {
    if (this.isRemote) {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', filters.page);
      if (filters.pageSize) params.set('pageSize', filters.pageSize);
      if (filters.search) params.set('search', filters.search);
      if (filters.type) params.set('type', filters.type);
      if (filters.tag) params.set('tag', filters.tag);
      const qs = params.toString();
      return this.fetchRemote(`/skills${qs ? '?' + qs : ''}`);
    }
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
    if (this.isRemote) return this.fetchRemote(`/skills/${id}`);
    const item = await this.prisma.catalogSkill.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog skill not found');
    return item;
  }

  async publishSkill(input: any, orgName: string, email?: string) {
    if (this.isRemote) {
      return this.fetchRemote('/skills/publish', {
        method: 'POST',
        body: JSON.stringify({ ...input, authorOrg: orgName, authorEmail: email }),
      });
    }
    const existing = await this.prisma.catalogSkill.findUnique({ where: { slug: input.slug } });
    if (existing) {
      return this.prisma.catalogSkill.update({
        where: { slug: input.slug },
        data: {
          name: input.name, description: input.description ?? '', content: input.content ?? '',
          version: input.version ?? '1.0.0', type: input.type ?? 'CUSTOM',
          entryPoint: input.entryPoint ?? '', configSchema: input.configSchema,
          tags: input.tags ?? [], authorOrg: orgName, authorEmail: email,
        },
      });
    }
    return this.prisma.catalogSkill.create({
      data: {
        slug: input.slug, name: input.name, description: input.description ?? '', content: input.content ?? '',
        version: input.version ?? '1.0.0', type: input.type ?? 'CUSTOM',
        entryPoint: input.entryPoint ?? '', configSchema: input.configSchema,
        tags: input.tags ?? [], authorOrg: orgName, authorEmail: email,
      },
    });
  }

  async importSkill(id: string, orgId: string) {
    const item: any = await this.getSkill(id);

    // Reuse existing skill in same org if slug matches
    const existing = await this.prisma.skill.findFirst({ where: { slug: item.slug, orgId } });
    if (existing) return existing;

    const skill = await this.prisma.skill.create({
      data: {
        orgId, name: item.name, slug: item.slug, description: item.description, content: item.content,
        version: item.version, type: item.type, entryPoint: item.entryPoint,
        configSchema: item.configSchema as any,
      },
    });

    if (this.isRemote) {
      this.fetchRemote(`/skills/${id}/import`, { method: 'POST' }).catch(() => {});
    } else {
      await this.prisma.catalogSkill.update({ where: { id }, data: { downloads: { increment: 1 } } });
    }
    return skill;
  }

  async deleteSkill(id: string) {
    if (this.isRemote) return this.fetchRemote(`/skills/${id}`, { method: 'DELETE' });
    const item = await this.prisma.catalogSkill.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog skill not found');
    return this.prisma.catalogSkill.delete({ where: { id } });
  }

  // ── Tools ──

  async listTools(filters: any) {
    if (this.isRemote) {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', filters.page);
      if (filters.pageSize) params.set('pageSize', filters.pageSize);
      if (filters.search) params.set('search', filters.search);
      if (filters.type) params.set('type', filters.type);
      if (filters.tag) params.set('tag', filters.tag);
      const qs = params.toString();
      return this.fetchRemote(`/tools${qs ? '?' + qs : ''}`);
    }
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
    if (this.isRemote) return this.fetchRemote(`/tools/${id}`);
    const item = await this.prisma.catalogTool.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog tool not found');
    return item;
  }

  async publishTool(input: any, orgName: string, email?: string) {
    if (this.isRemote) {
      return this.fetchRemote('/tools/publish', {
        method: 'POST',
        body: JSON.stringify({ ...input, authorOrg: orgName, authorEmail: email }),
      });
    }
    const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = await this.prisma.catalogTool.findUnique({ where: { slug } });
    if (existing) {
      return this.prisma.catalogTool.update({
        where: { slug },
        data: {
          name: input.name, description: input.description ?? '', type: input.type,
          configTemplate: input.configTemplate ?? {}, authType: input.authType,
          tags: input.tags ?? [], authorOrg: orgName, authorEmail: email,
        },
      });
    }
    return this.prisma.catalogTool.create({
      data: {
        slug, name: input.name, description: input.description ?? '', type: input.type,
        configTemplate: input.configTemplate ?? {}, authType: input.authType,
        tags: input.tags ?? [], authorOrg: orgName, authorEmail: email,
      },
    });
  }

  async importTool(id: string, orgId: string) {
    const item: any = await this.getTool(id);

    // Reuse existing tool in same org if name+type matches
    const existing = await this.prisma.tool.findFirst({ where: { name: item.name, type: item.type, orgId } });
    if (existing) return existing;

    const tool = await this.prisma.tool.create({
      data: {
        orgId, name: item.name, type: item.type,
        config: item.configTemplate as any, authType: item.authType, authConfig: {},
      },
    });

    if (this.isRemote) {
      this.fetchRemote(`/tools/${id}/import`, { method: 'POST' }).catch(() => {});
    } else {
      await this.prisma.catalogTool.update({ where: { id }, data: { downloads: { increment: 1 } } });
    }
    return tool;
  }

  async deleteTool(id: string) {
    if (this.isRemote) return this.fetchRemote(`/tools/${id}`, { method: 'DELETE' });
    const item = await this.prisma.catalogTool.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Catalog tool not found');
    return this.prisma.catalogTool.delete({ where: { id } });
  }
}
