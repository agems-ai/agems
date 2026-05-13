import { Module, forwardRef } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskSchedulerService } from './task-scheduler.service';
import { TriggersController } from './triggers.controller';
import { TriggersService } from './triggers.service';
import { RuntimeModule } from '../runtime/runtime.module';
import { CommsModule } from '../comms/comms.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [forwardRef(() => RuntimeModule), forwardRef(() => CommsModule), SettingsModule],
  controllers: [TasksController, TriggersController],
  providers: [TasksService, TaskSchedulerService, TriggersService],
  exports: [TasksService, TriggersService],
})
export class TasksModule {}
