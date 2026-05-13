import { Controller, Get, Put, Post, Body, Query, Request } from '@nestjs/common';
import { PlatformBudgetsService } from './platform-budgets.service';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestUser } from '../../common/types';

@Controller('platform-budget')
export class PlatformBudgetsController {
  constructor(private service: PlatformBudgetsService) {}

  /** Current platform budget for caller's org (null if not configured) */
  @Get()
  async get(@Request() req: { user: RequestUser }) {
    const budget = await this.service.findByOrg(req.user.orgId);
    const breakdown = await this.service.getSpendBreakdown(req.user.orgId);
    return { budget, breakdown };
  }

  /** Live spend breakdown (hourly / daily / monthly + limits) */
  @Get('breakdown')
  getBreakdown(@Request() req: { user: RequestUser }) {
    return this.service.getSpendBreakdown(req.user.orgId);
  }

  /** Create or update platform budget (MANAGER+) */
  @Put()
  @Roles('MANAGER')
  upsert(
    @Body() body: {
      hourlyLimitUsd?: number | null;
      dailyLimitUsd?: number | null;
      monthlyLimitUsd?: number | null;
      softAlertPercent?: number;
      hardStopEnabled?: boolean;
      periodStart?: string;
      periodEnd?: string;
      metadata?: any;
    },
    @Request() req: { user: RequestUser },
  ) {
    return this.service.upsert(req.user.orgId, body, req.user.id);
  }

  /** Manual monthly reset (MANAGER+) */
  @Post('reset')
  @Roles('MANAGER')
  reset(
    @Body() body: { periodStart?: string; periodEnd?: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.service.reset(req.user.orgId, body, req.user.id);
  }

  /** Incident history */
  @Get('incidents')
  getIncidents(
    @Query() filters: { page?: string; pageSize?: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.service.getIncidents(req.user.orgId, filters);
  }
}
