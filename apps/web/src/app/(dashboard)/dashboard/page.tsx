'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { getCommsSocket } from '@/lib/socket';
import { Plus, Pencil, Trash2, Play, X, Code2, BarChart3, RefreshCw, ChevronDown, ChevronUp, MessageSquare, Square, Settings2, GripVertical, Wrench, Brain } from 'lucide-react';
import ChatPanel, { Avatar } from '@/components/ChatPanel';

/* ═══════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════ */

interface DashTool {
  id: string;
  name: string;
  type: string;
  database: string;
  url: string;
  description: string;
}

interface Widget {
  id: string;
  title: string;
  code: string;
  display: 'number' | 'breakdown' | 'table' | 'chart';
  refreshMin: number;
}

interface WidgetResult {
  data?: any[];
  value?: string | number;
  items?: { label: string; value: string | number }[];
  error?: string;
  loading?: boolean;
}

/* ═══════════════════════════════════════════════════════════
   Default system widgets (platform stats, work for every org)
   ═══════════════════════════════════════════════════════════ */

const DEFAULT_SYSTEM_WIDGETS: Widget[] = [
  {
    id: 'sys-agents',
    title: 'Agents',
    code: `const s = await agems('/dashboard/system-stats');
return s.agents?.byStatus?.length ? s.agents.byStatus : s.agents?.total ?? 0;`,
    display: 'breakdown',
    refreshMin: 5,
  },
  {
    id: 'sys-tasks',
    title: 'Tasks',
    code: `const s = await agems('/dashboard/system-stats');
return s.tasks?.byStatus?.length ? s.tasks.byStatus : s.tasks?.total ?? 0;`,
    display: 'breakdown',
    refreshMin: 5,
  },
  {
    id: 'sys-tools',
    title: 'Tools',
    code: `const s = await agems('/dashboard/system-stats');
return s.tools ?? 0;`,
    display: 'number',
    refreshMin: 10,
  },
  {
    id: 'sys-skills',
    title: 'Skills',
    code: `const s = await agems('/dashboard/system-stats');
return s.skills ?? 0;`,
    display: 'number',
    refreshMin: 10,
  },
  {
    id: 'sys-messages',
    title: 'Messages (7d)',
    code: `const s = await agems('/dashboard/system-stats');
return s.messagesLast7d ?? 0;`,
    display: 'number',
    refreshMin: 5,
  },
  {
    id: 'sys-approvals',
    title: 'Pending Approvals',
    code: `const s = await agems('/dashboard/system-stats');
return s.pendingApprovals ?? 0;`,
    display: 'number',
    refreshMin: 2,
  },
  {
    id: 'sys-executions',
    title: 'Recent Executions',
    code: `const s = await agems('/dashboard/system-stats');
return s.executions?.byStatus?.length ? s.executions.byStatus : s.executions?.recent ?? 0;`,
    display: 'breakdown',
    refreshMin: 3,
  },
  {
    id: 'sys-channels',
    title: 'Channels',
    code: `const s = await agems('/dashboard/system-stats');
return s.channels ?? 0;`,
    display: 'number',
    refreshMin: 10,
  },
];

/* ═══════════════════════════════════════════════════════════
   Widget code executor
   Runs widget JS code with helpers: query(), http(), agems(), ctx
   ═══════════════════════════════════════════════════════════ */

async function executeWidgetCode(code: string, tools: DashTool[]): Promise<any> {
  const queryFn = (toolId: string, sql: string) => api.dashboardQuery(toolId, sql);
  const httpFn = (toolId: string, method: string, path: string, body?: any, params?: Record<string, string>) =>
    api.dashboardHttp(toolId, method, path, body, params);
  const agemsFn = (path: string) => api.fetch<any>(path);
  const ctx = { tools };

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('query', 'http', 'agems', 'ctx', code);
  return fn(queryFn, httpFn, agemsFn, ctx);
}

/* ═══════════════════════════════════════════════════════════
   Main Dashboard
   ═══════════════════════════════════════════════════════════ */

