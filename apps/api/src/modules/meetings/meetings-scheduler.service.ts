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

          // If there are agent participants, trigger the CHAIR agent to open the discussion
          const chairAgent = meeting.participants.find(
            (p) => p.participantType === 'AGENT' && p.role === 'CHAIR',
          );

          if (chairAgent) {
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
              this.events.emit('meeting.entry.human', {
                meetingId: meeting.id,
                entry: { ...lastEntry, speakerType: 'HUMAN', entryType: 'SPEECH' },
              });
            }
          }

          this.logger.log(`Meeting "${meeting.title}" auto-started successfully`);
        } catch (err) {
          this.logger.error(`Failed to auto-start meeting ${meeting.id}: ${err}`);
        }
      }
    } catch (err) {
      this.logger.error(`Auto-start scheduler error: ${err}`);
    }
  }
}
