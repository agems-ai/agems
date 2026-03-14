import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Request } from '@nestjs/common';
import { ToolsService } from './tools.service';
import { SkillsService } from './skills.service';
import { RequestUser } from '../../common/types';

@Controller()
export class ToolsController {
  constructor(
    private toolsService: ToolsService,
    private skillsService: SkillsService,
  ) {}

  // ── Tools ──

  @Post('tools')
  createTool(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.toolsService.createTool(body, req.user.id, req.user.orgId);
  }

  @Get('tools')
  findAllTools(@Query() filters: any, @Request() req: { user: RequestUser }) {
    return this.toolsService.findAllTools(filters, req.user.orgId);
  }

  @Get('tools/export')
  exportTools(@Request() req: { user: RequestUser }) {
    return this.toolsService.exportTools(req.user.orgId);
  }

  @Post('tools/import')
  importTools(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.toolsService.importTools(body, req.user.orgId);
  }

  @Get('tools/:id')
  findOneTool(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.toolsService.findOneTool(id, req.user.orgId);
  }

  @Patch('tools/:id')
  updateTool(@Param('id') id: string, @Body() body: any, @Request() req: { user: RequestUser }) {
    return this.toolsService.updateTool(id, body, req.user.orgId);
  }

  @Delete('tools/:id')
  deleteTool(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.toolsService.deleteTool(id, req.user.orgId);
  }

  @Post('tools/:id/test')
  testTool(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.toolsService.testConnection(id, req.user.orgId);
  }

  // ── Skills ──

  @Post('skills')
  createSkill(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.skillsService.createSkill(body, req.user.orgId);
  }

  @Get('skills')
  findAllSkills(@Query() filters: any, @Request() req: { user: RequestUser }) {
    return this.skillsService.findAllSkills(filters, req.user.orgId);
  }

  @Get('skills/export')
  exportSkills(@Request() req: { user: RequestUser }) {
    return this.skillsService.exportSkills(req.user.orgId);
  }

  @Post('skills/import')
  importSkills(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.skillsService.importSkills(body, req.user.orgId);
  }

  @Get('skills/:id')
  findOneSkill(@Param('id') id: string) {
    return this.skillsService.findOneSkill(id);
  }

  @Patch('skills/:id')
  updateSkill(@Param('id') id: string, @Body() body: any) {
    return this.skillsService.updateSkill(id, body);
  }

  @Delete('skills/:id')
  deleteSkill(@Param('id') id: string) {
    return this.skillsService.deleteSkill(id);
  }

  // ── Agent assignments ──

  @Post('agents/:agentId/tools')
  assignTool(@Param('agentId') agentId: string, @Body() body: { toolId: string; permissions?: any }) {
    return this.toolsService.assignToolToAgent(agentId, body.toolId, body.permissions);
  }

  @Delete('agents/:agentId/tools/:toolId')
  removeTool(@Param('agentId') agentId: string, @Param('toolId') toolId: string) {
    return this.toolsService.removeToolFromAgent(agentId, toolId);
  }

  @Post('agents/:agentId/skills')
  assignSkill(@Param('agentId') agentId: string, @Body() body: { skillId: string; config?: any }) {
    return this.skillsService.assignSkillToAgent(agentId, body.skillId, body.config);
  }

  @Delete('agents/:agentId/skills/:skillId')
  removeSkill(@Param('agentId') agentId: string, @Param('skillId') skillId: string) {
    return this.skillsService.removeSkillFromAgent(agentId, skillId);
  }
}
