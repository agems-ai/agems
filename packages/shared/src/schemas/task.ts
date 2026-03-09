import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  type: z.enum(['ONE_TIME', 'RECURRING', 'CONTINUOUS']).default('ONE_TIME'),
  cronExpression: z.string().optional(),
  assigneeType: z.enum(['AGENT', 'HUMAN']),
  assigneeId: z.string().uuid(),
  parentTaskId: z.string().uuid().optional(),
  deadline: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'IN_TESTING', 'VERIFIED', 'COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  type: z.enum(['ONE_TIME', 'RECURRING', 'CONTINUOUS']).optional(),
  cronExpression: z.string().optional(),
  assigneeType: z.enum(['AGENT', 'HUMAN']).optional(),
  assigneeId: z.string().uuid().optional(),
  deadline: z.string().datetime().optional(),
  result: z.record(z.unknown()).optional(),
});

export const taskFiltersSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'IN_TESTING', 'VERIFIED', 'COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  assigneeType: z.enum(['AGENT', 'HUMAN']).optional(),
  assigneeId: z.string().uuid().optional(),
  creatorId: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskFilters = z.infer<typeof taskFiltersSchema>;
