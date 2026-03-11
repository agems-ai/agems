import { Injectable, Logger } from '@nestjs/common';
import { Bot, Context } from 'grammy';

export interface BotInstance {
  bot: Bot;
  agentId: string;
  startedAt: Date;
  config: BotConfig;
}

export interface BotConfig {
  botToken: string;
  accessMode: 'OPEN' | 'WHITELIST';
  allowedChatIds: number[];
  voiceEnabled: boolean;
  ttsVoice: string;
}

export interface BotHandlers {
  onText: (agentId: string, ctx: Context) => Promise<void>;
  onVoice: (agentId: string, ctx: Context) => Promise<void>;
  onPhoto: (agentId: string, ctx: Context) => Promise<void>;
  onDocument: (agentId: string, ctx: Context) => Promise<void>;
}

@Injectable()
export class TelegramBotManager {
  private readonly logger = new Logger(TelegramBotManager.name);
  private readonly bots = new Map<string, BotInstance>();

  async start(agentId: string, config: BotConfig, handlers: BotHandlers): Promise<void> {
    if (this.bots.has(agentId)) {
      await this.stop(agentId);
    }

    const bot = new Bot(config.botToken);

    // Auth middleware
    bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      if (config.accessMode === 'WHITELIST' && config.allowedChatIds.length > 0) {
        if (!config.allowedChatIds.includes(chatId)) {
          // Let the service handle unapproved chats (it creates TelegramChat with isApproved=false)
          // But still pass through so the handler can decide
        }
      }

      await next();
    });

    // Message handlers
    bot.on('message:text', async (ctx) => {
      try {
        await handlers.onText(agentId, ctx);
      } catch (err) {
        this.logger.error(`Bot ${agentId} text handler error:`, err);
        try { await ctx.reply('An error occurred. Please try again.'); } catch {}
      }
    });

    bot.on(['message:voice', 'message:audio'], async (ctx) => {
      try {
        await handlers.onVoice(agentId, ctx);
      } catch (err) {
        this.logger.error(`Bot ${agentId} voice handler error:`, err);
        try { await ctx.reply('Error processing audio.'); } catch {}
      }
    });

    bot.on('message:photo', async (ctx) => {
      try {
        await handlers.onPhoto(agentId, ctx);
      } catch (err) {
        this.logger.error(`Bot ${agentId} photo handler error:`, err);
        try { await ctx.reply('Error processing photo.'); } catch {}
      }
    });

    bot.on('message:document', async (ctx) => {
      try {
        await handlers.onDocument(agentId, ctx);
      } catch (err) {
        this.logger.error(`Bot ${agentId} document handler error:`, err);
        try { await ctx.reply('Error processing document.'); } catch {}
      }
    });

    // Error handler
    bot.catch((err) => {
      this.logger.error(`Bot ${agentId} error:`, err);
    });

    // Start polling (non-blocking) — catch polling errors to prevent process crash
    bot.start({
      drop_pending_updates: true,
      onStart: () => {
        this.logger.log(`Bot started for agent ${agentId}`);
      },
    }).catch((err) => {
      this.logger.error(`Bot polling crashed for agent ${agentId}: ${err.message}`);
      this.bots.delete(agentId);
    });

    this.bots.set(agentId, {
      bot,
      agentId,
      startedAt: new Date(),
      config,
    });
  }

  async stop(agentId: string): Promise<void> {
    const instance = this.bots.get(agentId);
    if (!instance) return;

    try {
      await instance.bot.stop();
      this.logger.log(`Bot stopped for agent ${agentId}`);
    } catch (err) {
      this.logger.warn(`Error stopping bot for agent ${agentId}:`, err);
    }

    this.bots.delete(agentId);
  }

  async stopAll(): Promise<void> {
    const agentIds = [...this.bots.keys()];
    await Promise.allSettled(agentIds.map((id) => this.stop(id)));
  }

  isRunning(agentId: string): boolean {
    return this.bots.has(agentId);
  }

  getRunningBots(): { agentId: string; startedAt: Date }[] {
    return [...this.bots.values()].map((b) => ({
      agentId: b.agentId,
      startedAt: b.startedAt,
    }));
  }

  getBotInstance(agentId: string): BotInstance | undefined {
    return this.bots.get(agentId);
  }
}
