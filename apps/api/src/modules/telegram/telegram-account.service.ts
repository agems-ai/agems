import { Injectable, Logger } from '@nestjs/common';

interface TelegramAccountConfig {
  apiId: number;
  apiHash: string;
  sessionString: string;
}

@Injectable()
export class TelegramAccountService {
  private readonly logger = new Logger(TelegramAccountService.name);

  /** Send a message to a contact by name from a Telegram user account */
  async sendMessage(config: TelegramAccountConfig, contactName: string, text: string): Promise<{ ok: boolean; to?: string; text?: string; error?: string }> {
    try {
      const { TelegramClient } = await import('telegram');
      const { StringSession } = await import('telegram/sessions');

      const client = new TelegramClient(
        new StringSession(config.sessionString),
        config.apiId,
        config.apiHash,
        { connectionRetries: 3 },
      );

      await client.connect();

      try {
        const dialogs = await client.getDialogs({ limit: 200 });
        const matches = dialogs.filter(
          (d) => d.name && d.name.toLowerCase().includes(contactName.toLowerCase()),
        );

        if (matches.length === 0) {
          return { ok: false, error: `Contact '${contactName}' not found` };
        }
        if (matches.length > 1) {
          const names = matches.map((d) => d.name);
          return { ok: false, error: `Multiple matches: ${names.join(', ')}. Be more specific.` };
        }

        const dialog = matches[0];
        await client.sendMessage(dialog.entity!, { message: text });
        this.logger.log(`Sent message to ${dialog.name}: ${text.slice(0, 50)}`);
        return { ok: true, to: dialog.name!, text };
      } finally {
        await client.disconnect();
      }
    } catch (err: any) {
      this.logger.error(`TG account sendMessage error:`, err);
      return { ok: false, error: err.message };
    }
  }

  /** Search contacts/dialogs by name */
  async findContact(config: TelegramAccountConfig, query: string): Promise<any[]> {
    try {
      const { TelegramClient } = await import('telegram');
      const { StringSession } = await import('telegram/sessions');

      const client = new TelegramClient(
        new StringSession(config.sessionString),
        config.apiId,
        config.apiHash,
        { connectionRetries: 3 },
      );

      await client.connect();

      try {
        const dialogs = await client.getDialogs({ limit: 200 });
        return dialogs
          .filter((d) => d.name && d.name.toLowerCase().includes(query.toLowerCase()))
          .map((d) => ({
            id: d.id?.toString(),
            name: d.name,
            unreadCount: d.unreadCount,
          }));
      } finally {
        await client.disconnect();
      }
    } catch (err: any) {
      this.logger.error(`TG account findContact error:`, err);
      return [{ error: err.message }];
    }
  }

  /** Send a photo to a contact by name from a Telegram user account */
  async sendPhoto(config: TelegramAccountConfig, contactName: string, imageUrl: string, caption?: string): Promise<{ ok: boolean; to?: string; error?: string }> {
    try {
      const { TelegramClient } = await import('telegram');
      const { StringSession } = await import('telegram/sessions');
      const { existsSync, readFileSync } = await import('fs');
      const { join } = await import('path');

      // Resolve file path
      const cwd = process.cwd();
      const isMonorepoRoot = existsSync(join(cwd, 'apps', 'api')) && existsSync(join(cwd, 'apps', 'web'));
      const uploadsBase = isMonorepoRoot ? join(cwd, 'apps', 'web', 'public') : join(cwd, '..', 'web', 'public');
      const filePath = join(uploadsBase, imageUrl);
      if (!existsSync(filePath)) {
        return { ok: false, error: `File not found: ${imageUrl}` };
      }

      const client = new TelegramClient(
        new StringSession(config.sessionString),
        config.apiId,
        config.apiHash,
        { connectionRetries: 3 },
      );

      await client.connect();

      try {
        const dialogs = await client.getDialogs({ limit: 200 });
        const matches = dialogs.filter(
          (d) => d.name && d.name.toLowerCase().includes(contactName.toLowerCase()),
        );

        if (matches.length === 0) return { ok: false, error: `Contact '${contactName}' not found` };
        if (matches.length > 1) return { ok: false, error: `Multiple matches: ${matches.map(d => d.name).join(', ')}. Be more specific.` };

        const dialog = matches[0];
        const fileBuffer = readFileSync(filePath);

        await client.sendFile(dialog.entity!, {
          file: fileBuffer,
          caption: caption || '',
          forceDocument: false,
        });

        this.logger.log(`Sent photo to ${dialog.name}: ${imageUrl}`);
        return { ok: true, to: dialog.name! };
      } finally {
        await client.disconnect();
      }
    } catch (err: any) {
      this.logger.error(`TG account sendPhoto error:`, err);
      return { ok: false, error: err.message };
    }
  }

  /** List recent dialogs */
  async getDialogs(config: TelegramAccountConfig, limit = 30): Promise<any[]> {
    try {
      const { TelegramClient } = await import('telegram');
      const { StringSession } = await import('telegram/sessions');

      const client = new TelegramClient(
        new StringSession(config.sessionString),
        config.apiId,
        config.apiHash,
        { connectionRetries: 3 },
      );

      await client.connect();

      try {
        const dialogs = await client.getDialogs({ limit });
        return dialogs.map((d) => ({
          name: d.name,
          id: d.id?.toString(),
          unreadCount: d.unreadCount,
        }));
      } finally {
        await client.disconnect();
      }
    } catch (err: any) {
      this.logger.error(`TG account getDialogs error:`, err);
      return [{ error: err.message }];
    }
  }
}
