import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { CommsService } from './comms.service';
import type { CreateChannelInput, SendMessageInput } from '@agems/shared';
import type { RequestUser } from '../../common/types';

@Controller('channels')
export class CommsController {
  constructor(private commsService: CommsService) {}

  @Post()
  create(@Body() body: CreateChannelInput, @Req() req: { user: RequestUser }) {
    return this.commsService.createChannel(body, 'HUMAN', req.user.id, req.user.orgId);
  }

  @Get()
  findAll(@Req() req: { user: RequestUser }) {
    return this.commsService.findAllChannels(req.user.id, req.user.orgId);
  }

  @Get('agent-chats')
  findAgentChats(@Req() req: { user: RequestUser }) {
    return this.commsService.findAgentToAgentChannels(req.user.orgId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: { user: RequestUser }) {
    return this.commsService.findOneChannel(id, req.user.orgId);
  }

  @Post(':id/upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (/^(image\/(jpeg|png|gif|webp|svg\+xml)|application\/pdf|text\/(plain|csv|markdown)|application\/json)$/.test(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new BadRequestException('Unsupported file type'), false);
      }
    },
  }))
  async uploadFile(@Param('id') channelId: string, @UploadedFile() file: any) {
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
    return {
      url: `/uploads/${filename}`,
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
  getMessages(@Param('id') channelId: string, @Query() filters: any) {
    return this.commsService.getMessages(channelId, filters);
  }

  @Post(':id/participants')
  addParticipant(
    @Param('id') channelId: string,
    @Body() body: { participantType: string; participantId: string; role?: string },
  ) {
    return this.commsService.addParticipant(channelId, body.participantType, body.participantId, body.role);
  }

  @Delete(':id/participants/:pid')
  removeParticipant(@Param('id') channelId: string, @Param('pid') participantId: string) {
    return this.commsService.removeParticipant(channelId, participantId);
  }

  @Patch(':id')
  updateChannel(@Param('id') id: string, @Body() body: { name?: string; metadata?: any }) {
    return this.commsService.updateChannel(id, body);
  }

  @Delete(':id')
  deleteChannel(@Param('id') id: string) {
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
