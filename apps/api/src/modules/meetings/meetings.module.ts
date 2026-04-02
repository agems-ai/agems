import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { MeetingsGateway } from './meetings.gateway';
import { MeetingsSchedulerService } from './meetings-scheduler.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, MeetingsGateway, MeetingsSchedulerService],
  exports: [MeetingsService],
})
export class MeetingsModule {}
