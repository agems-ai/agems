import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseInterceptors, UploadedFile, BadRequestException, ForbiddenException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { CommsService } from './comms.service';
import { PrismaService } from '../../config/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';
import type { CreateChannelInput, SendMessageInput } from '@agems/shared';
import type { RequestUser } from '../../common/types';

@Controller('channels')
export class CommsController {
  constructor(private commsService: CommsService, private prisma: PrismaService) {}

  /** Verify channel belongs to user's org and the user participates in it.
   *  ADMIN and MANAGER roles can access any channel in their org (needed for A2A chat monitoring). */
  private async verifyChannelAccess(channelId: string, userId: string, orgId: string, role?: string) {
    // ADMIN, MANAGER, and VIEWER (public mode) can read any channel in their org
    if (role === 'ADMIN' || role === 'MANAGER' || role === 'VIEWER') {
      const channel = await this.prisma.channel.findFirst({
        where: { id: channelId, orgId },
        select: { id: true },
      });
      if (!channel) throw new ForbiddenException('Access denied');
      return;
    }
    const participant = await this.prisma.channelParticipant.findFirst({
      where: {
        channelId,
        participantType: 'HUMAN',
        participantId: userId,
        channel: { orgId },
      },
      select: { id: true },
    });
    if (!participant) throw new ForbiddenException('Access denied');
  }

  @Post()
  create(@Body() body: any, @Req() req: { user: RequestUser }) {
    // Support shorthand { targetType, targetId } from ChatPanel auto-create
    if (!body.participantIds && body.targetType && body.targetId) {
      body.participantIds = [{ type: body.targetType, id: body.targetId }];
    }
    return this.commsService.createChannel(body as CreateChannelInput, 'HUMAN', req.user.id, req.user.orgId);
  }

  @Get()
  findAll(@Req() req: { user: RequestUser }) {
    // VIEWER (public mode) sees all channels in org without participant filter
    if (req.user.role === 'VIEWER' || req.user.role === 'ADMIN' || req.user.role === 'MANAGER') {
      return this.commsService.findAllOrgChannels(req.user.orgId);
    }
    return this.commsService.findAllChannels(req.user.id, req.user.orgId);
  }

  @Get('agent-chats')
  findAgentChats(@Req() req: { user: RequestUser }) {
    return this.commsService.findAgentToAgentChannels(req.user.orgId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: { user: RequestUser }) {
    // ADMIN/MANAGER can view any channel in their org (including A2A)
    if (req.user.role === 'ADMIN' || req.user.role === 'MANAGER') {
      return this.commsService.findOneChannel(id, req.user.orgId);
    }
    return this.commsService.findOneChannel(id, req.user.orgId, 'HUMAN', req.user.id);
  }

  @Post(':id/upload')
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
  async uploadFile(@Param('id') channelId: string, @UploadedFile() file: any, @Req() req: { user: RequestUser }) {
    await this.verifyChannelAccess(channelId, req.user.id, req.user.orgId, req.user.role);
    if (!file) throw new BadRequestException('No file provided');
    const ext = extname(file.originalname).toLowerCase() || '.bin';
    const filename = `${randomUUID()}${ext}`;
    // Resolve uploads dir: works from both monorepo root and apps/api
    const cwd = process.cwd();
    const isMonorepoRoot = existsSync(join(cwd, 'apps', 'api')) && existsSync(join(cwd, 'apps', 'web'));
    const dir = isMonorepoRoot
      ? join(cwd, 'apps', 'web', 'public', 'uploads')
      : join(cwd, '..', 'web', 'public', 'uploads');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), file.buffer);

    const url = `/uploads/${filename}`;

    // Register in fileRecord so file appears on /files page
    await this.prisma.fileRecord.create({
      data: {
        orgId: req.user.orgId,
        filename,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        url,
        uploadedBy: 'HUMAN',
        uploaderId: req.user.id,
      },
    }).catch(() => {}); // non-blocking — chat upload still works even if DB insert fails

    return {
      url,
      filename,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    };
  }

  @Post(':id/messages')
  sendMessage(
    @Param('id') channelId: string,
    @Body() body: SendMessageInput,
    @Req() req: { user: RequestUser },
  ) {
    return this.commsService.sendMessage(channelId, body, 'HUMAN', req.user.id, req.user.orgId);
  }

  @Get(':id/messages')
  async getMessages(@Param('id') channelId: string, @Query() filters: any, @Req() req: { user: RequestUser }) {
    await this.verifyChannelAccess(channelId, req.user.id, req.user.orgId, req.user.role);
    return this.commsService.getMessages(channelId, filters);
  }

  @Post(':id/participants')
  async addParticipant(
    @Param('id') channelId: string,
    @Body() body: { participantType: string; participantId: string; role?: string },
    @Req() req: { user: RequestUser },
  ) {
    await this.verifyChannelAccess(channelId, req.user.id, req.user.orgId, req.user.role);
    return this.commsService.addParticipant(channelId, body.participantType, body.participantId, body.role);
  }

  @Delete(':id/participants/:pid')
  async removeParticipant(@Param('id') channelId: string, @Param('pid') participantId: string, @Req() req: { user: RequestUser }) {
    await this.verifyChannelAccess(channelId, req.user.id, req.user.orgId, req.user.role);
    return this.commsService.removeParticipant(channelId, participantId);
  }

  @Patch(':id')
  async updateChannel(@Param('id') id: string, @Body() body: { name?: string; metadata?: any }, @Req() req: { user: RequestUser }) {
    await this.verifyChannelAccess(id, req.user.id, req.user.orgId, req.user.role);
    return this.commsService.updateChannel(id, body);
  }

  @Delete(':id')
  @Roles('ADMIN')
  async deleteChannel(@Param('id') id: string, @Req() req: { user: RequestUser }) {
    await this.verifyChannelAccess(id, req.user.id, req.user.orgId, req.user.role);
    return this.commsService.deleteChannel(id);
  }

  @Post('ensure-direct')
  ensureAllDirectChats(@Req() req: { user: RequestUser }) {
    return this.commsService.ensureAllDirectChats(req.user.orgId);
  }

  @Get('direct/:type/:targetId')
  findDirectChannel(@Param('type') type: string, @Param('targetId') targetId: string, @Req() req: { user: RequestUser }) {
    return this.commsService.findDirectChannel('HUMAN', req.user.id, type, targetId, req.user.orgId);
  }

  @Get('direct/:type/:targetId/all')
  findAllDirectChannels(@Param('type') type: string, @Param('targetId') targetId: string, @Req() req: { user: RequestUser }) {
    return this.commsService.findAllDirectChannels('HUMAN', req.user.id, type, targetId, req.user.orgId);
  }
}
