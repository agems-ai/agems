import { Module } from '@nestjs/common';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { PlatformBudgetsController } from './platform-budgets.controller';
import { PlatformBudgetsService } from './platform-budgets.service';
import { BudgetNotificationsService } from './budget-notifications.service';
import { BudgetResetScheduler } from './budget-reset.scheduler';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [BudgetsController, PlatformBudgetsController],
  providers: [BudgetsService, PlatformBudgetsService, BudgetNotificationsService, BudgetResetScheduler],
  exports: [BudgetsService, PlatformBudgetsService],
})
export class BudgetsModule {}
