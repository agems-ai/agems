import { z } from 'zod';

export const auditFiltersSchema = z.object({
  actorType: z.enum(['AGENT', 'HUMAN', 'SYSTEM']).optional(),
  actorId: z.string().uuid().optional(),
  action: z.enum([
    'CREATE', 'READ', 'UPDATE', 'DELETE',
    'EXECUTE', 'COMMUNICATE', 'LOGIN',
    'GRANT_ACCESS', 'REVOKE_ACCESS',
  ]).optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
});

export type AuditFilters = z.infer<typeof auditFiltersSchema>;
