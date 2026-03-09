import { Controller, Get, Post, Patch, Body, Param, Query, Request } from '@nestjs/common';
import { TasksService } from './tasks.service';
import type { CreateTaskInput, UpdateTaskInput, TaskFilters } from '@agems/shared';
import type { RequestUser } from '../../common/types';

@Controller('tasks')
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Post()
  create(@Body() body: CreateTaskInput, @Request() req: { user: RequestUser }) {
    return this.tasksService.create(body, 'HUMAN', req.user.id, req.user.orgId);
  }

  @Get()
  findAll(@Query() filters: TaskFilters, @Request() req: { user: RequestUser }) {
    return this.tasksService.findAll(filters, req.user.orgId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.tasksService.findOne(id, req.user.orgId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateTaskInput, @Request() req: { user: RequestUser }) {
    return this.tasksService.update(id, body, req.user.orgId);
  }

  @Post(':id/assign')
  assign(
    @Param('id') id: string,
    @Body() body: { assigneeType: string; assigneeId: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.tasksService.assign(id, body.assigneeType, body.assigneeId, req.user.id);
  }

  @Post(':id/decompose')
  decompose(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.tasksService.decompose(id, req.user.id, req.user.orgId);
  }

  @Get(':id/comments')
  getComments(@Param('id') id: string) {
    return this.tasksService.getComments(id);
  }

  @Post(':id/comments')
  addComment(
    @Param('id') id: string,
    @Body() body: { content: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.tasksService.addComment(id, 'HUMAN', req.user.id, body.content, undefined, req.user.orgId);
  }
}
