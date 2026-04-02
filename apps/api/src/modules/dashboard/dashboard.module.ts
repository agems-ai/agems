import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [SettingsModule, RuntimeModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
