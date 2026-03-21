import { Controller, Post, Get, Body, Query, Request } from '@nestjs/common';
import { EvalsService } from './evals.service';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestUser } from '../../common/types';

@Controller('evals')
export class EvalsController {
  constructor(private evalsService: EvalsService) {}

  @Post('run')
  @Roles('MANAGER')
  runEval(
    @Request() req: { user: RequestUser },
    @Body() body: {
      agentId: string;
      testCases: Array<{ input: string; expectedOutput: string }>;
      model?: string;
    },
  ) {
    return this.evalsService.runEval(req.user.orgId, body.agentId, body.testCases, body.model);
  }

  @Get('history')
  getHistory(
    @Request() req: { user: RequestUser },
    @Query('agentId') agentId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.evalsService.getHistory(req.user.orgId, agentId, Number(limit) || 50);
  }

  @Post('compare')
  @Roles('MANAGER')
  compareAgents(
    @Request() req: { user: RequestUser },
    @Body() body: {
      agentIdA: string;
      agentIdB: string;
      testCases: Array<{ input: string; expectedOutput: string }>;
      model?: string;
    },
  ) {
    return this.evalsService.compareAgents(
      req.user.orgId,
      body.agentIdA,
      body.agentIdB,
      body.testCases,
      body.model,
    );
  }
}
