/**
 * Preset-to-category mappings for approval policies.
 * Each preset defines the default ToolApprovalMode per action category.
 */
export const APPROVAL_PRESETS: Record<string, Record<string, string>> = {
  FULL_CONTROL: {
    READ: 'REQUIRES_APPROVAL',
    WRITE: 'REQUIRES_APPROVAL',
    DELETE: 'REQUIRES_APPROVAL',
    EXECUTE: 'REQUIRES_APPROVAL',
    SEND: 'REQUIRES_APPROVAL',
    ADMIN: 'REQUIRES_APPROVAL',
  },
  SUPERVISED: {
    READ: 'FREE',
    WRITE: 'REQUIRES_APPROVAL',
    DELETE: 'REQUIRES_APPROVAL',
    EXECUTE: 'REQUIRES_APPROVAL',
    SEND: 'REQUIRES_APPROVAL',
    ADMIN: 'REQUIRES_APPROVAL',
  },
  GUIDED: {
    READ: 'FREE',
    WRITE: 'FREE',
    DELETE: 'REQUIRES_APPROVAL',
    EXECUTE: 'FREE',
    SEND: 'REQUIRES_APPROVAL',
    ADMIN: 'REQUIRES_APPROVAL',
  },
  AUTOPILOT: {
    READ: 'FREE',
    WRITE: 'FREE',
    DELETE: 'FREE',
    EXECUTE: 'FREE',
    SEND: 'FREE',
    ADMIN: 'FREE',
  },
};
