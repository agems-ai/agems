import { Module } from '@nestjs/common';
import { WorktreesController } from './worktrees.controller';
import { WorktreesService } from './worktrees.service';

@Module({
  controllers: [WorktreesController],
  providers: [WorktreesService],
  exports: [WorktreesService],
})
export class WorktreesModule {}
