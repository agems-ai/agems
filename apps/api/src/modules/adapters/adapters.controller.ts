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

  // Everything below starts a process or calls out from the API host. Org ADMIN is not enough (every signup is
  // ADMIN of its own org): AdaptersService.assertAccess requires ADAPTERS_ENABLED=true and a platform admin
  // listed in PLATFORM_ADMIN_EMAILS.

  /** Check availability of all adapters on this host */
  @Get('availability')
  @Roles('ADMIN')
  async checkAllAvailability(@Request() req: { user: RequestUser }) {
    await this.service.assertAccess(req.user?.id);
    return this.service.checkAllAvailability();
  }

  /** Check availability of a specific adapter (caller config is ignored) */
  @Get(':type/availability')
  @Roles('ADMIN')
  async checkAvailability(
    @Param('type') type: string,
    @Request() req: { user: RequestUser },
  ) {
    await this.service.assertAccess(req.user?.id);
    return this.service.checkAvailability(type);
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
    await this.service.assertAccess(req.user?.id);
    return this.service.execute(type, body?.prompt, {
      config: body?.config,
      taskId: body?.taskId,
      context: body?.context,
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
    await this.service.assertAccess(req.user?.id);
    return this.service.executeForAgent(agentId, body?.prompt, {
      taskId: body?.taskId,
      context: body?.context,
      userId: req.user.id,
      orgId: req.user.orgId,
    });
  }
}
