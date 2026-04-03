'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { MessageSquare, ListChecks, Video, GitFork, Archive, Send, Plus, ChevronDown } from 'lucide-react';
import TelegramSection from './telegram-section';
import ChatPanel from '@/components/ChatPanel';

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [agent, setAgent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Chat state
  const [chatChannelId, setChatChannelId] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [allChats, setAllChats] = useState<any[]>([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Execution history
  const [executions, setExecutions] = useState<any[]>([]);
  const [expandedExec, setExpandedExec] = useState<string | null>(null);

  // Tools
  const [allTools, setAllTools] = useState<any[]>([]);
  const [showToolPicker, setShowToolPicker] = useState(false);

  // Built-in runtime tools
  const [builtinTools, setBuiltinTools] = useState<Array<{ name: string; description: string; category: string }>>([]);

  // Skills
  const [allSkills, setAllSkills] = useState<any[]>([]);

  // Avatar lightbox
  const [showAvatarFull, setShowAvatarFull] = useState(false);
  const [showSkillPicker, setShowSkillPicker] = useState(false);

  // Spawn
  const [showSpawn, setShowSpawn] = useState(false);
  const [spawnForm, setSpawnForm] = useState({ name: '', slug: '', mission: '', llmProvider: '', llmModel: '', systemPrompt: '' });
  const [spawning, setSpawning] = useState(false);

  // Delegate
  const [showDelegate, setShowDelegate] = useState(false);
  const [delegateForm, setDelegateForm] = useState({ childAgentId: '', title: '', description: '', priority: 'MEDIUM' });
  const [delegating, setDelegating] = useState(false);

  // Archive
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Memory
  const [memories, setMemories] = useState<any[]>([]);
  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const [editMemoryContent, setEditMemoryContent] = useState('');
  const [editMemoryType, setEditMemoryType] = useState('KNOWLEDGE');
  const [newMemoryContent, setNewMemoryContent] = useState('');
  const [newMemoryType, setNewMemoryType] = useState('KNOWLEDGE');
  const [showAddMemory, setShowAddMemory] = useState(false);

  const loadAgent = useCallback(async () => {
    if (!params.id) return;
    try {
      const data = await api.getAgent(params.id as string);
      setAgent(data);
    } catch { /* noop */ }
    setLoading(false);
  }, [params.id]);

  const loadExecutions = useCallback(async () => {
    if (!params.id) return;
    try {
      const data = await api.getAgentExecutions(params.id as string, 10);
      setExecutions(Array.isArray(data) ? data : []);
    } catch { /* noop */ }
  }, [params.id]);

  const loadTools = useCallback(async () => {
    try {
      const r = await api.getTools();
      setAllTools((r as any).data || []);
    } catch { /* noop */ }
  }, []);

  const loadSkills = useCallback(async () => {
    try {
      const r = await api.getSkills();
      setAllSkills((r as any).data || r || []);
    } catch { /* noop */ }
  }, []);

  const loadBuiltinTools = useCallback(async () => {
    if (!params.id) return;
    try {
      const data = await api.getAgentBuiltinTools(params.id as string);
      setBuiltinTools(Array.isArray(data) ? data : []);
    } catch { /* noop */ }
  }, [params.id]);

  const loadMemory = useCallback(async () => {
    if (!params.id) return;
    try {
      const data = await api.getAgentMemory(params.id as string);
      setMemories(Array.isArray(data) ? data : []);
    } catch { /* noop */ }
  }, [params.id]);

  useEffect(() => {
    loadAgent();
    loadExecutions();
    loadTools();
    loadSkills();
    loadBuiltinTools();
    loadMemory();
    api.fetch<any>('/auth/profile').then((p: any) => setCurrentUserId(p.id)).catch(() => {});
  }, [loadAgent, loadExecutions, loadTools, loadSkills, loadBuiltinTools, loadMemory]);

  // Load all direct channels with this agent
  const loadChats = useCallback(async () => {
    if (!params.id) return;
    try {
      const chats = await api.findAllDirectChannels('AGENT', params.id as string);
      setAllChats(chats || []);
      if (chats?.length > 0 && !chatChannelId) {
        setChatChannelId(chats[0].id);
      }
    } catch {
      // fallback to single channel
      try {
        const ch = await api.findDirectChannel('AGENT', params.id as string);
        if (ch?.id) { setAllChats([ch]); setChatChannelId(ch.id); }
      } catch {}
    }
  }, [params.id, chatChannelId]);

  useEffect(() => { loadChats(); }, [loadChats]);

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

  const createNewAgentChat = async () => {
    if (!agent) return;
    const now = new Date();
    const label = now.toLocaleDateString('ru', { day: 'numeric', month: 'short' }) + ' ' + now.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    try {
      const ch: any = await api.createChannel({
        name: `${agent.name} ${label}`,
        type: 'DIRECT',
        participantIds: [{ type: 'AGENT', id: agent.id }],
      });
      setAllChats(prev => [ch, ...prev]);
      setChatChannelId(ch.id);
      setShowChatHistory(false);
    } catch (err: any) {
      alert(err.message || 'Failed to create chat');
    }
  };

  const chatNameMap = useCallback((type: string, id: string) => {
    if (type === 'AGENT') return { name: agent?.name || 'Agent', avatar: agent?.avatar || null };
    return { name: 'You', avatar: null };
  }, [agent]);

  const openEdit = () => {
    const lc = (agent.llmConfig as any) || {};
    const rc = (agent.runtimeConfig as any) || {};
    setEditForm({
      name: agent.name || '',
      llmProvider: agent.llmProvider || 'ANTHROPIC',
      llmModel: agent.llmModel || '',
      systemPrompt: agent.systemPrompt || '',
      mission: agent.mission || '',
      avatar: agent.avatar || '',
      type: agent.type || 'WORKER',
      values: (agent.values || []).join(', '),
      temperature: lc.temperature ?? 0.7,
      maxTokens: lc.maxTokens ?? 4096,
      thinkingBudget: lc.thinkingBudget ?? 4000,
      mcpServers: Array.isArray(rc.mcpServers) ? rc.mcpServers : [],
    });
    setSaveError('');
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const { values: valuesStr, temperature, maxTokens, thinkingBudget, mcpServers: mcpRaw, ...rest } = editForm;
      const values = valuesStr ? valuesStr.split(',').map((v: string) => v.trim()).filter(Boolean) : [];
      const llmConfig = {
        temperature: parseFloat(temperature) || 0.7,
        maxTokens: parseInt(maxTokens) || 4096,
        thinkingBudget: parseInt(thinkingBudget) || 4000,
      };
      // Merge MCP servers into existing runtimeConfig
      const existingRc = (agent.runtimeConfig as any) || {};
      const mcpServers = Array.isArray(mcpRaw) ? mcpRaw.filter((s: any) => s.name && s.url) : [];
      const runtimeConfig = { ...existingRc, mcpServers };
      await api.updateAgent(agent.id, { ...rest, values, llmConfig, runtimeConfig });
      setEditing(false);
      loadAgent();
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save');
    }
    setSaving(false);
  };

  const handleSpawn = async () => {
    setSpawning(true);
    try {
      await api.spawnAgent(agent.id, {
        name: spawnForm.name,
        slug: spawnForm.slug,
        mission: spawnForm.mission || undefined,
        llmProvider: spawnForm.llmProvider || agent.llmProvider,
        llmModel: spawnForm.llmModel || agent.llmModel,
        systemPrompt: spawnForm.systemPrompt || undefined,
      });
      setShowSpawn(false);
      setSpawnForm({ name: '', slug: '', mission: '', llmProvider: '', llmModel: '', systemPrompt: '' });
      loadAgent();
    } catch { /* noop */ }
    setSpawning(false);
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await api.archiveAgent(agent.id);
      router.push('/agents');
    } catch { /* noop */ }
    setArchiving(false);
  };

  const handleUnarchive = async () => {
    try {
      const updated = await api.unarchiveAgent(agent.id);
      setAgent(updated);
    } catch { /* noop */ }
  };

  const handleDelegate = async () => {
    setDelegating(true);
    try {
      await api.delegateToAgent(agent.id, {
        childAgentId: delegateForm.childAgentId,
        title: delegateForm.title,
        description: delegateForm.description || undefined,
        priority: delegateForm.priority,
      });
      setShowDelegate(false);
      setDelegateForm({ childAgentId: '', title: '', description: '', priority: 'MEDIUM' });
    } catch { /* noop */ }
    setDelegating(false);
  };

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading agent...</div>;
  if (!agent) return <div className="p-8 text-red-400">Agent not found</div>;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <Link href="/agents" className="text-sm text-[var(--muted)] hover:text-white mb-4 inline-block">&larr; Back to agents</Link>

      {/* Header */}
      <div className="flex items-start gap-4 mb-8">
        {agent.avatar && agent.avatar.startsWith('/') ? (
          <img src={agent.avatar} alt={agent.name} className="w-28 h-28 rounded-full object-cover object-top cursor-pointer hover:ring-2 hover:ring-[var(--accent)] transition shadow-lg" onClick={() => setShowAvatarFull(true)} />
        ) : (
          <span className="text-5xl">{agent.avatar || '🤖'}</span>
        )}
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-3xl font-bold">{agent.name}</h1>
              {agent.positions?.[0]?.title && (
                <p className="text-sm text-[var(--muted)]">{agent.positions[0].title}</p>
              )}
            </div>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${agent.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'}`}>
              {agent.status}
            </span>
            {agent.status !== 'ACTIVE' ? (
              <button
                onClick={async () => { await api.activateAgent(agent.id); loadAgent(); }}
                className="px-3 py-1 text-xs bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors"
              >
                Activate
              </button>
            ) : (
              <button
                onClick={async () => { await api.pauseAgent(agent.id); loadAgent(); }}
                className="px-3 py-1 text-xs bg-yellow-500/20 text-yellow-400 rounded-lg hover:bg-yellow-500/30 transition-colors"
              >
                Pause
              </button>
            )}
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => router.push(`/comms?direct=AGENT:${agent.id}`)}
                className="p-2 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-white transition-colors"
                title="Open Chat"
              >
                <MessageSquare size={16} strokeWidth={1.5} />
              </button>
              <button
                onClick={() => router.push(`/tasks?assignee=AGENT:${agent.id}`)}
                className="p-2 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-white transition-colors"
                title="Tasks"
              >
                <ListChecks size={16} strokeWidth={1.5} />
              </button>
              <button
                onClick={() => router.push('/meetings')}
                className="p-2 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-white transition-colors"
                title="Meetings"
              >
                <Video size={16} strokeWidth={1.5} />
              </button>
              <button
                onClick={() => {
                  setSpawnForm({ name: '', slug: '', mission: '', llmProvider: agent.llmProvider, llmModel: agent.llmModel, systemPrompt: '' });
                  setShowSpawn(true);
                }}
                className="p-2 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-white transition-colors"
                title="Spawn Child Agent"
              >
                <GitFork size={16} strokeWidth={1.5} />
              </button>
              {agent.childAgents?.length > 0 && (
                <button
                  onClick={() => {
                    setDelegateForm({ childAgentId: agent.childAgents[0].id, title: '', description: '', priority: 'MEDIUM' });
                    setShowDelegate(true);
                  }}
                  className="p-2 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-white transition-colors"
                  title="Delegate Task"
                >
                  <Send size={16} strokeWidth={1.5} />
                </button>
              )}
              {agent.status === 'ARCHIVED' ? (
                <button
                  onClick={handleUnarchive}
                  className="px-3 py-1 text-xs bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors"
                  title="Restore Agent"
                >
                  Restore
                </button>
              ) : (
                <button
                  onClick={() => setShowArchiveConfirm(true)}
                  className="p-2 rounded-lg hover:bg-red-500/10 text-[var(--muted)] hover:text-red-400 transition-colors"
                  title="Archive Agent"
                >
                  <Archive size={16} strokeWidth={1.5} />
                </button>
              )}
              <button
                onClick={openEdit}
                className="px-3 py-1 text-xs bg-[var(--accent)]/20 text-[var(--accent)] rounded-lg hover:bg-[var(--accent)]/30 transition-colors"
              >
                Edit
              </button>
            </div>
          </div>
          <p className="text-[var(--muted)]">@{agent.slug} &middot; v{agent.version}</p>
          {agent.mission && <p className="mt-2 text-sm">{agent.mission}</p>}
        </div>
      </div>

      {/* Chat */}
      <Section title={
        <div className="flex items-center gap-3 w-full">
          <span>Chat</span>
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
                      const isActive = ch.id === chatChannelId;
                      return (
                        <button
                          key={ch.id}
                          onClick={() => { setChatChannelId(ch.id); setShowChatHistory(false); }}
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
              onClick={createNewAgentChat}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-[var(--accent)] text-white hover:opacity-90 transition"
              title="New chat"
            >
              <Plus size={14} />
              <span>New Chat</span>
            </button>
          </div>
        </div>
      } wide>
        <ChatPanel
          channelId={chatChannelId}
          currentUserId={currentUserId}
          nameMap={chatNameMap}
          placeholder={`Message ${agent.name}...`}
          height="420px"
          onApprovalResolved={() => { loadAgent(); loadExecutions(); }}
          emptyState={
            <p className="text-sm text-[var(--muted)] text-center py-8">No messages yet. Start a conversation with {agent.name}.</p>
          }
        />
      </Section>

      {/* Info grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 mt-8">
        <Section title="Brain">
          <InfoRow label="Provider" value={agent.llmProvider} />
          <InfoRow label="Model" value={agent.llmModel} />
          <InfoRow label="Temperature" value={(agent.llmConfig as any)?.temperature ?? 0.7} />
          <InfoRow label="Max Tokens" value={(agent.llmConfig as any)?.maxTokens ?? 4096} />
          {['ANTHROPIC', 'GOOGLE'].includes(agent.llmProvider) && (
            <InfoRow label="Thinking Budget" value={(agent.llmConfig as any)?.thinkingBudget ?? 4000} />
          )}
          <InfoRow label="Type" value={agent.type} />
          <InfoRow label="Owner" value={agent.owner?.name || agent.ownerId} />
        </Section>

        <Section title="Stats">
          <InfoRow label="Memory entries" value={memories.length} />
          <InfoRow label="Executions" value={agent._count?.executions ?? 0} />
          <InfoRow label="Metrics" value={agent._count?.metrics ?? 0} />
          <InfoRow label="Skills" value={agent.skills?.length ?? 0} />
          <InfoRow label="Tools" value={`${builtinTools.filter((t: any) => t.enabled).length} / ${builtinTools.length}`} />
        </Section>

        <Section title="Tools" wide>
          <p className="text-xs text-[var(--muted)] mb-3">Click to enable/disable. Greyed out tools are not available to the agent.</p>
          {builtinTools.length > 0 ? (
            <div className="space-y-1">
              {Object.entries(builtinTools.reduce((acc: Record<string, typeof builtinTools>, t) => {
                (acc[t.category] = acc[t.category] || []).push(t);
                return acc;
              }, {})).map(([category, tools]) => (
                <div key={category} className="mb-3">
                  <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-1.5">{category}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {tools.map((t: any) => (
                      <button key={t.name} title={t.description}
                        onClick={async () => {
                          await api.toggleAgentBuiltinTool(agent.id, t.name, !t.enabled);
                          loadBuiltinTools();
                        }}
                        className={`text-[11px] px-2 py-1 rounded-md border transition ${
                          t.enabled
                            ? 'bg-[var(--background)] border-[var(--border)] text-[var(--foreground)] hover:border-red-400/40'
                            : 'bg-[var(--background)] border-[var(--border)] text-[var(--muted)] opacity-40 hover:opacity-70 hover:border-emerald-400/40 line-through'
                        }`}>
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Loading...</p>
          )}
          <button
            onClick={() => setShowToolPicker(true)}
            className="text-sm px-3 py-2 mt-3 rounded-lg border border-dashed border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition w-full"
          >+ Connect External Tool</button>
        </Section>

        <Section title="Skills" wide>
          <div className="space-y-2">
            {(agent.skills && agent.skills.length > 0) ? agent.skills.map((as: any) => {
              const skill = as.skill || {};
              const typeIcons: Record<string, string> = { BUILTIN: '📦', PLUGIN: '🔌', CUSTOM: '✨' };
              return (
                <div key={as.id} className="flex items-center gap-3 p-3 bg-[var(--background)] border border-[var(--border)] rounded-lg">
                  <span className="text-lg">{typeIcons[skill.type] || '📦'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{skill.name}</div>
                    <div className="text-xs text-[var(--muted)] truncate">{skill.description || skill.type}</div>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${as.enabled !== false ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'}`}>
                    {as.enabled !== false ? 'ON' : 'OFF'}
                  </span>
                  <button
                    onClick={async () => {
                      await api.removeSkillFromAgent(agent.id, as.skillId);
                      loadAgent();
                    }}
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
                  >Remove</button>
                </div>
              );
            }) : (
              <p className="text-sm text-[var(--muted)]">No skills assigned. Add skills to extend the agent&apos;s capabilities.</p>
            )}
            <button
              onClick={() => setShowSkillPicker(true)}
              className="text-sm px-3 py-2 rounded-lg border border-dashed border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition w-full"
            >+ Add Skill</button>
          </div>
        </Section>

        {/* MCP Servers (read-only display) */}
        {(() => {
          const rc = (agent.runtimeConfig as any) || {};
          const servers = Array.isArray(rc.mcpServers) ? rc.mcpServers : [];
          if (servers.length === 0) return null;
          return (
            <Section title={`MCP Servers (${servers.length})`} wide>
              <div className="space-y-2">
                {servers.map((s: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-[var(--muted)] font-mono text-xs truncate">{s.url}</span>
                    {s.authorizationToken && <span className="text-[10px] text-green-400 border border-green-400/30 rounded px-1">AUTH</span>}
                  </div>
                ))}
              </div>
            </Section>
          );
        })()}

        <Section title="System Prompt" wide>
          <pre className="text-sm text-[var(--muted)] whitespace-pre-wrap bg-[var(--background)] rounded-lg p-4 border border-[var(--border)] max-h-60 overflow-auto">
            {agent.systemPrompt}
          </pre>
        </Section>

        <ValuesSection values={agent.values || []} agentId={agent.id} onUpdated={loadAgent} />
      </div>

      {/* Approval Policy */}
      <div className="mb-8">
        <ApprovalPolicySection agentId={agent.id} agentTools={agent.tools || []} />
      </div>

      {/* Telegram */}
      <div className="mb-8">
        <TelegramSection agent={agent} onAgentUpdated={loadAgent} />
      </div>

      {/* Memory */}
      <div className="mb-8">
        <Section title={<span className="flex items-center gap-2">Memory <span className="text-xs font-normal text-[var(--muted)]">({memories.length})</span></span>} wide>
          <div className="space-y-2">
            {/* Add memory button */}
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setShowAddMemory(!showAddMemory)}
                className="text-xs px-3 py-1.5 bg-[var(--accent)] text-white rounded-lg hover:opacity-90"
              >
                + Add Memory
              </button>
            </div>

            {/* Add memory form */}
            {showAddMemory && (
              <div className="border border-[var(--border)] rounded-lg p-3 mb-3 bg-[var(--bg)]">
                <div className="flex gap-2 mb-2">
                  <select
                    value={newMemoryType}
                    onChange={(e) => setNewMemoryType(e.target.value)}
                    className="text-xs px-2 py-1 bg-[var(--card)] border border-[var(--border)] rounded"
                  >
                    <option value="KNOWLEDGE">KNOWLEDGE</option>
                    <option value="CONTEXT">CONTEXT</option>
                    <option value="FILE">FILE</option>
                    <option value="CONVERSATION">CONVERSATION</option>
                  </select>
                </div>
                <textarea
                  value={newMemoryContent}
                  onChange={(e) => setNewMemoryContent(e.target.value)}
                  placeholder="Memory content..."
                  className="w-full text-sm p-2 bg-[var(--card)] border border-[var(--border)] rounded-lg resize-y min-h-[60px]"
                  rows={3}
                />
                <div className="flex gap-2 mt-2 justify-end">
                  <button
                    onClick={() => { setShowAddMemory(false); setNewMemoryContent(''); }}
                    className="text-xs px-3 py-1 border border-[var(--border)] rounded-lg hover:bg-[var(--hover)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      if (!newMemoryContent.trim()) return;
                      await api.createAgentMemory(agent.id, { content: newMemoryContent, type: newMemoryType });
                      setNewMemoryContent('');
                      setShowAddMemory(false);
                      loadMemory();
                    }}
                    className="text-xs px-3 py-1 bg-[var(--accent)] text-white rounded-lg hover:opacity-90"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            {/* Memory entries */}
            {memories.length === 0 && !showAddMemory && (
              <p className="text-sm text-[var(--muted)] text-center py-4">No memory entries yet. Agent will save knowledge as it works.</p>
            )}
            {memories.map((mem: any) => (
              <div key={mem.id} className="border border-[var(--border)] rounded-lg p-3 group">
                {editingMemory === mem.id ? (
                  /* Edit mode */
                  <div>
                    <div className="flex gap-2 mb-2">
                      <select
                        value={editMemoryType}
                        onChange={(e) => setEditMemoryType(e.target.value)}
                        className="text-xs px-2 py-1 bg-[var(--card)] border border-[var(--border)] rounded"
                      >
                        <option value="KNOWLEDGE">KNOWLEDGE</option>
                        <option value="CONTEXT">CONTEXT</option>
                        <option value="FILE">FILE</option>
                        <option value="CONVERSATION">CONVERSATION</option>
                      </select>
                    </div>
                    <textarea
                      value={editMemoryContent}
                      onChange={(e) => setEditMemoryContent(e.target.value)}
                      className="w-full text-sm p-2 bg-[var(--card)] border border-[var(--border)] rounded-lg resize-y min-h-[60px]"
                      rows={4}
                    />
                    <div className="flex gap-2 mt-2 justify-end">
                      <button
                        onClick={() => setEditingMemory(null)}
                        className="text-xs px-3 py-1 border border-[var(--border)] rounded-lg hover:bg-[var(--hover)]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={async () => {
                          await api.updateAgentMemory(mem.id, { content: editMemoryContent, type: editMemoryType });
                          setEditingMemory(null);
                          loadMemory();
                        }}
                        className="text-xs px-3 py-1 bg-[var(--accent)] text-white rounded-lg hover:opacity-90"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                            mem.type === 'KNOWLEDGE' ? 'bg-blue-500/20 text-blue-400' :
                            mem.type === 'CONTEXT' ? 'bg-yellow-500/20 text-yellow-400' :
                            mem.type === 'FILE' ? 'bg-green-500/20 text-green-400' :
                            'bg-purple-500/20 text-purple-400'
                          }`}>
                            {mem.type}
                          </span>
                          <span className="text-[10px] text-[var(--muted)]">
                            {new Date(mem.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap break-words">{mem.content}</p>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => {
                            setEditingMemory(mem.id);
                            setEditMemoryContent(mem.content);
                            setEditMemoryType(mem.type);
                          }}
                          className="text-[10px] px-2 py-1 border border-[var(--border)] rounded hover:bg-[var(--hover)]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm('Delete this memory entry?')) return;
                            await api.deleteAgentMemory(mem.id);
                            loadMemory();
                          }}
                          className="text-[10px] px-2 py-1 border border-red-500/30 text-red-400 rounded hover:bg-red-500/10"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* Execution History */}
      {executions.length > 0 && (
        <Section title="Execution History" wide>
          <div className="space-y-2">
            {executions.map((ex: any) => (
              <div key={ex.id} className="border border-[var(--border)] rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedExec(expandedExec === ex.id ? null : ex.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--background)] transition-colors"
                >
                  <StatusBadge status={ex.status} />
                  <span className="text-sm flex-1 truncate">
                    {(ex.input as any)?.message || 'No message'}
                  </span>
                  <span className="text-xs text-[var(--muted)]">{ex.triggerType}</span>
                  {ex.tokensUsed > 0 && <span className="text-xs text-[var(--muted)]">{ex.tokensUsed} tok</span>}
                  {ex.costUsd > 0 && <span className="text-xs text-[var(--muted)]">${ex.costUsd.toFixed(4)}</span>}
                  <span className="text-xs text-[var(--muted)]">{(() => { const d = new Date(ex.startedAt || ex.createdAt); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }); })()}</span>
                  <span className="text-xs text-[var(--muted)]">{expandedExec === ex.id ? '▲' : '▼'}</span>
                </button>
                {expandedExec === ex.id && (
                  <div className="px-4 pb-3 border-t border-[var(--border)] bg-[var(--background)]">
                    {ex.output && (
                      <div className="mt-2">
                        <p className="text-xs text-[var(--muted)] mb-1">Output:</p>
                        <pre className="text-sm whitespace-pre-wrap max-h-40 overflow-auto">{(ex.output as any)?.text}</pre>
                      </div>
                    )}
                    {ex.error && (
                      <div className="mt-2 text-sm text-red-400">{ex.error}</div>
                    )}
                    {ex.toolCalls && Array.isArray(ex.toolCalls) && ex.toolCalls.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-[var(--muted)] mb-1">Tool Calls ({ex.toolCalls.length}):</p>
                        <div className="space-y-1">
                          {ex.toolCalls.map((tc: any, i: number) => (
                            <div key={i} className="text-xs bg-[var(--card)] rounded p-2">
                              <span className="font-medium text-[var(--accent)]">{tc.name}</span>
                              {tc.input && <pre className="mt-1 text-[var(--muted)] overflow-auto max-h-24">{JSON.stringify(tc.input, null, 2)}</pre>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Hierarchy */}
      {(agent.parentAgent || (agent.childAgents && agent.childAgents.length > 0)) && (
        <div className="mt-8">
          <Section title="Hierarchy">
            {agent.parentAgent && (
              <div className="mb-2">
                <span className="text-xs text-[var(--muted)]">Reports to:</span>{' '}
                <Link href={`/agents/${agent.parentAgent.id}`} className="text-[var(--accent)] hover:underline text-sm">
                  {agent.parentAgent.name}
                </Link>
              </div>
            )}
            {agent.childAgents?.length > 0 && (
              <div>
                <span className="text-xs text-[var(--muted)]">Manages:</span>
                <div className="flex flex-wrap gap-2 mt-1">
                  {agent.childAgents.map((c: any) => (
                    <Link key={c.id} href={`/agents/${c.id}`} className="px-3 py-1 bg-[var(--card-hover)] rounded-lg text-sm hover:bg-[var(--accent)]/20 transition-colors">
                      {c.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </Section>
        </div>
      )}

      {/* Responsibilities */}
      {agent.responsibilities?.length > 0 && (
        <div className="mt-8">
          <Section title="Responsibilities">
            <div className="space-y-2">
              {agent.responsibilities.map((r: any) => (
                <div key={r.id} className="p-3 bg-[var(--background)] rounded-lg border border-[var(--border)]">
                  <p className="font-medium text-sm">{r.title}</p>
                  {r.description && <p className="text-xs text-[var(--muted)] mt-1">{r.description}</p>}
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* Tool Picker modal */}
      {showToolPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowToolPicker(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[480px] mx-4 max-h-[70vh] overflow-y-auto border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Connect Tool to {agent.name}</h3>
            <div className="space-y-2">
              {allTools.filter((t: any) => !agent.tools?.some((at: any) => at.toolId === t.id)).map((tool: any) => {
                const cfg = tool.config || {};
                const typeIcons: Record<string, string> = { DATABASE: '🗄️', REST_API: '🌐', MCP_SERVER: '🔌', GRAPHQL: '📊', WEBHOOK: '🔗', N8N: '⚡', DIGITALOCEAN: '🌊', SSH: '🖥️', FIRECRAWL: '🔥', CUSTOM: '⚙️' };
                return (
                  <button
                    key={tool.id}
                    onClick={async () => {
                      const perms = tool.type === 'DATABASE'
                        ? { read: true, write: false, execute: true }
                        : { read: true, write: true, execute: true };
                      await api.assignToolToAgent(agent.id, tool.id, perms);
                      setShowToolPicker(false);
                      loadAgent();
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] hover:border-[var(--accent)] transition text-left"
                  >
                    <span className="text-lg">{typeIcons[tool.type] || '⚙️'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{tool.name}</div>
                      <div className="text-xs text-[var(--muted)] truncate">{cfg.description || tool.type}</div>
                    </div>
                    <span className="text-xs text-[var(--accent)]">Connect</span>
                  </button>
                );
              })}
              {allTools.filter((t: any) => !agent.tools?.some((at: any) => at.toolId === t.id)).length === 0 && (
                <p className="text-sm text-[var(--muted)] text-center py-4">All tools are already connected.</p>
              )}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowToolPicker(false)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Skill Picker modal */}
      {showSkillPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSkillPicker(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[480px] mx-4 max-h-[70vh] overflow-y-auto border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Add Skill to {agent.name}</h3>
            <div className="space-y-2">
              {allSkills.filter((s: any) => !agent.skills?.some((as: any) => as.skillId === s.id)).map((skill: any) => {
                const typeIcons: Record<string, string> = { BUILTIN: '📦', PLUGIN: '🔌', CUSTOM: '✨' };
                return (
                  <button
                    key={skill.id}
                    onClick={async () => {
                      await api.assignSkillToAgent(agent.id, skill.id);
                      setShowSkillPicker(false);
                      loadAgent();
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] hover:border-[var(--accent)] transition text-left"
                  >
                    <span className="text-lg">{typeIcons[skill.type] || '📦'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{skill.name}</div>
                      <div className="text-xs text-[var(--muted)] truncate">{skill.description || skill.type}</div>
                    </div>
                    <span className="text-xs text-[var(--accent)]">Add</span>
                  </button>
                );
              })}
              {allSkills.filter((s: any) => !agent.skills?.some((as: any) => as.skillId === s.id)).length === 0 && (
                <p className="text-sm text-[var(--muted)] text-center py-4">All skills are already assigned.</p>
              )}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowSkillPicker(false)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditing(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[520px] mx-4 max-h-[90vh] overflow-y-auto border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Edit Agent</h3>
            <div className="space-y-4">
              <Field label="Name" value={editForm.name} onChange={(v) => setEditForm({ ...editForm, name: v })} />
              <Field label="Avatar" value={editForm.avatar} onChange={(v) => setEditForm({ ...editForm, avatar: v })} placeholder="Emoji" />
              <Field label="Mission" value={editForm.mission} onChange={(v) => setEditForm({ ...editForm, mission: v })} />
              <Field label="Values" value={editForm.values || ''} onChange={(v) => setEditForm({ ...editForm, values: v })} placeholder="efficiency, accuracy, proactivity" />

              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select
                  value={editForm.type}
                  onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
                >
                  {['WORKER', 'MANAGER', 'EXECUTIVE', 'SPECIALIST', 'ASSISTANT'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">LLM Provider</label>
                <select
                  value={editForm.llmProvider}
                  onChange={(e) => setEditForm({ ...editForm, llmProvider: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
                >
                  {['ANTHROPIC', 'OPENAI', 'GOOGLE', 'DEEPSEEK', 'MISTRAL', 'MINIMAX', 'GLM', 'XAI', 'COHERE', 'PERPLEXITY', 'TOGETHER', 'FIREWORKS', 'GROQ', 'MOONSHOT', 'QWEN', 'AI21', 'SAMBANOVA', 'OLLAMA', 'CUSTOM'].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <Field label="LLM Model" value={editForm.llmModel} onChange={(v) => setEditForm({ ...editForm, llmModel: v })} placeholder="e.g. claude-opus-4-6, gpt-4o, gemini-2.0-flash" />

              <div className={`grid gap-3 ${['ANTHROPIC', 'GOOGLE'].includes(editForm.llmProvider) ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <div>
                  <label className="block text-xs font-medium mb-1 text-[var(--muted)]">Temperature</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={editForm.temperature ?? 0.7}
                    onChange={(e) => setEditForm({ ...editForm, temperature: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                  />
                  <p className="text-[10px] text-[var(--muted)] mt-1">Creativity: 0 = precise, 1+ = creative</p>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1 text-[var(--muted)]">Max Tokens</label>
                  <input
                    type="number"
                    step="256"
                    min="256"
                    max="32768"
                    value={editForm.maxTokens ?? 4096}
                    onChange={(e) => setEditForm({ ...editForm, maxTokens: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                  />
                  <p className="text-[10px] text-[var(--muted)] mt-1">Max response length</p>
                </div>
                {['ANTHROPIC', 'GOOGLE'].includes(editForm.llmProvider) && (
                  <div>
                    <label className="block text-xs font-medium mb-1 text-[var(--muted)]">Thinking Budget</label>
                    <input
                      type="number"
                      step="1000"
                      min="0"
                      max="32000"
                      value={editForm.thinkingBudget ?? 4000}
                      onChange={(e) => setEditForm({ ...editForm, thinkingBudget: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                    />
                    <p className="text-[10px] text-[var(--muted)] mt-1">Internal reasoning tokens. 0 = off</p>
                  </div>
                )}
              </div>

              {/* MCP Servers */}
              {(
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium">MCP Servers</label>
                    <button
                      type="button"
                      onClick={() => setEditForm({ ...editForm, mcpServers: [...(editForm.mcpServers || []), { name: '', url: '', authorizationToken: '' }] })}
                      className="text-xs px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--hover)]"
                    >+ Add Server</button>
                  </div>
                  {(editForm.mcpServers || []).length === 0 && (
                    <p className="text-xs text-[var(--muted)]">No MCP servers configured. Add servers like GitLab, AWS, Datadog, Sentry etc.</p>
                  )}
                  {(editForm.mcpServers || []).map((srv: any, idx: number) => (
                    <div key={idx} className="mb-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-[var(--muted)]">Server #{idx + 1}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...editForm.mcpServers];
                            updated.splice(idx, 1);
                            setEditForm({ ...editForm, mcpServers: updated });
                          }}
                          className="text-xs text-red-400 hover:text-red-300"
                        >Remove</button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div>
                          <label className="block text-[10px] text-[var(--muted)] mb-0.5">Name</label>
                          <input
                            value={srv.name || ''}
                            onChange={(e) => {
                              const updated = [...editForm.mcpServers];
                              updated[idx] = { ...updated[idx], name: e.target.value };
                              setEditForm({ ...editForm, mcpServers: updated });
                            }}
                            placeholder="e.g. gitlab"
                            className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-[var(--muted)] mb-0.5">Auth Token</label>
                          <input
                            type="password"
                            value={srv.authorizationToken || ''}
                            onChange={(e) => {
                              const updated = [...editForm.mcpServers];
                              updated[idx] = { ...updated[idx], authorizationToken: e.target.value };
                              setEditForm({ ...editForm, mcpServers: updated });
                            }}
                            placeholder="Optional"
                            className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] text-[var(--muted)] mb-0.5">URL</label>
                        <input
                          value={srv.url || ''}
                          onChange={(e) => {
                            const updated = [...editForm.mcpServers];
                            updated[idx] = { ...updated[idx], url: e.target.value };
                            setEditForm({ ...editForm, mcpServers: updated });
                          }}
                          placeholder="https://mcp-server.example.com/sse"
                          className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm font-mono"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">System Prompt</label>
                <textarea
                  value={editForm.systemPrompt}
                  onChange={(e) => setEditForm({ ...editForm, systemPrompt: e.target.value })}
                  rows={6}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm font-mono resize-y"
                />
              </div>

              {saveError && <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{saveError}</div>}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)]">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-40">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Spawn modal */}
      {showSpawn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSpawn(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[520px] mx-4 max-h-[90vh] overflow-y-auto border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Spawn Child Agent</h3>
            <p className="text-sm text-[var(--muted)] mb-4">Create a new agent under {agent.name}. It will inherit configuration from the parent.</p>
            <div className="space-y-4">
              <Field label="Name" value={spawnForm.name} onChange={(v) => setSpawnForm({ ...spawnForm, name: v })} placeholder="Agent name" />
              <Field label="Slug" value={spawnForm.slug} onChange={(v) => setSpawnForm({ ...spawnForm, slug: v })} placeholder="agent-slug" />
              <Field label="Mission" value={spawnForm.mission} onChange={(v) => setSpawnForm({ ...spawnForm, mission: v })} placeholder="Optional mission" />
              <div>
                <label className="block text-sm font-medium mb-1">LLM Provider</label>
                <select
                  value={spawnForm.llmProvider}
                  onChange={(e) => setSpawnForm({ ...spawnForm, llmProvider: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
                >
                  {['ANTHROPIC', 'OPENAI', 'GOOGLE', 'DEEPSEEK', 'MISTRAL', 'MINIMAX', 'GLM', 'XAI', 'COHERE', 'PERPLEXITY', 'TOGETHER', 'FIREWORKS', 'GROQ', 'MOONSHOT', 'QWEN', 'AI21', 'SAMBANOVA', 'OLLAMA', 'CUSTOM'].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <Field label="LLM Model" value={spawnForm.llmModel} onChange={(v) => setSpawnForm({ ...spawnForm, llmModel: v })} placeholder="e.g. claude-opus-4-6" />
              <div>
                <label className="block text-sm font-medium mb-1">System Prompt</label>
                <textarea
                  value={spawnForm.systemPrompt}
                  onChange={(e) => setSpawnForm({ ...spawnForm, systemPrompt: e.target.value })}
                  rows={4}
                  placeholder="Optional — leave empty to generate from parent"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm font-mono resize-y"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowSpawn(false)} className="px-4 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)]">Cancel</button>
              <button onClick={handleSpawn} disabled={spawning || !spawnForm.name || !spawnForm.slug} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-40">
                {spawning ? 'Creating...' : 'Spawn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archive confirmation */}
      {showArchiveConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowArchiveConfirm(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[400px] mx-4 border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Archive Agent</h3>
            <p className="text-sm text-[var(--muted)] mb-6">Are you sure you want to archive <strong>{agent.name}</strong>? This will deactivate the agent.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowArchiveConfirm(false)} className="px-4 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)]">Cancel</button>
              <button onClick={handleArchive} disabled={archiving} className="px-4 py-2 bg-red-500 text-white rounded-lg hover:opacity-90 disabled:opacity-40">
                {archiving ? 'Archiving...' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delegate modal */}
      {showDelegate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDelegate(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[520px] mx-4 max-h-[90vh] overflow-y-auto border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Delegate Task</h3>
            <p className="text-sm text-[var(--muted)] mb-4">Assign a task to a child agent of {agent.name}.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Delegate to</label>
                <select
                  value={delegateForm.childAgentId}
                  onChange={(e) => setDelegateForm({ ...delegateForm, childAgentId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
                >
                  {agent.childAgents?.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <Field label="Task Title" value={delegateForm.title} onChange={(v) => setDelegateForm({ ...delegateForm, title: v })} placeholder="What needs to be done" />
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={delegateForm.description}
                  onChange={(e) => setDelegateForm({ ...delegateForm, description: e.target.value })}
                  rows={3}
                  placeholder="Optional details"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm resize-y"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Priority</label>
                <select
                  value={delegateForm.priority}
                  onChange={(e) => setDelegateForm({ ...delegateForm, priority: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
                >
                  {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowDelegate(false)} className="px-4 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)]">Cancel</button>
              <button onClick={handleDelegate} disabled={delegating || !delegateForm.title} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-40">
                {delegating ? 'Delegating...' : 'Delegate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Avatar lightbox */}
      {showAvatarFull && agent.avatar && agent.avatar.startsWith('/') && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 cursor-pointer" onClick={() => setShowAvatarFull(false)}>
          <img src={agent.avatar} alt={agent.name} className="max-w-[90vw] max-h-[90vh] rounded-2xl shadow-2xl object-contain" />
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
      />
    </div>
  );
}

function Section({ title, children, wide }: { title: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 ${wide ? 'md:col-span-2' : ''}`}>
      <h3 className="font-semibold mb-3 text-sm text-[var(--muted)] uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[var(--border)] last:border-0">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className="text-sm font-medium">{String(value)}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    COMPLETED: 'bg-emerald-500/20 text-emerald-400',
    RUNNING: 'bg-blue-500/20 text-blue-400',
    FAILED: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-500/20 text-gray-400'}`}>
      {status}
    </span>
  );
}

/* ── Approval Policy Section ─────────────────────────────────── */

const PRESETS = [
  { key: 'FULL_CONTROL', label: 'Full Control', desc: 'Every action requires approval', color: 'border-red-500/50 bg-red-500/5' },
  { key: 'SUPERVISED', label: 'Supervised', desc: 'Reads are free, writes need approval', color: 'border-orange-500/50 bg-orange-500/5' },
  { key: 'GUIDED', label: 'Guided', desc: 'Only deletes, sends & admin need approval', color: 'border-yellow-500/50 bg-yellow-500/5' },
  { key: 'AUTOPILOT', label: 'Autopilot', desc: 'Full autonomy, all actions logged', color: 'border-emerald-500/50 bg-emerald-500/5' },
] as const;

const CATEGORIES = ['READ', 'WRITE', 'DELETE', 'EXECUTE', 'SEND', 'ADMIN'] as const;
const MODES = ['FREE', 'REQUIRES_APPROVAL', 'BLOCKED'] as const;
const modeColors: Record<string, string> = {
  FREE: 'text-emerald-400',
  REQUIRES_APPROVAL: 'text-amber-400',
  BLOCKED: 'text-red-400',
};

function ApprovalPolicySection({ agentId, agentTools }: { agentId: string; agentTools: any[] }) {
  const [policy, setPolicy] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const loadPolicy = useCallback(async () => {
    try {
      const p = await api.getApprovalPolicy(agentId);
      setPolicy(p);
    } catch {
      setPolicy(null);
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => { loadPolicy(); }, [loadPolicy]);

  const applyPreset = async (preset: string) => {
    setSaving(true);
    try {
      const p = await api.applyApprovalPreset(agentId, preset);
      setPolicy(p);
    } catch { /* noop */ }
    setSaving(false);
  };

  const updateCategoryMode = async (category: string, mode: string) => {
    const key = `${category.toLowerCase()}Mode`;
    const update = { ...policy, [key]: mode === '' ? null : mode };
    setSaving(true);
    try {
      const p = await api.setApprovalPolicy(agentId, {
        preset: update.preset || 'SUPERVISED',
        readMode: update.readMode || null,
        writeMode: update.writeMode || null,
        deleteMode: update.deleteMode || null,
        executeMode: update.executeMode || null,
        sendMode: update.sendMode || null,
        adminMode: update.adminMode || null,
        toolOverrides: update.toolOverrides || undefined,
      });
      setPolicy(p);
    } catch { /* noop */ }
    setSaving(false);
  };

  const currentPreset = policy?.preset || 'SUPERVISED';

  return (
    <Section title="Approval Policy" wide>
      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading policy...</p>
      ) : (
        <div className="space-y-4">
          {/* Preset cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => applyPreset(p.key)}
                disabled={saving}
                className={`text-left p-3 rounded-xl border-2 transition ${
                  currentPreset === p.key ? p.color : 'border-[var(--border)] hover:border-[var(--accent)]/30'
                } ${saving ? 'opacity-50' : ''}`}
              >
                <div className="font-medium text-sm">{p.label}</div>
                <div className="text-[10px] text-[var(--muted)] mt-1">{p.desc}</div>
              </button>
            ))}
          </div>

          {/* Category overrides */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-[var(--muted)] hover:text-white transition"
          >
            {expanded ? 'Hide' : 'Show'} per-category overrides
          </button>

          {expanded && (
            <div className="space-y-2">
              {CATEGORIES.map((cat) => {
                const key = `${cat.toLowerCase()}Mode` as string;
                const value = policy?.[key] || '';
                return (
                  <div key={cat} className="flex items-center gap-3 py-1">
                    <span className="text-xs font-mono w-20">{cat}</span>
                    <select
                      value={value}
                      onChange={(e) => updateCategoryMode(cat, e.target.value)}
                      className={`px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-xs ${modeColors[value] || 'text-[var(--muted)]'}`}
                    >
                      <option value="">Inherit from preset</option>
                      {MODES.map((m) => (
                        <option key={m} value={m}>{m.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}

          {/* Info */}
          {!policy && (
            <p className="text-xs text-[var(--muted)]">
              No policy set. Select a preset to configure approval behavior.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

/* ── Values Section (inline-editable) ────────────────────────── */

function ValuesSection({ values, agentId, onUpdated }: { values: string[]; agentId: string; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setInput(values.join(', '));
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const newValues = input.split(',').map((v) => v.trim()).filter(Boolean);
      await api.updateAgent(agentId, { values: newValues });
      setEditing(false);
      onUpdated();
    } catch { /* noop */ }
    setSaving(false);
  };

  const cancel = () => {
    setEditing(false);
    setInput('');
  };

  return (
    <Section title="Values" wide>
      {editing ? (
        <div className="space-y-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') cancel(); }}
            placeholder="efficiency, accuracy, proactivity"
            autoFocus
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
          />
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="px-3 py-1 text-xs bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-40">
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={cancel} className="px-3 py-1 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--hover)]">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          {values.length > 0 ? values.map((v) => (
            <span key={v} className="px-3 py-1 bg-[var(--accent)]/10 text-[var(--accent)] rounded-full text-sm">{v}</span>
          )) : (
            <span className="text-sm text-[var(--muted)]">No values set.</span>
          )}
          <button onClick={startEdit} className="px-2 py-1 text-xs text-[var(--muted)] hover:text-white transition">Edit</button>
        </div>
      )}
    </Section>
  );
}
