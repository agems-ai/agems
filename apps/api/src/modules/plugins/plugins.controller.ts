import { Controller, Get, Post, Patch, Delete, Body, Param, Request } from '@nestjs/common';
import { PluginsService } from './plugins.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types';

@Controller('plugins')
export class PluginsController {
  constructor(private pluginsService: PluginsService) {}

  @Get()
  list(@Request() req: { user: RequestUser }) {
    return this.pluginsService.list(req.user.orgId);
  }

  @Get(':id')
  get(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.pluginsService.get(id, req.user.orgId);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @Body()
    body: {
      name: string;
      slug: string;
      version: string;
      description?: string;
      author?: string;
      homepage?: string;
      entryPoint: string;
      config?: Record<string, unknown>;
    },
    @Request() req: { user: RequestUser },
  ) {
    return this.pluginsService.create(body, req.user.orgId);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      version?: string;
      description?: string;
      author?: string;
      homepage?: string;
      entryPoint?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    },
    @Request() req: { user: RequestUser },
  ) {
    return this.pluginsService.update(id, body, req.user.orgId);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.pluginsService.remove(id, req.user.orgId);
  }

  @Post(':id/enable')
  @Roles('ADMIN')
  enable(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.pluginsService.setEnabled(id, true, req.user.orgId);
  }

  @Post(':id/disable')
  @Roles('ADMIN')
  disable(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.pluginsService.setEnabled(id, false, req.user.orgId);
  }
}
