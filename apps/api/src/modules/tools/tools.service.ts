import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class ToolsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async createTool(input: any, userId: string, orgId: string) {
    const tool = await this.prisma.tool.create({
      data: {
        name: input.name,
        type: input.type,
        config: input.config ?? {},
        authType: input.authType,
        authConfig: input.authConfig ?? {},
        orgId,
      },
    });
    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: userId, action: 'CREATE',
      resourceType: 'tool', resourceId: tool.id,
    });
    return tool;
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
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOneTool(id: string, orgId: string) {
    const tool = await this.prisma.tool.findUnique({ where: { id }, include: { agents: { include: { agent: { select: { id: true, name: true, slug: true } } } } } });
    if (!tool || tool.orgId !== orgId) throw new NotFoundException('Tool not found');
    return tool;
  }

  async updateTool(id: string, input: any, orgId: string) {
    await this.findOneTool(id, orgId);
    return this.prisma.tool.update({ where: { id }, data: input });
  }

  async deleteTool(id: string, orgId: string) {
    await this.findOneTool(id, orgId);
    return this.prisma.tool.delete({ where: { id } });
  }

  async testConnection(id: string, orgId: string) {
    const tool = await this.findOneTool(id, orgId);
    const start = Date.now();
    try {
      const config = tool.config as any;
      if (config?.url) {
        const res = await fetch(config.url, { method: 'HEAD', signal: AbortSignal.timeout(5000) }).catch(() => null);
        return { success: !!res?.ok, latencyMs: Date.now() - start, status: res?.status };
      }
      return { success: false, latencyMs: Date.now() - start, error: 'No URL configured' };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message };
    }
  }

  async assignToolToAgent(agentId: string, toolId: string, permissions: any) {
    return this.prisma.agentTool.create({
      data: { agentId, toolId, permissions: permissions ?? { read: true, write: false, execute: true } },
    });
  }

  async removeToolFromAgent(agentId: string, toolId: string) {
    const at = await this.prisma.agentTool.findFirst({ where: { agentId, toolId } });
    if (!at) throw new NotFoundException('Agent-tool link not found');
    return this.prisma.agentTool.delete({ where: { id: at.id } });
  }
}
