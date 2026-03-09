'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { Plus, Pencil, Trash2, Play, X, Code2, BarChart3, RefreshCw, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';
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
  const [dashTab, setDashTab] = useState<'chat' | 'widgets'>('chat');

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-3.5rem)] lg:h-screen overflow-hidden">
      {/* Mobile tab bar */}
      <div className="flex border-b border-[var(--border)] lg:hidden shrink-0">
        <button onClick={() => setDashTab('chat')} className={`flex-1 py-2.5 text-sm font-medium text-center transition ${dashTab === 'chat' ? 'text-white border-b-2 border-[var(--accent)]' : 'text-[var(--muted)]'}`}>Chat</button>
        <button onClick={() => setDashTab('widgets')} className={`flex-1 py-2.5 text-sm font-medium text-center transition ${dashTab === 'widgets' ? 'text-white border-b-2 border-[var(--accent)]' : 'text-[var(--muted)]'}`}>Widgets</button>
      </div>

      {/* ═══════ LEFT: Chat ═══════ */}
      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden lg:border-r border-[var(--border)] ${dashTab !== 'chat' ? 'hidden lg:flex' : ''}`}>
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
              <div key={w.id} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 group">
                <div className="flex items-center gap-2 mb-2">
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
                    <div className="overflow-x-auto max-h-48">
                      {res.data && res.data.length > 0 ? (
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-[var(--border)]">{Object.keys(res.data[0]).map((k) => <th key={k} className="text-left py-1 pr-2 text-[var(--muted)] font-medium">{k}</th>)}</tr></thead>
                          <tbody>{res.data.slice(0, 20).map((row, i) => (
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
