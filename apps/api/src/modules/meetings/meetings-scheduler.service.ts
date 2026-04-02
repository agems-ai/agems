import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import { MeetingsService } from './meetings.service';

@Injectable()
export class MeetingsSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeetingsSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    private prisma: PrismaService,
    private meetingsService: MeetingsService,
    private events: EventEmitter2,
  ) {}

  onModuleInit() {
    // Check every 30 seconds for meetings that should be started
    this.intervalRef = setInterval(() => this.autoStartMeetings(), 30_000);
    this.logger.log('Meeting auto-start scheduler initialized (30s interval)');

    // On startup, check for stalled meetings (started but no agent responses)
    setTimeout(() => this.retriggerStalledMeetings(), 10_000);
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  private async autoStartMeetings() {
    try {
      const now = new Date();

      const dueMeetings = await this.prisma.meeting.findMany({
        where: {
          status: 'SCHEDULED',
          scheduledAt: { lte: now },
        },
        include: {
          participants: true,
        },
      });

      for (const meeting of dueMeetings) {
        try {
          this.logger.log(`Auto-starting meeting "${meeting.title}" (${meeting.id})`);

          await this.meetingsService.startMeeting(meeting.id);

          await this.triggerAgents(meeting);

          this.logger.log(`Meeting "${meeting.title}" auto-started successfully`);
        } catch (err) {
          this.logger.error(`Failed to auto-start meeting ${meeting.id}: ${err}`);
        }
      }
    } catch (err) {
      this.logger.error(`Auto-start scheduler error: ${err}`);
    }
  }

  /** Trigger agent participants to start discussing */
  private async triggerAgents(meeting: { id: string; title: string; agenda: string | null; participants: any[] }) {
    // If there are agent participants, trigger them to open the discussion
    const chairAgent = meeting.participants.find(
      (p: any) => p.participantType === 'AGENT' && p.role === 'CHAIR',
    );

    if (!chairAgent) {
      this.logger.log(`Meeting "${meeting.title}" has no agent CHAIR, skipping agent trigger`);
      return;
    }

    // Add a system prompt to kick off the discussion
    await this.meetingsService.addEntry(meeting.id, {
      speakerType: 'SYSTEM',
      speakerId: 'system',
      content: `Meeting "${meeting.title}" has auto-started at the scheduled time.${meeting.agenda ? ` Agenda: ${meeting.agenda}` : ''} Please begin the discussion.`,
      entryType: 'SPEECH',
    });

    // Emit as if a human spoke so agents respond
    const lastEntry = await this.prisma.meetingEntry.findFirst({
      where: { meetingId: meeting.id },
      orderBy: { order: 'desc' },
    });

    if (lastEntry) {
      this.logger.log(`Triggering ${meeting.participants.filter((p: any) => p.participantType === 'AGENT').length} agents for meeting "${meeting.title}"`);
      this.events.emit('meeting.entry.human', {
        meetingId: meeting.id,
        entry: { ...lastEntry, speakerType: 'HUMAN', entryType: 'SPEECH' },
      });
    }
  }

  /** Re-trigger IN_PROGRESS meetings where agents never responded (e.g. after server restart) */
  private async retriggerStalledMeetings() {
    try {
      const stalledMeetings = await this.prisma.meeting.findMany({
        where: {
          status: 'IN_PROGRESS',
        },
        include: {
          participants: true,
        },
      });

      for (const meeting of stalledMeetings) {
        // Check if any agent has responded
        const agentEntries = await this.prisma.meetingEntry.count({
          where: { meetingId: meeting.id, speakerType: 'AGENT' },
        });

        if (agentEntries > 0) continue; // agents already responded

        // Check if there are agent participants
        const agentParticipants = meeting.participants.filter(
          (p: any) => p.participantType === 'AGENT',
        );
        if (agentParticipants.length === 0) continue;

        this.logger.warn(`Re-triggering stalled meeting "${meeting.title}" (${meeting.id}) — ${agentParticipants.length} agents never responded`);

        // Find the last SPEECH entry to use as trigger
        const lastSpeech = await this.prisma.meetingEntry.findFirst({
          where: { meetingId: meeting.id, entryType: 'SPEECH' },
          orderBy: { order: 'desc' },
        });

        if (lastSpeech) {
          this.events.emit('meeting.entry.human', {
            meetingId: meeting.id,
            entry: { ...lastSpeech, speakerType: 'HUMAN', entryType: 'SPEECH' },
          });
        } else {
          // No speech entry exists, create one and trigger
          await this.triggerAgents(meeting);
        }
      }
    } catch (err) {
      this.logger.error(`Retrigger stalled meetings error: ${err}`);
    }
  }
}
