import { Controller, Get, Post, Patch, Delete, Param, Body, Request } from '@nestjs/common';
import { ReposService } from './repos.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types';

@Controller()
export class ReposController {
  constructor(private reposService: ReposService) {}

  @Post('repos')
  @Roles('MANAGER')
  create(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.reposService.create(body, req.user.id, req.user.orgId);
  }

  @Get('repos')
  findAll(@Request() req: { user: RequestUser }) {
    return this.reposService.findAll(req.user.orgId);
  }

  @Get('repos/:id')
  findOne(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.reposService.findOne(id, req.user.orgId);
  }

  @Patch('repos/:id')
  @Roles('MANAGER')
  update(@Param('id') id: string, @Body() body: any, @Request() req: { user: RequestUser }) {
    return this.reposService.update(id, body, req.user.orgId);
  }

  @Delete('repos/:id')
  @Roles('ADMIN')
  delete(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.reposService.delete(id, req.user.orgId);
  }

  @Post('repos/:id/sync')
  @Roles('MANAGER')
  sync(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.reposService.syncRepo(id, req.user.orgId);
  }

  @Get('repos/:id/progress')
  getProgress(@Param('id') id: string) {
    return this.reposService.getProgress(id);
  }

  @Post('agents/:agentId/repos')
  @Roles('MANAGER')
  assignToAgent(
    @Param('agentId') agentId: string,
    @Body() body: { repoId: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.reposService.assignToAgent(agentId, body.repoId, req.user.orgId);
  }

  @Delete('agents/:agentId/repos/:repoId')
  @Roles('MANAGER')
  removeFromAgent(
    @Param('agentId') agentId: string,
    @Param('repoId') repoId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.reposService.removeFromAgent(agentId, repoId, req.user.orgId);
  }
}
