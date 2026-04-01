import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { BootstrapModule } from '../bootstrap/bootstrap.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [BootstrapModule, SettingsModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
