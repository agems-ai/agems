import { Controller, Get, Post, Param, Body, Query, Request } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { RequestUser } from '../../common/types';

@Controller('meetings')
export class MeetingsController {
  constructor(private meetingsService: MeetingsService) {}

  @Post()
  create(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.meetingsService.createMeeting(body, 'HUMAN', req.user.id, req.user.orgId);
  }

  @Get()
  findAll(@Query() filters: any, @Request() req: { user: RequestUser }) {
    return this.meetingsService.findAllMeetings(filters, req.user.orgId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.meetingsService.findOneMeeting(id, req.user.orgId);
  }

  @Post(':id/start')
  start(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.meetingsService.startMeeting(id, req.user.orgId);
  }

  @Post(':id/end')
  end(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.meetingsService.endMeeting(id, req.user.orgId);
  }

  @Post(':id/entries')
  addEntry(@Param('id') meetingId: string, @Body() body: any) {
    return this.meetingsService.addEntry(meetingId, body);
  }

  @Post(':id/vote')
  startVote(@Param('id') meetingId: string, @Body() body: { description: string }) {
    return this.meetingsService.startVote(meetingId, body.description);
  }

  @Post(':id/vote/cast')
  castVote(@Body() body: { decisionId: string; vote: 'FOR' | 'AGAINST' | 'ABSTAIN' }) {
    return this.meetingsService.castVote(body.decisionId, body.vote);
  }

  @Post(':id/vote/:did/tally')
  tallyVote(@Param('did') decisionId: string) {
    return this.meetingsService.tallyVote(decisionId);
  }

  @Post(':id/tasks')
  createTask(@Param('id') meetingId: string, @Body() body: any, @Request() req: { user: RequestUser }) {
    return this.meetingsService.createTaskFromMeeting(meetingId, body, 'HUMAN', req.user.id, req.user.orgId);
  }

  @Get(':id/protocol')
  getProtocol(@Param('id') meetingId: string, @Request() req: { user: RequestUser }) {
    return this.meetingsService.getProtocol(meetingId, req.user.orgId);
  }
}
