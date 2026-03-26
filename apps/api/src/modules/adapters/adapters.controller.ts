import { Controller, Get, Post, Body, Param, Request } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestUser } from '../../common/types';
import { AdaptersService } from './adapters.service';

@Controller('adapters')
export class AdaptersController {
  constructor(private service: AdaptersService) {}

  /** List all available adapter types with metadata */
  @Get()
  @Roles('MANAGER')
  listAdapters() {
    return this.service.listAdapters();
  }

  /** Check availability of all adapters on this host */
  @Get('availability')
  @Roles('ADMIN')
  async checkAllAvailability() {
    return this.service.checkAllAvailability();
  }

  /** Check availability of a specific adapter */
  @Get(':type/availability')
  @Roles('ADMIN')
  async checkAvailability(
    @Param('type') type: string,
    @Body() config?: Record<string, any>,
  ) {
    return this.service.checkAvailability(type, config);
  }

  /** Execute a task via an external adapter (for testing) */
  @Post(':type/execute')
  @Roles('ADMIN')
  async execute(
    @Param('type') type: string,
    @Body() body: {
      prompt: string;
      config?: Record<string, any>;
      taskId?: string;
      context?: string;
    },
    @Request() req: { user: RequestUser },
  ) {
    return this.service.execute(type, body.prompt, {
      config: body.config,
      taskId: body.taskId,
      context: body.context,
      userId: req.user.id,
      orgId: req.user.orgId,
    });
  }

  /** Execute a task via an agent's configured adapter */
  @Post('agents/:agentId/execute')
  @Roles('MANAGER')
  async executeForAgent(
    @Param('agentId') agentId: string,
    @Body() body: {
      prompt: string;
      taskId?: string;
      context?: string;
    },
    @Request() req: { user: RequestUser },
  ) {
    return this.service.executeForAgent(agentId, body.prompt, {
      taskId: body.taskId,
      context: body.context,
      userId: req.user.id,
      orgId: req.user.orgId,
    });
  }
}
