import { Controller, Get, Post, Body, Request, UsePipes } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { RequestUser } from '../../common/types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

const QuerySchema = z.object({
  toolId: z.string().uuid(),
  sql: z.string().min(1).max(10000),
});

const HttpSchema = z.object({
  toolId: z.string().uuid(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().min(1).max(2000),
  body: z.any().optional(),
  queryParams: z.record(z.string()).optional(),
});

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** System-level statistics for org widgets */
  @Get('system-stats')
  getSystemStats(@Request() req: { user: RequestUser }) {
    return this.dashboardService.getSystemStats(req.user.orgId);
  }

  /** List all tools (DATABASE + REST_API) available for widgets */
  @Get('tools')
  getTools(@Request() req: { user: RequestUser }) {
    return this.dashboardService.getTools(req.user.orgId);
  }

  /** Execute a read-only SQL query for a dashboard widget */
  @Post('query')
  @Roles('MANAGER')
  @UsePipes(new ZodValidationPipe(QuerySchema))
  executeQuery(@Body() body: { toolId: string; sql: string }, @Request() req: { user: RequestUser }) {
    return this.dashboardService.executeQuery(body.toolId, body.sql, req.user.orgId);
  }

  /** Execute HTTP request via a REST_API tool */
  @Post('http')
  @Roles('MANAGER')
  @UsePipes(new ZodValidationPipe(HttpSchema))
  executeHttp(@Body() body: { toolId: string; method: string; path: string; body?: any; queryParams?: Record<string, string> }, @Request() req: { user: RequestUser }) {
    return this.dashboardService.executeHttp(body.toolId, body.method, body.path, body.body, body.queryParams, req.user.orgId);
  }

  /** Get saved widget configs */
  @Get('widgets')
  getWidgets(@Request() req: { user: RequestUser }) {
    return this.dashboardService.getWidgets(req.user.orgId);
  }

  /** Save widget configs */
  @Post('widgets')
  saveWidgets(@Body() body: { widgets: any[] }, @Request() req: { user: RequestUser }) {
    return this.dashboardService.saveWidgets(body.widgets, req.user.orgId);
  }
}
