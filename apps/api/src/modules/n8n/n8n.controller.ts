import { Controller, Get, Post, Put, Delete, Query, Body, Param, Request } from '@nestjs/common';
import { N8nService } from './n8n.service';
import type { RequestUser } from '../../common/types';

@Controller('n8n')
export class N8nController {
  constructor(private n8n: N8nService) {}

  @Get('test')
  testConnection(@Request() req: { user: RequestUser }) {
    return this.n8n.testConnection(undefined, undefined, req.user.orgId);
  }

  @Get('workflows')
  listWorkflows(@Query('active') active?: string, @Query('limit') limit?: string, @Request() req?: { user: RequestUser }) {
    return this.n8n.listWorkflows(req?.user.orgId, {
      active: active !== undefined ? active === 'true' : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('workflows/:id')
  getWorkflow(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.n8n.getWorkflow(id, req.user.orgId);
  }

  @Post('workflows')
  createWorkflow(@Body() body: { name: string; nodes?: any[]; connections?: any; settings?: any }, @Request() req: { user: RequestUser }) {
    return this.n8n.createWorkflow(body, req.user.orgId);
  }

  @Put('workflows/:id')
  updateWorkflow(@Param('id') id: string, @Body() body: { name: string; nodes: any[]; connections: any; settings?: any; staticData?: any }, @Request() req: { user: RequestUser }) {
    return this.n8n.updateWorkflow(id, body, req.user.orgId);
  }

  @Delete('workflows/:id')
  deleteWorkflow(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.n8n.deleteWorkflow(id, req.user.orgId);
  }

  @Post('workflows/:id/activate')
  activateWorkflow(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.n8n.activateWorkflow(id, req.user.orgId);
  }

  @Post('workflows/:id/deactivate')
  deactivateWorkflow(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.n8n.deactivateWorkflow(id, req.user.orgId);
  }

  @Post('workflows/:id/execute')
  executeWorkflow(@Param('id') id: string, @Body() body: any, @Request() req: { user: RequestUser }) {
    return this.n8n.executeWorkflow(id, body, req.user.orgId);
  }

  @Get('executions')
  getExecutions(
    @Query('workflowId') workflowId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Request() req?: { user: RequestUser },
  ) {
    return this.n8n.getExecutions({ workflowId, status, limit: limit ? Number(limit) : undefined }, req?.user.orgId);
  }
}
