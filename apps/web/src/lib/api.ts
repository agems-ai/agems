const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('agems_token', token);
    }
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('agems_token');
    }
    return this.token;
  }

  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('agems_token');
    }
  }

  getUserFromToken(): { id: string; name: string; email: string; role: string; orgId: string } | null {
    const token = this.getToken();
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1]));
      if (!payload.sub) return null;
      return { id: payload.sub, name: payload.name, email: payload.email, role: payload.role, orgId: payload.orgId };
    } catch { return null; }
  }

  async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const token = this.getToken();
    const res = await fetch(`${API_URL}/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      // Surface a friendly message for rate-limit / throttler responses —
      // the raw exception name ("ThrottlerException: Too Many Requests") is
      // noisy and unhelpful to end users.
      if (res.status === 429) {
        throw new Error('Too many attempts — please wait a minute and try again.');
      }
      throw new Error(error.message || `API Error: ${res.status}`);
    }

    return res.json();
  }

  // Auth
  register(email: string, password: string, name: string, orgName?: string, inviteCode?: string) {
    return this.fetch<{ user: any; org: any; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, orgName, inviteCode }),
    });
  }

  login(email: string, password: string, orgId?: string) {
    return this.fetch<{ user: any; org: any; token: string; requireOrgSelection?: boolean; organizations?: any[] }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(orgId && { orgId }) }),
    });
  }

  getProfile() {
    return this.fetch<any>('/auth/profile');
  }

  forgotPassword(email: string) {
    return this.fetch<{ ok: true }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  resetPassword(token: string, password: string) {
    return this.fetch<{ ok: true }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  }

  switchOrg(orgId: string) {
    return this.fetch<{ org: any; token: string }>('/auth/switch-org', {
      method: 'POST',
      body: JSON.stringify({ orgId }),
    });
  }

  createOrg(name: string, cloneFromOrgId?: string, cloneEntities?: string[]) {
    return this.fetch<any>('/org/create', {
      method: 'POST',
      body: JSON.stringify({ name, cloneFromOrgId, cloneEntities }),
    });
  }

  // Agents
  getAgents(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.fetch<any>(`/agents${query}`);
  }

  getAgent(id: string) {
    return this.fetch<any>(`/agents/${id}`);
  }

  createAgent(data: any) {
    return this.fetch('/agents', { method: 'POST', body: JSON.stringify(data) });
  }

  getAgentTemplates() {
    return this.fetch<any[]>('/agents/templates');
  }

  importAgentFromTemplate(templateSlug: string) {
    return this.fetch<any>('/agents/import-template', {
      method: 'POST',
      body: JSON.stringify({ templateSlug }),
    });
  }

  updateAgent(id: string, data: any) {
    return this.fetch(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  activateAgent(id: string) {
    return this.fetch(`/agents/${id}/activate`, { method: 'POST' });
  }

  pauseAgent(id: string) {
    return this.fetch(`/agents/${id}/pause`, { method: 'POST' });
  }

  executeAgent(id: string, message: string) {
    return this.fetch<any>(`/agents/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  // Tasks
  getTasks(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.fetch<any>(`/tasks${query}`);
  }

  getInbox() {
    return this.fetch<any[]>('/tasks/inbox');
  }

  markTaskRead(taskId: string) {
    return this.fetch(`/tasks/${taskId}/read`, { method: 'POST' });
  }

  markTaskUnread(taskId: string) {
    return this.fetch(`/tasks/${taskId}/unread`, { method: 'POST' });
  }

  markAllTasksRead() {
    return this.fetch('/tasks/read-all', { method: 'POST' });
  }

  createTask(data: any) {
    return this.fetch('/tasks', { method: 'POST', body: JSON.stringify(data) });
  }

  updateTask(id: string, data: any) {
    return this.fetch(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  deleteTask(id: string) {
    return this.fetch(`/tasks/${id}`, { method: 'DELETE' });
  }

  getTask(id: string) {
    return this.fetch<any>(`/tasks/${id}`);
  }

  getTaskComments(taskId: string) {
    return this.fetch<any[]>(`/tasks/${taskId}/comments`);
  }

  addTaskComment(taskId: string, content: string) {
    return this.fetch(`/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ content }) });
  }

  // Task Agents Config (legacy — kept for backward compat)
  getTaskAgentsConfig() {
    return this.fetch<{ enabled: boolean; interval: number; reviewInterval: number; reviewBudget: number; autonomyLevel: number }>('/settings/task-agents');
  }

  setTaskAgentsConfig(data: { enabled?: boolean; interval?: number; reviewInterval?: number; reviewBudget?: number; autonomyLevel?: number }) {
    return this.fetch<{ enabled: boolean; interval: number; reviewInterval: number; reviewBudget: number; autonomyLevel: number }>('/settings/task-agents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Module Settings (per-module enable/activity/autonomy)
  getModulesConfig() {
    return this.fetch<{
      globalEnabled: boolean;
      crossChannel: { enabled: boolean; messageCount: number };
      modules: Record<string, { enabled: boolean; activityLevel: number; autonomyLevel: number }>;
    }>('/settings/modules');
  }

  setModulesConfig(data: {
    globalEnabled?: boolean;
    crossChannel?: { enabled?: boolean; messageCount?: number };
    modules?: Record<string, { enabled?: boolean; activityLevel?: number; autonomyLevel?: number }>;
  }) {
    return this.fetch<{
      globalEnabled: boolean;
      crossChannel: { enabled: boolean; messageCount: number };
      modules: Record<string, { enabled: boolean; activityLevel: number; autonomyLevel: number }>;
    }>('/settings/modules', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Channels (Comms)
  getChannels() {
    return this.fetch<any[]>('/channels');
  }

  getAgentChats() {
    return this.fetch<any[]>('/channels/agent-chats');
  }

  getChannel(id: string) {
    return this.fetch<any>(`/channels/${id}`);
  }

  createChannel(data: any) {
    return this.fetch('/channels', { method: 'POST', body: JSON.stringify(data) });
  }

  getMessages(channelId: string, params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.fetch<any>(`/channels/${channelId}/messages${query}`);
  }

  sendMessage(channelId: string, content: string, contentType = 'TEXT', metadata?: Record<string, any>) {
    return this.fetch<any>(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, contentType, ...(metadata && { metadata }) }),
    });
  }

  async uploadFile(channelId: string, file: File): Promise<{ url: string; filename: string; originalName: string; size: number; mimetype: string }> {
    const token = this.getToken();
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_URL}/api/channels/${channelId}/upload`, {
      method: 'POST',
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || 'Upload failed');
    }
    return res.json();
  }

  addParticipant(channelId: string, data: any) {
    return this.fetch(`/channels/${channelId}/participants`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  removeParticipant(channelId: string, participantId: string) {
    return this.fetch(`/channels/${channelId}/participants/${participantId}`, { method: 'DELETE' });
  }

  updateChannel(channelId: string, data: { name?: string; metadata?: any }) {
    return this.fetch<any>(`/channels/${channelId}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  deleteChannel(channelId: string) {
    return this.fetch(`/channels/${channelId}`, { method: 'DELETE' });
  }

  ensureDirectChats() {
    return this.fetch<{ created: number; total: number; existing: number }>('/channels/ensure-direct', { method: 'POST' });
  }

  findDirectChannel(type: string, targetId: string) {
    return this.fetch<any>(`/channels/direct/${type}/${targetId}`);
  }

  findAllDirectChannels(type: string, targetId: string) {
    return this.fetch<any[]>(`/channels/direct/${type}/${targetId}/all`);
  }

  // Tools
  getTools() {
    return this.fetch<any>('/tools');
  }

  createTool(data: any) {
    return this.fetch('/tools', { method: 'POST', body: JSON.stringify(data) });
  }

  updateTool(id: string, data: any) {
    return this.fetch(`/tools/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  deleteTool(id: string) {
    return this.fetch(`/tools/${id}`, { method: 'DELETE' });
  }

  testTool(id: string) {
    return this.fetch<any>(`/tools/${id}/test`, { method: 'POST' });
  }

  // Skills
  getSkills() {
    return this.fetch<any>('/skills?pageSize=100');
  }

  createSkill(data: any) {
    return this.fetch('/skills', { method: 'POST', body: JSON.stringify(data) });
  }

  updateSkill(id: string, data: any) {
    return this.fetch(`/skills/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  deleteSkill(id: string) {
    return this.fetch(`/skills/${id}`, { method: 'DELETE' });
  }

  exportSkills() {
    return this.fetch<any>('/skills/export');
  }

  importSkills(data: any) {
    return this.fetch<any>('/skills/import', { method: 'POST', body: JSON.stringify(data) });
  }

  assignSkillToAgent(agentId: string, skillId: string, config?: any) {
    return this.fetch(`/agents/${agentId}/skills`, { method: 'POST', body: JSON.stringify({ skillId, config }) });
  }

  removeSkillFromAgent(agentId: string, skillId: string) {
    return this.fetch(`/agents/${agentId}/skills/${skillId}`, { method: 'DELETE' });
  }

  // Meetings
  getMeetings(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.fetch<any>(`/meetings${query}`);
  }

  getMeeting(id: string) {
    return this.fetch<any>(`/meetings/${id}`);
  }

  createMeeting(data: any) {
    return this.fetch('/meetings', { method: 'POST', body: JSON.stringify(data) });
  }

  startMeeting(id: string) {
    return this.fetch(`/meetings/${id}/start`, { method: 'POST' });
  }

  endMeeting(id: string) {
    return this.fetch(`/meetings/${id}/end`, { method: 'POST' });
  }

  addMeetingEntry(meetingId: string, data: any) {
    return this.fetch(`/meetings/${meetingId}/entries`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  startVote(meetingId: string, description: string) {
    return this.fetch(`/meetings/${meetingId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    });
  }

  castVote(meetingId: string, decisionId: string, vote: string) {
    return this.fetch(`/meetings/${meetingId}/vote/cast`, {
      method: 'POST',
      body: JSON.stringify({ decisionId, vote }),
    });
  }

  tallyVote(meetingId: string, decisionId: string) {
    return this.fetch(`/meetings/${meetingId}/vote/${decisionId}/tally`, { method: 'POST' });
  }

  getMeetingProtocol(meetingId: string) {
    return this.fetch<any>(`/meetings/${meetingId}/protocol`);
  }

  // Organization Management
  getOrganization() {
    return this.fetch<any>('/org');
  }

  updateOrganization(data: { name?: string; slug?: string }) {
    return this.fetch<any>('/org', { method: 'PATCH', body: JSON.stringify(data) });
  }

  getOrgMembers() {
    return this.fetch<any[]>('/org/members');
  }

  inviteOrgMember(email: string, role?: string) {
    return this.fetch<any>('/org/members/invite', {
      method: 'POST', body: JSON.stringify({ email, role }),
    });
  }

  updateOrgMemberRole(userId: string, role: string) {
    return this.fetch<any>(`/org/members/${userId}/role`, {
      method: 'PATCH', body: JSON.stringify({ role }),
    });
  }

  removeOrgMember(userId: string) {
    return this.fetch(`/org/members/${userId}`, { method: 'DELETE' });
  }

  // Org Structure
  getOrgPositions() {
    return this.fetch<any[]>('/org/positions');
  }

  getOrgTree() {
    return this.fetch<any[]>('/org/tree');
  }

  createOrgPosition(data: any) {
    return this.fetch('/org/positions', { method: 'POST', body: JSON.stringify(data) });
  }

  updateOrgPosition(id: string, data: any) {
    return this.fetch(`/org/positions/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  deleteOrgPosition(id: string) {
    return this.fetch(`/org/positions/${id}`, { method: 'DELETE' });
  }

  assignOrgHolder(positionId: string, data: any) {
    return this.fetch(`/org/positions/${positionId}/assign`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Security
  getAuditLogs(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.fetch<any>(`/audit${query}`);
  }

  getAccessRules(agentId?: string) {
    const query = agentId ? `?agentId=${agentId}` : '';
    return this.fetch<any[]>(`/access-rules${query}`);
  }

  createAccessRule(data: any) {
    return this.fetch('/access-rules', { method: 'POST', body: JSON.stringify(data) });
  }

  deleteAccessRule(id: string) {
    return this.fetch(`/access-rules/${id}`, { method: 'DELETE' });
  }

  // Settings
  getSettings() {
    return this.fetch<Record<string, string>>('/settings');
  }

  updateSettings(data: Record<string, string>) {
    return this.fetch<Record<string, string>>('/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  getLlmKeys() {
    return this.fetch<Record<string, { set: boolean; masked: string }>>('/settings/llm-keys');
  }

  setLlmKeys(keys: Record<string, string>) {
    return this.fetch<Record<string, { set: boolean; masked: string }>>('/settings/llm-keys', {
      method: 'POST',
      body: JSON.stringify(keys),
    });
  }

  getUsers() {
    return this.fetch<any[]>('/settings/users');
  }

  createUser(data: { email: string; password: string; name: string; role?: string }) {
    return this.fetch<any>('/settings/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateUser(userId: string, data: { name?: string; email?: string; role?: string; password?: string }) {
    return this.fetch<any>(`/settings/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  deleteUser(userId: string) {
    return this.fetch(`/settings/users/${userId}`, { method: 'DELETE' });
  }

  async uploadUserAvatar(userId: string, file: File): Promise<any> {
    const token = this.getToken();
    const form = new FormData();
    form.append('avatar', file);
    const res = await fetch(`${API_URL}/api/settings/users/${userId}/avatar`, {
      method: 'POST',
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
      body: form,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(error.message || `Upload failed: ${res.status}`);
    }
    return res.json();
  }

  // Company Profile
  getCompanyProfile() {
    return this.fetch<Record<string, string>>('/settings/company');
  }

  setCompanyProfile(data: Record<string, string>) {
    return this.fetch<Record<string, string>>('/settings/company', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // N8N Settings
  getN8nSettings() {
    return this.fetch<{ url: string; keySet: boolean; keyMasked: string }>('/settings/n8n');
  }

  setN8nSettings(url: string, key?: string) {
    return this.fetch<{ url: string; keySet: boolean; keyMasked: string }>('/settings/n8n', {
      method: 'POST',
      body: JSON.stringify({ url, key }),
    });
  }

  testN8nConnection() {
    return this.fetch<{ ok: boolean; error?: string; workflowCount?: number }>('/n8n/test');
  }

  // System Prompts
  getSystemPrompts() {
    return this.fetch<Record<string, string>>('/settings/system-prompts');
  }

  setSystemPrompts(data: Record<string, string>) {
    return this.fetch<Record<string, string>>('/settings/system-prompts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  resetSystemPrompt(key: string) {
    return this.fetch<Record<string, string>>('/settings/system-prompts/reset', {
      method: 'POST',
      body: JSON.stringify({ key }),
    });
  }

  // N8N Workflows
  getN8nWorkflows(params?: { active?: boolean; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.active !== undefined) query.set('active', String(params.active));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.fetch<any>(`/n8n/workflows${qs ? '?' + qs : ''}`);
  }

  getN8nWorkflow(id: string) {
    return this.fetch<any>(`/n8n/workflows/${id}`);
  }

  createN8nWorkflow(data: { name: string; nodes?: any[]; connections?: any }) {
    return this.fetch<any>('/n8n/workflows', { method: 'POST', body: JSON.stringify(data) });
  }

  updateN8nWorkflow(id: string, data: any) {
    return this.fetch<any>(`/n8n/workflows/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  deleteN8nWorkflow(id: string) {
    return this.fetch(`/n8n/workflows/${id}`, { method: 'DELETE' });
  }

  activateN8nWorkflow(id: string) {
    return this.fetch<any>(`/n8n/workflows/${id}/activate`, { method: 'POST' });
  }

  deactivateN8nWorkflow(id: string) {
    return this.fetch<any>(`/n8n/workflows/${id}/deactivate`, { method: 'POST' });
  }

  executeN8nWorkflow(id: string, data?: any) {
    return this.fetch<any>(`/n8n/workflows/${id}/execute`, { method: 'POST', body: data ? JSON.stringify(data) : undefined });
  }

  getN8nExecutions(params?: { workflowId?: string; status?: string; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.workflowId) query.set('workflowId', params.workflowId);
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.fetch<any>(`/n8n/executions${qs ? '?' + qs : ''}`);
  }

  // Agent Executions
  getAgentExecutions(agentId: string, limit = 10) {
    return this.fetch<any[]>(`/agents/${agentId}/executions?limit=${limit}`);
  }

  // Agent Tools
  assignToolToAgent(agentId: string, toolId: string, permissions?: { read?: boolean; write?: boolean; execute?: boolean }) {
    return this.fetch(`/agents/${agentId}/tools`, {
      method: 'POST',
      body: JSON.stringify({ toolId, permissions }),
    });
  }

  removeToolFromAgent(agentId: string, toolId: string) {
    return this.fetch(`/agents/${agentId}/tools/${toolId}`, { method: 'DELETE' });
  }

  // Agent Meta-Management
  spawnAgent(parentId: string, data: { name: string; slug: string; mission?: string; llmProvider?: string; llmModel?: string; systemPrompt?: string }) {
    return this.fetch<any>(`/agents/${parentId}/spawn`, { method: 'POST', body: JSON.stringify(data) });
  }

  getAgentHierarchy(agentId: string) {
    return this.fetch<any>(`/agents/${agentId}/hierarchy`);
  }

  delegateToAgent(parentId: string, data: { childAgentId: string; title: string; description?: string; priority?: string }) {
    return this.fetch<any>(`/agents/${parentId}/delegate`, {
      method: 'POST',
      body: JSON.stringify({ childId: data.childAgentId, title: data.title, description: data.description, priority: data.priority }),
    });
  }

  archiveAgent(agentId: string) {
    return this.fetch<any>(`/agents/${agentId}`, { method: 'DELETE' });
  }

  unarchiveAgent(agentId: string) {
    return this.fetch<any>(`/agents/${agentId}/unarchive`, { method: 'POST' });
  }

  getAgentMetrics(agentId: string) {
    return this.fetch<any>(`/agents/${agentId}/metrics`);
  }

  getAgentMemory(agentId: string) {
    return this.fetch<any>(`/agents/${agentId}/memory`);
  }

  createAgentMemory(agentId: string, data: { content: string; type?: string; metadata?: any }) {
    return this.fetch<any>(`/agents/${agentId}/memory`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateAgentMemory(memoryId: string, data: { content?: string; type?: string }) {
    return this.fetch<any>(`/agents/memory/${memoryId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  deleteAgentMemory(memoryId: string) {
    return this.fetch<any>(`/agents/memory/${memoryId}`, { method: 'DELETE' });
  }

  getAgentBuiltinTools(agentId: string) {
    return this.fetch<Array<{ name: string; description: string; category: string; enabled: boolean }>>(`/agents/${agentId}/builtin-tools`);
  }

  toggleAgentBuiltinTool(agentId: string, toolName: string, enabled: boolean) {
    return this.fetch(`/agents/${agentId}/builtin-tools`, {
      method: 'PATCH',
      body: JSON.stringify({ toolName, enabled }),
    });
  }

  // Telegram
  getTelegramBots() {
    return this.fetch<any[]>('/telegram/bots');
  }

  getTelegramBotStatus(agentId: string) {
    return this.fetch<any>(`/telegram/bots/${agentId}/status`);
  }

  startTelegramBot(agentId: string) {
    return this.fetch<any>(`/telegram/bots/${agentId}/start`, { method: 'POST' });
  }

  stopTelegramBot(agentId: string) {
    return this.fetch<any>(`/telegram/bots/${agentId}/stop`, { method: 'POST' });
  }

  testTelegramToken(token: string) {
    return this.fetch<any>('/telegram/test-token', { method: 'POST', body: JSON.stringify({ token }) });
  }

  getTelegramChats(agentId: string) {
    return this.fetch<any[]>(`/telegram/chats/${agentId}`);
  }

  approveTelegramChat(chatId: string) {
    return this.fetch<any>(`/telegram/chats/${chatId}/approve`, { method: 'PATCH' });
  }

  rejectTelegramChat(chatId: string) {
    return this.fetch<any>(`/telegram/chats/${chatId}/reject`, { method: 'PATCH' });
  }

  // Dashboard
  getActivity() {
    return this.fetch<{
      running: any[];
      recent: any[];
    }>('/dashboard/activity');
  }

  getSystemStats() {
    return this.fetch<any>('/dashboard/system-stats');
  }

  getDashboardTools() {
    return this.fetch<{ id: string; name: string; type: string; database: string; url: string; description: string }[]>('/dashboard/tools');
  }

  dashboardQuery(toolId: string, sql: string) {
    return this.fetch<{ data?: any[]; rowCount?: number; error?: string }>('/dashboard/query', {
      method: 'POST',
      body: JSON.stringify({ toolId, sql }),
    });
  }

  dashboardHttp(toolId: string, method: string, path: string, body?: any, queryParams?: Record<string, string>) {
    return this.fetch<{ data?: any; error?: string }>('/dashboard/http', {
      method: 'POST',
      body: JSON.stringify({ toolId, method, path, body, queryParams }),
    });
  }

  getDashboardWidgets() {
    return this.fetch<any[]>('/dashboard/widgets');
  }

  saveDashboardWidgets(widgets: any[]) {
    return this.fetch<any[]>('/dashboard/widgets', {
      method: 'POST',
      body: JSON.stringify({ widgets }),
    });
  }

  stopExecution(executionId: string) {
    return this.fetch<{ stopped: boolean }>(`/dashboard/stop-execution/${executionId}`, { method: 'POST' });
  }

  stopAllExecutions() {
    return this.fetch<{ stopped: number; total: number }>('/dashboard/stop-all', { method: 'POST' });
  }

  // Folders
  getFolders(parentId?: string) {
    const qs = parentId ? `?parentId=${parentId}` : '';
    return this.fetch<any[]>(`/files/folders${qs}`);
  }

  getFolderTree() {
    return this.fetch<any[]>('/files/folders/tree');
  }

  getFolder(id: string) {
    return this.fetch<any>(`/files/folders/${id}`);
  }

  createFolder(data: { name: string; parentId?: string }) {
    return this.fetch<any>('/files/folders', { method: 'POST', body: JSON.stringify(data) });
  }

  updateFolder(id: string, data: { name?: string; parentId?: string | null }) {
    return this.fetch<any>(`/files/folders/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  deleteFolder(id: string) {
    return this.fetch<any>(`/files/folders/${id}`, { method: 'DELETE' });
  }

  // Files
  getFiles(params?: { page?: number; type?: string; search?: string; folderId?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.type) query.set('type', params.type);
    if (params?.search) query.set('search', params.search);
    if (params?.folderId) query.set('folderId', params.folderId);
    const qs = query.toString();
    return this.fetch<any>(`/files${qs ? '?' + qs : ''}`);
  }

  async uploadFileStandalone(file: File, folderId?: string): Promise<any> {
    const token = this.getToken();
    const form = new FormData();
    form.append('file', file);
    const qs = folderId ? `?folderId=${folderId}` : '';
    const res = await fetch(`${API_URL}/api/files/upload${qs}`, {
      method: 'POST',
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || 'Upload failed');
    }
    return res.json();
  }

  moveFile(id: string, folderId: string | null) {
    return this.fetch<any>(`/files/${id}/move`, { method: 'PUT', body: JSON.stringify({ folderId }) });
  }

  renameFile(id: string, name: string) {
    return this.fetch<any>(`/files/${id}/rename`, { method: 'PUT', body: JSON.stringify({ name }) });
  }

  deleteFile(id: string) {
    return this.fetch(`/files/${id}`, { method: 'DELETE' });
  }

  syncFiles() {
    return this.fetch<{ synced: number }>('/files/sync', { method: 'POST' });
  }

  // Budgets
  getBudgets(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.fetch<any>(`/budgets${query}`);
  }

  getBudgetSummary() {
    return this.fetch<{ totalLimit: number; totalSpend: number; agentsOverBudget: number; utilization: number }>('/budgets/summary');
  }

  createBudget(data: any) {
    return this.fetch('/budgets', { method: 'POST', body: JSON.stringify(data) });
  }

  updateBudget(id: string, data: any) {
    return this.fetch(`/budgets/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  getBudgetIncidents(id: string) {
    return this.fetch<any[]>(`/budgets/${id}/incidents`);
  }

  resetBudget(id: string, body?: { periodStart: string; periodEnd: string }) {
    return this.fetch(`/budgets/${id}/reset`, { method: 'POST', body: JSON.stringify(body || {}) });
  }

  getOrgCostStats(period: 'daily' | 'weekly' | 'monthly' = 'daily', days = 30) {
    return this.fetch<any>(`/budgets/cost-stats?period=${period}&days=${days}`);
  }

  getAgentCostStats(agentId: string, period: 'daily' | 'weekly' | 'monthly' = 'daily', days = 30) {
    return this.fetch<any>(`/agents/${agentId}/cost-stats?period=${period}&days=${days}`);
  }

  // Platform Budget (org-wide limits with priority over agent limits)
  getPlatformBudget() {
    return this.fetch<{
      budget: {
        id: string;
        orgId: string;
        hourlyLimitUsd: number | null;
        dailyLimitUsd: number | null;
        monthlyLimitUsd: number | null;
        currentSpendUsd: number;
        periodStart: string;
        periodEnd: string;
        softAlertPercent: number;
        hardStopEnabled: boolean;
        hardStopTriggered: boolean;
        alertSent: boolean;
      } | null;
      breakdown: {
        hourly: { spend: number; limit: number | null };
        daily: { spend: number; limit: number | null };
        monthly: { spend: number; limit: number | null; periodStart: string | null; periodEnd: string | null };
        hardStopTriggered: boolean;
        softAlertPercent: number;
      };
    }>('/platform-budget');
  }

  getPlatformBudgetBreakdown() {
    return this.fetch<{
      hourly: { spend: number; limit: number | null };
      daily: { spend: number; limit: number | null };
      monthly: { spend: number; limit: number | null; periodStart: string | null; periodEnd: string | null };
      hardStopTriggered: boolean;
      softAlertPercent: number;
    }>('/platform-budget/breakdown');
  }

  upsertPlatformBudget(data: {
    hourlyLimitUsd?: number | null;
    dailyLimitUsd?: number | null;
    monthlyLimitUsd?: number | null;
    softAlertPercent?: number;
    hardStopEnabled?: boolean;
    periodStart?: string;
    periodEnd?: string;
  }) {
    return this.fetch('/platform-budget', { method: 'PUT', body: JSON.stringify(data) });
  }

  resetPlatformBudget(body?: { periodStart?: string; periodEnd?: string }) {
    return this.fetch('/platform-budget/reset', { method: 'POST', body: JSON.stringify(body || {}) });
  }

  getPlatformBudgetIncidents(params?: { page?: string; pageSize?: string }) {
    const query = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return this.fetch<any>(`/platform-budget/incidents${query}`);
  }

  // Repos (added by PR #24 — fills the API methods the page already uses)
  getRepos() {
    return this.fetch<any[]>('/repos');
  }
  getRepoProgress(id: string) {
    return this.fetch<any>(`/repos/${id}/progress`);
  }
  createRepo(data: any) {
    return this.fetch<any>('/repos', { method: 'POST', body: JSON.stringify(data) });
  }
  updateRepo(id: string, data: any) {
    return this.fetch<any>(`/repos/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }
  syncRepo(id: string) {
    return this.fetch<any>(`/repos/${id}/sync`, { method: 'POST' });
  }
  deleteRepo(id: string) {
    return this.fetch<any>(`/repos/${id}`, { method: 'DELETE' });
  }
  assignRepoToAgent(agentId: string, repoId: string) {
    return this.fetch<any>(`/agents/${agentId}/repos`, { method: 'POST', body: JSON.stringify({ repoId }) });
  }
  removeRepoFromAgent(agentId: string, repoId: string) {
    return this.fetch<any>(`/agents/${agentId}/repos/${repoId}`, { method: 'DELETE' });
  }

  // Task Triggers (webhook-fired tasks)
  listTriggers(taskId?: string) {
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : '';
    return this.fetch<any[]>(`/triggers${query}`);
  }

  createTrigger(data: {
    taskId: string;
    kind?: 'WEBHOOK' | 'GMAIL' | 'N8N';
    authKind?: 'HMAC' | 'BEARER' | 'NONE';
    signatureHeader?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.fetch<any>('/triggers', { method: 'POST', body: JSON.stringify(data) });
  }

  setTriggerEnabled(id: string, enabled: boolean) {
    return this.fetch<any>(`/triggers/${id}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
  }

  deleteTrigger(id: string) {
    return this.fetch<any>(`/triggers/${id}`, { method: 'DELETE' });
  }

  // Approvals
  getApprovals(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.fetch<any>(`/approvals${query}`);
  }

  getPendingApprovalCount() {
    return this.fetch<{ count: number }>('/approvals/pending/count');
  }

  getApproval(id: string) {
    return this.fetch<any>(`/approvals/${id}`);
  }

  approveRequest(id: string) {
    return this.fetch<any>(`/approvals/${id}/approve`, { method: 'POST' });
  }

  rejectRequest(id: string, reason?: string) {
    return this.fetch<any>(`/approvals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  bulkApprove(ids: string[]) {
    return this.fetch<any>('/approvals/bulk/approve', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  }

  bulkReject(ids: string[], reason?: string) {
    return this.fetch<any>('/approvals/bulk/reject', {
      method: 'POST',
      body: JSON.stringify({ ids, reason }),
    });
  }

  getApprovalPolicy(agentId: string) {
    return this.fetch<any>(`/approvals/policies/${agentId}`);
  }

  setApprovalPolicy(agentId: string, data: any) {
    return this.fetch<any>(`/approvals/policies/${agentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  applyApprovalPreset(agentId: string, preset: string) {
    return this.fetch<any>(`/approvals/policies/${agentId}/preset`, {
      method: 'POST',
      body: JSON.stringify({ preset }),
    });
  }

  // Agents export/import
  exportAgents() {
    return this.fetch<any>('/agents/export');
  }

  importAgents(data: any) {
    return this.fetch<any>('/agents/import', { method: 'POST', body: JSON.stringify(data) });
  }

  // Tools export/import
  exportTools() {
    return this.fetch<any>('/tools/export');
  }

  importTools(data: any) {
    return this.fetch<any>('/tools/import', { method: 'POST', body: JSON.stringify(data) });
  }

  // Catalog / Marketplace
  getCatalogAgents(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.fetch<any>(`/catalog/agents${query}`);
  }

  getCatalogSkills(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.fetch<any>(`/catalog/skills${query}`);
  }

  getCatalogTools(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.fetch<any>(`/catalog/tools${query}`);
  }

  getCatalogAgent(id: string) {
    return this.fetch<any>(`/catalog/agents/${id}`);
  }

  getCatalogSkill(id: string) {
    return this.fetch<any>(`/catalog/skills/${id}`);
  }

  getCatalogTool(id: string) {
    return this.fetch<any>(`/catalog/tools/${id}`);
  }

  publishAgentToCatalog(data: any) {
    return this.fetch<any>('/catalog/agents/publish', { method: 'POST', body: JSON.stringify(data) });
  }

  publishSkillToCatalog(data: any) {
    return this.fetch<any>('/catalog/skills/publish', { method: 'POST', body: JSON.stringify(data) });
  }

  publishToolToCatalog(data: any) {
    return this.fetch<any>('/catalog/tools/publish', { method: 'POST', body: JSON.stringify(data) });
  }

  importAgentFromCatalog(id: string) {
    return this.fetch<any>(`/catalog/agents/${id}/import`, { method: 'POST' });
  }

  importSkillFromCatalog(id: string) {
    return this.fetch<any>(`/catalog/skills/${id}/import`, { method: 'POST' });
  }

  importToolFromCatalog(id: string) {
    return this.fetch<any>(`/catalog/tools/${id}/import`, { method: 'POST' });
  }

  deleteCatalogAgent(id: string) {
    return this.fetch(`/catalog/agents/${id}`, { method: 'DELETE' });
  }

  deleteCatalogSkill(id: string) {
    return this.fetch(`/catalog/skills/${id}`, { method: 'DELETE' });
  }

  deleteCatalogTool(id: string) {
    return this.fetch(`/catalog/tools/${id}`, { method: 'DELETE' });
  }

  // System Update
  getSystemVersion() {
    return this.fetch<any>('/settings/system/version');
  }

  triggerSystemUpdate() {
    return this.fetch<any>('/settings/system/update', { method: 'POST' });
  }

  // Admin
  getAdminStats() {
    return this.fetch<any>('/admin/stats');
  }

  // ─── Billing / Credits ────────────────────────────────────────────
  getBillingBalance() {
    return this.fetch<BillingBalance>('/billing/balance');
  }

  getBillingPlans() {
    return this.fetch<BillingPlan[]>('/billing/plans');
  }

  getBillingLedger(params?: { limit?: number; cursor?: string; type?: string }) {
    const query = params ? '?' + new URLSearchParams(params as any).toString() : '';
    return this.fetch<{ entries: BillingLedgerEntry[]; nextCursor: string | null }>(`/billing/ledger${query}`);
  }

  getBillingUsageByAgent() {
    return this.fetch<Array<{ agentId: string; calls: number; creditsSpent: number; rawCostUsd: number; tokensIn: number; tokensOut: number }>>('/billing/usage-by-agent');
  }

  setBillingByok(enabled: boolean) {
    return this.fetch<BillingBalance>('/billing/byok', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  }

  setBillingOverage(enabled: boolean, capUsd: number | null) {
    return this.fetch<BillingBalance>('/billing/overage', {
      method: 'POST',
      body: JSON.stringify({ enabled, capUsd }),
    });
  }

  getAvailableModels() {
    return this.fetch<AvailableModelsResponse>('/billing/available-models');
  }

  // ─── Admin: Platform Models ───────────────────────────────────────
  adminListPlatformModels() {
    return this.fetch<PlatformModel[]>('/admin/platform-models');
  }

  adminCreatePlatformModel(input: Partial<PlatformModel>) {
    return this.fetch<PlatformModel>('/admin/platform-models', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  adminUpdatePlatformModel(id: string, input: Partial<PlatformModel>) {
    return this.fetch<PlatformModel>(`/admin/platform-models/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  adminGrantCredits(orgId: string, amountUsd: number, note?: string) {
    return this.fetch<unknown>(`/admin/tenants/${orgId}/grant-credits`, {
      method: 'POST',
      body: JSON.stringify({ amountUsd, note }),
    });
  }

  createStripeTopUp(
    amountUsd: number,
    autoReload?: { thresholdUsd: number; targetUsd: number },
  ) {
    return this.fetch<{ url: string }>('/stripe/top-up', {
      method: 'POST',
      body: JSON.stringify({
        token: this.getToken(),
        amountUsd,
        ...(autoReload && {
          autoReload: true,
          autoReloadThresholdUsd: autoReload.thresholdUsd,
          autoReloadTargetUsd: autoReload.targetUsd,
        }),
      }),
    });
  }

  stripeSetupCard() {
    return this.fetch<{ url: string }>('/stripe/setup-card', {
      method: 'POST',
      body: JSON.stringify({ token: this.getToken() }),
    });
  }

  setAutoTopUp(enabled: boolean, thresholdUsd?: number, amountUsd?: number) {
    return this.fetch<BillingBalance>('/billing/auto-topup', {
      method: 'POST',
      body: JSON.stringify({ enabled, thresholdUsd, amountUsd }),
    });
  }

  clearSavedCard() {
    return this.fetch<BillingBalance>('/billing/clear-card', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  adminDeletePlatformModel(id: string) {
    return this.fetch<{ success: boolean }>(`/admin/platform-models/${id}`, {
      method: 'DELETE',
    });
  }

  adminGetPlatformLlmKeys() {
    return this.fetch<Record<string, { set: boolean; masked: string }>>('/admin/llm-keys');
  }

  adminSetPlatformLlmKeys(keys: Record<string, string>) {
    return this.fetch<Record<string, { set: boolean; masked: string }>>('/admin/llm-keys', {
      method: 'POST',
      body: JSON.stringify(keys),
    });
  }

  // ─── Admin: Tenants & Users ───────────────────────────────────────
  adminListTenants(params: { page?: number; limit?: number; plan?: string; status?: string; search?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.plan) qs.set('plan', params.plan);
    if (params.status) qs.set('status', params.status);
    if (params.search) qs.set('search', params.search);
    const q = qs.toString();
    return this.fetch<{ data: AdminTenantSummary[]; total: number }>(`/admin/tenants${q ? '?' + q : ''}`);
  }

  adminSuspendTenant(id: string, reason: string) {
    return this.fetch<{ success: boolean }>(`/admin/tenants/${id}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  adminUnbanTenant(id: string) {
    return this.fetch<{ success: boolean }>(`/admin/tenants/${id}/unban`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  adminListUsers(params: { page?: number; limit?: number; search?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.search) qs.set('search', params.search);
    const q = qs.toString();
    return this.fetch<{ data: AdminUserSummary[]; total: number; page: number; pageSize: number }>(`/admin/users${q ? '?' + q : ''}`);
  }

  adminBlockUser(id: string, reason: string) {
    return this.fetch<{ success: boolean }>(`/admin/moderation/users/${id}/block`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  adminUnblockUser(id: string) {
    return this.fetch<{ success: boolean }>(`/admin/moderation/users/${id}/unblock`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async adminImpersonateUser(id: string, reason?: string) {
    const result = await this.fetch<{ token: string; user: { id: string; name: string; email: string }; org: { id: string; name: string } }>(
      `/admin/users/${id}/impersonate`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
    if (typeof window !== 'undefined' && result.token) {
      localStorage.setItem('agems_admin_token_backup', this.getToken() ?? '');
      this.setToken(result.token);
    }
    return result;
  }

  adminRestoreSession() {
    if (typeof window === 'undefined') return false;
    const backup = localStorage.getItem('agems_admin_token_backup');
    if (!backup) return false;
    this.setToken(backup);
    localStorage.removeItem('agems_admin_token_backup');
    return true;
  }

  adminIsImpersonating() {
    if (typeof window === 'undefined') return false;
    return !!localStorage.getItem('agems_admin_token_backup');
  }

  // ─── Admin: Tenants extended ──────────────────────────────────────
  adminGetTenant(id: string) {
    return this.fetch<any>(`/admin/tenants/${id}`);
  }

  adminGetTenantUsage(id: string, days = 30) {
    return this.fetch<any>(`/admin/tenants/${id}/usage?days=${days}`);
  }

  adminBanTenant(id: string, reason: string) {
    return this.fetch<{ success: boolean }>(`/admin/tenants/${id}/ban`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  adminChangeTenantPlan(id: string, plan: string, reason: string) {
    return this.fetch<{ success: boolean }>(`/admin/tenants/${id}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ plan, reason }),
    });
  }

  adminDeleteTenant(id: string) {
    return this.fetch<{ success: boolean }>(`/admin/tenants/${id}`, {
      method: 'DELETE',
    });
  }

  // ─── Admin: Agents (global) ───────────────────────────────────────
  adminListAgents(params: { page?: number; limit?: number; search?: string; orgId?: string; status?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.search) qs.set('search', params.search);
    if (params.orgId) qs.set('orgId', params.orgId);
    if (params.status) qs.set('status', params.status);
    const q = qs.toString();
    return this.fetch<{ data: AdminAgentSummary[]; total: number; page: number; pageSize: number }>(`/admin/agents${q ? '?' + q : ''}`);
  }

  adminDeleteAgent(id: string, reason?: string) {
    const q = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    return this.fetch<{ id: string; name: string; orgId: string; message: string }>(`/admin/agents/${id}${q}`, {
      method: 'DELETE',
    });
  }

  adminDeleteUser(id: string, reason?: string) {
    const q = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    return this.fetch<{ id: string; email: string; message: string }>(`/admin/users/${id}${q}`, {
      method: 'DELETE',
    });
  }

  // ─── Admin: Users extended ────────────────────────────────────────
  adminResetUserPassword(id: string, password: string, reason?: string) {
    return this.fetch<{ id: string; email: string; message: string }>(`/admin/users/${id}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ password, reason }),
    });
  }

  // ─── Admin: Billing ───────────────────────────────────────────────
  adminGetBillingOverview() {
    return this.fetch<AdminBillingOverview>('/admin/billing/overview');
  }

  adminGetPayments(params: { page?: number; limit?: number; orgId?: string; status?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.orgId) qs.set('orgId', params.orgId);
    if (params.status) qs.set('status', params.status);
    const q = qs.toString();
    return this.fetch<{ data: AdminPayment[]; total: number }>(`/admin/billing/payments${q ? '?' + q : ''}`);
  }

  adminGetSubscriptions(params: { page?: number; limit?: number; status?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.status) qs.set('status', params.status);
    const q = qs.toString();
    return this.fetch<{ data: AdminSubscription[]; total: number }>(`/admin/billing/subscriptions${q ? '?' + q : ''}`);
  }

  adminRefundPayment(paymentId: string, amount?: number, reason?: string) {
    return this.fetch<{ success: boolean; paymentId: string; refundedAmount?: number; error?: string }>('/admin/billing/refund', {
      method: 'POST',
      body: JSON.stringify({ paymentId, amount, reason }),
    });
  }

  adminOverrideSubscription(orgId: string, body: { plan?: string; status?: string; expiresAt?: string }) {
    return this.fetch<{ success: boolean }>(`/admin/billing/subscriptions/${orgId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  adminRevenueByPlan() {
    return this.fetch<Array<{ plan: string; count: number; revenue: number }>>('/admin/billing/revenue-by-plan');
  }

  // ─── Admin: Feature Flags ─────────────────────────────────────────
  adminGetFeatureFlags() {
    return this.fetch<Array<{ key: string; enabled: boolean; description?: string; value?: any }>>('/admin/features');
  }

  adminSetFeatureFlag(key: string, body: { enabled?: boolean; value?: any; description?: string }) {
    return this.fetch<any>(`/admin/features/${key}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  adminToggleFeatureFlag(key: string, enabled: boolean) {
    return this.fetch<any>(`/admin/features/${key}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  }

  adminGetSystemConfig() {
    return this.fetch<Record<string, any>>('/admin/features/config/system');
  }

  adminUpdateSystemConfig(body: Record<string, any>) {
    return this.fetch<Record<string, any>>('/admin/features/config/system', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  // ─── Admin: Observability ─────────────────────────────────────────
  adminGetSystemHealth() {
    return this.fetch<AdminSystemHealth>('/admin/observability/health');
  }

  adminGetStuckExecutions(thresholdMinutes = 30) {
    return this.fetch<Array<AdminStuckExecution>>(`/admin/observability/stuck-executions?thresholdMinutes=${thresholdMinutes}`);
  }

  adminCancelStuckExecution(id: string) {
    return this.fetch<{ success: boolean }>(`/admin/observability/stuck-executions/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  adminGetQueueStats() {
    return this.fetch<Array<{ name: string; waiting: number; active: number; completed: number; failed: number; delayed: number }>>('/admin/observability/queue-stats');
  }

  adminGetPlatformMetrics(days = 7) {
    return this.fetch<AdminPlatformMetrics>(`/admin/observability/metrics?days=${days}`);
  }

  // ─── Admin: Moderation ────────────────────────────────────────────
  adminGetBlockedOrgs() {
    return this.fetch<Array<{ id: string; name: string; slug: string; blockedAt: string; reason: string; severity?: string }>>('/admin/moderation/orgs/blocked');
  }

  adminGetBlockedUsers() {
    return this.fetch<Array<{ id: string; name: string; email: string; blockedAt: string; reason: string }>>('/admin/moderation/users/blocked');
  }

  adminBlockOrg(id: string, reason: string, severity?: 'high' | 'critical') {
    return this.fetch<{ success: boolean }>(`/admin/moderation/orgs/${id}/block`, {
      method: 'POST',
      body: JSON.stringify({ reason, severity }),
    });
  }

  adminUnblockOrg(id: string) {
    return this.fetch<{ success: boolean }>(`/admin/moderation/orgs/${id}/unblock`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  adminGetRateLimit(targetType: string, targetId: string) {
    return this.fetch<any>(`/admin/moderation/rate-limit?targetType=${targetType}&targetId=${targetId}`);
  }

  adminSetRateLimit(body: {
    targetType: 'org' | 'user';
    targetId: string;
    requestsPerMinute?: number;
    requestsPerHour?: number;
    requestsPerDay?: number;
    agentExecutionsPerHour?: number;
    durationMinutes?: number;
  }) {
    return this.fetch<{ success: boolean }>('/admin/moderation/rate-limit', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  adminDetectSuspiciousActivity(body: { orgId?: string; hours?: number } = {}) {
    return this.fetch<any>('/admin/moderation/suspicious-activity/detect', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  adminGetModerationLog() {
    return this.fetch<Array<{ id: string; targetType: string; targetId: string; action: string; reason: string; createdAt: string }>>('/admin/moderation/log');
  }

  // ─── Admin: Audit ─────────────────────────────────────────────────
  adminGetAuditLog(params: { page?: number; limit?: number; adminId?: string; action?: string; targetType?: string; targetId?: string; from?: string; to?: string } = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') qs.set(k, String(v)); });
    const q = qs.toString();
    return this.fetch<{ data: AdminAuditEntry[]; total: number; page: number; pageSize: number }>(`/admin/audit${q ? '?' + q : ''}`);
  }

  adminGetAuditStats(adminId?: string, days = 30) {
    const qs = new URLSearchParams();
    if (adminId) qs.set('adminId', adminId);
    qs.set('days', String(days));
    return this.fetch<any>(`/admin/audit/stats?${qs.toString()}`);
  }

  // ─── Onboarding ───────────────────────────────────────────────────
  getOnboardingStatus() {
    return this.fetch<{ needsOnboarding: boolean; orgId: string; chatStatus?: 'pending' | 'in_progress' | 'completed' }>('/onboarding/status');
  }

  getOnboardingChat() {
    return this.fetch<OnboardingChatResponse>('/onboarding/chat');
  }

  submitOnboardingAnswer(questionId: string, value: any) {
    return this.fetch<OnboardingAnswerResponse>('/onboarding/chat/answer', {
      method: 'POST',
      body: JSON.stringify({ questionId, value }),
    });
  }

  skipOnboardingQuestion(questionId: string) {
    return this.fetch<OnboardingAnswerResponse>('/onboarding/chat/skip', {
      method: 'POST',
      body: JSON.stringify({ questionId }),
    });
  }

  goBackOnboarding() {
    return this.fetch<OnboardingChatResponse>('/onboarding/chat/back', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  completeOnboardingChat() {
    return this.fetch<{ presetSlug: string; goalTitle: string; agentsCreated: number }>('/onboarding/chat/complete', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  sendOnboardingMessage(text: string) {
    return this.fetch<{
      reply: string | null;
      done: boolean;
      progress: { current: number; total: number; answered: number };
      answers: Record<string, any>;
      question: OnboardingQuestionShaped | null;
    }>('/onboarding/chat/message', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  listOnboardingPresets() {
    return this.fetch<OnboardingPreset[]>('/onboarding/presets');
  }

  launchOnboardingPreset(presetSlug: string, companyName?: string) {
    return this.fetch<{
      presetSlug: string;
      orgId: string;
      agentsCreated: number;
      toolsCreated: number;
      goalId: string;
      taskId: string;
      agents: Array<{ templateSlug: string; id: string; name?: string }>;
      firstGoal: { id: string; title: string };
      firstTask: { id: string; title: string; assigneeId: string };
    }>('/onboarding/launch', {
      method: 'POST',
      body: JSON.stringify({ presetSlug, companyName }),
    });
  }

  /** Starts a Stripe Checkout session and returns the redirect URL. */
  async startCheckout(plan: 'STARTER' | 'PRO' | 'BUSINESS' | 'BYOK_PRO'): Promise<{ url: string }> {
    const token = this.getToken();
    const res = await fetch(`${API_URL}/api/stripe/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, token }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Checkout failed: ${res.status}`);
    }
    return res.json();
  }

  // Projects
  getProjects(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.fetch<any>(`/projects${query}`);
  }

  getProject(id: string) {
    return this.fetch<any>(`/projects/${id}`);
  }

  createProject(data: any) {
    return this.fetch<any>('/projects', { method: 'POST', body: JSON.stringify(data) });
  }

  updateProject(id: string, data: any) {
    return this.fetch<any>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  deleteProject(id: string) {
    return this.fetch(`/projects/${id}`, { method: 'DELETE' });
  }

  getProjectStats(id: string) {
    return this.fetch<any>(`/projects/${id}/stats`);
  }

  // Goals
  getGoals(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.fetch<any>(`/goals${query}`);
  }

  getGoal(id: string) {
    return this.fetch<any>(`/goals/${id}`);
  }

  createGoal(data: any) {
    return this.fetch<any>('/goals', { method: 'POST', body: JSON.stringify(data) });
  }

  updateGoal(id: string, data: any) {
    return this.fetch<any>(`/goals/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  deleteGoal(id: string) {
    return this.fetch(`/goals/${id}`, { method: 'DELETE' });
  }

  getGoalTree() {
    return this.fetch<any[]>('/goals/tree');
  }

  // Agent Config Revisions
  getAgentConfigRevisions(agentId: string) {
    return this.fetch<any[]>(`/agents/${agentId}/config-revisions`);
  }

  rollbackAgentConfig(agentId: string, version: number) {
    return this.fetch<any>(`/agents/${agentId}/config-revisions/rollback/${version}`, { method: 'POST' });
  }

  // Agent API Keys
  getAgentApiKeys(agentId: string) {
    return this.fetch<any[]>(`/agents/${agentId}/api-keys`);
  }

  createAgentApiKey(agentId: string, data: { name: string; expiresAt?: string }) {
    return this.fetch<any>(`/agents/${agentId}/api-keys`, { method: 'POST', body: JSON.stringify(data) });
  }

  revokeAgentApiKey(agentId: string, keyId: string) {
    return this.fetch(`/agents/${agentId}/api-keys/${keyId}`, { method: 'DELETE' });
  }

  // Task Labels
  getLabels() {
    return this.fetch<any[]>('/tasks/labels');
  }

  createLabel(data: { name: string; color: string }) {
    return this.fetch<any>('/tasks/labels', { method: 'POST', body: JSON.stringify(data) });
  }

  deleteLabel(labelId: string) {
    return this.fetch(`/tasks/labels/${labelId}`, { method: 'DELETE' });
  }

  addTaskLabel(taskId: string, labelId: string) {
    return this.fetch(`/tasks/${taskId}/labels/${labelId}`, { method: 'POST' });
  }

  removeTaskLabel(taskId: string, labelId: string) {
    return this.fetch(`/tasks/${taskId}/labels/${labelId}`, { method: 'DELETE' });
  }

  // Task Attachments
  getTaskAttachments(taskId: string) {
    return this.fetch<any[]>(`/tasks/${taskId}/attachments`);
  }

  addTaskAttachment(taskId: string, data: { filename: string; originalName: string; mimetype: string; size: number; url: string }) {
    return this.fetch<any>(`/tasks/${taskId}/attachments`, { method: 'POST', body: JSON.stringify(data) });
  }

  removeTaskAttachment(taskId: string, attachmentId: string) {
    return this.fetch(`/tasks/${taskId}/attachments/${attachmentId}`, { method: 'DELETE' });
  }

  // Task Work Products
  getTaskWorkProducts(taskId: string) {
    return this.fetch<any[]>(`/tasks/${taskId}/work-products`);
  }

  createTaskWorkProduct(taskId: string, data: { title: string; description?: string; type?: string; content?: string }) {
    return this.fetch<any>(`/tasks/${taskId}/work-products`, { method: 'POST', body: JSON.stringify(data) });
  }

  removeTaskWorkProduct(taskId: string, productId: string) {
    return this.fetch(`/tasks/${taskId}/work-products/${productId}`, { method: 'DELETE' });
  }

  // Approval Comments
  getApprovalComments(approvalId: string) {
    return this.fetch<any[]>(`/approvals/${approvalId}/comments`);
  }

  addApprovalComment(approvalId: string, content: string) {
    return this.fetch<any>(`/approvals/${approvalId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  // Adapters (External Agents)
  getAdapters() {
    return this.fetch<any[]>('/adapters');
  }

  getAdapterAvailability() {
    return this.fetch<Record<string, { available: boolean; version?: string; error?: string }>>('/adapters/availability');
  }

  checkAdapterAvailability(type: string) {
    return this.fetch<{ available: boolean; version?: string; error?: string }>(`/adapters/${type}/availability`);
  }

  executeAdapter(type: string, data: { prompt: string; config?: any; taskId?: string; context?: string }) {
    return this.fetch<any>(`/adapters/${type}/execute`, { method: 'POST', body: JSON.stringify(data) });
  }

  executeAdapterForAgent(agentId: string, data: { prompt: string; taskId?: string; context?: string }) {
    return this.fetch<any>(`/adapters/agents/${agentId}/execute`, { method: 'POST', body: JSON.stringify(data) });
  }

  // Plugins
  getPlugins(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.fetch<any>(`/plugins${query}`);
  }

  getPlugin(id: string) {
    return this.fetch<any>(`/plugins/${id}`);
  }

  installPlugin(data: any) {
    return this.fetch<any>('/plugins', { method: 'POST', body: JSON.stringify(data) });
  }

  updatePlugin(id: string, data: any) {
    return this.fetch<any>(`/plugins/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  removePlugin(id: string) {
    return this.fetch(`/plugins/${id}`, { method: 'DELETE' });
  }

  enablePlugin(id: string) {
    return this.fetch(`/plugins/${id}/enable`, { method: 'POST' });
  }

  disablePlugin(id: string) {
    return this.fetch(`/plugins/${id}/disable`, { method: 'POST' });
  }

  // Org Export/Import
  exportOrg() {
    return this.fetch<any>('/org/export');
  }

  importOrg(data: any) {
    return this.fetch<any>('/org/import', { method: 'POST', body: JSON.stringify(data) });
  }

  // Evals (Promptfoo)
  runEval(data: { agentId: string; testCases: Array<{ input: string; expectedOutput: string }> }) {
    return this.fetch<any>('/evals/run', { method: 'POST', body: JSON.stringify(data) });
  }

  getEvalHistory(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.fetch<any>(`/evals/history${query}`);
  }

  // Git Worktrees
  getWorktrees() {
    return this.fetch<any[]>('/worktrees');
  }

  createWorktree(data: { agentId: string; repoPath: string; branchName?: string }) {
    return this.fetch<any>('/worktrees', { method: 'POST', body: JSON.stringify(data) });
  }

  removeWorktree(id: string) {
    return this.fetch(`/worktrees/${id}`, { method: 'DELETE' });
  }
}

// ─── Billing types (mirror apps/api BillingService shapes) ──────────

export type BillingTier = 'FREE' | 'STARTER' | 'PRO' | 'BUSINESS' | 'ENTERPRISE';

export interface BillingBalance {
  orgId: string;
  tier: BillingTier;
  creditsIncluded: number;   // USD
  creditsUsed: number;        // USD
  creditsBonus: number;       // USD
  creditsAvailable: number;   // USD (included − used + bonus)
  percentUsed: number;        // 0..1
  periodStart: string;
  periodEnd: string;
  trialEndsAt: string | null;
  trialExpired: boolean;
  byokEnabled: boolean;
  hardStopped: boolean;
  pausedReason: string | null;
  overageEnabled: boolean;
  overageSpentUsd: number;
  overageCapUsd: number | null;
  autoTopUpEnabled?: boolean;
  autoTopUpThresholdUsd?: number | null;
  autoTopUpAmountUsd?: number | null;
  stripePaymentMethodId?: string | null;
}

export interface BillingPlan {
  tier: BillingTier;
  label: string;
  tagline: string;
  priceUsdPerMonth: number | null;
  creditsIncludedUsd: number;
  maxAgents: number | null;
  byokAllowed: boolean;
  allowedModelTiers: Array<'economy' | 'standard' | 'premium'>;
  overageAllowed: boolean;
  stripePriceId: string | null;
}

export interface AdminTenantSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED';
  createdAt: string;
  owner: { id: string; name: string; email: string };
  stats: { members: number; agents: number; channels: number; tasks: number; totalSpent: number };
}

export interface AdminUserSummary {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  createdAt: string;
  blocked: boolean;
  memberships: Array<{ role: string; org: { id: string; name: string; slug: string } }>;
}

export interface PlatformModel {
  id: string;
  provider: string;
  model: string;
  displayName: string | null;
  tier: 'economy' | 'standard' | 'premium';
  enabled: boolean;
  sortOrder: number;
  notes: string | null;
  inputPer1M?: number;
  outputPer1M?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AvailableModel {
  provider: string;
  model: string;
  displayName: string;
  tier: 'economy' | 'standard' | 'premium';
  keySource: 'org' | 'platform' | 'env' | null;
  inputPer1M: number;
  outputPer1M: number;
  inputPer1MCharged: number;
  outputPer1MCharged: number;
  notes: string | null;
}

export interface AvailableModelsResponse {
  plan: BillingTier;
  byokEnabled: boolean;
  markup: number;
  models: AvailableModel[];
}

export interface BillingLedgerEntry {
  id: string;
  type: 'DEBIT_LLM' | 'DEBIT_TOOL' | 'CREDIT_GRANT' | 'CREDIT_REFUND' | 'CREDIT_RESET' | 'CREDIT_TOPUP' | 'TIER_CHANGE';
  agentId: string | null;
  executionId: string | null;
  provider: string | null;
  model: string | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  costRawUsd: string | null;
  markupMultiplier: string | null;
  creditsDelta: string;        // signed, Decimal serialized as string
  creditBucket: string | null;
  note: string | null;
  createdAt: string;
}

export interface OnboardingPreset {
  slug: string;
  label: string;
  description: string;
  icon: string;
  agentCount: number;
  agents: Array<{ name: string; slug: string; position: string; department: string; avatar: string }>;
  firstGoal: string;
  firstTask: string;
}

export interface OnboardingQuestionShaped {
  id: string;
  prompt: string;
  helper?: string;
  type: 'text' | 'textarea' | 'choice' | 'multichoice' | 'choice-with-other';
  options?: Array<{ value: string; label: string; icon?: string; hint?: string; custom?: boolean }>;
  placeholder?: string;
  required: boolean;
}

export interface OnboardingChatResponse {
  status: 'pending' | 'in_progress' | 'completed';
  answers: Record<string, any>;
  question?: OnboardingQuestionShaped;
  progress: { current: number; total: number; answered?: number };
  history?: Array<{ role: 'alex' | 'user'; text: string; ts: string }>;
}

export interface OnboardingAnswerResponse {
  ack?: string;
  next?: OnboardingQuestionShaped;
  done: boolean;
  progress: { current: number; total: number; answered: number };
}

// ─── Admin types ──────────────────────────────────────────────────

export interface AdminBillingOverview {
  totalRevenue: number;
  mrr: number;
  arr: number;
  activeSubscriptions: number;
  failedPayments: number;
  refunds: number;
  churnRate: number;
  avgRevenuePerUser: number;
}

export interface AdminPayment {
  id: string;
  orgId: string | null;
  orgName: string;
  email: string;
  amount: number;
  currency: string;
  status: string;
  product: string;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

export interface AdminSubscription {
  id: string;
  orgId: string;
  orgName: string;
  plan: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
}

export interface AdminSystemHealth {
  status: 'healthy' | 'degraded' | 'critical';
  uptime: number;
  timestamp: string;
  checks: {
    database: { status: 'up' | 'down' | 'slow'; latencyMs?: number; error?: string };
    redis: { status: 'up' | 'down' | 'slow'; latencyMs?: number; error?: string };
    agents: { total: number; active: number; paused: number; error: number; failedExecutions: number; pendingApprovals: number };
    executions: { running: number; queued: number; stuck: number; completedLast24h: number; failedLast24h: number; avgDurationMs: number };
    storage: { usedMb: number; availableMb: number; percentUsed: number; uploadsCount: number };
  };
}

export interface AdminStuckExecution {
  id: string;
  agentId: string;
  agentName: string;
  orgId: string;
  startedAt: string;
  durationMs: number;
}

export interface AdminPlatformMetrics {
  period: { start: string; end: string };
  agents: { created: number; active: number; failed: number };
  executions: { total: number; avgDuration: number; successRate: number };
  revenue: { total: number; mrr: number };
  users: { new: number; total: number };
}

export interface AdminAgentSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  provider: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  org: { id: string; name: string; slug: string; plan: string };
  _count: { executions: number; skills: number; tools: number };
}

export interface AdminAuditEntry {
  id: string;
  adminId: string;
  adminName?: string;
  adminEmail?: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export const api = new ApiClient();
