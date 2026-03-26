import { Controller, Get, Post, Put, Delete, Param, Query, Body, Req, Request, UseInterceptors, UploadedFile, BadRequestException, NotFoundException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync, statSync } from 'fs';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import type { RequestUser } from '../../common/types';

@Controller('files')
export class FilesController {
  constructor(private prisma: PrismaService) {}

  private async getFolderInOrg(id: string, orgId: string) {
    const folder = await this.prisma.folder.findFirst({ where: { id, orgId } });
    if (!folder) throw new NotFoundException('Folder not found');
    return folder;
  }

  private async assertFolderTreeParent(folderId: string, parentId: string | null | undefined, orgId: string) {
    if (!parentId) return;
    if (parentId === folderId) throw new BadRequestException('Cannot move folder into itself');

    let currentId: string | null = parentId;
    while (currentId) {
      const current = await this.getFolderInOrg(currentId, orgId);
      if (current.id === folderId) {
        throw new BadRequestException('Cannot move folder into its descendant');
      }
      currentId = current.parentId;
    }
  }

  // ═══════════════════════════════════════════════════
  // FOLDERS
  // ═══════════════════════════════════════════════════

  @Get('folders')
  async listFolders(@Query('parentId') parentId: string | undefined, @Request() req: { user: RequestUser }) {
    const orgId = req.user.orgId;
    const where: any = { orgId };
    if (parentId) {
      where.parentId = parentId;
    } else {
      where.parentId = null;
    }
    const folders = await this.prisma.folder.findMany({
      where,
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: {
        _count: { select: { children: true, files: true } },
      },
    });
    return folders;
  }

  @Get('folders/tree')
  async getFolderTree(@Request() req: { user: RequestUser }) {
    const orgId = req.user.orgId;
    const folders = await this.prisma.folder.findMany({
      where: { orgId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: {
        _count: { select: { children: true, files: true } },
      },
    });
    return folders;
  }

  @Get('folders/:id')
  async getFolder(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    const orgId = req.user.orgId;
    const folder = await this.prisma.folder.findFirst({
      where: { id, orgId },
      include: {
        parent: true,
        _count: { select: { children: true, files: true } },
      },
    });
    if (!folder) throw new NotFoundException('Folder not found');

    // Build breadcrumb path
    const breadcrumbs: { id: string; name: string }[] = [];
    let current = folder;
    breadcrumbs.unshift({ id: current.id, name: current.name });
    while (current.parentId) {
      const parent = await this.prisma.folder.findFirst({ where: { id: current.parentId, orgId } });
      if (!parent) break;
      breadcrumbs.unshift({ id: parent.id, name: parent.name });
      current = parent as any;
    }

    return { ...folder, breadcrumbs };
  }

  @Post('folders')
  async createFolder(@Body() body: { name: string; parentId?: string }, @Request() req: { user: RequestUser }) {
    const { name, parentId } = body;
    if (!name?.trim()) throw new BadRequestException('Folder name is required');

    const orgId = req.user.orgId;

    // Validate parent exists if provided
    if (parentId) {
      const parent = await this.prisma.folder.findFirst({ where: { id: parentId, orgId } });
      if (!parent) throw new NotFoundException('Parent folder not found');
    }

    return this.prisma.folder.create({
      data: {
        orgId,
        name: name.trim(),
        parentId: parentId || null,
      },
      include: { _count: { select: { children: true, files: true } } },
    });
  }

  @Put('folders/:id')
  async updateFolder(@Param('id') id: string, @Body() body: { name?: string; parentId?: string | null }, @Request() req: { user: RequestUser }) {
    const orgId = req.user.orgId;
    const folder = await this.getFolderInOrg(id, orgId);
    if (folder.isSystem) throw new BadRequestException('Cannot modify system folders');

    const data: any = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.parentId !== undefined) {
      await this.assertFolderTreeParent(id, body.parentId, orgId);
      data.parentId = body.parentId || null;
    }

    return this.prisma.folder.update({ where: { id }, data });
  }

  @Delete('folders/:id')
  async deleteFolder(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    const folder = await this.prisma.folder.findFirst({ where: { id, orgId: req.user.orgId } });
    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.isSystem) throw new BadRequestException('Cannot delete system folders');

