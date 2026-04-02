import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import { MeetingsService } from './meetings.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class MeetingsSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeetingsSchedulerService.name);
  private startInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private prisma: PrismaService,
    private meetingsService: MeetingsService,
    private events: EventEmitter2,
    private settings: SettingsService,
  ) {}

  onModuleInit() {
    // Check every 30 seconds for meetings that should be started
    this.startInterval = setInterval(() => this.autoStartMeetings(), 30_000);

    // Check every 2 minutes for stuck IN_PROGRESS meetings that need to be finished
    this.cleanupInterval = setInterval(() => this.finishStuckMeetings(), 120_000);

    this.logger.log('Meeting scheduler initialized (auto-start 30s, cleanup 120s)');

    // On startup, handle all stalled meetings
    setTimeout(() => this.handleStalledMeetings(), 10_000);
  }

  onModuleDestroy() {
    if (this.startInterval) { clearInterval(this.startInterval); this.startInterval = null; }
    if (this.cleanupInterval) { clearInterval(this.cleanupInterval); this.cleanupInterval = null; }
  }

  // ── Auto-start SCHEDULED meetings ──

  private async autoStartMeetings() {
    try {
      const dueMeetings = await this.prisma.meeting.findMany({
        where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
        include: { participants: true },
      });

      for (const meeting of dueMeetings) {
        try {
          // Check if meetings module is enabled for this org (respects master switch)
          if (meeting.orgId && !(await this.settings.isModuleEnabled('meetings', meeting.orgId))) {
            this.logger.debug(`Skipping meeting "${meeting.title}" — meetings module disabled for org`);
            continue;
          }
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

  // ── Trigger agents to discuss ──

  private async triggerAgents(meeting: { id: string; title: string; agenda: string | null; participants: any[] }) {
    const chairAgent = meeting.participants.find(
      (p: any) => p.participantType === 'AGENT' && p.role === 'CHAIR',
    );

    if (!chairAgent) {
      this.logger.log(`Meeting "${meeting.title}" has no agent CHAIR, skipping agent trigger`);
      return;
    }

    await this.meetingsService.addEntry(meeting.id, {
      speakerType: 'SYSTEM',
      speakerId: 'system',
      content: `Meeting "${meeting.title}" has auto-started at the scheduled time.${meeting.agenda ? ` Agenda: ${meeting.agenda}` : ''} Please begin the discussion.`,
      entryType: 'SPEECH',
    });

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

  // ── Handle stalled meetings on startup ──

  private async handleStalledMeetings() {
    try {
      const inProgressMeetings = await this.prisma.meeting.findMany({
        where: { status: 'IN_PROGRESS' },
        include: { participants: true },
      });

      for (const meeting of inProgressMeetings) {
        // Check if meetings module is enabled for this org (respects master switch)
        if (meeting.orgId && !(await this.settings.isModuleEnabled('meetings', meeting.orgId))) continue;

        const agentParticipants = meeting.participants.filter(
          (p: any) => p.participantType === 'AGENT',
        );
        if (agentParticipants.length === 0) continue;

        const agentEntries = await this.prisma.meetingEntry.count({
          where: { meetingId: meeting.id, speakerType: 'AGENT' },
        });

        const lastEntry = await this.prisma.meetingEntry.findFirst({
          where: { meetingId: meeting.id },
          orderBy: { order: 'desc' },
        });

        const lastEntryAge = lastEntry
          ? Date.now() - new Date(lastEntry.createdAt).getTime()
          : Infinity;
        const fiveMinutes = 5 * 60 * 1000;

        if (agentEntries === 0) {
          // No agent responses at all — re-trigger from scratch
          this.logger.warn(`Re-triggering stalled meeting "${meeting.title}" (${meeting.id}) — 0 agent responses`);
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
            await this.triggerAgents(meeting);
          }
        } else if (lastEntryAge > fiveMinutes && !(meeting as any).summary) {
          // Has agent responses but no activity for 5+ min and no summary — force finish
          this.logger.warn(`Force-finishing stuck meeting "${meeting.title}" (${meeting.id}) — ${agentEntries} agent entries, idle ${Math.round(lastEntryAge / 60000)}min`);
          this.events.emit('meeting.force.finish', { meetingId: meeting.id });
        }
      }
    } catch (err) {
      this.logger.error(`Handle stalled meetings error: ${err}`);
    }
  }

  // ── Periodic cleanup: finish any IN_PROGRESS meeting idle for too long ──

  private async finishStuckMeetings() {
    try {
      const inProgressMeetings = await this.prisma.meeting.findMany({
        where: { status: 'IN_PROGRESS' },
        select: { id: true, title: true, summary: true },
      });

      for (const meeting of inProgressMeetings) {
        // Already has summary — just needs to be marked COMPLETED
        if (meeting.summary) {
          this.logger.log(`Closing meeting "${meeting.title}" — summary exists but status was IN_PROGRESS`);
          await this.prisma.meeting.update({
            where: { id: meeting.id },
            data: { status: 'COMPLETED', endedAt: new Date() },
          });
          continue;
        }

        const lastEntry = await this.prisma.meetingEntry.findFirst({
          where: { meetingId: meeting.id },
          orderBy: { order: 'desc' },
        });

        if (!lastEntry) continue;

        const idleMinutes = (Date.now() - new Date(lastEntry.createdAt).getTime()) / 60000;

        // If idle for 10+ minutes, force finish
        if (idleMinutes >= 10) {
          const agentEntries = await this.prisma.meetingEntry.count({
            where: { meetingId: meeting.id, speakerType: 'AGENT' },
          });

          if (agentEntries > 0) {
            this.logger.warn(`Force-finishing idle meeting "${meeting.title}" (idle ${Math.round(idleMinutes)}min, ${agentEntries} agent entries)`);
            this.events.emit('meeting.force.finish', { meetingId: meeting.id });
          }
        }
      }
    } catch (err) {
      this.logger.error(`Finish stuck meetings error: ${err}`);
    }
  }
}
