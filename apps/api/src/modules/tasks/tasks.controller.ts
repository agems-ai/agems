import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Request } from '@nestjs/common';
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

  // ── Static routes (must be before :id param routes) ─────────────────

  @Post('labels')
  createLabel(
    @Body() body: { name: string; color: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.tasksService.createLabel(body.name, body.color, req.user.orgId);
  }

  @Get('labels')
  listLabels(@Request() req: { user: RequestUser }) {
    return this.tasksService.listLabels(req.user.orgId);
  }

  @Delete('labels/:labelId')
  deleteLabel(@Param('labelId') labelId: string, @Request() req: { user: RequestUser }) {
    return this.tasksService.deleteLabel(labelId, req.user.orgId);
  }

  @Get('inbox')
  getInbox(@Request() req: { user: RequestUser }) {
    return this.tasksService.getUnreadTasks(req.user.id, req.user.orgId);
  }

  // ── Parameterized routes ────────────────────────────────────────────

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

  // ── Labels on tasks ────────────────────────────────────────────────

  @Post(':id/labels/:labelId')
  addLabelToTask(
    @Param('id') id: string,
    @Param('labelId') labelId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.tasksService.addLabelToTask(id, labelId, req.user.orgId);
  }

  @Delete(':id/labels/:labelId')
  removeLabelFromTask(
    @Param('id') id: string,
    @Param('labelId') labelId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.tasksService.removeLabelFromTask(id, labelId, req.user.orgId);
  }

  // ── Attachments ─────────────────────────────────────────────────────

  @Post(':id/attachments')
  addAttachment(
    @Param('id') id: string,
    @Body() body: { filename: string; originalName: string; mimetype: string; size: number; url: string },
    @Request() req: { user: RequestUser },
  ) {
    return this.tasksService.addAttachment(id, body, 'HUMAN', req.user.id, req.user.orgId);
  }

  @Get(':id/attachments')
  listAttachments(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.tasksService.listAttachments(id, req.user.orgId);
  }

  @Delete(':id/attachments/:attachmentId')
  removeAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.tasksService.removeAttachment(id, attachmentId, req.user.orgId);
  }

  // ── Work Products ──────────────────────────────────────────────────

  @Post(':id/work-products')
  createWorkProduct(
    @Param('id') id: string,
    @Body() body: { title: string; description?: string; type: string; content?: string; metadata?: any },
    @Request() req: { user: RequestUser },
  ) {
    return this.tasksService.createWorkProduct(id, body, 'HUMAN', req.user.id, req.user.orgId);
  }

  @Get(':id/work-products')
  listWorkProducts(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.tasksService.listWorkProducts(id, req.user.orgId);
  }

  @Delete(':id/work-products/:productId')
  removeWorkProduct(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.tasksService.removeWorkProduct(id, productId, req.user.orgId);
  }

  // ── Read States ─────────────────────────────────────────────────────

  @Post(':id/read')
  markAsRead(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.tasksService.markAsRead(id, req.user.id, req.user.orgId);
  }

  @Delete(':id/read')
  markAsUnread(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.tasksService.markAsUnread(id, req.user.id, req.user.orgId);
  }
}
