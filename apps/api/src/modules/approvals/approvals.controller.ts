import { Controller, Get, Post, Put, Param, Body, Query, Request } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types';

@Controller('approvals')
export class ApprovalsController {
  constructor(private approvalsService: ApprovalsService) {}

  @Get()
  @Roles('MANAGER')
  findAll(@Query() filters: any, @Request() req: { user: RequestUser }) {
    return this.approvalsService.findAll(filters, req.user.orgId);
  }

  @Get('pending/count')
  @Roles('MANAGER')
  async getPendingCount(@Request() req: { user: RequestUser }) {
    const count = await this.approvalsService.getPendingCount(req.user.orgId);
    return { count };
  }

  @Get(':id')
  @Roles('MANAGER')
  findOne(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.approvalsService.findOne(id, req.user.orgId);
  }

  @Post(':id/approve')
  @Roles('MANAGER')
  approve(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.approvalsService.resolveRequest(id, 'APPROVED', 'HUMAN', req.user.id, req.user.orgId);
  }

  @Post(':id/reject')
  @Roles('MANAGER')
  reject(@Param('id') id: string, @Body() body: { reason?: string }, @Request() req: { user: RequestUser }) {
    return this.approvalsService.resolveRequest(id, 'REJECTED', 'HUMAN', req.user.id, req.user.orgId, body.reason);
  }

  @Post('bulk/approve')
  @Roles('MANAGER')
  async bulkApprove(@Body() body: { ids: string[] }, @Request() req: { user: RequestUser }) {
    const approved = await this.approvalsService.bulkResolve(body.ids, 'APPROVED', 'HUMAN', req.user.id, req.user.orgId);
    return { approved };
  }

  @Post('bulk/reject')
  @Roles('MANAGER')
  async bulkReject(@Body() body: { ids: string[]; reason?: string }, @Request() req: { user: RequestUser }) {
    const rejected = await this.approvalsService.bulkResolve(body.ids, 'REJECTED', 'HUMAN', req.user.id, req.user.orgId, body.reason);
    return { rejected };
  }

  @Post(':id/comments')
  @Roles('MANAGER')
  addComment(
    @Param('id') id: string,
    @Body() body: { content: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.approvalsService.addComment(id, 'HUMAN', req.user.id, body.content, req.user.orgId);
  }

  @Get(':id/comments')
  @Roles('MANAGER')
  listComments(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.approvalsService.listComments(id, req.user.orgId);
  }

  @Get('policies/:agentId')
  @Roles('MANAGER')
  getPolicy(@Param('agentId') agentId: string, @Request() req: { user: RequestUser }) {
    return this.approvalsService.getPolicy(agentId, req.user.orgId);
  }

  @Put('policies/:agentId')
  @Roles('ADMIN')
  upsertPolicy(@Param('agentId') agentId: string, @Body() body: any, @Request() req: { user: RequestUser }) {
    return this.approvalsService.upsertPolicy(agentId, body, req.user.orgId);
  }

  @Post('policies/:agentId/preset')
  @Roles('ADMIN')
  applyPreset(@Param('agentId') agentId: string, @Body() body: { preset: string }, @Request() req: { user: RequestUser }) {
    return this.approvalsService.applyPreset(agentId, body.preset, req.user.orgId);
  }
}
