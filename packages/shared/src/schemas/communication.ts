import { z } from 'zod';

export const createChannelSchema = z.object({
  name: z.string().max(100).optional(),
  type: z.enum(['DIRECT', 'GROUP', 'BROADCAST', 'SYSTEM']),
  participantIds: z.array(z.object({
    type: z.enum(['AGENT', 'HUMAN']),
    id: z.string().uuid(),
  })).min(1),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1),
  contentType: z.enum(['TEXT', 'JSON', 'FILE', 'ACTION']).default('TEXT'),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
