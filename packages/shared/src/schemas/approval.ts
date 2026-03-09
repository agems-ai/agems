import { z } from 'zod';

export const approvalPresets = ['FULL_CONTROL', 'SUPERVISED', 'GUIDED', 'AUTOPILOT'] as const;
export const toolApprovalModes = ['FREE', 'REQUIRES_APPROVAL', 'BLOCKED'] as const;
export const approvalStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'AUTO_APPROVED'] as const;
export const approvalCategories = ['READ', 'WRITE', 'DELETE', 'EXECUTE', 'SEND', 'ADMIN'] as const;

export const upsertPolicySchema = z.object({
  preset: z.enum(approvalPresets),
  readMode: z.enum(toolApprovalModes).nullable().optional(),
  writeMode: z.enum(toolApprovalModes).nullable().optional(),
  deleteMode: z.enum(toolApprovalModes).nullable().optional(),
  executeMode: z.enum(toolApprovalModes).nullable().optional(),
  sendMode: z.enum(toolApprovalModes).nullable().optional(),
  adminMode: z.enum(toolApprovalModes).nullable().optional(),
  toolOverrides: z.record(z.enum(toolApprovalModes)).optional(),
  approverType: z.enum(['AGENT', 'HUMAN']).optional(),
  approverId: z.string().uuid().optional(),
  autoApproveAfterMin: z.number().min(1).max(1440).optional(),
  autoApproveLowRisk: z.boolean().optional(),
  costThresholdUsd: z.number().min(0).optional(),
});

export const approvalFiltersSchema = z.object({
  agentId: z.string().uuid().optional(),
  status: z.enum(approvalStatuses).optional(),
  category: z.enum(approvalCategories).optional(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

export type ApprovalPreset = (typeof approvalPresets)[number];
export type ToolApprovalMode = (typeof toolApprovalModes)[number];
export type ApprovalStatus = (typeof approvalStatuses)[number];
export type ApprovalCategory = (typeof approvalCategories)[number];
export type UpsertPolicyInput = z.infer<typeof upsertPolicySchema>;
export type ApprovalFilters = z.infer<typeof approvalFiltersSchema>;
