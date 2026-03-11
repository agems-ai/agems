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
      throw new Error(error.message || `API Error: ${res.status}`);
    }

    return res.json();
  }

  // Auth
  register(email: string, password: string, name: string, orgName?: string) {
    return this.fetch<{ user: any; org: any; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, orgName }),
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

  createTask(data: any) {
    return this.fetch('/tasks', { method: 'POST', body: JSON.stringify(data) });
  }

  updateTask(id: string, data: any) {
    return this.fetch(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
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

  // Task Agents Config
  getTaskAgentsConfig() {
    return this.fetch<{ enabled: boolean; interval: number; reviewInterval: number; reviewBudget: number; autonomyLevel: number }>('/settings/task-agents');
  }

  setTaskAgentsConfig(data: { enabled?: boolean; interval?: number; reviewInterval?: number; reviewBudget?: number; autonomyLevel?: number }) {
    return this.fetch<{ enabled: boolean; interval: number; reviewInterval: number; reviewBudget: number; autonomyLevel: number }>('/settings/task-agents', {
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

  getDefaultSkills() {
    return this.fetch<any[]>('/skills/defaults/list');
  }

  importDefaultSkills(slugs?: string[]) {
    return this.fetch<{ created: number; skipped: number }>('/skills/defaults/import', {
      method: 'POST', body: JSON.stringify(slugs ? { slugs } : {}),
    });
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
}

export const api = new ApiClient();
