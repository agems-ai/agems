import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Request } from '@nestjs/common';
import { GoalsService } from './goals.service';
import type { RequestUser } from '../../common/types';

@Controller('goals')
export class GoalsController {
  constructor(private goalsService: GoalsService) {}

  @Post()
  create(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.goalsService.create(body, req.user.id, req.user.orgId);
  }

  @Get('tree')
  getTree(@Request() req: { user: RequestUser }) {
    return this.goalsService.getTree(req.user.orgId);
  }

  @Get()
  findAll(@Query() filters: any, @Request() req: { user: RequestUser }) {
    return this.goalsService.findAll(filters, req.user.orgId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.goalsService.findOne(id, req.user.orgId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Request() req: { user: RequestUser }) {
    return this.goalsService.update(id, body, req.user.orgId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.goalsService.delete(id, req.user.orgId);
  }
}
