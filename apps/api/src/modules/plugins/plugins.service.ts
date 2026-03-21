import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class PluginsService {
  constructor(private prisma: PrismaService) {}

  async list(orgId: string) {
    return this.prisma.plugin.findMany({
      where: { orgId },
      orderBy: { installedAt: 'desc' },
    });
  }

  async get(id: string, orgId: string) {
    const plugin = await this.prisma.plugin.findFirst({
      where: { id, orgId },
    });
    if (!plugin) throw new NotFoundException('Plugin not found');
    return plugin;
  }

  async create(
    data: {
      name: string;
      slug: string;
      version: string;
      description?: string;
      author?: string;
      homepage?: string;
      entryPoint: string;
      config?: Record<string, unknown>;
    },
    orgId: string,
  ) {
    const existing = await this.prisma.plugin.findFirst({
      where: { slug: data.slug, orgId },
    });
    if (existing) {
      throw new ConflictException(`Plugin with slug "${data.slug}" is already installed`);
    }

    return this.prisma.plugin.create({
      data: {
        orgId,
        name: data.name,
        slug: data.slug,
        version: data.version,
        description: data.description ?? null,
        author: data.author ?? null,
        homepage: data.homepage ?? null,
        entryPoint: data.entryPoint,
        config: (data.config ?? undefined) as any,
        enabled: true,
      },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      version?: string;
      description?: string;
      author?: string;
      homepage?: string;
      entryPoint?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    },
    orgId: string,
  ) {
    const plugin = await this.prisma.plugin.findFirst({
      where: { id, orgId },
    });
    if (!plugin) throw new NotFoundException('Plugin not found');

    return this.prisma.plugin.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.version !== undefined && { version: data.version }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.author !== undefined && { author: data.author }),
        ...(data.homepage !== undefined && { homepage: data.homepage }),
        ...(data.entryPoint !== undefined && { entryPoint: data.entryPoint }),
        ...(data.config !== undefined && { config: data.config as any }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
      },
    });
  }

  async remove(id: string, orgId: string) {
    const plugin = await this.prisma.plugin.findFirst({
      where: { id, orgId },
    });
    if (!plugin) throw new NotFoundException('Plugin not found');

    await this.prisma.plugin.delete({ where: { id } });
    return { success: true };
  }

  async setEnabled(id: string, enabled: boolean, orgId: string) {
    const plugin = await this.prisma.plugin.findFirst({
      where: { id, orgId },
    });
    if (!plugin) throw new NotFoundException('Plugin not found');

    return this.prisma.plugin.update({
      where: { id },
      data: { enabled },
    });
  }
}
