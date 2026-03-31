import { Module, forwardRef } from '@nestjs/common';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';
import { GoalSchedulerService } from './goal-scheduler.service';
import { RuntimeModule } from '../runtime/runtime.module';
import { CommsModule } from '../comms/comms.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [forwardRef(() => RuntimeModule), forwardRef(() => CommsModule), SettingsModule],
  controllers: [GoalsController],
  providers: [GoalsService, GoalSchedulerService],
  exports: [GoalsService],
})
export class GoalsModule {}
