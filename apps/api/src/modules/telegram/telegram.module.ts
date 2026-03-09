import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../config/prisma.module';
import { TelegramService } from './telegram.service';
import { TelegramBotManager } from './telegram-bot-manager';
import { TelegramMediaService } from './telegram-media.service';
import { TelegramAccountService } from './telegram-account.service';
import { TelegramController } from './telegram.controller';
import { SettingsModule } from '../settings/settings.module';
import { CommsModule } from '../comms/comms.module';
import { RuntimeModule } from '../runtime/runtime.module';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    CommsModule,
    forwardRef(() => RuntimeModule),
  ],
  providers: [
    TelegramService,
    TelegramBotManager,
    TelegramMediaService,
    TelegramAccountService,
  ],
  controllers: [TelegramController],
  exports: [TelegramService, TelegramAccountService],
})
export class TelegramModule {}
