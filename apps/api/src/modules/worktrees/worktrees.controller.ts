import { Controller, Post, Get, Delete, Body, Param, Request } from '@nestjs/common';
import { WorktreesService } from './worktrees.service';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestUser } from '../../common/types';

@Controller('worktrees')
export class WorktreesController {
  constructor(private worktreesService: WorktreesService) {}

  @Post()
  @Roles('MANAGER')
  create(
    @Request() req: { user: RequestUser },
    @Body() body: { agentId: string; repoPath: string; branchName?: string },
  ) {
    return this.worktreesService.create(req.user.orgId, body.agentId, body.repoPath, body.branchName);
  }

  @Get()
  findAll(@Request() req: { user: RequestUser }) {
    return this.worktreesService.findAll(req.user.orgId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.worktreesService.findOne(req.user.orgId, id);
  }

  @Delete(':id')
  @Roles('MANAGER')
  remove(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.worktreesService.remove(req.user.orgId, id);
  }
}
