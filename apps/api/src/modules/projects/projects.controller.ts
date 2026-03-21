import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Request } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import type { RequestUser } from '../../common/types';

@Controller('projects')
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Post()
  create(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.projectsService.create(body, req.user.id, req.user.orgId);
  }

  @Get()
  findAll(@Query() filters: any, @Request() req: { user: RequestUser }) {
    return this.projectsService.findAll(filters, req.user.orgId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.projectsService.findOne(id, req.user.orgId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Request() req: { user: RequestUser }) {
    return this.projectsService.update(id, body, req.user.orgId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.projectsService.remove(id, req.user.orgId);
  }

  @Get(':id/stats')
  getStats(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.projectsService.getStats(id, req.user.orgId);
  }
}
