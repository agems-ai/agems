import { Module, forwardRef } from '@nestjs/common';
import { RuntimeService } from './runtime.service';
import { RuntimeController } from './runtime.controller';
import { AgentsModule } from '../agents/agents.module';
import { SettingsModule } from '../settings/settings.module';
import { N8nModule } from '../n8n/n8n.module';
import { CommsModule } from '../comms/comms.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  imports: [AgentsModule, SettingsModule, N8nModule, CommsModule, forwardRef(() => TelegramModule), forwardRef(() => ApprovalsModule), DashboardModule],
  controllers: [RuntimeController],
  providers: [RuntimeService],
  exports: [RuntimeService],
})
export class RuntimeModule {}
