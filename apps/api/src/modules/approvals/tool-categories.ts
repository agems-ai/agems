/**
 * Maps tool names to approval action categories.
 * Used to determine which approval policy rule applies to a given tool.
 */

const STATIC_MAP: Record<string, string> = {
  // System tools
  bash_command: 'EXECUTE',
  read_file: 'READ',
  write_file: 'WRITE',

  // N8N tools
  n8n_list_workflows: 'READ',
  n8n_get_workflow: 'READ',
  n8n_get_executions: 'READ',
  n8n_create_workflow: 'WRITE',
  n8n_update_workflow: 'WRITE',
  n8n_delete_workflow: 'DELETE',
  n8n_activate_workflow: 'ADMIN',
  n8n_execute_workflow: 'EXECUTE',

  // Telegram
  tg_send_message: 'SEND',
  tg_find_contact: 'READ',
  tg_list_dialogs: 'READ',
};

/**
 * Resolve the approval category for a given tool name.
 * Handles both static names and dynamic prefixes (db_query_*, api_call_*, etc.).
 */
export function categorizeToolName(toolName: string): string {
  if (STATIC_MAP[toolName]) return STATIC_MAP[toolName];

  if (toolName.startsWith('db_query_') || toolName.startsWith('db_tables_')) return 'READ';
  if (toolName.startsWith('db_execute_')) return 'WRITE';
  if (toolName.startsWith('api_call_')) return 'WRITE';

  return 'EXECUTE'; // Unknown tools default to EXECUTE
}

/**
 * Generate a human-readable description of a tool call.
 */
export function describeToolCall(toolName: string, params: unknown): string {
  const p = params as Record<string, unknown>;

  if (toolName === 'bash_command') return `Run command: ${truncate(String(p.command ?? ''), 120)}`;
  if (toolName === 'write_file') return `Write file: ${p.path}`;
  if (toolName === 'read_file') return `Read file: ${p.path}`;

  if (toolName.startsWith('db_query_')) return `SQL query on ${toolName.slice(9)}: ${truncate(String(p.query ?? ''), 120)}`;
  if (toolName.startsWith('db_execute_')) return `SQL execute on ${toolName.slice(11)}: ${truncate(String(p.query ?? ''), 120)}`;
  if (toolName.startsWith('db_tables_')) return `List tables on ${toolName.slice(10)}`;

  if (toolName.startsWith('api_call_')) return `API ${p.method || 'call'} ${p.path || ''} on ${toolName.slice(9)}`;

  if (toolName === 'tg_send_message') return `Send Telegram message to ${p.contact}: ${truncate(String(p.text ?? ''), 80)}`;

  if (toolName.startsWith('n8n_')) return `N8N: ${toolName.slice(4).replace(/_/g, ' ')}${p.workflowId ? ` (${p.workflowId})` : ''}`;

  return `Execute ${toolName}`;
}

/**
 * Assess risk level based on tool name, category, and params.
 */
export function assessRiskLevel(toolName: string, category: string, _params: unknown): string {
  if (category === 'DELETE' || category === 'ADMIN') return 'HIGH';
  if (category === 'SEND') return 'MEDIUM';
  if (toolName === 'bash_command') return 'HIGH';
  if (toolName.startsWith('db_execute_')) return 'MEDIUM';
  if (category === 'WRITE') return 'MEDIUM';
  if (category === 'READ') return 'LOW';
  return 'MEDIUM';
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}