    // Move children & files to parent before deleting
    await this.prisma.folder.updateMany({ where: { parentId: id }, data: { parentId: folder.parentId } });
    await this.prisma.fileRecord.updateMany({ where: { folderId: id }, data: { folderId: folder.parentId } });
    await this.prisma.folder.delete({ where: { id } });
    return { deleted: true };
  }

  // ═══════════════════════════════════════════════════
  // FILES
  // ═══════════════════════════════════════════════════

  @Get()
  async listFiles(@Query() filters: { page?: string; type?: string; search?: string; folderId?: string }, @Request() req: { user: RequestUser }) {
    const page = Number(filters.page) || 1;
    const pageSize = 50;
    const orgId = req.user.orgId;

    const where: any = { orgId };

    // Folder filter: if folderId is set, show files in that folder; if 'root', show files with no folder
    if (filters.folderId === 'root') {
      where.folderId = null;
    } else if (filters.folderId) {
      await this.getFolderInOrg(filters.folderId, orgId);
      where.folderId = filters.folderId;
    }

    if (filters.type === 'image') {
      where.mimetype = { startsWith: 'image/' };
    } else if (filters.type === 'document') {
      where.mimetype = { not: { startsWith: 'image/' } };
    }

    if (filters.search) {
      where.originalName = { contains: filters.search, mode: 'insensitive' };
    }

    const [files, total] = await Promise.all([
      this.prisma.fileRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.fileRecord.count({ where }),
    ]);

    return { data: files, total, page, pageSize };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (/^(image\/(jpeg|png|gif|webp)|application\/pdf|text\/(plain|csv|markdown)|application\/json)$/.test(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new BadRequestException('Unsupported file type'), false);
      }
    },
  }))
  async uploadFile(@UploadedFile() file: any, @Req() req: any, @Query('folderId') folderId?: string) {
    if (!file) throw new BadRequestException('No file provided');
    const orgId = req.user?.orgId;
    if (folderId) {
      await this.getFolderInOrg(folderId, orgId);
    }
    const ext = extname(file.originalname).toLowerCase() || '.bin';
    const filename = `${randomUUID()}${ext}`;
    const dir = this.getUploadsDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), file.buffer);

    const url = `/uploads/${filename}`;

    // Create FileRecord in DB
    const record = await this.prisma.fileRecord.create({
      data: {
        orgId: orgId || 'default',
        folderId: folderId || null,
        filename,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        url,
        uploadedBy: 'HUMAN',
        uploaderId: req.user?.id || null,
      },
    });

    return record;
  }

  @Put(':id/move')
  async moveFile(@Param('id') id: string, @Body() body: { folderId: string | null }, @Request() req: { user: RequestUser }) {
    const file = await this.prisma.fileRecord.findFirst({ where: { id, orgId: req.user.orgId } });
    if (!file) throw new NotFoundException('File not found');

    if (body.folderId) {
      const folder = await this.prisma.folder.findFirst({ where: { id: body.folderId, orgId: req.user.orgId } });
      if (!folder) throw new NotFoundException('Target folder not found');
    }

    return this.prisma.fileRecord.update({
      where: { id },
      data: { folderId: body.folderId },
    });
  }

  @Put(':id/rename')
  async renameFile(@Param('id') id: string, @Body() body: { name: string }, @Request() req: { user: RequestUser }) {
    const file = await this.prisma.fileRecord.findFirst({ where: { id, orgId: req.user.orgId } });
    if (!file) throw new NotFoundException('File not found');
    if (!body.name?.trim()) throw new BadRequestException('Name is required');

    return this.prisma.fileRecord.update({
      where: { id },
      data: { originalName: body.name.trim() },
    });
  }

  @Delete(':id')
  async deleteFile(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    // Try to find by ID first, then by filename for backward compat
    let file = await this.prisma.fileRecord.findFirst({ where: { id, orgId: req.user.orgId } });
    if (!file) {
      file = await this.prisma.fileRecord.findFirst({ where: { filename: id, orgId: req.user.orgId } });
    }

    // Delete from disk
    const filename = file?.filename || id;
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..') || filename.includes('\0')) {
      throw new BadRequestException('Invalid filename');
    }
    const dir = this.getUploadsDir();
    const filePath = join(dir, filename);
    if (!filePath.startsWith(dir)) throw new BadRequestException('Invalid filename');
    if (existsSync(filePath)) unlinkSync(filePath);

    // Delete from DB
    if (file) {
      await this.prisma.fileRecord.delete({ where: { id: file.id } });
    }

    return { deleted: true, filename };
  }

  // ═══════════════════════════════════════════════════
  // SYNC: Import existing disk files + avatars into DB
  // ═══════════════════════════════════════════════════

  @Post('sync')
  async syncFiles(@Request() req: { user: RequestUser }) {
    const orgId = req.user.orgId;
    const dir = this.getUploadsDir();
    if (!existsSync(dir)) return { synced: 0 };

    // Get all tracked filenames
    const tracked = new Set(
      (await this.prisma.fileRecord.findMany({ where: { orgId }, select: { filename: true } })).map((f) => f.filename),
    );

    const allDisk = readdirSync(dir);
    let synced = 0;

    for (const name of allDisk) {
      if (tracked.has(name)) continue;
      const fullPath = join(dir, name);
      try {
        const stat = statSync(fullPath);
        if (!stat.isFile()) continue;
        const ext = extname(name).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
          '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
          '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv',
          '.json': 'application/json', '.md': 'text/markdown',
        };
        await this.prisma.fileRecord.create({
          data: {
            orgId,
            filename: name,
            originalName: name,
            mimetype: mimeMap[ext] || 'application/octet-stream',
            size: stat.size,
            url: `/uploads/${name}`,
            uploadedBy: 'SYSTEM',
          },
        });
        synced++;
      } catch {}
    }

    // Sync avatars into Avatars folder
    await this.syncAvatarsFolder(orgId);

    return { synced };
  }

  private async syncAvatarsFolder(orgId: string) {
    // Get or create Avatars system folder
    let avatarsFolder = await this.prisma.folder.findFirst({ where: { orgId, name: 'Avatars', isSystem: true } });
    if (!avatarsFolder) {
      avatarsFolder = await this.prisma.folder.create({
        data: { orgId, name: 'Avatars', isSystem: true },
      });
    }

    // Get all agents with avatars
    const agents = await this.prisma.agent.findMany({
      where: { orgId, avatar: { not: null } },
      select: { id: true, name: true, avatar: true },
    });

    const avatarDir = this.getAvatarsDir();
    if (!existsSync(avatarDir)) return;

    const tracked = new Set(
      (await this.prisma.fileRecord.findMany({ where: { folderId: avatarsFolder.id }, select: { filename: true } })).map((f) => f.filename),
    );

    for (const agent of agents) {
      if (!agent.avatar) continue;
      // Avatar is like '/avatars/filename.png'
      const filename = agent.avatar.replace(/^\/avatars\//, '');
      if (tracked.has(filename)) continue;

      const fullPath = join(avatarDir, filename);
      if (!existsSync(fullPath)) continue;

      try {
        const stat = statSync(fullPath);
        const ext = extname(filename).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
          '.gif': 'image/gif', '.webp': 'image/webp',
        };
        await this.prisma.fileRecord.create({
          data: {
            orgId,
            folderId: avatarsFolder.id,
            filename,
            originalName: `${agent.name} avatar${ext}`,
            mimetype: mimeMap[ext] || 'image/png',
            size: stat.size,
            url: `/avatars/${filename}`,
            uploadedBy: 'SYSTEM',
            metadata: { agentId: agent.id, agentName: agent.name },
          },
        });
      } catch {}
    }
  }

  private getUploadsDir(): string {
    const cwd = process.cwd();
    const isMonorepoRoot = existsSync(join(cwd, 'apps', 'api')) && existsSync(join(cwd, 'apps', 'web'));
    return isMonorepoRoot
      ? join(cwd, 'apps', 'web', 'public', 'uploads')
      : join(cwd, '..', 'web', 'public', 'uploads');
  }

  private getAvatarsDir(): string {
    const cwd = process.cwd();
    const isMonorepoRoot = existsSync(join(cwd, 'apps', 'api')) && existsSync(join(cwd, 'apps', 'web'));
    return isMonorepoRoot
      ? join(cwd, 'apps', 'web', 'public', 'avatars')
      : join(cwd, '..', 'web', 'public', 'avatars');
  }
}
