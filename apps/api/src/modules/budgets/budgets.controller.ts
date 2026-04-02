import {
  Controller, Get, Post, Patch, Body, Param, Query, Request,
} from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestUser } from '../../common/types';

@Controller('budgets')
export class BudgetsController {
  constructor(private budgetsService: BudgetsService) {}

  @Post()
  @Roles('MANAGER')
  create(
    @Body() body: {
      agentId: string;
      monthlyLimitUsd: number;
      periodStart?: string;
      periodEnd?: string;
      softAlertPercent?: number;
      hardStopEnabled?: boolean;
      metadata?: any;
    },
    @Request() req: { user: RequestUser },
  ) {
    return this.budgetsService.create(body, req.user.id, req.user.orgId);
  }

  @Get('summary')
  getSummary(@Request() req: { user: RequestUser }) {
    return this.budgetsService.getSummary(req.user.orgId);
  }

  @Get('cost-stats')
  getCostStats(
    @Query('period') period: 'daily' | 'weekly' | 'monthly' | undefined,
    @Query('days') days: string | undefined,
    @Request() req: { user: RequestUser },
  ) {
    return this.budgetsService.getOrgCostStats(req.user.orgId, period || 'daily', days ? parseInt(days, 10) : 30);
  }

  @Get()
  findAll(
    @Query() filters: { agentId?: string; page?: string; pageSize?: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.budgetsService.findAll(filters, req.user.orgId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.budgetsService.findOne(id, req.user.orgId);
  }

  @Patch(':id')
  @Roles('MANAGER')
  update(
    @Param('id') id: string,
    @Body() body: {
      monthlyLimitUsd?: number;
      softAlertPercent?: number;
      hardStopEnabled?: boolean;
      metadata?: any;
    },
    @Request() req: { user: RequestUser },
  ) {
    return this.budgetsService.update(id, body, req.user.id, req.user.orgId);
  }

  @Post(':id/record-spend')
  recordSpend(
    @Param('id') id: string,
    @Body() body: { amount: number; description?: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.budgetsService.recordSpend(id, body.amount, body.description, req.user.orgId);
  }

  @Post(':id/reset')
  @Roles('MANAGER')
  reset(
    @Param('id') id: string,
    @Body() body: { periodStart: string; periodEnd: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.budgetsService.reset(id, body, req.user.id, req.user.orgId);
  }

  @Get(':id/incidents')
  getIncidents(
    @Param('id') id: string,
    @Query() filters: { page?: string; pageSize?: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.budgetsService.getIncidents(id, filters, req.user.orgId);
  }
}
