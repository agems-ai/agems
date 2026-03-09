import { Module } from '@nestjs/common';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';
import { SkillsService } from './skills.service';

@Module({
  controllers: [ToolsController],
  providers: [ToolsService, SkillsService],
  exports: [ToolsService, SkillsService],
})
export class ToolsModule {}
