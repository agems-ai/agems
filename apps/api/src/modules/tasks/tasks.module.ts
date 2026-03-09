import { Module, forwardRef } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskSchedulerService } from './task-scheduler.service';
import { RuntimeModule } from '../runtime/runtime.module';
import { CommsModule } from '../comms/comms.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [forwardRef(() => RuntimeModule), forwardRef(() => CommsModule), SettingsModule],
  controllers: [TasksController],
  providers: [TasksService, TaskSchedulerService],
  exports: [TasksService],
})
export class TasksModule {}
