import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Request,
} from '@nestjs/common';
import { AgentsService } from './agents.service';
import { DemoSeedService } from '../bootstrap/demo-seed.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { AGENT_TEMPLATES } from '../bootstrap/agent-templates';
import type { CreateAgentInput, UpdateAgentInput, AgentFilters } from '@agems/shared';
import type { RequestUser } from '../../common/types';

@Controller('agents')
export class AgentsController {
  constructor(
    private agentsService: AgentsService,
    private demoSeed: DemoSeedService,
  ) {}

  /** List all available agent templates for import */
  @Get('templates')
  getTemplates() {
    return AGENT_TEMPLATES.map(t => ({
      slug: t.slug,
      name: t.name,
      avatar: t.avatar,
      type: t.type,
      department: t.department,
      position: t.position,
      mission: t.mission,
      tags: t.tags,
      tools: t.tools,
      skills: t.skills,
      isStartupEssential: t.isStartupEssential,
    }));
  }

  @Get('export')
  exportAgents(@Request() req: { user: RequestUser }) {
    return this.agentsService.exportAgents(req.user.orgId);
  }

  @Post('import')
  @Roles('MANAGER')
  importAgents(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.agentsService.importAgents(body, req.user.id, req.user.orgId);
  }

  /** Import an agent from a template into the current org */
  @Post('import-template')
  @Roles('MANAGER')
  async importTemplate(
    @Body() body: { templateSlug: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.demoSeed.importAgentFromTemplate(req.user.orgId, req.user.id, body.templateSlug);
  }

  @Post()
  @Roles('MANAGER')
  create(@Body() body: CreateAgentInput, @Request() req: { user: RequestUser }) {
    return this.agentsService.create(body, req.user.id, req.user.orgId);
  }

  @Get()
  findAll(@Query() filters: AgentFilters, @Request() req: { user: RequestUser }) {
    return this.agentsService.findAll(filters, req.user.orgId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.agentsService.findOne(id, req.user.orgId);
  }

  @Patch(':id')
  @Roles('MANAGER')
  update(
    @Param('id') id: string,
    @Body() body: UpdateAgentInput,
    @Request() req: { user: RequestUser },
  ) {
    return this.agentsService.update(id, body, req.user.id, req.user.orgId);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.agentsService.activate(id, req.user.id, req.user.orgId);
  }

  @Post(':id/pause')
  pause(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.agentsService.pause(id, req.user.id, req.user.orgId);
  }

  @Delete(':id')
  @Roles('ADMIN')
  archive(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.agentsService.archive(id, req.user.id, req.user.orgId);
  }

  @Post(':id/unarchive')
  @Roles('ADMIN')
  unarchive(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.agentsService.unarchive(id, req.user.id, req.user.orgId);
  }

  @Get(':id/metrics')
  getMetrics(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.agentsService.getMetrics(id, req.user.orgId);
  }

  @Get(':id/memory')
  getMemory(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.agentsService.getMemory(id, req.user.orgId);
  }

  @Post(':id/memory')
  createMemory(
    @Param('id') id: string,
    @Body() body: { content: string; type?: string; metadata?: any },
    @Request() req: { user: RequestUser },
  ) {
    return this.agentsService.createMemory(id, body, req.user.orgId);
  }

  @Patch('memory/:memoryId')
  updateMemory(
    @Param('memoryId') memoryId: string,
    @Body() body: { content?: string; type?: string; metadata?: any },
    @Request() req: { user: RequestUser },
  ) {
    return this.agentsService.updateMemory(memoryId, body, req.user.orgId);
  }

  @Delete('memory/:memoryId')
  deleteMemory(@Param('memoryId') memoryId: string, @Request() req: { user: RequestUser }) {
    return this.agentsService.deleteMemory(memoryId, req.user.orgId);
  }

  @Get(':id/executions')
  getExecutions(@Param('id') id: string, @Query('limit') limit: string | undefined, @Request() req: { user: RequestUser }) {
    return this.agentsService.getExecutions(id, req.user.orgId, limit ? parseInt(limit, 10) : 20);
  }

  @Get(':id/cost-stats')
  getCostStats(
    @Param('id') id: string,
    @Query('period') period: 'daily' | 'weekly' | 'monthly' | undefined,
    @Query('days') days: string | undefined,
    @Request() req: { user: RequestUser },
  ) {
    return this.agentsService.getCostStats(id, req.user.orgId, period || 'daily', days ? parseInt(days, 10) : 30);
  }

  @Post(':id/spawn')
  @Roles('ADMIN')
  spawn(@Param('id') id: string, @Body() body: any, @Request() req: { user: RequestUser }) {
    return this.agentsService.spawn(id, body, req.user.id, req.user.orgId);
  }

  @Get(':id/hierarchy')
  getHierarchy(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.agentsService.getHierarchy(id, req.user.orgId);
  }

  @Post(':id/delegate')
  delegate(
    @Param('id') id: string,
    @Body() body: { childId: string; title: string; description?: string; priority?: string; parentTaskId?: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.agentsService.delegate(id, body.childId, body, req.user.id, req.user.orgId);
  }

  // --- Config Revisions ---

  @Get(':id/config-revisions')
  getConfigRevisions(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.agentsService.getConfigRevisions(id, req.user.orgId);
  }

  @Post(':id/config-revisions/rollback/:version')
  @Roles('MANAGER')
  rollbackConfig(
    @Param('id') id: string,
    @Param('version') version: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.agentsService.rollbackConfig(id, parseInt(version), req.user.id, req.user.orgId);
  }

  // --- API Keys ---

  @Post(':id/api-keys')
  @Roles('MANAGER')
  createApiKey(
    @Param('id') id: string,
    @Body() body: { name: string; expiresAt?: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.agentsService.createApiKey(id, body, req.user.id, req.user.orgId);
  }

  @Get(':id/api-keys')
  getApiKeys(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.agentsService.getApiKeys(id, req.user.orgId);
  }

  @Delete(':id/api-keys/:keyId')
  @Roles('MANAGER')
  revokeApiKey(
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.agentsService.revokeApiKey(id, keyId, req.user.id, req.user.orgId);
  }
}
