import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class MeetingsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async createMeeting(input: any, creatorType: string, creatorId: string, orgId: string) {
    const meeting = await this.prisma.meeting.create({
      data: {
        title: input.title,
        agenda: input.agenda,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
        creatorType: creatorType as any,
        creatorId,
        orgId,
        participants: {
          create: [
            { participantType: creatorType as any, participantId: creatorId, role: 'CHAIR' },
            ...(input.participants || []).map((p: any) => ({
              participantType: p.type as any,
              participantId: p.id,
              role: (p.role ?? 'MEMBER') as any,
            })),
          ],
        },
      },
      include: { participants: true },
    });

    this.events.emit('audit.create', {
      actorType: creatorType, actorId: creatorId, action: 'CREATE',
      resourceType: 'meeting', resourceId: meeting.id,
    });
    return meeting;
  }

  async findAllMeetings(filters: any, orgId?: string) {
    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 20;
    const where = {
      ...(filters.status && { status: filters.status }),
      ...(orgId && { orgId }),
    };
    const [data, total] = await Promise.all([
      this.prisma.meeting.findMany({
        where, skip: (page - 1) * pageSize, take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { participants: true, _count: { select: { entries: true, decisions: true, tasks: true } } },
      }),
      this.prisma.meeting.count({ where }),
    ]);
    const resolved = await Promise.all(data.map(m => this.resolveNames(m)));
    return { data: resolved, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOneMeeting(id: string, orgId?: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id },
      include: {
        participants: true,
        entries: { orderBy: { order: 'asc' } },
        decisions: true,
        tasks: { include: { task: true } },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (orgId && (meeting as any).orgId !== orgId) throw new NotFoundException('Meeting not found');
    return this.resolveNames(meeting);
  }

  private async resolveNames<T extends { participants?: any[]; entries?: any[] }>(meeting: T): Promise<T> {
    const agentIds = new Set<string>();
    const userIds = new Set<string>();

    for (const p of meeting.participants || []) {
      if (p.participantType === 'AGENT') agentIds.add(p.participantId);
      else if (p.participantType === 'HUMAN') userIds.add(p.participantId);
    }
    for (const e of meeting.entries || []) {
      if (e.speakerType === 'AGENT') agentIds.add(e.speakerId);
      else if (e.speakerType === 'HUMAN') userIds.add(e.speakerId);
    }

    const [agents, users] = await Promise.all([
      agentIds.size > 0
        ? this.prisma.agent.findMany({ where: { id: { in: [...agentIds] } }, select: { id: true, name: true, avatar: true, positions: { select: { title: true }, take: 1 } } })
        : [],
      userIds.size > 0
        ? this.prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true, avatarUrl: true } })
        : [],
    ]);

    const agentMap = new Map(agents.map(a => [a.id, a]));
    const userMap = new Map(users.map(u => [u.id, u]));

    for (const p of meeting.participants || []) {
      if (p.participantType === 'AGENT') (p as any).agent = agentMap.get(p.participantId) || null;
      else if (p.participantType === 'HUMAN') (p as any).user = userMap.get(p.participantId) || null;
    }
    for (const e of meeting.entries || []) {
      if (e.speakerType === 'AGENT') (e as any).agent = agentMap.get(e.speakerId) || null;
      else if (e.speakerType === 'HUMAN') (e as any).user = userMap.get(e.speakerId) || null;
    }

    return meeting;
  }

  async startMeeting(id: string, orgId?: string) {
    const meeting = await this.findOneMeeting(id, orgId);
    if (meeting.status !== 'SCHEDULED') throw new BadRequestException('Meeting is not in SCHEDULED status');

    const updated = await this.prisma.meeting.update({
      where: { id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
      include: { participants: true },
    });

    await this.addEntry(id, { speakerType: 'SYSTEM', speakerId: 'system', content: 'Meeting started', entryType: 'SYSTEM' });
    this.events.emit('meeting.started', { meetingId: id });
    return updated;
  }

  async endMeeting(id: string, orgId?: string) {
    const meeting = await this.findOneMeeting(id, orgId);
    if (meeting.status !== 'IN_PROGRESS') throw new BadRequestException('Meeting is not in progress');

    await this.addEntry(id, { speakerType: 'SYSTEM', speakerId: 'system', content: 'Meeting ended', entryType: 'SYSTEM' });

    return this.prisma.meeting.update({
      where: { id },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });
  }

  async addEntry(meetingId: string, input: any) {
    const lastEntry = await this.prisma.meetingEntry.findFirst({
      where: { meetingId },
      orderBy: { order: 'desc' },
    });

    const entry = await this.prisma.meetingEntry.create({
      data: {
        meetingId,
        speakerType: input.speakerType as any,
        speakerId: input.speakerId,
        content: input.content,
        entryType: (input.entryType ?? 'SPEECH') as any,
        order: (lastEntry?.order ?? 0) + 1,
      },
    });

    this.events.emit('meeting.entry.new', { meetingId, entry });

    // Trigger agent responses when human speaks
    if (input.speakerType === 'HUMAN' && (input.entryType ?? 'SPEECH') === 'SPEECH') {
      this.events.emit('meeting.entry.human', { meetingId, entry });
    }

    return entry;
  }

  async startVote(meetingId: string, description: string) {
    const decision = await this.prisma.meetingDecision.create({
      data: { meetingId, description, result: 'TABLED' as any },
    });

    await this.addEntry(meetingId, {
      speakerType: 'SYSTEM', speakerId: 'system',
      content: `Vote started: ${description}`,
      entryType: 'VOTE_START',
    });

    this.events.emit('meeting.vote.started', { meetingId, decisionId: decision.id });
    return decision;
  }

  async castVote(decisionId: string, vote: 'FOR' | 'AGAINST' | 'ABSTAIN') {
    const field = vote === 'FOR' ? 'votesFor' : vote === 'AGAINST' ? 'votesAgainst' : 'votesAbstain';
    return this.prisma.meetingDecision.update({
      where: { id: decisionId },
      data: { [field]: { increment: 1 } },
    });
  }

  async tallyVote(decisionId: string) {
    const decision = await this.prisma.meetingDecision.findUnique({ where: { id: decisionId } });
    if (!decision) throw new NotFoundException('Decision not found');

    const result = decision.votesFor > decision.votesAgainst ? 'APPROVED' : 'REJECTED';
    const updated = await this.prisma.meetingDecision.update({
      where: { id: decisionId },
      data: { result: result as any },
    });

    await this.addEntry(decision.meetingId, {
      speakerType: 'SYSTEM', speakerId: 'system',
      content: `Vote result: ${result} (${decision.votesFor} for, ${decision.votesAgainst} against, ${decision.votesAbstain} abstain)`,
      entryType: 'VOTE_RESULT',
    });

    this.events.emit('meeting.vote.tallied', { meetingId: decision.meetingId, decision: updated });
    return updated;
  }

  async createTaskFromMeeting(meetingId: string, taskInput: any, creatorType: string, creatorId: string, orgId: string) {
    await this.findOneMeeting(meetingId, orgId);
    const task = await this.prisma.task.create({
      data: {
        title: taskInput.title,
        description: taskInput.description,
        priority: taskInput.priority ?? 'MEDIUM',
        type: 'ONE_TIME',
        creatorType: creatorType as any,
        creatorId,
        assigneeType: taskInput.assigneeType as any,
        assigneeId: taskInput.assigneeId,
        orgId,
      },
    });

    await this.prisma.meetingTask.create({
      data: { meetingId, taskId: task.id },
    });

    await this.addEntry(meetingId, {
      speakerType: 'SYSTEM', speakerId: 'system',
      content: `Task assigned: "${task.title}" → ${taskInput.assigneeType}:${taskInput.assigneeId}`,
      entryType: 'TASK_ASSIGN',
    });

    return task;
  }

  async getProtocol(meetingId: string, orgId?: string) {
    const meeting = await this.findOneMeeting(meetingId, orgId);
    return {
      title: meeting.title,
      agenda: meeting.agenda,
      status: meeting.status,
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt,
      participants: meeting.participants,
      entries: meeting.entries,
      decisions: meeting.decisions,
      tasks: meeting.tasks,
      summary: meeting.summary,
    };
  }
}
