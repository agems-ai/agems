import { Controller, Get, Post, Put, Param, Body, Query, Request } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';

@Controller('approvals')
export class ApprovalsController {
  constructor(private approvalsService: ApprovalsService) {}

  // ── Requests ──

  @Get()
  findAll(@Query() filters: any) {
    return this.approvalsService.findAll(filters);
  }

  @Get('pending/count')
  async getPendingCount() {
    const count = await this.approvalsService.getPendingCount();
    return { count };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.approvalsService.findOne(id);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Request() req: any) {
    return this.approvalsService.resolveRequest(id, 'APPROVED', 'HUMAN', req.user.id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() body: { reason?: string }, @Request() req: any) {
    return this.approvalsService.resolveRequest(id, 'REJECTED', 'HUMAN', req.user.id, body.reason);
  }

  @Post('bulk/approve')
  async bulkApprove(@Body() body: { ids: string[] }, @Request() req: any) {
    const approved = await this.approvalsService.bulkResolve(body.ids, 'APPROVED', 'HUMAN', req.user.id);
    return { approved };
  }

  @Post('bulk/reject')
  async bulkReject(@Body() body: { ids: string[]; reason?: string }, @Request() req: any) {
    const rejected = await this.approvalsService.bulkResolve(body.ids, 'REJECTED', 'HUMAN', req.user.id, body.reason);
    return { rejected };
  }

  // ── Comments ──

  @Post(':id/comments')
  addComment(
    @Param('id') id: string,
    @Body() body: { content: string },
    @Request() req: any,
  ) {
    return this.approvalsService.addComment(id, 'HUMAN', req.user.id, body.content);
  }

  @Get(':id/comments')
  listComments(@Param('id') id: string) {
    return this.approvalsService.listComments(id);
  }

  // ── Policies ──

  @Get('policies/:agentId')
  getPolicy(@Param('agentId') agentId: string) {
    return this.approvalsService.getPolicy(agentId);
  }

  @Put('policies/:agentId')
  upsertPolicy(@Param('agentId') agentId: string, @Body() body: any) {
    return this.approvalsService.upsertPolicy(agentId, body);
  }

  @Post('policies/:agentId/preset')
  applyPreset(@Param('agentId') agentId: string, @Body() body: { preset: string }) {
    return this.approvalsService.applyPreset(agentId, body.preset);
  }
}
