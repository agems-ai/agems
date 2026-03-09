import { z } from 'zod';

export const createMeetingSchema = z.object({
  title: z.string().min(1).max(200),
  agenda: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
  participantIds: z.array(z.object({
    type: z.enum(['AGENT', 'HUMAN']),
    id: z.string().uuid(),
    role: z.enum(['CHAIR', 'MEMBER', 'OBSERVER']).default('MEMBER'),
  })).min(2),
});

export const meetingEntrySchema = z.object({
  speakerType: z.enum(['AGENT', 'HUMAN', 'SYSTEM']),
  speakerId: z.string(),
  content: z.string().min(1),
  entryType: z.enum(['SPEECH', 'VOTE_START', 'VOTE_RESULT', 'DECISION', 'TASK_ASSIGN', 'SYSTEM']).default('SPEECH'),
});

export const meetingVoteSchema = z.object({
  description: z.string().min(1),
});

export const castVoteSchema = z.object({
  decisionId: z.string().uuid(),
  vote: z.enum(['FOR', 'AGAINST', 'ABSTAIN']),
});

export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type MeetingEntryInput = z.infer<typeof meetingEntrySchema>;
export type MeetingVoteInput = z.infer<typeof meetingVoteSchema>;
export type CastVoteInput = z.infer<typeof castVoteSchema>;
