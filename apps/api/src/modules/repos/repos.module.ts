import { Module, forwardRef } from '@nestjs/common';
import { ReposController } from './repos.controller';
import { ReposService } from './repos.service';
import { RepoSyncService } from './repo-sync.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [forwardRef(() => SettingsModule)],
  controllers: [ReposController],
  providers: [ReposService, RepoSyncService],
  exports: [ReposService],
})
export class ReposModule {}
