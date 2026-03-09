import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('telegram')
export class TelegramController {
  constructor(private telegramService: TelegramService) {}

  @Get('bots')
  getRunningBots() {
    return this.telegramService['botManager'].getRunningBots();
  }

  @Get('bots/:agentId/status')
  getBotStatus(@Param('agentId') agentId: string) {
    return this.telegramService.getBotStatus(agentId);
  }

  @Post('bots/:agentId/start')
  @Roles('MANAGER')
  async startBot(@Param('agentId') agentId: string) {
    const agent = await this.telegramService['prisma'].agent.findUnique({ where: { id: agentId } });
    if (!agent) return { error: 'Agent not found' };
    const config = agent.telegramConfig as any;
    if (!config?.botToken) return { error: 'No bot token configured' };
    await this.telegramService.startBotForAgent(agentId, config);
    return { ok: true };
  }

  @Post('bots/:agentId/stop')
  @Roles('MANAGER')
  async stopBot(@Param('agentId') agentId: string) {
    await this.telegramService.stopBotForAgent(agentId);
    return { ok: true };
  }

  @Post('sync-profiles')
  @Roles('ADMIN')
  syncAllProfiles() {
    return this.telegramService.syncAllBotProfiles();
  }

  @Post('bots/:agentId/sync-profile')
  @Roles('MANAGER')
  async syncProfile(@Param('agentId') agentId: string) {
    const agent = await this.telegramService['prisma'].agent.findUnique({ where: { id: agentId } });
    if (!agent) return { error: 'Agent not found' };
    const config = agent.telegramConfig as any;
    if (!config?.botToken) return { error: 'No bot token configured' };
    await this.telegramService.syncBotProfile(agentId, config.botToken);
    return { ok: true };
  }

  @Post('test-token')
  testToken(@Body() body: { token: string }) {
    return this.telegramService.testBotToken(body.token);
  }

  @Get('chats/:agentId')
  getChats(@Param('agentId') agentId: string) {
    return this.telegramService.getChats(agentId);
  }

  @Patch('chats/:chatId/approve')
  @Roles('MANAGER')
  approveChat(@Param('chatId') chatId: string) {
    return this.telegramService.approveChat(chatId);
  }

  @Patch('chats/:chatId/reject')
  @Roles('MANAGER')
  rejectChat(@Param('chatId') chatId: string) {
    return this.telegramService.rejectChat(chatId);
  }
}
