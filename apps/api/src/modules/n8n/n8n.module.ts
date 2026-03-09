import { Module } from '@nestjs/common';
import { N8nService } from './n8n.service';
import { N8nController } from './n8n.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [N8nController],
  providers: [N8nService],
  exports: [N8nService],
})
export class N8nModule {}
