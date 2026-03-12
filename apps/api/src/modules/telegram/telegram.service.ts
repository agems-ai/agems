import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import { TelegramBotManager, type BotConfig } from './telegram-bot-manager';
import { TelegramMediaService } from './telegram-media.service';
import { RuntimeService } from '../runtime/runtime.service';
import { CommsService } from '../comms/comms.service';
import type { Context } from 'grammy';
import type { UserMessage } from '@agems/ai';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private prisma: PrismaService,
    private botManager: TelegramBotManager,
    private media: TelegramMediaService,
    @Inject(forwardRef(() => RuntimeService))
    private runtime: RuntimeService,
    private comms: CommsService,
    private events: EventEmitter2,
  ) {}

  async onModuleInit() {
    // Start bots for all active agents with telegram config
    const agents = await this.prisma.agent.findMany({
      where: {
        status: 'ACTIVE',
        telegramConfig: { not: null as any },
      },
    });

    for (const agent of agents) {
      const config = agent.telegramConfig as any;
      if (config?.botToken && config?.botEnabled !== false) {
        try {
          await this.startBotForAgent(agent.id, config);
        } catch (err) {
          this.logger.error(`Failed to start bot for agent ${agent.id}:`, err);
        }
      }
    }

    const running = this.botManager.getRunningBots().length;
    if (running > 0) {
      this.logger.log(`Started ${running} Telegram bot(s)`);
    }
  }

  async onModuleDestroy() {
    await this.botManager.stopAll();
  }

  @OnEvent('agent.status-changed')
  async onAgentStatusChanged(payload: { id: string; status: string }) {
    if (payload.status === 'ACTIVE') {
      const agent = await this.prisma.agent.findUnique({ where: { id: payload.id } });
      if (!agent) return;
      const config = agent.telegramConfig as any;
      if (config?.botToken && config?.botEnabled !== false) {
        await this.startBotForAgent(agent.id, config);
      }
    } else {
      // PAUSED, ARCHIVED, DRAFT, ERROR — stop bot
      if (this.botManager.isRunning(payload.id)) {
        await this.botManager.stop(payload.id);
      }
    }
  }

  @OnEvent('agent.telegram-config-changed')
  async onTelegramConfigChanged(payload: { id: string }) {
    const agent = await this.prisma.agent.findUnique({ where: { id: payload.id } });
    if (!agent) return;
    const config = agent.telegramConfig as any;

    // Stop existing bot
    if (this.botManager.isRunning(payload.id)) {
      await this.botManager.stop(payload.id);
    }

    // Restart if active and has token
    if (agent.status === 'ACTIVE' && config?.botToken && config?.botEnabled !== false) {
      await this.startBotForAgent(agent.id, config);
    }
  }

  async startBotForAgent(agentId: string, tgConfig: any) {
    const botConfig: BotConfig = {
      botToken: tgConfig.botToken,
      accessMode: tgConfig.accessMode || 'OPEN',
      allowedChatIds: tgConfig.allowedChatIds || [],
      voiceEnabled: tgConfig.voiceEnabled ?? false,
      ttsVoice: tgConfig.ttsVoice || 'Kore',
    };

    await this.botManager.start(agentId, botConfig, {
      onText: (id, ctx) => this.handleText(id, ctx),
      onVoice: (id, ctx) => this.handleVoice(id, ctx),
      onPhoto: (id, ctx) => this.handlePhoto(id, ctx),
      onDocument: (id, ctx) => this.handleDocument(id, ctx),
    });

    // Sync bot profile (name, description, photo) with agent data
    this.syncBotProfile(agentId, tgConfig.botToken).catch((err) => {
      this.logger.warn(`Failed to sync bot profile for agent ${agentId}:`, err);
    });
  }

  /** Sync ALL bots' profiles (name, description, photo) — includes non-running bots */
  async syncAllBotProfiles(): Promise<{ synced: string[]; errors: string[] }> {
    const agents = await this.prisma.agent.findMany({
      where: { telegramConfig: { not: null as any } },
      select: { id: true, name: true, telegramConfig: true },
    });
    const synced: string[] = [];
    const errors: string[] = [];
    for (const agent of agents) {
      const config = agent.telegramConfig as any;
      if (!config?.botToken) continue;
      try {
        await this.syncBotProfile(agent.id, config.botToken);
        synced.push(agent.id);
      } catch (err: any) {
        errors.push(`${agent.name || agent.id}: ${err.message}`);
      }
    }
    return { synced, errors };
  }

  /** Sync Telegram bot profile with agent name, position title, and avatar */
  async syncBotProfile(agentId: string, botToken: string) {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return;

    // Get position title from org_positions
    const position = await this.prisma.orgPosition.findFirst({
      where: { agentId },
      select: { title: true },
    });

    const botName = position?.title
      ? `${agent.name} — ${position.title}`
      : agent.name;

    const baseUrl = `https://api.telegram.org/bot${botToken}`;

    // 1. Set bot name (display name, max 64 chars)
    try {
      await fetch(`${baseUrl}/setMyName`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: botName.slice(0, 64) }),
      });
    } catch (err) {
      this.logger.warn('setMyName failed:', err);
    }

    // 2. Set bot description (shown on bot profile page, max 512 chars)
    try {
      const desc = agent.mission
        ? `${agent.name}${position?.title ? ` | ${position.title}` : ''}\n\n${agent.mission}`.slice(0, 512)
        : `${botName} — AI Agent`;
      await fetch(`${baseUrl}/setMyDescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc }),
      });
    } catch (err) {
      this.logger.warn('setMyDescription failed:', err);
    }

    // 3. Set bot short description (shown in chat list, max 120 chars)
    try {
      const shortDesc = position?.title
        ? `${agent.name} — ${position.title}`.slice(0, 120)
        : (agent.name || 'AI Agent').slice(0, 120);
      await fetch(`${baseUrl}/setMyShortDescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ short_description: shortDesc }),
      });
    } catch (err) {
      this.logger.warn('setMyShortDescription failed:', err);
    }

    // 4. Set bot profile photo from agent avatar (Bot API 9.4+)
    if (agent.avatar) {
      try {
        const { join } = await import('path');
        const { readFileSync, existsSync } = await import('fs');

        const webPublic = join(process.cwd(), '..', 'web', 'public');
        const avatarPath = join(webPublic, agent.avatar);
        if (existsSync(avatarPath)) {
          const fileBuffer = readFileSync(avatarPath);

          const form = new FormData();
          form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://file' }));
          form.append('file', new Blob([fileBuffer], { type: 'image/png' }), 'avatar.png');

          const photoRes = await fetch(`${baseUrl}/setMyProfilePhoto`, {
            method: 'POST',
            body: form as any,
          });
          const photoResult = await photoRes.json() as any;
          if (!photoResult.ok) {
            this.logger.warn(`setMyProfilePhoto failed: ${photoResult.description}`);
          }
        }
      } catch (err) {
        this.logger.warn('setMyProfilePhoto failed:', err);
      }
    }
  }

  async stopBotForAgent(agentId: string) {
    await this.botManager.stop(agentId);
  }

  // ── Message Handlers ──

  private async handleText(agentId: string, ctx: Context) {
    const chatId = ctx.chat?.id;
    const text = ctx.message?.text;
    if (!chatId || !text) return;

    // Handle /start command
    if (text === '/start') {
      const agent = await this.prisma.agent.findUnique({ where: { id: agentId }, select: { name: true } });
      await ctx.reply(`Hi! I'm ${agent?.name || 'an AI agent'}. Send me a message, voice, photo, or document.`);
      return;
    }

    const chat = await this.getOrCreateChat(agentId, ctx);
    if (!chat) return; // not approved

    await this.withTyping(ctx, async () => {
      // Save incoming message
      await this.comms.sendMessage(chat.channelId, { content: text, contentType: 'TEXT' }, 'HUMAN', `tg-${chatId}`);

      // Build context from recent messages
      const context = await this.buildTelegramContext(chat.channelId, agentId);

      // Execute agent
      const result = await this.runtime.execute(agentId, context, { type: 'TELEGRAM', id: chat.channelId });

      // Save agent response
      await this.comms.sendMessage(chat.channelId, { content: result.text, contentType: 'TEXT' }, 'AGENT', agentId);

      // Send response to Telegram
      const voiceRequested = this.media.wantsVoiceResponse(text);
      await this.sendResponse(ctx, agentId, result.text, voiceRequested);
    });
  }

  private async handleVoice(agentId: string, ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const chat = await this.getOrCreateChat(agentId, ctx);
    if (!chat) return;

    await this.withTyping(ctx, async () => {
      // Download and transcribe
      const voice = ctx.message?.voice || ctx.message?.audio;
      if (!voice) return;

      const file = await ctx.api.getFile(voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${this.getBotToken(agentId)}/${file.file_path}`;
      const res = await fetch(fileUrl);
      const buffer = Buffer.from(await res.arrayBuffer());

      const transcript = await this.media.transcribeAudio(buffer, 'audio/ogg');
      const userText = `[Voice message]: ${transcript}`;

      // Save to channel
      await this.comms.sendMessage(chat.channelId, { content: userText, contentType: 'TEXT' }, 'HUMAN', `tg-${chatId}`);

      // Execute agent
      const context = await this.buildTelegramContext(chat.channelId, agentId, { isVoice: true });
      const result = await this.runtime.execute(agentId, context, { type: 'TELEGRAM', id: chat.channelId });

      // Save agent response
      await this.comms.sendMessage(chat.channelId, { content: result.text, contentType: 'TEXT' }, 'AGENT', agentId);

      // Voice messages always get voice response
      await this.sendResponse(ctx, agentId, result.text, true);
    });
  }

  private async handlePhoto(agentId: string, ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId || !ctx.message?.photo) return;

    const chat = await this.getOrCreateChat(agentId, ctx);
    if (!chat) return;

    await this.withTyping(ctx, async () => {
      const photo = ctx.message!.photo![ctx.message!.photo!.length - 1]; // highest res
      const file = await ctx.api.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${this.getBotToken(agentId)}/${file.file_path}`;
      const res = await fetch(fileUrl);
      const buffer = Buffer.from(await res.arrayBuffer());

      const ext = (file.file_path || '').split('.').pop()?.toLowerCase() || 'jpg';
      const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
      const mime = mimeMap[ext] || 'image/jpeg';
      const b64 = buffer.toString('base64');

      const caption = ctx.message?.caption || 'What do you see in this image?';

      // Save to channel
      await this.comms.sendMessage(
        chat.channelId,
        { content: `[Photo] ${caption}`, contentType: 'FILE', metadata: { type: 'photo', mime } },
        'HUMAN',
        `tg-${chatId}`,
      );

      // Build multimodal input with actual image data for vision models
      const context = await this.buildTelegramContext(chat.channelId, agentId, { isPhoto: true });
      const messages: UserMessage[] = [
        { role: 'user', content: context },
        {
          role: 'user',
          content: [
            { type: 'image', image: b64, mimeType: mime },
            { type: 'text', text: caption },
          ],
        },
      ];

      const result = await this.runtime.execute(agentId, messages, { type: 'TELEGRAM', id: chat.channelId });

      await this.comms.sendMessage(chat.channelId, { content: result.text, contentType: 'TEXT' }, 'AGENT', agentId);
      await this.sendResponse(ctx, agentId, result.text, false);
    });
  }

  private async handleDocument(agentId: string, ctx: Context) {
    const chatId = ctx.chat?.id;
    const doc = ctx.message?.document;
    if (!chatId || !doc) return;

    const chat = await this.getOrCreateChat(agentId, ctx);
    if (!chat) return;

    await this.withTyping(ctx, async () => {
      const file = await ctx.api.getFile(doc.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${this.getBotToken(agentId)}/${file.file_path}`;
      const res = await fetch(fileUrl);
      const buffer = Buffer.from(await res.arrayBuffer());

      const fileName = doc.file_name || 'document';
      const fileSize = (doc.file_size || buffer.length) / 1024;
      const caption = ctx.message?.caption || '';

      // For text files, include content
      const textExts = ['txt', 'json', 'csv', 'md', 'xml', 'yaml', 'yml', 'log', 'py', 'js', 'ts', 'html', 'css'];
      const ext = fileName.split('.').pop()?.toLowerCase() || '';
      let docDescription = `[Document: ${fileName}, ${fileSize.toFixed(1)}KB]`;

      if (textExts.includes(ext) && buffer.length < 50000) {
        const content = buffer.toString('utf-8');
        docDescription += `\n\nContent:\n${content.slice(0, 10000)}`;
        if (content.length > 10000) docDescription += '\n... (truncated)';
      }

      if (caption) docDescription += `\n\nCaption: ${caption}`;

      await this.comms.sendMessage(
        chat.channelId,
        { content: docDescription, contentType: 'FILE', metadata: { type: 'document', fileName } },
        'HUMAN',
        `tg-${chatId}`,
      );

      const context = await this.buildTelegramContext(chat.channelId, agentId);
      const result = await this.runtime.execute(agentId, context, { type: 'TELEGRAM', id: chat.channelId });

      await this.comms.sendMessage(chat.channelId, { content: result.text, contentType: 'TEXT' }, 'AGENT', agentId);
      await this.sendResponse(ctx, agentId, result.text, false);
    });
  }

  // ── Helpers ──

  private async getOrCreateChat(agentId: string, ctx: Context): Promise<{ channelId: string; telegramChatId: bigint } | null> {
    const chatId = ctx.chat?.id;
    if (!chatId) return null;

    const bigChatId = BigInt(chatId);

    // Look up existing chat
    let tgChat = await this.prisma.telegramChat.findUnique({
      where: { agentId_telegramChatId: { agentId, telegramChatId: bigChatId } },
    });

    if (tgChat) {
      if (!tgChat.isApproved) {
        await ctx.reply('Your access is pending approval.');
        return null;
      }
      return { channelId: tgChat.channelId, telegramChatId: bigChatId };
    }

    // Check whitelist
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    const tgConfig = agent?.telegramConfig as any;
    const accessMode = tgConfig?.accessMode || 'OPEN';
    const allowedIds: number[] = tgConfig?.allowedChatIds || [];

    const isApproved = accessMode === 'OPEN' || allowedIds.includes(chatId);

    // Create AGEMS channel for this Telegram chat
    const userName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || `User ${chatId}`;
    const agentName = agent?.name || 'Agent';

    const channel = await this.prisma.channel.create({
      data: {
        orgId: agent!.orgId,
        name: `TG: ${userName} & ${agentName}`,
        type: 'DIRECT',
        metadata: { source: 'telegram', telegramChatId: chatId.toString() },
        participants: {
          create: [
            { participantType: 'AGENT', participantId: agentId, role: 'MEMBER' },
            { participantType: 'SYSTEM', participantId: `tg-${chatId}`, role: 'MEMBER' },
          ],
        },
      },
    });

    // Create TelegramChat mapping
    tgChat = await this.prisma.telegramChat.create({
      data: {
        agentId,
        telegramChatId: bigChatId,
        channelId: channel.id,
        username: ctx.from?.username || null,
        firstName: ctx.from?.first_name || null,
        lastName: ctx.from?.last_name || null,
        isApproved,
      },
    });

    if (!isApproved) {
      // Create approval request so admins can approve via the Approvals page
      const approvalRequest = await this.prisma.approvalRequest.create({
        data: {
          agentId,
          toolName: 'telegram_access',
          toolInput: {
            telegramChatId: chatId,
            telegramDbChatId: tgChat.id,
            username: ctx.from?.username || null,
            firstName: ctx.from?.first_name || null,
            lastName: ctx.from?.last_name || null,
          },
          category: 'ADMIN',
          riskLevel: 'LOW',
          description: `Telegram user ${userName} (@${ctx.from?.username || 'N/A'}) requests access to ${agentName}`,
        },
        include: { agent: { select: { id: true, name: true, avatar: true } } },
      });
      this.events.emit('approval.requested', approvalRequest);

      await ctx.reply('Your access is pending approval. An admin will review your request.');
      return null;
    }

    return { channelId: channel.id, telegramChatId: bigChatId };
  }

  private async buildTelegramContext(channelId: string, agentId: string, options?: { isVoice?: boolean; isPhoto?: boolean }): Promise<string> {
    const messages = await this.prisma.message.findMany({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const agent = await this.prisma.agent.findUnique({ where: { id: agentId }, select: { name: true } });
    const lines = messages.reverse().map((m) => {
      const sender = m.senderType === 'AGENT' ? (agent?.name || 'Agent') : 'User';
      return `[${sender}]: ${m.content}`;
    });

    // Cross-platform memory: include recent AGEMS conversations for this agent
    let armContext = '';
    const armChannels = await this.prisma.channelParticipant.findMany({
      where: { participantId: agentId, participantType: 'AGENT' },
      select: { channelId: true },
    });
    const telegramChannelIds = new Set(
      (await this.prisma.telegramChat.findMany({
        where: { agentId },
        select: { channelId: true },
      })).map(tc => tc.channelId),
    );
    for (const armCh of armChannels) {
      if (armCh.channelId === channelId || telegramChannelIds.has(armCh.channelId)) continue;
      const armMessages = await this.prisma.message.findMany({
        where: { channelId: armCh.channelId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      if (armMessages.length > 0) {
        const armLines = armMessages.reverse().map(m => {
          const sender = m.senderType === 'AGENT' ? (agent?.name || 'Agent') : 'Human';
          return `[${sender}]: ${m.content}`;
        });
        armContext += `\n[Previous conversation in AGEMS platform]:\n${armLines.join('\n')}\n[End of AGEMS context]\n`;
      }
    }

    // Build capabilities description
    const botConfig = this.botManager.getBotInstance(agentId)?.config;
    let capabilities = '';
    if (botConfig?.voiceEnabled) {
      capabilities += '\nYour Telegram capabilities: You CAN receive and understand voice messages (they are auto-transcribed for you). You CAN send voice responses (the system converts your text to speech automatically). You CAN see and analyze photos/images sent to you.';
    } else {
      capabilities += '\nYour Telegram capabilities: You CAN receive and understand voice messages (they are auto-transcribed for you). You CAN see and analyze photos/images sent to you. Voice responses are disabled.';
    }
    if (options?.isVoice) {
      capabilities += ' The user sent a voice message which was transcribed below.';
    }
    if (options?.isPhoto) {
      capabilities += ' The user sent a photo which you can see.';
    }

    return `This conversation is happening in Telegram (external messenger, not the internal AGEMS platform).${capabilities}${armContext}\n\n${lines.join('\n')}\n\nContinue the conversation. Respond naturally and concisely.`;
  }

  private async sendResponse(ctx: Context, agentId: string, text: string, voiceRequested: boolean) {
    const botConfig = this.botManager.getBotInstance(agentId)?.config;

    if (voiceRequested && botConfig?.voiceEnabled) {
      try {
        const cleanText = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').replace(/#/g, '');
        const ttsText = cleanText.slice(0, 2000) + (cleanText.length > 2000 ? '... rest in text below.' : '');
        const oggBuffer = await this.media.textToVoice(ttsText, botConfig.ttsVoice);

        await ctx.replyWithVoice(new (await import('grammy')).InputFile(oggBuffer, 'response.ogg'));
      } catch (err) {
        this.logger.error('TTS failed, falling back to text:', err);
      }
    }

    // Always send text (as fallback or alongside voice)
    const chunks = this.media.splitMessage(text);
    for (const chunk of chunks) {
      try {
        await ctx.reply(chunk, { parse_mode: 'Markdown' });
      } catch {
        try {
          await ctx.reply(chunk);
        } catch (err) {
          this.logger.error('Failed to send message:', err);
        }
      }
    }
  }

  private async withTyping(ctx: Context, fn: () => Promise<void>) {
    const interval = setInterval(async () => {
      try { await ctx.replyWithChatAction('typing'); } catch {}
    }, 4000);
    try {
      // Send initial typing
      try { await ctx.replyWithChatAction('typing'); } catch {}
      await fn();
    } finally {
      clearInterval(interval);
    }
  }

  private getBotToken(agentId: string): string {
    return this.botManager.getBotInstance(agentId)?.config.botToken || '';
  }

  // ── Approval Events ──

  @OnEvent('telegram.chat.approved')
  async onChatApproved(payload: { telegramDbChatId: string; agentId: string; telegramChatId: number }) {
    try {
      const bot = this.botManager.getBotInstance(payload.agentId);
      if (bot) {
        await bot.bot.api.sendMessage(payload.telegramChatId, 'Your access has been approved! You can now send messages.');
      }
    } catch (err) {
      this.logger.warn('Failed to notify approved TG user:', err);
    }
  }

  @OnEvent('telegram.chat.rejected')
  async onChatRejected(payload: { telegramDbChatId: string; agentId: string; telegramChatId: number }) {
    try {
      const bot = this.botManager.getBotInstance(payload.agentId);
      if (bot) {
        await bot.bot.api.sendMessage(payload.telegramChatId, 'Your access request has been declined.');
      }
    } catch (err) {
      this.logger.warn('Failed to notify rejected TG user:', err);
    }
  }

  // ── Public API for controller ──

  async getBotStatus(agentId: string) {
    const running = this.botManager.isRunning(agentId);
    const instance = this.botManager.getBotInstance(agentId);
    const chatCount = await this.prisma.telegramChat.count({ where: { agentId } });

    return {
      running,
      startedAt: instance?.startedAt || null,
      chatCount,
    };
  }

  async getChats(agentId: string) {
    return this.prisma.telegramChat.findMany({
      where: { agentId },
      include: { channel: { include: { _count: { select: { messages: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveChat(chatId: string) {
    return this.prisma.telegramChat.update({
      where: { id: chatId },
      data: { isApproved: true },
    });
  }

  async rejectChat(chatId: string) {
    return this.prisma.telegramChat.update({
      where: { id: chatId },
      data: { isApproved: false },
    });
  }

  async testBotToken(token: string): Promise<{ ok: boolean; username?: string; name?: string; error?: string }> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await res.json();
      if (data.ok) {
        return { ok: true, username: data.result.username, name: data.result.first_name };
      }
      return { ok: false, error: data.description };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
}
