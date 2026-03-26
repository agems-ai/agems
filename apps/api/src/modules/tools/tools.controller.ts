import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Request } from '@nestjs/common';
import { ToolsService } from './tools.service';
import { SkillsService } from './skills.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types';

@Controller()
export class ToolsController {
  constructor(
    private toolsService: ToolsService,
    private skillsService: SkillsService,
  ) {}

  // ── Tools ──

  @Post('tools')
  @Roles('MANAGER')
  createTool(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.toolsService.createTool(body, req.user.id, req.user.orgId);
  }

  @Get('tools')
  findAllTools(@Query() filters: any, @Request() req: { user: RequestUser }) {
    return this.toolsService.findAllTools(filters, req.user.orgId);
  }

  @Get('tools/export')
  @Roles('ADMIN')
  exportTools(@Request() req: { user: RequestUser }) {
    return this.toolsService.exportTools(req.user.orgId);
  }

  @Post('tools/import')
  @Roles('ADMIN')
  importTools(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.toolsService.importTools(body, req.user.orgId);
  }

  @Get('tools/:id')
  findOneTool(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.toolsService.findOneTool(id, req.user.orgId);
  }

  @Patch('tools/:id')
  @Roles('MANAGER')
  updateTool(@Param('id') id: string, @Body() body: any, @Request() req: { user: RequestUser }) {
    return this.toolsService.updateTool(id, body, req.user.orgId);
  }

  @Delete('tools/:id')
  @Roles('ADMIN')
  deleteTool(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.toolsService.deleteTool(id, req.user.orgId);
  }

  @Post('tools/:id/test')
  @Roles('MANAGER')
  testTool(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.toolsService.testConnection(id, req.user.orgId);
  }

  // ── Skills ──

  @Post('skills')
  @Roles('MANAGER')
  createSkill(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.skillsService.createSkill(body, req.user.orgId);
  }

  @Get('skills')
  findAllSkills(@Query() filters: any, @Request() req: { user: RequestUser }) {
    return this.skillsService.findAllSkills(filters, req.user.orgId);
  }

  @Get('skills/export')
  @Roles('MANAGER')
  exportSkills(@Request() req: { user: RequestUser }) {
    return this.skillsService.exportSkills(req.user.orgId);
  }

  @Post('skills/import')
  @Roles('MANAGER')
  importSkills(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.skillsService.importSkills(body, req.user.orgId);
  }

  @Get('skills/:id')
  findOneSkill(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.skillsService.findOneSkill(id, req.user.orgId);
  }

  @Patch('skills/:id')
  @Roles('MANAGER')
  updateSkill(@Param('id') id: string, @Body() body: any, @Request() req: { user: RequestUser }) {
    return this.skillsService.updateSkill(id, body, req.user.orgId);
  }

  @Delete('skills/:id')
  @Roles('ADMIN')
  deleteSkill(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.skillsService.deleteSkill(id, req.user.orgId);
  }

  // ── Agent assignments ──

  @Post('agents/:agentId/tools')
  @Roles('MANAGER')
  assignTool(@Param('agentId') agentId: string, @Body() body: { toolId: string; permissions?: any }, @Request() req: { user: RequestUser }) {
    return this.toolsService.assignToolToAgent(agentId, body.toolId, body.permissions, req.user.orgId);
  }

  @Delete('agents/:agentId/tools/:toolId')
  @Roles('MANAGER')
  removeTool(@Param('agentId') agentId: string, @Param('toolId') toolId: string, @Request() req: { user: RequestUser }) {
    return this.toolsService.removeToolFromAgent(agentId, toolId, req.user.orgId);
  }

  @Post('agents/:agentId/skills')
  @Roles('MANAGER')
  assignSkill(@Param('agentId') agentId: string, @Body() body: { skillId: string; config?: any }, @Request() req: { user: RequestUser }) {
    return this.skillsService.assignSkillToAgent(agentId, body.skillId, body.config, req.user.orgId);
  }

  @Delete('agents/:agentId/skills/:skillId')
  @Roles('MANAGER')
  removeSkill(@Param('agentId') agentId: string, @Param('skillId') skillId: string, @Request() req: { user: RequestUser }) {
    return this.skillsService.removeSkillFromAgent(agentId, skillId, req.user.orgId);
  }
}
