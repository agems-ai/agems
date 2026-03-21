import { Controller, Get, Post, Patch, Delete, Param, Body, Request } from '@nestjs/common';
import { OrgService } from './org.service';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestUser } from '../../common/types';

@Controller('org')
export class OrgController {
  constructor(private orgService: OrgService) {}

  // ── Organization ──

  @Get()
  getOrganization(@Request() req: { user: RequestUser }) {
    return this.orgService.getOrganization(req.user.orgId);
  }

  @Patch()
  @Roles('ADMIN')
  updateOrganization(@Request() req: { user: RequestUser }, @Body() body: { name?: string; slug?: string; metadata?: any }) {
    return this.orgService.updateOrganization(req.user.orgId, body);
  }

  @Post('create')
  createOrg(
    @Request() req: { user: RequestUser },
    @Body() body: { name: string; cloneFromOrgId?: string; cloneEntities?: string[] },
  ) {
    return this.orgService.createOrg(req.user.id, body.name, body.cloneFromOrgId, body.cloneEntities);
  }

  // ── Members ──

  @Get('members')
  getMembers(@Request() req: { user: RequestUser }) {
    return this.orgService.getMembers(req.user.orgId);
  }

  @Post('members/invite')
  @Roles('ADMIN')
  inviteMember(@Request() req: { user: RequestUser }, @Body() body: { email: string; role?: string }) {
    return this.orgService.inviteMember(req.user.orgId, body.email, body.role);
  }

  @Patch('members/:userId/role')
  @Roles('ADMIN')
  updateMemberRole(@Request() req: { user: RequestUser }, @Param('userId') userId: string, @Body() body: { role: string }) {
    return this.orgService.updateMemberRole(req.user.orgId, userId, body.role);
  }

  @Delete('members/:userId')
  @Roles('ADMIN')
  removeMember(@Request() req: { user: RequestUser }, @Param('userId') userId: string) {
    return this.orgService.removeMember(req.user.orgId, userId);
  }

  // ── Positions ──

  @Post('positions')
  @Roles('MANAGER')
  createPosition(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.orgService.createPosition({ ...body, orgId: req.user.orgId });
  }

  @Get('positions')
  findAllPositions(@Request() req: { user: RequestUser }) {
    return this.orgService.findAllPositions(req.user.orgId);
  }

  @Get('tree')
  getTree(@Request() req: { user: RequestUser }) {
    return this.orgService.getTree(req.user.orgId);
  }

  @Patch('positions/:id')
  @Roles('MANAGER')
  updatePosition(@Param('id') id: string, @Body() body: any, @Request() req: { user: RequestUser }) {
    return this.orgService.updatePosition(id, body, req.user.orgId);
  }

  @Delete('positions/:id')
  @Roles('ADMIN')
  deletePosition(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.orgService.deletePosition(id, req.user.orgId);
  }

  @Post('positions/:id/assign')
  assignHolder(@Param('id') id: string, @Body() body: { holderType: string; agentId?: string; userId?: string }, @Request() req: { user: RequestUser }) {
    return this.orgService.assignHolder(id, body.holderType, body.agentId, body.userId, req.user.orgId);
  }

  // ── Export / Import ──

  @Get('export')
  @Roles('ADMIN')
  exportOrg(@Request() req: { user: RequestUser }) {
    return this.orgService.exportOrg(req.user.orgId);
  }

  @Post('import')
  @Roles('ADMIN')
  importOrg(@Request() req: { user: RequestUser }, @Body() body: any) {
    return this.orgService.importOrg(req.user.orgId, body);
  }
}