export default function DashboardPage() {
  const [agents, setAgents] = useState<any[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [allChats, setAllChats] = useState<any[]>([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [widgetResults, setWidgetResults] = useState<Record<string, WidgetResult>>({});
  const [dashTools, setDashTools] = useState<DashTool[]>([]);
  const [editWidget, setEditWidget] = useState<Widget | null>(null);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [widgetsDirty, setWidgetsDirty] = useState(false);
  const refreshTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const dragWidget = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const nameMap = useCallback((type: string, id: string) => {
    if (type === 'AGENT') {
      const a = agents.find((ag) => ag.id === id);
      const role = a?.positions?.[0]?.title;
      return { name: a?.name || 'Agent', avatar: a?.avatar || null, role };
    }
    return { name: 'You', avatar: null };
  }, [agents]);

  useEffect(() => {
    Promise.all([
      api.fetch<any>('/auth/profile').catch(() => null),
      api.getAgents({ pageSize: '100' }).then((r: any) => r.data || []).catch(() => []),
      api.getDashboardTools().catch(() => []),
      api.getDashboardWidgets().catch(() => []),
    ]).then(([profile, agentsList, tools, saved]) => {
      if (profile) setCurrentUserId(profile.id);
      setAgents(agentsList);
      setDashTools(tools);
      if (saved && saved.length > 0) {
        setWidgets(saved);
      } else {
        setWidgets(DEFAULT_SYSTEM_WIDGETS);
      }

      const meta = agentsList.find((a: any) => a.type === 'META' && a.status === 'ACTIVE');
      const active = agentsList.find((a: any) => a.status === 'ACTIVE');
      if (meta || active) setSelectedAgentId((meta || active).id);
    });
  }, []);

  useEffect(() => {
    if (!selectedAgentId) return;
    api.findAllDirectChannels('AGENT', selectedAgentId).then((chats: any[]) => {
      setAllChats(chats || []);
      if (chats?.length > 0) {
        setChannelId(chats[0].id);
      } else { setChannelId(''); }
    }).catch(() => {
      // fallback
      api.findDirectChannel('AGENT', selectedAgentId).then((ch: any) => {
        if (ch?.id) { setAllChats([ch]); setChannelId(ch.id); }
        else { setAllChats([]); setChannelId(''); }
      }).catch(() => { setAllChats([]); setChannelId(''); });
    });
  }, [selectedAgentId]);

  // Close chat history dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (chatHistoryRef.current && !chatHistoryRef.current.contains(e.target as Node)) {
        setShowChatHistory(false);
      }
    };
    if (showChatHistory) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showChatHistory]);

  const createNewDashChat = async () => {
    const ag = agents.find((a) => a.id === selectedAgentId);
    if (!ag) return;
    const now = new Date();
    const label = now.toLocaleDateString('ru', { day: 'numeric', month: 'short' }) + ' ' + now.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    try {
      const ch: any = await api.createChannel({
        name: `${ag.name} ${label}`,
        type: 'DIRECT',
        participantIds: [{ type: 'AGENT', id: ag.id }],
      });
      setAllChats(prev => [ch, ...prev]);
      setChannelId(ch.id);
      setShowChatHistory(false);
    } catch (err: any) {
      alert(err.message || 'Failed to create chat');
    }
  };

  /* ─── Run widget ─── */
  const runWidget = useCallback(async (w: Widget) => {
    if (!w.code.trim()) { setWidgetResults((p) => ({ ...p, [w.id]: { error: 'No code' } })); return; }
    setWidgetResults((p) => ({ ...p, [w.id]: { loading: true } }));
    try {
      const result = await executeWidgetCode(w.code, dashTools);
      if (result?.error) {
        setWidgetResults((p) => ({ ...p, [w.id]: { error: String(result.error), loading: false } }));
      } else if (w.display === 'number') {
        const val = typeof result === 'object' && result !== null
          ? (result.value ?? result.data?.[0]?.value ?? result) : result;
        setWidgetResults((p) => ({ ...p, [w.id]: { value: val, loading: false } }));
      } else if (w.display === 'breakdown' || w.display === 'chart') {
        const items = Array.isArray(result)
          ? result.map((r: any) => ({ label: String(r.label || r.name || r.status || Object.values(r)[0]), value: r.value ?? r.count ?? Object.values(r)[1] ?? 0 }))
          : [];
        setWidgetResults((p) => ({ ...p, [w.id]: { items, loading: false } }));
      } else {
        const data = Array.isArray(result) ? result : (result?.data || [result]);
        setWidgetResults((p) => ({ ...p, [w.id]: { data, loading: false } }));
      }
    } catch (err: any) {
      setWidgetResults((p) => ({ ...p, [w.id]: { error: err.message, loading: false } }));
    }
  }, [dashTools]);

  useEffect(() => {
    for (const t of Object.values(refreshTimers.current)) clearInterval(t);
    refreshTimers.current = {};
    for (const w of widgets) {
      runWidget(w);
      if (w.refreshMin > 0) refreshTimers.current[w.id] = setInterval(() => runWidget(w), w.refreshMin * 60000);
    }
    return () => { for (const t of Object.values(refreshTimers.current)) clearInterval(t); };
  }, [widgets, runWidget]);

  const saveWidgetEdit = (w: Widget) => { setWidgets((p) => p.map((pw) => pw.id === w.id ? w : pw)); setEditWidget(null); setWidgetsDirty(true); setTimeout(() => runWidget(w), 100); };
  const addWidget = (w: Widget) => { setWidgets((p) => [...p, w]); setShowAddWidget(false); setWidgetsDirty(true); setTimeout(() => runWidget(w), 100); };
  const removeWidget = (id: string) => { setWidgets((p) => p.filter((w) => w.id !== id)); setWidgetsDirty(true); };
  const persistWidgets = async () => { await api.saveDashboardWidgets(widgets); setWidgetsDirty(false); };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const [dashTab, setDashTab] = useState<'activity' | 'chat' | 'widgets'>('activity');
  const [expandedExec, setExpandedExec] = useState<string | null>(null);
  const [stoppingExec, setStoppingExec] = useState<Record<string, boolean>>({});
  const [stoppingAll, setStoppingAll] = useState(false);
  const [showModulesModal, setShowModulesModal] = useState(false);

  // AI Modules state
  type ModuleName = 'tasks' | 'comms' | 'meetings' | 'goals' | 'projects';
  interface ModuleConfig { enabled: boolean; activityLevel: number; autonomyLevel: number; }
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [crossChannelEnabled, setCrossChannelEnabled] = useState(false);
  const [crossChannelMessages, setCrossChannelMessages] = useState(10);
  const [aiModules, setAiModules] = useState<Record<ModuleName, ModuleConfig>>({
    tasks: { enabled: true, activityLevel: 3, autonomyLevel: 3 },
    comms: { enabled: true, activityLevel: 3, autonomyLevel: 3 },
    meetings: { enabled: true, activityLevel: 3, autonomyLevel: 3 },
    goals: { enabled: true, activityLevel: 3, autonomyLevel: 3 },
    projects: { enabled: true, activityLevel: 3, autonomyLevel: 3 },
  });
  const [savingModules, setSavingModules] = useState(false);
  const [modulesSaved, setModulesSaved] = useState(false);

  // Load modules config
  useEffect(() => {
    api.getModulesConfig().then((c) => {
      setGlobalEnabled(c.globalEnabled);
      if (c.crossChannel) {
        setCrossChannelEnabled(c.crossChannel.enabled);
        setCrossChannelMessages(c.crossChannel.messageCount);
      }
      setAiModules(c.modules as Record<ModuleName, ModuleConfig>);
    }).catch(() => {});
  }, []);

  const handleStopExecution = async (execId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStoppingExec(prev => ({ ...prev, [execId]: true }));
    try {
      await api.stopExecution(execId);
      setTimeout(() => setStoppingExec(prev => ({ ...prev, [execId]: false })), 2000);
    } catch {
      setStoppingExec(prev => ({ ...prev, [execId]: false }));
    }
  };

  const handleStopAll = async () => {
    setStoppingAll(true);
    try {
      await api.stopAllExecutions();
      setTimeout(() => setStoppingAll(false), 2000);
    } catch {
      setStoppingAll(false);
    }
  };

  const handleSaveModules = async () => {
    setSavingModules(true);
    try {
      const res = await api.setModulesConfig({
        globalEnabled,
        crossChannel: { enabled: crossChannelEnabled, messageCount: crossChannelMessages },
        modules: aiModules,
      });
      setGlobalEnabled(res.globalEnabled);
      if (res.crossChannel) {
        setCrossChannelEnabled(res.crossChannel.enabled);
        setCrossChannelMessages(res.crossChannel.messageCount);
      }
      setAiModules(res.modules as Record<ModuleName, ModuleConfig>);
      setModulesSaved(true);
      setTimeout(() => setModulesSaved(false), 2000);
    } finally { setSavingModules(false); }
  };

  const updateModule = (mod: ModuleName, patch: Partial<ModuleConfig>) => {
    setAiModules(prev => ({ ...prev, [mod]: { ...prev[mod], ...patch } }));
  };

  // Agent Activity data
  const [activityData, setActivityData] = useState<{ running: any[]; recent: any[] }>({ running: [], recent: [] });
  useEffect(() => {
    const fetchActivity = () => api.getActivity().then(setActivityData).catch(() => {});
    fetchActivity();
    const iv = setInterval(fetchActivity, 5000);
    return () => clearInterval(iv);
  }, []);

  // Live streaming text from agents (org-level socket events)
  const [liveStreams, setLiveStreams] = useState<Record<string, {
    text: string;
    thinking: string;
    tool: string;
    toolCalls: Array<{ toolName: string; status: string; durationMs?: number; error?: string }>;
  }>>({});
  useEffect(() => {
    const socket = getCommsSocket();
    if (!socket.connected) socket.connect();

    const onTextChunk = (data: any) => {
      setLiveStreams(prev => {
        const key = data.executionId || data.agentId;
        const existing = prev[key] || { text: '', thinking: '', tool: '', toolCalls: [] };
        return { ...prev, [key]: { ...existing, text: (existing.text + (data.chunk || '')).slice(-500) } };
      });
    };
    const onThinkingChunk = (data: any) => {
      setLiveStreams(prev => {
        const key = data.executionId || data.agentId;
        const existing = prev[key] || { text: '', thinking: '', tool: '', toolCalls: [] };
        return { ...prev, [key]: { ...existing, thinking: (existing.thinking + (data.chunk || '')).slice(-500) } };
      });
    };
    const onToolUpdate = (data: any) => {
      setLiveStreams(prev => {
        const key = data.executionId || data.agentId;
        const existing = prev[key] || { text: '', thinking: '', tool: '', toolCalls: [] };
        const toolStr = data.status === 'running' ? `Using ${data.toolName}...` : data.status === 'completed' ? `${data.toolName} done` : `${data.toolName} error`;
        const tools = [...existing.toolCalls];
        if (data.status === 'running') {
          tools.push({ toolName: data.toolName, status: 'running' });
        } else {
          const idx = tools.findIndex(tc => tc.toolName === data.toolName && tc.status === 'running');
          if (idx >= 0) tools[idx] = { toolName: data.toolName, status: data.status, durationMs: data.durationMs, error: data.error };
        }
        return { ...prev, [key]: { ...existing, tool: toolStr, toolCalls: tools } };
      });
    };

    socket.on('agent_text_chunk_org', onTextChunk);
    socket.on('agent_thinking_chunk_org', onThinkingChunk);
    socket.on('agent_tool_update_org', onToolUpdate);

    return () => {
      socket.off('agent_text_chunk_org', onTextChunk);
      socket.off('agent_thinking_chunk_org', onThinkingChunk);
      socket.off('agent_tool_update_org', onToolUpdate);
    };
  }, []);

  // Browser screencast frames from agents (live browser preview)
  const [browserFrames, setBrowserFrames] = useState<Record<string, string>>({}); // executionId → base64 jpeg
  const [expandedBrowser, setExpandedBrowser] = useState<string | null>(null);
  const [screenshotModal, setScreenshotModal] = useState<string | null>(null);
  useEffect(() => {
    const socket = getCommsSocket();
    const onBrowserFrame = (data: any) => {
      const key = data.executionId;
      if (!key) return;
      setBrowserFrames(prev => ({ ...prev, [key]: data.frame }));
    };
    const onBrowserStop = (data: any) => {
      const key = data.executionId;
      if (!key) return;
      setBrowserFrames(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setExpandedBrowser(prev => prev === key ? null : prev);
    };

    socket.on('agent_browser_frame', onBrowserFrame);
    socket.on('agent_browser_stop', onBrowserStop);
    return () => {
      socket.off('agent_browser_frame', onBrowserFrame);
      socket.off('agent_browser_stop', onBrowserStop);
    };
  }, []);

  const triggerLabels: Record<string, string> = {
    TASK: 'Task', MESSAGE: 'Message', SCHEDULE: 'Schedule', EVENT: 'Goal/Event',
    MANUAL: 'Manual', MEETING: 'Meeting', TELEGRAM: 'Telegram', APPROVAL: 'Approval',
  };
  const getExecLink = (e: any): { label: string; href: string } | null => {
    if (e.triggerType === 'TASK' && e.triggerId) return { label: 'Open Task', href: `/tasks/${e.triggerId}` };
    if (e.triggerType === 'MESSAGE' && e.triggerId) return { label: 'Open Channel', href: `/comms?channel=${e.triggerId}` };
    if (e.triggerType === 'MEETING' && e.triggerId) return { label: 'Open Meeting', href: `/meetings?id=${e.triggerId}` };
    if (e.triggerType === 'TELEGRAM' && e.triggerId) return { label: 'Open Channel', href: `/comms?channel=${e.triggerId}` };
    if (e.triggerType === 'EVENT' && e.triggerId) return { label: 'Open Goal', href: `/goals` };
    if (e.agent?.id) return { label: 'Open Agent', href: `/agents/${e.agent.id}` };
    return null;
  };
  const timeAgo = (date: string) => {
    const d = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (d < 60) return `${d}s`;
    if (d < 3600) return `${Math.floor(d/60)}m`;
    if (d < 86400) return `${Math.floor(d/3600)}h`;
    return `${Math.floor(d/86400)}d`;
  };

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-3.5rem)] lg:h-screen overflow-hidden">
      {/* Mobile tab bar */}
      <div className="flex border-b border-[var(--border)] lg:hidden shrink-0">
        <button onClick={() => setDashTab('activity')} className={`flex-1 py-2.5 text-sm font-medium text-center transition ${dashTab === 'activity' ? 'text-white border-b-2 border-[var(--accent)]' : 'text-[var(--muted)]'}`}>Activity</button>
        <button onClick={() => setDashTab('widgets')} className={`flex-1 py-2.5 text-sm font-medium text-center transition ${dashTab === 'widgets' ? 'text-white border-b-2 border-[var(--accent)]' : 'text-[var(--muted)]'}`}>Widgets</button>
      </div>

      {/* ═══════ LEFT: Activity ═══════ */}
      <div className={`flex-1 flex flex-col min-w-0 overflow-auto lg:border-r border-[var(--border)] ${dashTab !== 'activity' ? 'hidden lg:flex' : ''}`}>
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2 shrink-0">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <h2 className="font-semibold">Agent Activity</h2>
          <span className="text-xs text-[var(--muted)]">Live</span>
          <div className="ml-auto flex items-center gap-1.5">
            {activityData.running.length > 0 && (
              <button
                onClick={handleStopAll}
                disabled={stoppingAll}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-red-500/15 text-red-400 hover:bg-red-500/25 transition disabled:opacity-50"
                title="Stop all running executions"
              >
                <Square size={12} fill="currentColor" />
                <span>{stoppingAll ? 'Stopping...' : 'Stop All'}</span>
              </button>
            )}
            <button
              onClick={() => setShowModulesModal(true)}
              className="p-1.5 rounded-lg hover:bg-[var(--hover)] text-[var(--muted)] hover:text-white transition"
              title="AI Modules Settings"
            >
              <Settings2 size={16} />
            </button>
          </div>
        </div>
        <div className="p-4 space-y-4 overflow-auto flex-1">
          {/* Running Now */}
          <div>
            <h3 className="text-sm font-medium text-[var(--muted)] mb-2">Running Now ({activityData.running.length})</h3>
            {activityData.running.length === 0 ? (
              <div className="text-xs text-[var(--muted)] py-6 text-center">No agents executing right now</div>
            ) : activityData.running.map((e: any) => {
              const link = getExecLink(e);
              const isExpanded = expandedExec === e.id;
              return (
                <div key={e.id} className="border border-emerald-500/30 bg-emerald-500/10 rounded-lg mb-2 cursor-pointer hover:border-emerald-400/50 transition"
                  onClick={() => setExpandedExec(isExpanded ? null : e.id)}>
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                      <span className="font-medium text-sm truncate">{e.agent?.name || 'Agent'}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 shrink-0">{triggerLabels[e.triggerType] || e.triggerType}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs font-mono text-emerald-400">{timeAgo(e.startedAt)}</span>
                      <button
                        onClick={(ev) => handleStopExecution(e.id, ev)}
                        disabled={stoppingExec[e.id]}
                        className="p-1 rounded hover:bg-red-500/20 text-red-400/60 hover:text-red-400 transition disabled:opacity-50"
                        title="Stop execution"
                      >
                        <Square size={12} fill="currentColor" />
                      </button>
                    </div>
                  </div>
                  {/* Live streaming details */}
                  {(() => {
                    const stream = liveStreams[e.id] || liveStreams[e.agentId];
                    if (!stream) return null;
                    const display = stream.text || stream.thinking || stream.tool;
                    if (!display) return null;
                    const completedTools = stream.toolCalls?.filter(tc => tc.status !== 'running') || [];
                    const runningTools = stream.toolCalls?.filter(tc => tc.status === 'running') || [];
                    return (
                      <div className="px-3 pb-2 space-y-1.5">
                        {/* Thinking */}
                        {stream.thinking && (
                          <div className="text-xs text-purple-300/80 bg-purple-500/5 rounded-lg px-3 py-2 max-h-[120px] overflow-y-auto border border-purple-500/10">
                            <div className="flex items-center gap-1 mb-1 text-purple-400/60 text-[10px] font-medium">
                              <Brain size={10} />
                              <span>Thinking</span>
                            </div>
                            <div className="whitespace-pre-wrap break-words">{stream.thinking.slice(-400)}</div>
                          </div>
                        )}
                        {/* Response text */}
                        {stream.text && (
                          <div className="text-xs text-emerald-300 leading-relaxed max-h-16 overflow-hidden" style={{ wordBreak: 'break-word' }}>
                            {stream.text.slice(-300)}<span className="animate-pulse">|</span>
                          </div>
                        )}
                        {/* Tool calls */}
                        {stream.toolCalls?.length > 0 && (
                          <div className="space-y-0.5 border-l-2 border-emerald-500/30 pl-2">
                            {completedTools.slice(-8).map((tc, i) => (
                              <div key={i} className="flex items-center gap-1 text-[11px]">
                                <Wrench size={10} className={tc.error ? 'text-red-400' : 'text-green-400'} />
                                <span className="font-mono text-[var(--muted)] truncate flex-1">{tc.toolName}</span>
                                {tc.durationMs && <span className="text-[var(--muted)] opacity-50">{tc.durationMs}ms</span>}
                                {tc.error ? <span className="text-red-400 text-[10px]">failed</span> : <span className="text-green-400 text-[10px]">done</span>}
                              </div>
                            ))}
                            {completedTools.length > 8 && <div className="text-[9px] text-[var(--muted)]">+{completedTools.length - 8} more</div>}
                            {runningTools.map((tc, i) => (
                              <div key={`r-${i}`} className="flex items-center gap-1 text-[11px]">
                                <Wrench size={10} className="text-yellow-400 animate-spin" />
                                <span className="font-mono text-white">{tc.toolName}</span>
                                <span className="text-yellow-400 text-[10px] ml-auto">running...</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* Browser live preview */}
                  {browserFrames[e.id] && (
                    <div className="px-3 pb-2">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-[10px] text-cyan-400 font-medium">Browser Live</span>
                        </div>
                        <button
                          onClick={(ev) => { ev.stopPropagation(); setExpandedBrowser(e.id); }}
                          className="text-[10px] text-cyan-400/60 hover:text-cyan-300 transition px-1.5 py-0.5 rounded hover:bg-cyan-500/10"
                        >Fullscreen</button>
                      </div>
                      <div
                        className="relative rounded-lg border border-cyan-500/20 overflow-hidden cursor-pointer bg-black"
                        style={{ height: '160px' }}
                        onClick={(ev) => { ev.stopPropagation(); setExpandedBrowser(e.id); }}
                      >
                        <img
                          src={`data:image/jpeg;base64,${browserFrames[e.id]}`}
                          alt="Browser preview"
                          className="w-full h-full object-contain"
                        />
                      </div>
                    </div>
                  )}
                  {/* Fullscreen browser modal */}
                  {expandedBrowser === e.id && browserFrames[e.id] && (
                    <div
                      className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4"
                      onClick={(ev) => { ev.stopPropagation(); setExpandedBrowser(null); }}
                    >
                      <div className="relative w-full max-w-6xl" onClick={(ev) => ev.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-sm text-cyan-400 font-medium">{e.agent?.name || 'Agent'}</span>
                            <span className="text-xs text-[var(--muted)]">Browser Live</span>
                            <span className="text-xs font-mono text-emerald-400">{timeAgo(e.startedAt)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(ev) => { handleStopExecution(e.id, ev); setExpandedBrowser(null); }}
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-500/15 text-red-400 hover:bg-red-500/25 transition"
                            >
                              <Square size={10} fill="currentColor" /> Stop
                            </button>
                            <button
                              onClick={() => setExpandedBrowser(null)}
                              className="text-white/60 hover:text-white p-1 rounded hover:bg-white/10 transition"
                            >
                              <X size={18} />
                            </button>
                          </div>
                        </div>
                        <div className="rounded-xl overflow-hidden border border-cyan-500/20 shadow-2xl shadow-cyan-500/5 bg-black">
                          <img
                            src={`data:image/jpeg;base64,${browserFrames[e.id]}`}
                            alt="Browser live view"
                            className="w-full"
                          />
                        </div>
                        {/* Live stream info below fullscreen */}
                        {(() => {
                          const stream = liveStreams[e.id] || liveStreams[e.agentId];
                          if (!stream) return null;
                          return (
                            <div className="mt-3 px-1 max-w-6xl">
                              {stream.tool && <div className="text-xs text-amber-400 mb-1">{stream.tool}</div>}
                              {stream.thinking && <div className="text-xs text-purple-400 italic truncate">{stream.thinking.slice(-200)}</div>}
                              {stream.text && <div className="text-xs text-emerald-300 truncate">{stream.text.slice(-200)}</div>}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-0 space-y-2 border-t border-emerald-500/20">
                      <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                        <div><span className="text-[var(--muted)]">Started:</span> {new Date(e.startedAt).toLocaleTimeString()}</div>
                        <div><span className="text-[var(--muted)]">Trigger:</span> {triggerLabels[e.triggerType] || e.triggerType}</div>
                        {e.triggerId && <div className="col-span-2"><span className="text-[var(--muted)]">ID:</span> <span className="font-mono">{e.triggerId}</span></div>}
                        {e.tokensUsed > 0 && <div><span className="text-[var(--muted)]">Tokens:</span> {e.tokensUsed}</div>}
                        {e.costUsd > 0 && <div><span className="text-[var(--muted)]">Cost:</span> ${e.costUsd.toFixed(4)}</div>}
                      </div>
                      {link && (
                        <a href={link.href} onClick={(ev) => ev.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline mt-1">
                          {link.label} &rarr;
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Cost Overview */}
          <CostOverviewSection />

          {/* Recent */}
          <div>
            <h3 className="text-sm font-medium text-[var(--muted)] mb-2">Recent Activity</h3>
            {activityData.recent.length === 0 ? (
              <div className="text-xs text-[var(--muted)] py-4 text-center">No recent activity</div>
            ) : activityData.recent.map((e: any) => {
              const link = getExecLink(e);
              const isExpanded = expandedExec === e.id;
              const statusIcon = e.status === 'COMPLETED' ? '\u2713' : e.status === 'FAILED' ? '\u2717' : e.status === 'WAITING_HITL' ? '\u23F3' : '\u25CB';
              const statusColor = e.status === 'COMPLETED' ? 'text-green-400' : e.status === 'FAILED' ? 'text-red-400' : e.status === 'WAITING_HITL' ? 'text-amber-400' : 'text-gray-400';
              return (
                <div key={e.id} className="border-b border-[var(--border)] last:border-0 cursor-pointer hover:bg-[var(--hover)] transition rounded"
                  onClick={() => setExpandedExec(isExpanded ? null : e.id)}>
                  <div className="py-2.5 px-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${statusColor}`}>{statusIcon}</span>
                      <span className="text-sm font-medium flex-1 truncate">{e.agent?.name || 'Agent'}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg)] text-[var(--muted)]">{triggerLabels[e.triggerType] || e.triggerType}</span>
                      <span className="text-[10px] text-[var(--muted)]">{timeAgo(e.startedAt)}</span>
                    </div>
                    {/* Always-visible summary */}
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--muted)]">
                      {e.tokensUsed > 0 && <span>{e.tokensUsed} tok</span>}
                      {e.toolCalls?.length > 0 && <span>{e.toolCalls.length} tools</span>}
                      {e.output?.screenshots?.length > 0 && <span className="text-cyan-400">{e.output.screenshots.length} screenshots</span>}
                      {e.output?.text && <span className="truncate max-w-[200px] opacity-60">{e.output.text.substring(0, 80)}</span>}
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-1 pb-2.5 space-y-2">
                      <div className="grid grid-cols-2 gap-1.5 text-xs">
                        <div><span className="text-[var(--muted)]">Status:</span> <span className={statusColor}>{e.status}</span></div>
                        <div><span className="text-[var(--muted)]">Started:</span> {new Date(e.startedAt).toLocaleTimeString()}</div>
                        {e.endedAt && <div><span className="text-[var(--muted)]">Ended:</span> {new Date(e.endedAt).toLocaleTimeString()}</div>}
                        {e.triggerId && <div className="col-span-2"><span className="text-[var(--muted)]">ID:</span> <span className="font-mono text-[10px]">{e.triggerId}</span></div>}
                        {e.tokensUsed > 0 && <div><span className="text-[var(--muted)]">Tokens:</span> {e.tokensUsed}</div>}
                        {e.costUsd > 0 && <div><span className="text-[var(--muted)]">Cost:</span> ${e.costUsd.toFixed(4)}</div>}
                        {e.error && <div className="col-span-2 text-red-400 truncate"><span className="text-[var(--muted)]">Error:</span> {e.error}</div>}
                      </div>
                      {/* Screenshots */}
                      {e.output?.screenshots?.length > 0 && (
                        <div>
                          <div className="text-[10px] text-[var(--muted)] uppercase mb-1">Browser Screenshots</div>
                          <div className="flex gap-2 overflow-x-auto">
                            {e.output.screenshots.map((frame: string, i: number) => (
                              <img key={i} src={`data:image/jpeg;base64,${frame}`} alt={`Screenshot ${i + 1}`}
                                className="rounded-lg border border-[var(--border)] h-20 object-cover shrink-0 cursor-pointer hover:border-cyan-400/50 transition"
                                onClick={(ev) => { ev.stopPropagation(); setScreenshotModal(frame); }}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Thinking */}
                      {e.output?.thinking?.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1 text-[10px] text-purple-400/60 font-medium mb-1">
                            <Brain size={10} />
                            <span>Thinking</span>
                          </div>
                          <div className="text-xs text-purple-300/80 bg-purple-500/5 rounded-lg px-3 py-2 max-h-32 overflow-y-auto border border-purple-500/10 whitespace-pre-wrap break-words">
                            {e.output.thinking.map((t: string) => t).join('\n\n').substring(0, 800)}
                          </div>
                        </div>
                      )}
                      {/* Response preview */}
                      {e.output?.text && (
                        <div>
                          <div className="text-[10px] text-[var(--muted)] uppercase mb-1">Response</div>
                          <div className="text-xs bg-[var(--bg)] rounded px-2 py-1.5 max-h-24 overflow-y-auto border border-[var(--border)] whitespace-pre-wrap break-words">
                            {e.output.text.substring(0, 500)}{e.output.text.length > 500 ? '...' : ''}
                          </div>
                        </div>
                      )}
                      {/* Tool calls */}
                      {e.toolCalls?.length > 0 && (
                        <div>
                          <div className="text-[10px] text-[var(--muted)] uppercase mb-1">Tool Calls ({e.toolCalls.length})</div>
                          <div className="space-y-0.5 border-l-2 border-[var(--accent)]/30 pl-2">
                            {e.toolCalls.slice(0, 10).map((tc: any, i: number) => (
                              <div key={i} className="flex items-center gap-1 text-[11px]">
                                <Wrench size={10} className={tc.error ? 'text-red-400' : 'text-green-400'} />
                                <span className="font-mono text-[var(--muted)] truncate flex-1">{tc.toolName}</span>
                                {tc.durationMs && <span className="text-[var(--muted)] opacity-50">{tc.durationMs}ms</span>}
                                {tc.error ? <span className="text-red-400 text-[10px]">failed</span> : <span className="text-green-400 text-[10px]">done</span>}
                              </div>
                            ))}
                            {e.toolCalls.length > 10 && <div className="text-[9px] text-[var(--muted)]">+{e.toolCalls.length - 10} more</div>}
                          </div>
                        </div>
                      )}
                      <div className="flex gap-3">
                        {link && (
                          <a href={link.href} onClick={(ev) => ev.stopPropagation()}
                            className="text-xs text-[var(--accent)] hover:underline">
                            {link.label} &rarr;
                          </a>
                        )}
                        <a href={`/agents/${e.agent?.id || e.agentId}`} onClick={(ev) => ev.stopPropagation()}
                          className="text-xs text-[var(--muted)] hover:text-white hover:underline">
                          Agent profile
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Screenshot fullscreen modal */}
      {screenshotModal && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center cursor-pointer" onClick={() => setScreenshotModal(null)}>
          <img src={`data:image/jpeg;base64,${screenshotModal}`} alt="Screenshot" className="rounded-xl border border-white/10 max-w-[90vw] max-h-[90vh] object-contain" />
        </div>
      )}

      {/* ═══════ LEFT: Chat (hidden — Gemma is now a floating widget) ═══════ */}
      <div className="hidden">
        <div className="px-3 md:px-4 py-3 border-b border-[var(--border)] flex items-center gap-2 md:gap-3 shrink-0">
          <BarChart3 size={20} className="text-[var(--accent)] hidden md:block" />
          <h1 className="font-semibold text-lg hidden md:block">Dashboard</h1>
          {selectedAgent && (
            <>
              <div className="w-px h-5 bg-[var(--border)]" />
              <Avatar name={selectedAgent.name} avatar={selectedAgent.avatar} size={24} />
              <span className="text-sm font-medium">{selectedAgent.name}</span>
              <span className="text-xs text-[var(--muted)] truncate max-w-sm flex-1">{selectedAgent.mission?.split(/[—–.]/)?.[0]?.trim()}</span>
              <div className="flex items-center gap-1 ml-auto" ref={chatHistoryRef}>
                <div className="relative">
                  <button
                    onClick={() => setShowChatHistory(!showChatHistory)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-[var(--muted)] hover:text-white hover:bg-[var(--hover)] transition"
                    title="Chat history"
                  >
                    <MessageSquare size={14} />
                    <span>{allChats.length}</span>
                    <ChevronDown size={12} />
                  </button>
                  {showChatHistory && (
                    <div className="absolute right-0 top-full mt-1 w-72 bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-lg z-50 overflow-hidden">
                      <div className="p-2 border-b border-[var(--border)] flex items-center justify-between">
                        <span className="text-xs font-medium text-[var(--muted)]">Chat History</span>
                        <span className="text-[10px] text-[var(--muted)]">{allChats.length} chat{allChats.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {allChats.map((ch) => {
                          const lastMsg = ch.messages?.[0];
                          const date = new Date(ch.createdAt);
                          const isActive = ch.id === channelId;
                          return (
                            <button
                              key={ch.id}
                              onClick={() => { setChannelId(ch.id); setShowChatHistory(false); }}
                              className={`w-full text-left px-3 py-2.5 hover:bg-[var(--hover)] transition flex items-start gap-2.5 border-b border-[var(--border)] last:border-0 ${
                                isActive ? 'bg-[var(--accent)]/10' : ''
                              }`}
                            >
                              <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${isActive ? 'bg-[var(--accent)]' : 'bg-[var(--muted)]/30'}`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium truncate">
                                    {date.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })}
                                    {' '}
                                    {date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  <span className="text-[10px] text-[var(--muted)] shrink-0">{ch._count?.messages || 0} msg</span>
                                </div>
                                {lastMsg && (
                                  <p className="text-[11px] text-[var(--muted)] truncate mt-0.5">{lastMsg.content?.substring(0, 60)}</p>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={createNewDashChat}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-[var(--accent)] text-white hover:opacity-90 transition"
                  title="New chat"
                >
                  <Plus size={14} />
                  <span>New Chat</span>
                </button>
              </div>
            </>
          )}
        </div>

        <ChatPanel
          channelId={channelId}
          currentUserId={currentUserId}
          nameMap={nameMap}
          placeholder="Ask anything..."
          autoCreateChannel={selectedAgentId ? { targetType: 'AGENT', targetId: selectedAgentId } : undefined}
          onChannelCreated={setChannelId}
          emptyState={
            !selectedAgentId ? (
              <div className="text-center text-[var(--muted)] py-20">
                <Avatar name="Gemma" avatar="/avatars/gemma.png" size={64} />
                <p className="text-lg font-medium mt-4">Gemma is loading...</p>
                <p className="text-sm">AGEMS System Director will be available shortly</p>
              </div>
            ) : (
              <div className="text-center text-[var(--muted)] py-20">
                <Avatar name="Gemma" avatar="/avatars/gemma.png" size={64} />
                <p className="text-lg font-medium mt-4">Chat with Gemma</p>
                <p className="text-sm">Ask questions or manage your AGEMS agents</p>
              </div>
            )
          }
        />
      </div>

      {/* ═══════ RIGHT: Widgets ═══════ */}
      <div className={`w-full lg:w-[420px] flex flex-col shrink-0 overflow-hidden bg-[var(--background)] ${dashTab !== 'widgets' ? 'hidden lg:flex' : ''}`}>
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2 shrink-0">
          <Code2 size={16} className="text-[var(--muted)]" />
          <span className="text-sm font-semibold flex-1">Widgets</span>
          {dashTools.length > 0 && <span className="text-[10px] text-[var(--muted)]">{dashTools.length} tools</span>}
          {widgetsDirty && (
            <button onClick={persistWidgets} className="text-xs px-2 py-1 bg-[var(--accent)] text-white rounded-lg hover:opacity-90">Save</button>
          )}
          <button onClick={() => setShowAddWidget(true)} className="p-1 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-white transition">
            <Plus size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {widgets.length === 0 && (
            <div className="text-center text-[var(--muted)] py-10 text-sm">
              <p>No widgets configured</p>
              <button onClick={() => setShowAddWidget(true)} className="text-[var(--accent)] hover:underline mt-1">Add widget</button>
            </div>
          )}

          {widgets.map((w) => {
            const res = widgetResults[w.id] || {};
            return (
              <div key={w.id}
                draggable
                onDragStart={() => { dragWidget.current = w.id; }}
                onDragEnd={() => { dragWidget.current = null; setDragOver(null); }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(w.id); }}
                onDrop={() => {
                  if (dragWidget.current && dragWidget.current !== w.id) {
                    setWidgets((prev) => {
                      const from = prev.findIndex((x) => x.id === dragWidget.current);
                      const to = prev.findIndex((x) => x.id === w.id);
                      if (from < 0 || to < 0) return prev;
                      const next = [...prev];
                      const [moved] = next.splice(from, 1);
                      next.splice(to, 0, moved);
                      api.saveDashboardWidgets(next);
                      return next;
                    });
                    setWidgetsDirty(false);
                  }
                  dragWidget.current = null;
                  setDragOver(null);
                }}
                className={`bg-[var(--card)] border rounded-xl p-4 group transition-all ${dragOver === w.id ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : 'border-[var(--border)]'}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="cursor-grab active:cursor-grabbing p-0.5 text-[var(--muted)] opacity-0 group-hover:opacity-100 transition"><GripVertical size={12} /></span>
                  <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider flex-1">{w.title}</span>
                  <button onClick={() => runWidget(w)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--card-hover)] text-[var(--muted)] transition" title="Refresh"><RefreshCw size={12} /></button>
                  <button onClick={() => setEditWidget(w)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--card-hover)] text-[var(--muted)] transition" title="Edit"><Pencil size={12} /></button>
                  <button onClick={() => removeWidget(w.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--card-hover)] text-red-400 transition" title="Remove"><Trash2 size={12} /></button>
                </div>
                {res.loading ? <div className="text-[var(--muted)] text-sm animate-pulse">Loading...</div>
                  : res.error ? <div className="text-red-400 text-xs break-words">{res.error}</div>
                  : w.display === 'number' ? <div className="text-3xl font-bold">{fmtNum(res.value)}</div>
                  : w.display === 'chart' ? (
                    <MiniChart items={res.items || []} />
                  ) : w.display === 'breakdown' ? (
                    <div className="space-y-1.5">
                      {(res.items || []).map((item, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="flex-1 truncate text-[var(--muted)]">{item.label}</span>
                          <span className="font-semibold tabular-nums">{fmtNum(item.value)}</span>
                        </div>
                      ))}
                      {(!res.items || res.items.length === 0) && <div className="text-[var(--muted)] text-xs">No data</div>}
                    </div>
                  ) : (
                    <div className="overflow-x-auto max-h-96">
                      {res.data && res.data.length > 0 ? (
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-[var(--border)]">{Object.keys(res.data[0]).map((k) => <th key={k} className="text-left py-1 pr-2 text-[var(--muted)] font-medium">{k}</th>)}</tr></thead>
                          <tbody>{res.data.slice(0, 200).map((row, i) => (
                            <tr key={i} className="border-b border-[var(--border)]/50">{Object.values(row).map((v, j) => <td key={j} className="py-1 pr-2 truncate max-w-[120px]">{String(v ?? '')}</td>)}</tr>
                          ))}</tbody>
                        </table>
                      ) : <div className="text-[var(--muted)] text-xs">No data</div>}
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══════ Widget Editor ═══════ */}
      {(editWidget || showAddWidget) && (
        <WidgetEditor
          widget={editWidget || { id: `w${Date.now()}`, title: 'New Widget', code: SNIPPETS[0].code, display: 'number', refreshMin: 5 }}
          tools={dashTools}
          isNew={!!showAddWidget}
          onSave={(w) => showAddWidget ? addWidget(w) : saveWidgetEdit(w)}
          onClose={() => { setEditWidget(null); setShowAddWidget(false); }}
        />
      )}

      {/* ═══════ AI Modules Modal ═══════ */}
      {showModulesModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowModulesModal(false)}>
          <div className="bg-[var(--card)] rounded-xl w-full max-w-[680px] mx-4 max-h-[90vh] overflow-y-auto border border-[var(--border)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-3">
              <Settings2 size={18} className="text-[var(--accent)]" />
              <h3 className="font-semibold flex-1">AI Modules</h3>
              <button onClick={() => setShowModulesModal(false)} className="p-1 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)]"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Global Master Switch */}
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-sm">AI Agent Execution</h4>
                  <p className="text-xs text-[var(--muted)]">Master switch for all agent interactions</p>
                </div>
                <button
                  onClick={async () => {
                    const next = !globalEnabled;
                    setGlobalEnabled(next);
                    try { await api.setModulesConfig({ globalEnabled: next }); } catch { setGlobalEnabled(!next); }
                  }}
                  className={`relative w-14 h-7 rounded-full transition-colors duration-200 ${globalEnabled ? 'bg-emerald-500' : 'bg-gray-600'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform duration-200 ${globalEnabled ? 'translate-x-7' : 'translate-x-0'}`} />
                </button>
              </div>
              <div className={`p-2.5 rounded-lg border ${globalEnabled ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${globalEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                  <span className={`text-xs font-medium ${globalEnabled ? 'text-emerald-400' : 'text-red-400'}`}>
                    {globalEnabled ? 'Agents are active across all enabled modules' : 'All agent interactions are paused'}
                  </span>
                </div>
              </div>

              {/* Cross-Channel Context */}
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-sm">Cross-Channel Context</h4>
                  <p className="text-xs text-[var(--muted)]">Inject recent messages from other channels</p>
                </div>
                <button
                  onClick={() => setCrossChannelEnabled(!crossChannelEnabled)}
                  className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${crossChannelEnabled ? 'bg-emerald-500' : 'bg-gray-600'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform duration-200 ${crossChannelEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Module Cards */}
              <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 ${!globalEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
                {([
                  { key: 'tasks' as ModuleName, label: 'Tasks', desc: 'Execute, review, and create tasks' },
                  { key: 'comms' as ModuleName, label: 'Comms', desc: 'Respond to messages in channels' },
                  { key: 'meetings' as ModuleName, label: 'Meetings', desc: 'Participate in meetings and vote' },
                  { key: 'goals' as ModuleName, label: 'Goals', desc: 'Track and advance goals' },
                  { key: 'projects' as ModuleName, label: 'Projects', desc: 'Manage project work' },
                ]).map(({ key: mod, label, desc }) => {
                  const mc = aiModules[mod];
                  const activityLabels: Record<number, string> = {
                    1: 'Passive', 2: 'Reactive', 3: 'Balanced', 4: 'Proactive', 5: 'Aggressive',
                  };
                  const autonomyLabels: Record<number, string> = {
                    1: 'Solo', 2: 'Lean', 3: 'Balanced', 4: 'Team-first', 5: 'Full team',
                  };
                  return (
                    <div key={mod} className={`bg-[var(--bg)] border rounded-xl p-4 transition-all ${mc.enabled ? 'border-[var(--border)]' : 'border-[var(--border)] opacity-60'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="font-semibold text-sm">{label}</h4>
                          <p className="text-[10px] text-[var(--muted)]">{desc}</p>
                        </div>
                        <button
                          onClick={() => updateModule(mod, { enabled: !mc.enabled })}
                          className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${mc.enabled ? 'bg-emerald-500' : 'bg-gray-600'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${mc.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      </div>
                      <div className={`space-y-3 ${!mc.enabled ? 'opacity-30 pointer-events-none' : ''}`}>
                        {/* Activity Level */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-medium text-[var(--muted)]">Activity</span>
                            <span className="text-[10px] text-[var(--muted)]">{activityLabels[mc.activityLevel]}</span>
                          </div>
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map(n => (
                              <button key={n} onClick={() => updateModule(mod, { activityLevel: n })}
                                className={`flex-1 h-6 rounded text-[10px] font-bold transition-all ${
                                  mc.activityLevel === n
                                    ? 'bg-[var(--accent)] text-white scale-105'
                                    : 'bg-[var(--card)] border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]'
                                }`}
                              >{n}</button>
                            ))}
                          </div>
                        </div>
                        {/* Autonomy Level */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-medium text-[var(--muted)]">Autonomy</span>
                            <span className="text-[10px] text-[var(--muted)]">{autonomyLabels[mc.autonomyLevel]}</span>
                          </div>
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map(n => (
                              <button key={n} onClick={() => updateModule(mod, { autonomyLevel: n })}
                                className={`flex-1 h-6 rounded text-[10px] font-bold transition-all ${
                                  mc.autonomyLevel === n
                                    ? 'bg-purple-500 text-white scale-105'
                                    : 'bg-[var(--card)] border border-[var(--border)] text-[var(--muted)] hover:border-purple-400'
                                }`}
                              >{n}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Save Button */}
              <div className="flex items-center gap-3 pt-2">
                <button onClick={handleSaveModules} disabled={savingModules}
                  className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
                  {savingModules ? 'Saving...' : 'Save Changes'}
                </button>
                {modulesSaved && <span className="text-green-500 text-sm">Saved!</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Snippets
   ═══════════════════════════════════════════════════════════ */

const SNIPPETS = [
  { label: 'SQL — number', code: `const db = ctx.tools.find(t => t.type === 'DATABASE');\nif (!db) return { error: 'No DB tool' };\nconst r = await query(db.id, "SELECT COUNT(*) as value FROM table_name WHERE DATE(created_at) = CURDATE()");\nreturn r.data?.[0]?.value ?? 0;` },
  { label: 'SQL — breakdown', code: `const db = ctx.tools.find(t => t.type === 'DATABASE');\nif (!db) return { error: 'No DB tool' };\nconst r = await query(db.id, "SELECT status as label, COUNT(*) as value FROM table_name GROUP BY status");\nreturn r.data || [];` },
  { label: 'REST API call', code: `const tool = ctx.tools.find(t => t.type === 'REST_API');\nif (!tool) return { error: 'No API tool' };\nconst r = await http(tool.id, 'GET', '/endpoint', null, { date: '2026-01-01' });\nreturn r.data?.total ?? 0;` },
  { label: 'SQL — chart (7 days)', code: `const db = ctx.tools.find(t => t.type === 'DATABASE');\nif (!db) return { error: 'No DB tool' };\nconst r = await query(db.id, "SELECT DATE_FORMAT(date_created, '%a %d') as label, COUNT(*) as value FROM table_name WHERE date_created >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY DATE(date_created) ORDER BY DATE(date_created)");\nreturn r.data || [];` },
  { label: 'Multiple sources', code: `const db = ctx.tools.find(t => t.type === 'DATABASE');\nconst api = ctx.tools.find(t => t.type === 'REST_API');\nconst [sales, visits] = await Promise.all([\n  db ? query(db.id, "SELECT COUNT(*) as v FROM orders WHERE DATE(created_at) = CURDATE()") : { data: [{v:'?'}] },\n  api ? http(api.id, 'GET', '/stats') : { data: {visits:'?'} },\n]);\nreturn [\n  { label: 'Sales', value: sales.data?.[0]?.v ?? 0 },\n  { label: 'Visits', value: visits.data?.visits ?? 0 },\n];` },
];

/* ═══════════════════════════════════════════════════════════
   Widget Editor
   ═══════════════════════════════════════════════════════════ */

function WidgetEditor({ widget, tools, isNew, onSave, onClose }: {
  widget: Widget; tools: DashTool[]; isNew: boolean;
  onSave: (w: Widget) => void; onClose: () => void;
}) {
  const [form, setForm] = useState<Widget>({ ...widget });
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try { setTestResult(JSON.stringify(await executeWidgetCode(form.code, tools), null, 2)); }
    catch (e: any) { setTestResult(`Error: ${e.message}`); }
    setTesting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[var(--card)] rounded-xl w-full max-w-[640px] mx-4 max-h-[90vh] overflow-y-auto border border-[var(--border)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-3">
          <Code2 size={18} className="text-[var(--accent)]" />
          <h3 className="font-semibold flex-1">{isNew ? 'Add Widget' : 'Edit Widget'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)]"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm" />
          </div>

          {tools.length > 0 && (
            <div className="text-xs text-[var(--muted)] flex flex-wrap gap-2">
              {tools.map((t) => (
                <span key={t.id} className="px-2 py-0.5 bg-[var(--background)] rounded border border-[var(--border)]">
                  {t.type === 'DATABASE' ? '🗄' : '🌐'} {t.name} <span className="opacity-50">{t.id.slice(0, 6)}</span>
                </span>
              ))}
            </div>
          )}
          {tools.length === 0 && (
            <div className="text-xs text-yellow-400 bg-yellow-400/10 rounded-lg p-2">
              No tools configured. Add DATABASE or REST_API tools in the Tools section to use them in widgets.
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="block text-sm font-medium">JavaScript Code</label>
              <button onClick={() => setShowSnippets(!showSnippets)} className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
                Examples {showSnippets ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>

            {showSnippets && (
              <div className="mb-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {SNIPPETS.map((s, i) => (
                  <button key={i} onClick={() => { setForm({ ...form, code: s.code }); setShowSnippets(false); }}
                    className="text-left px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--card-hover)] transition">
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            <textarea value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
              rows={10} spellCheck={false}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm font-mono resize-y leading-relaxed" />
            <div className="flex items-center gap-2 mt-1">
              <p className="text-[10px] text-[var(--muted)] flex-1">
                <code className="bg-[var(--background)] px-1 rounded">query(toolId, sql)</code>{' '}
                <code className="bg-[var(--background)] px-1 rounded">http(toolId, method, path, body?, params?)</code>{' '}
                <code className="bg-[var(--background)] px-1 rounded">ctx.tools</code>
              </p>
              <button onClick={handleTest} disabled={testing}
                className="px-3 py-1 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--card-hover)] disabled:opacity-40 flex items-center gap-1">
                <Play size={12} /> {testing ? 'Running...' : 'Test'}
              </button>
            </div>
          </div>

          {testResult !== null && (
            <div className="bg-[var(--background)] rounded-lg border border-[var(--border)] p-3 max-h-40 overflow-auto">
              <pre className={`text-xs whitespace-pre-wrap ${testResult.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>{testResult}</pre>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
            <div>
              <label className="block text-sm font-medium mb-1">Display</label>
              <div className="flex gap-2">
                {(['number', 'breakdown', 'chart', 'table'] as const).map((d) => (
                  <button key={d} onClick={() => setForm({ ...form, display: d })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${form.display === d
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--muted)] hover:text-white'}`}>
                    {d === 'number' ? 'Number' : d === 'breakdown' ? 'Breakdown' : d === 'chart' ? 'Chart' : 'Table'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Refresh (min)</label>
              <input type="number" min={0} max={60} value={form.refreshMin}
                onChange={(e) => setForm({ ...form, refreshMin: parseInt(e.target.value) || 0 })}
                className="w-20 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm" />
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[var(--border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--card-hover)]">Cancel</button>
          <button onClick={() => onSave(form)} disabled={!form.title.trim() || !form.code.trim()}
            className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40">
            {isNew ? 'Add Widget' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Mini Bar Chart (pure SVG, no deps)
   ═══════════════════════════════════════════════════════════ */

function MiniChart({ items }: { items: { label: string; value: string | number }[] }) {
  if (!items.length) return <div className="text-[var(--muted)] text-xs">No data</div>;

  const values = items.map((i) => Number(i.value) || 0);
  const max = Math.max(...values, 1);
  const barW = Math.max(16, Math.min(48, Math.floor(340 / items.length) - 6));
  const chartH = 100;
  const totalW = items.length * (barW + 6);

  return (
    <div className="overflow-x-auto">
      <svg width={totalW} height={chartH + 28} className="block">
        {/* grid lines */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={totalW} y1={chartH * (1 - f)} y2={chartH * (1 - f)}
            stroke="var(--border)" strokeWidth={0.5} strokeDasharray="4 4" />
        ))}
        {/* bars + labels */}
        {items.map((item, i) => {
          const v = Number(item.value) || 0;
          const h = (v / max) * chartH;
          const x = i * (barW + 6) + 3;
          return (
            <g key={i}>
              <rect x={x} y={chartH - h} width={barW} height={h} rx={3}
                fill={COLORS[i % COLORS.length]} opacity={0.85} />
              {h > 16 && (
                <text x={x + barW / 2} y={chartH - h + 14} textAnchor="middle"
                  className="text-[9px] font-semibold" fill="white">{fmtNum(v)}</text>
              )}
              {h <= 16 && (
                <text x={x + barW / 2} y={chartH - h - 4} textAnchor="middle"
                  className="text-[9px] font-semibold" fill="var(--muted)">{fmtNum(v)}</text>
              )}
              <text x={x + barW / 2} y={chartH + 14} textAnchor="middle"
                className="text-[9px]" fill="var(--muted)">{item.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const COLORS = ['#6c5ce7', '#00cec9', '#fdcb6e', '#e17055', '#0984e3', '#a29bfe', '#55efc4', '#fab1a0'];

function fmtNum(val: any): string {
  if (val === undefined || val === null) return '—';
  const num = Number(val);
  if (isNaN(num)) return String(val);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString();
}

/* ═══════════════════════════════════════════════════════════
   Cost Overview Section — Org-wide spending stats on dashboard
   ═══════════════════════════════════════════════════════════ */
function CostOverviewSection() {
  const [stats, setStats] = useState<any>(null);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const days = period === 'monthly' ? 365 : period === 'weekly' ? 90 : 30;
    api.getOrgCostStats(period, days).then((data) => {
      setStats(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [period]);

  if (loading && !stats) return null;
  if (!stats || (!stats.totalCost && !stats.timeline?.length)) return null;

  const maxCost = stats.timeline?.length > 0 ? Math.max(...stats.timeline.map((t: any) => t.cost), 0.0001) : 1;

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-[var(--muted)]">Cost Overview</h3>
        <div className="flex gap-1">
          {(['daily', 'weekly', 'monthly'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-[10px] px-2 py-0.5 rounded ${
                period === p ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)] hover:text-white'
              }`}
            >
              {p === 'daily' ? '30D' : p === 'weekly' ? '90D' : '12M'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center">
          <div className="text-lg font-bold" style={{ color: 'var(--accent)' }}>${stats.totalCost?.toFixed(2)}</div>
          <div className="text-[9px] text-[var(--muted)] uppercase">Total Cost</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold">{(stats.totalTokens || 0).toLocaleString()}</div>
          <div className="text-[9px] text-[var(--muted)] uppercase">Tokens</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold">{stats.totalExecutions || 0}</div>
          <div className="text-[9px] text-[var(--muted)] uppercase">Executions</div>
        </div>
      </div>

      {/* Mini bar chart */}
      {stats.timeline?.length > 0 && (
        <div className="flex items-end gap-px h-16">
          {stats.timeline.map((t: any, i: number) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group relative">
              <div
                className="w-full rounded-t-sm hover:opacity-80"
                style={{
                  height: `${Math.max((t.cost / maxCost) * 100, 3)}%`,
                  backgroundColor: 'var(--accent)',
                  minHeight: '1px',
                }}
              />
              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-[var(--card)] border border-[var(--border)] rounded px-2 py-1 text-[9px] whitespace-nowrap z-10 shadow-lg">
                <div className="font-medium">{t.date}</div>
                <div>${t.cost?.toFixed(4)} &middot; {t.tokens?.toLocaleString()} tok</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top agents by cost */}
      {stats.agentBreakdown?.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <div className="text-[9px] text-[var(--muted)] uppercase mb-1.5">Top Agents by Cost</div>
          <div className="space-y-1">
            {stats.agentBreakdown.slice(0, 5).map((a: any, i: number) => (
              <div key={a.agentId} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                <span className="flex-1 truncate text-[var(--muted)]">{a.name || a.agentId.slice(0, 8)}</span>
                <span className="font-medium tabular-nums">${a.cost?.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
