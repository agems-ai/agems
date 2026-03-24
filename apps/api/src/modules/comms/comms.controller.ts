import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
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
  async create(@Body() body: any, @Req() req: { user: RequestUser }) {
    if (!body.participantIds && body.targetType && body.targetId) {
      body.participantIds = [{ type: body.targetType, id: body.targetId }];
    }
    // orgId передаётся в сервис для проверки доступа участников
    return this.commsService.createChannel(body as CreateChannelInput, 'HUMAN', req.user.id, req.user.orgId);
  }

  @Get()
  async findAll(@Req() req: { user: RequestUser }) {
    return this.commsService.findAllChannels(req.user.id, req.user.orgId);
  }

  @Get('agent-chats')
  async findAgentChats(@Req() req: { user: RequestUser }) {
    return this.commsService.findAgentToAgentChannels(req.user.orgId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: { user: RequestUser }) {
    const channel = await this.commsService.findOneChannel(id);
    if (!channel || channel.orgId !== req.user.orgId) throw new ForbiddenException('Access denied');
    return channel;
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
  async uploadFile(@Param('id') channelId: string, @UploadedFile() file: any, @Req() req: { user: RequestUser }) {
    if (!file) throw new BadRequestException('No file provided');
    const channel = await this.commsService.findOneChannel(channelId);
    if (!channel || channel.orgId !== req.user.orgId) throw new ForbiddenException('Access denied');

    const ext = extname(file.originalname).toLowerCase() || '.bin';
    const filename = `${randomUUID()}${ext}`;
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
  async sendMessage(@Param('id') channelId: string, @Body() body: SendMessageInput, @Req() req: { user: RequestUser }) {
    const channel = await this.commsService.findOneChannel(channelId);
    if (!channel || channel.orgId !== req.user.orgId) throw new ForbiddenException('Access denied');

    return this.commsService.sendMessage(channelId, body, 'HUMAN', req.user.id, req.user.orgId);
  }

  @Get(':id/messages')
  async getMessages(@Param('id') channelId: string, @Query() filters: any, @Req() req: { user: RequestUser }) {
    const channel = await this.commsService.findOneChannel(channelId);
    if (!channel || channel.orgId !== req.user.orgId) throw new ForbiddenException('Access denied');

    return this.commsService.getMessages(channelId, filters);
  }

  @Post(':id/participants')
  async addParticipant(@Param('id') channelId: string, @Body() body: { participantType: string; participantId: string; role?: string }, @Req() req: { user: RequestUser }) {
    const channel = await this.commsService.findOneChannel(channelId);
    if (!channel || channel.orgId !== req.user.orgId) throw new ForbiddenException('Access denied');

    return this.commsService.addParticipant(channelId, body.participantType, body.participantId, body.role);
  }

  @Delete(':id/participants/:pid')
  async removeParticipant(@Param('id') channelId: string, @Param('pid') participantId: string, @Req() req: { user: RequestUser }) {
    const channel = await this.commsService.findOneChannel(channelId);
    if (!channel || channel.orgId !== req.user.orgId) throw new ForbiddenException('Access denied');

    return this.commsService.removeParticipant(channelId, participantId);
  }

  @Patch(':id')
  async updateChannel(@Param('id') id: string, @Body() body: { name?: string; metadata?: any }, @Req() req: { user: RequestUser }) {
    const channel = await this.commsService.findOneChannel(id);
    if (!channel || channel.orgId !== req.user.orgId) throw new ForbiddenException('Access denied');

    return this.commsService.updateChannel(id, body);
  }

  @Delete(':id')
  async deleteChannel(@Param('id') id: string, @Req() req: { user: RequestUser }) {
    const channel = await this.commsService.findOneChannel(id);
    if (!channel || channel.orgId !== req.user.orgId) throw new ForbiddenException('Access denied');

    return this.commsService.deleteChannel(id);
  }

  @Post('ensure-direct')
  async ensureAllDirectChats(@Req() req: { user: RequestUser }) {
    return this.commsService.ensureAllDirectChats(req.user.orgId);
  }

  @Get('direct/:type/:targetId')
  async findDirectChannel(@Param('type') type: string, @Param('targetId') targetId: string, @Req() req: { user: RequestUser }) {
    return this.commsService.findDirectChannel('HUMAN', req.user.id, type, targetId, req.user.orgId);
  }

  @Get('direct/:type/:targetId/all')
  async findAllDirectChannels(@Param('type') type: string, @Param('targetId') targetId: string, @Req() req: { user: RequestUser }) {
    return this.commsService.findAllDirectChannels('HUMAN', req.user.id, type, targetId, req.user.orgId);
  }
}
