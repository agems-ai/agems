import { Controller, Get, Post, Body, Param, Request, UsePipes, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { RuntimeService } from '../runtime/runtime.service';
import { RequestUser } from '../../common/types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

const QuerySchema = z.object({
  toolId: z.string().uuid(),
  sql: z.string().min(1).max(10000),
});

const HttpSchema = z.object({
  toolId: z.string().uuid(),
  method: z.enum(['GET']),
  path: z.string().min(1).max(2000),
  body: z.any().optional(),
  queryParams: z.record(z.string()).optional(),
});

@Controller('dashboard')
export class DashboardController {
  private readonly logger = new Logger('DashboardController');

  constructor(
    private readonly dashboardService: DashboardService,
    private readonly runtimeService: RuntimeService,
  ) {}

  /** Real-time agent activity: running + recent executions */
  @Get('activity')
  getActivity(@Request() req: { user: RequestUser }) {
    return this.dashboardService.getActivity(req.user.orgId);
  }

  /** System-level statistics for org widgets */
  @Get('system-stats')
  getSystemStats(@Request() req: { user: RequestUser }) {
    return this.dashboardService.getSystemStats(req.user.orgId);
  }

  /** AdSense + GA4 + GSC summary numbers, cached 5 min per org */
  @Get('google-summary')
  getGoogleSummary(@Request() req: { user: RequestUser }) {
    return this.dashboardService.getGoogleSummary(req.user.orgId);
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

  /** Stop a single running execution */
  @Post('stop-execution/:id')
  async stopExecution(@Param('id') id: string) {
    this.logger.log(`Stop execution requested: ${id}`);
    const stopped = await this.runtimeService.stopExecution(id);
    this.logger.log(`Stop execution ${id} result: ${stopped}`);
    return { stopped };
  }

  /** Stop all running executions */
  @Post('stop-all')
  async stopAll(@Request() req: { user: RequestUser }) {
    this.logger.log(`Stop all requested by org ${req.user.orgId}`);
    const running = await this.dashboardService.getRunningExecutionIds(req.user.orgId);
    this.logger.log(`Found ${running.length} running executions to stop`);
    let stopped = 0;
    for (const execId of running) {
      const ok = await this.runtimeService.stopExecution(execId);
      this.logger.log(`Stop ${execId}: ${ok}`);
      if (ok) stopped++;
    }
    this.logger.log(`Stopped ${stopped}/${running.length}`);
    return { stopped, total: running.length };
  }
}
