import { Controller, Get, Post, Patch, Param, Body, Request } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types';

@Controller('telegram')
export class TelegramController {
  constructor(private telegramService: TelegramService) {}

  @Get('bots')
  @Roles('MANAGER')
  getRunningBots(@Request() req: { user: RequestUser }) {
    return this.telegramService.getRunningBots(req.user.orgId);
  }

  @Get('bots/:agentId/status')
  @Roles('MANAGER')
  getBotStatus(@Param('agentId') agentId: string, @Request() req: { user: RequestUser }) {
    return this.telegramService.getBotStatus(agentId, req.user.orgId);
  }

  @Post('bots/:agentId/start')
  @Roles('MANAGER')
  async startBot(@Param('agentId') agentId: string, @Request() req: { user: RequestUser }) {
    return this.telegramService.startBot(agentId, req.user.orgId);
  }

  @Post('bots/:agentId/stop')
  @Roles('MANAGER')
  async stopBot(@Param('agentId') agentId: string, @Request() req: { user: RequestUser }) {
    return this.telegramService.stopBot(agentId, req.user.orgId);
  }

  @Post('sync-profiles')
  @Roles('ADMIN')
  syncAllProfiles(@Request() req: { user: RequestUser }) {
    return this.telegramService.syncAllBotProfiles(req.user.orgId);
  }

  @Post('bots/:agentId/sync-profile')
  @Roles('MANAGER')
  async syncProfile(@Param('agentId') agentId: string, @Request() req: { user: RequestUser }) {
    return this.telegramService.syncProfile(agentId, req.user.orgId);
  }

  @Post('test-token')
  @Roles('ADMIN')
  testToken(@Body() body: { token: string }) {
    return this.telegramService.testBotToken(body.token);
  }

  @Get('chats/:agentId')
  @Roles('MANAGER')
  getChats(@Param('agentId') agentId: string, @Request() req: { user: RequestUser }) {
    return this.telegramService.getChats(agentId, req.user.orgId);
  }

  @Patch('chats/:chatId/approve')
  @Roles('MANAGER')
  approveChat(@Param('chatId') chatId: string, @Request() req: { user: RequestUser }) {
    return this.telegramService.approveChat(chatId, req.user.orgId);
  }

  @Patch('chats/:chatId/reject')
  @Roles('MANAGER')
  rejectChat(@Param('chatId') chatId: string, @Request() req: { user: RequestUser }) {
    return this.telegramService.rejectChat(chatId, req.user.orgId);
  }
}
