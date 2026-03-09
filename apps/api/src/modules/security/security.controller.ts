import { Controller, Get, Post, Delete, Query, Body, Param, Request } from '@nestjs/common';
import { AuditService } from './audit.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types';

@Controller()
export class SecurityController {
  constructor(private auditService: AuditService) {}

  @Get('audit')
  @Roles('MANAGER')
  findAuditLogs(
    @Query() filters: {
      actorId?: string;
      actorType?: string;
      action?: string;
      resourceType?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    },
    @Request() req: { user: RequestUser },
  ) {
    return this.auditService.findAll(filters, req.user.orgId);
  }

  @Get('access-rules')
  findAccessRules(@Query('agentId') agentId?: string, @Request() req?: { user: RequestUser }) {
    return this.auditService.findAllAccessRules(agentId, req?.user?.orgId);
  }

  @Post('access-rules')
  @Roles('ADMIN')
  createAccessRule(@Body() input: any, @Request() req: { user: RequestUser }) {
    return this.auditService.createAccessRule(input, req.user.orgId);
  }

  @Delete('access-rules/:id')
  @Roles('ADMIN')
  deleteAccessRule(@Param('id') id: string) {
    return this.auditService.deleteAccessRule(id);
  }
}
