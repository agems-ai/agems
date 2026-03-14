import { Controller, Get, Post, Delete, Param, Body, Query, Request } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../../config/prisma.service';
import { Public, Roles } from '../../common/decorators/roles.decorator';
import type { RequestUser } from '../../common/types';

@Controller('catalog')
export class CatalogController {
  constructor(
    private catalogService: CatalogService,
    private prisma: PrismaService,
  ) {}

  // ── Public browsing (no auth required) ──

  @Public()
  @Get('agents')
  listAgents(@Query() filters: any) {
    return this.catalogService.listAgents(filters);
  }

  @Public()
  @Get('skills')
  listSkills(@Query() filters: any) {
    return this.catalogService.listSkills(filters);
  }

  @Public()
  @Get('tools')
  listTools(@Query() filters: any) {
    return this.catalogService.listTools(filters);
  }

  @Public()
  @Get('agents/:id')
  getAgent(@Param('id') id: string) {
    return this.catalogService.getAgent(id);
  }

  @Public()
  @Get('skills/:id')
  getSkill(@Param('id') id: string) {
    return this.catalogService.getSkill(id);
  }

  @Public()
  @Get('tools/:id')
  getTool(@Param('id') id: string) {
    return this.catalogService.getTool(id);
  }

  // ── Authenticated: publish to catalog ──

  @Post('agents/publish')
  async publishAgent(@Body() body: any, @Request() req: { user: RequestUser }) {
    const orgName = await this.getOrgName(req.user.orgId);

    // Auto-publish linked skills and tools to catalog
    if (body.skillSlugs?.length) {
      for (const slug of body.skillSlugs) {
        const skill = await this.prisma.skill.findFirst({ where: { slug, orgId: req.user.orgId } });
        if (skill) {
          await this.catalogService.publishSkill({
            slug: skill.slug, name: skill.name, description: skill.description,
            content: skill.content, version: skill.version, type: skill.type,
            entryPoint: skill.entryPoint, configSchema: skill.configSchema, tags: [],
          }, orgName, req.user.email);
        }
      }
    }
    if (body.toolSlugs?.length) {
      for (const toolName of body.toolSlugs) {
        const tool = await this.prisma.tool.findFirst({ where: { name: toolName, orgId: req.user.orgId } });
        if (tool) {
          const slug = toolName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          await this.catalogService.publishTool({
            slug, name: tool.name, description: (tool.config as any)?.description || tool.name,
            type: tool.type, configTemplate: tool.config, authType: tool.authType, tags: [],
          }, orgName, req.user.email);
        }
      }
    }

    return this.catalogService.publishAgent(body, orgName, req.user.email);
  }

  @Post('skills/publish')
  async publishSkill(@Body() body: any, @Request() req: { user: RequestUser }) {
    const orgName = await this.getOrgName(req.user.orgId);
    return this.catalogService.publishSkill(body, orgName, req.user.email);
  }

  @Post('tools/publish')
  async publishTool(@Body() body: any, @Request() req: { user: RequestUser }) {
    const orgName = await this.getOrgName(req.user.orgId);
    return this.catalogService.publishTool(body, orgName, req.user.email);
  }

  // ── Authenticated: import from catalog ──

  @Post('agents/:id/import')
  importAgent(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.catalogService.importAgent(id, req.user.orgId, req.user.id);
  }

  @Post('skills/:id/import')
  importSkill(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.catalogService.importSkill(id, req.user.orgId);
  }

  @Post('tools/:id/import')
  importTool(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.catalogService.importTool(id, req.user.orgId);
  }

  // ── Admin: delete from catalog ──

  @Delete('agents/:id')
  @Roles('ADMIN')
  deleteAgent(@Param('id') id: string) {
    return this.catalogService.deleteAgent(id);
  }

  @Delete('skills/:id')
  @Roles('ADMIN')
  deleteSkill(@Param('id') id: string) {
    return this.catalogService.deleteSkill(id);
  }

  @Delete('tools/:id')
  @Roles('ADMIN')
  deleteTool(@Param('id') id: string) {
    return this.catalogService.deleteTool(id);
  }

  private async getOrgName(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    return org?.name || 'Unknown';
  }
}
