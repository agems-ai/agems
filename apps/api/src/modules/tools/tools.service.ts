import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import { encryptJson, decryptJson } from '../../common/crypto.util';

@Injectable()
export class ToolsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  private sanitizeTool(tool: any) {
    if (!tool) return tool;
    return {
      ...tool,
      authConfig: tool.authConfig ? { configured: true } : {},
    };
  }

  private async getToolRecord(id: string, orgId: string) {
    const tool = await this.prisma.tool.findUnique({
      where: { id },
      include: { agents: { include: { agent: { select: { id: true, name: true, slug: true } } } } },
    });
    if (!tool || tool.orgId !== orgId) throw new NotFoundException('Tool not found');
    return tool;
  }

  private async assertAgentInOrg(agentId: string, orgId: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, orgId }, select: { id: true } });
    if (!agent) throw new ForbiddenException('Agent not found in this organization');
  }

  /** Encrypt authConfig for storage */
  private encryptAuthForStorage(authConfig: any): any {
    if (!authConfig || Object.keys(authConfig).length === 0) return {};
    return { _enc: encryptJson(authConfig) };
  }

  /** Decrypt authConfig when reading a tool */
  private decryptAuthFromStorage(tool: any): any {
    if (!tool?.authConfig) return tool;
    const ac = tool.authConfig as any;
    if (ac._enc) {
      try {
        return { ...tool, authConfig: decryptJson(ac._enc) };
      } catch {
        return tool;
      }
    }
    return tool; // backward compatible: plain JSON without _enc
  }

  async createTool(input: any, userId: string, orgId: string) {
    const tool = await this.prisma.tool.create({
      data: {
        name: input.name,
        type: input.type,
        config: input.config ?? {},
        authType: input.authType,
        authConfig: this.encryptAuthForStorage(input.authConfig ?? {}),
        orgId,
      },
    });
    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: userId, action: 'CREATE',
      resourceType: 'tool', resourceId: tool.id,
    });
    return this.sanitizeTool(tool);
  }

  async findAllTools(filters: any, orgId: string) {
    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 20;
    const where = {
      orgId,
      ...(filters.type && { type: filters.type }),
      ...(filters.search && { name: { contains: filters.search, mode: 'insensitive' as const } }),
    };
    const [data, total] = await Promise.all([
      this.prisma.tool.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' }, include: { _count: { select: { agents: true } } } }),
      this.prisma.tool.count({ where }),
    ]);
    return { data: data.map((tool) => this.sanitizeTool(tool)), total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOneTool(id: string, orgId: string) {
    const tool = await this.getToolRecord(id, orgId);
    return this.sanitizeTool(tool);
  }

  async updateTool(id: string, input: any, orgId: string) {
    await this.getToolRecord(id, orgId);
    // Whitelist allowed fields to prevent overwriting orgId, createdAt etc.
    const allowed = ['name', 'type', 'config', 'authType', 'authConfig'];
    const safeInput: any = {};
    for (const key of allowed) {
      if (key in input) {
        safeInput[key] = key === 'authConfig' ? this.encryptAuthForStorage(input[key]) : input[key];
      }
    }
    const tool = await this.prisma.tool.update({ where: { id }, data: safeInput });
    return this.sanitizeTool(tool);
  }

  async deleteTool(id: string, orgId: string) {
    await this.getToolRecord(id, orgId);
    return this.prisma.tool.delete({ where: { id } });
  }

  async testConnection(id: string, orgId: string) {
    const tool = this.decryptAuthFromStorage(await this.getToolRecord(id, orgId));
    const start = Date.now();
    try {
      const config = tool.config as any;
      const authConfig = (tool.authConfig as any) ?? {};

      if (tool.type === 'FIRECRAWL') {
        const apiKey = authConfig.token || authConfig.apiKey || authConfig.bearerToken || '';
        const baseUrl = config.url || 'https://api.firecrawl.dev/v2';
        if (!apiKey) return { success: false, latencyMs: Date.now() - start, error: 'No API key configured' };
        const res = await fetch(`${baseUrl}/scrape`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'] }),
          signal: AbortSignal.timeout(15000),
        }).catch(() => null);
        const data = res ? await res.json().catch(() => null) : null;
        return { success: !!data?.success, latencyMs: Date.now() - start, status: res?.status };
      }

      if (config?.url) {
        const res = await fetch(config.url, { method: 'HEAD', signal: AbortSignal.timeout(5000) }).catch(() => null);
        return { success: !!res?.ok, latencyMs: Date.now() - start, status: res?.status };
      }
      return { success: false, latencyMs: Date.now() - start, error: 'No URL configured' };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message };
    }
  }

  async exportTools(orgId: string) {
    const tools = await this.prisma.tool.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      tools: tools.map(({ id, orgId: _org, createdAt: _c, authConfig: _authConfig, ...rest }) => ({
        ...rest,
        authConfig: {},
      })),
    };
  }

  async importTools(input: any, orgId: string) {
    const items = Array.isArray(input) ? input : input.tools ?? [input];
    const results: { created: number; skipped: number; errors: string[] } = { created: 0, skipped: 0, errors: [] };

    for (const item of items) {
      if (!item.name || !item.type) {
        results.errors.push(`Missing name or type: ${JSON.stringify(item).slice(0, 80)}`);
        continue;
      }
      const existing = await this.prisma.tool.findFirst({ where: { name: item.name, type: item.type, orgId } });
      if (existing) {
        results.skipped++;
        continue;
      }
      try {
        await this.prisma.tool.create({
          data: {
            name: item.name,
            type: item.type,
            config: item.config ?? {},
            authType: item.authType,
            authConfig: this.encryptAuthForStorage(item.authConfig ?? {}),
            orgId,
          },
        });
        results.created++;
      } catch (e: any) {
        results.errors.push(`Failed to create "${item.name}": ${e.message}`);
      }
    }
    return results;
  }

  async assignToolToAgent(agentId: string, toolId: string, permissions: any, orgId: string) {
    await this.assertAgentInOrg(agentId, orgId);
    await this.getToolRecord(toolId, orgId);
    return this.prisma.agentTool.create({
      data: { agentId, toolId, permissions: permissions ?? { read: true, write: false, execute: true } },
    });
  }

  async removeToolFromAgent(agentId: string, toolId: string, orgId: string) {
    await this.assertAgentInOrg(agentId, orgId);
    await this.getToolRecord(toolId, orgId);
    const at = await this.prisma.agentTool.findFirst({ where: { agentId, toolId } });
    if (!at) throw new NotFoundException('Agent-tool link not found');
    return this.prisma.agentTool.delete({ where: { id: at.id } });
  }
}
