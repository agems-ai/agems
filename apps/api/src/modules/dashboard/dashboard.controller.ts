import { Controller, Get, Post, Body, Request } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { RequestUser } from '../../common/types';

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
  executeQuery(@Body() body: { toolId: string; sql: string }, @Request() req: { user: RequestUser }) {
    return this.dashboardService.executeQuery(body.toolId, body.sql, req.user.orgId);
  }

  /** Execute HTTP request via a REST_API tool */
  @Post('http')
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
