import { z } from 'zod';

export const createPositionSchema = z.object({
  title: z.string().min(1).max(100),
  department: z.string().max(100).optional(),
  parentId: z.string().uuid().optional(),
  holderType: z.enum(['AGENT', 'HUMAN', 'HYBRID']),
  agentId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});

export const updatePositionSchema = createPositionSchema.partial();

export type CreatePositionInput = z.infer<typeof createPositionSchema>;
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;
