'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { MessageSquare, Archive, Upload, Download, Store, X, Cpu, Wrench, Sparkles, Tag, User, ChevronRight } from 'lucide-react';

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/20 text-emerald-400',
  DRAFT: 'bg-gray-500/20 text-gray-400',
  PAUSED: 'bg-yellow-500/20 text-yellow-400',
  ERROR: 'bg-red-500/20 text-red-400',
  ARCHIVED: 'bg-gray-500/20 text-gray-500',
};

const typeIcons: Record<string, string> = {
  AUTONOMOUS: '🤖',
  ASSISTANT: '🧑‍💻',
  META: '👑',
  REACTIVE: '⚡',
};

const typeLabels: Record<string, string> = {
  AUTONOMOUS: 'Autonomous', ASSISTANT: 'Assistant', META: 'Meta Agent', REACTIVE: 'Reactive',
};

function AgentAvatar({ avatar, type, size = 'md' }: { avatar?: string; type?: string; size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'lg' ? 'w-12 h-12' : size === 'md' ? 'w-8 h-8' : 'w-6 h-6';
  const textSize = size === 'lg' ? 'text-3xl' : size === 'md' ? 'text-xl' : 'text-base';
  if (avatar && avatar.startsWith('/')) {
    return <img src={avatar} alt="" className={`${dims} rounded-full object-cover`} />;
  }
  if (avatar && !avatar.startsWith('/')) return <span className={textSize}>{avatar}</span>;
  const icons: Record<string, string> = { AUTONOMOUS: '🤖', ASSISTANT: '💬', META: '🧠', REACTIVE: '⚡' };
  return <span className={textSize}>{icons[type || ''] || '🤖'}</span>;
}

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogImporting, setCatalogImporting] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadAgents = () => {
    api.getAgents({ pageSize: '100' }).then((res) => {
      setAgents(res.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { loadAgents(); }, []);

  const handleExport = async () => {
    try {
      const data = await api.exportAgents();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agems-agents-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message || 'Export failed');
    }
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setImporting(true);
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const result = await api.importAgents(data);
        const msg = [`Imported: ${result.created} agent(s)`];
        if (result.skipped) msg.push(`Skipped (duplicate): ${result.skipped}`);
        if (result.errors?.length) msg.push(`Errors: ${result.errors.join('; ')}`);
        alert(msg.join('\n'));
        loadAgents();
      } catch (e: any) {
        alert(e.message || 'Import failed');
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  const openCatalog = async () => {
    setShowCatalog(true);
    setCatalogSearch('');
    loadCatalogItems('');
  };

  const loadCatalogItems = async (search: string) => {
    setCatalogLoading(true);
    try {
      const params: Record<string, string> = { pageSize: '100' };
      if (search) params.search = search;
      const res = await api.getCatalogAgents(params);
      setCatalogItems(res.data || []);
    } catch { setCatalogItems([]); }
    setCatalogLoading(false);
  };

  const openAgentDetail = async (item: any) => {
    setSelectedAgent(item);
    setDetailLoading(true);
    try {
      const full = await api.getCatalogAgent(item.id);
      setSelectedAgent(full);
    } catch { /* keep list data */ }
    setDetailLoading(false);
  };

  const handleCatalogImport = async (id: string) => {
    setCatalogImporting(id);
    try {
      await api.importAgentFromCatalog(id);
      alert('Agent imported successfully!');
      loadAgents();
    } catch (e: any) {
      alert(e.message || 'Import failed');
    }
    setCatalogImporting(null);
  };

  // Debounced search
  useEffect(() => {
    if (!showCatalog) return;
    const timer = setTimeout(() => loadCatalogItems(catalogSearch), 300);
    return () => clearTimeout(timer);
  }, [catalogSearch, showCatalog]);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 md:mb-8 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Agent Registry</h1>
          <p className="text-[var(--muted)] mt-1 text-sm">Manage your AI agents</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleImport} disabled={importing}
            className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--hover)] text-sm disabled:opacity-50">
            <Upload size={14} /> {importing ? 'Importing...' : 'Import'}
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--hover)] text-sm">
            <Download size={14} /> Export
          </button>
          <button onClick={openCatalog}
            className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--hover)] text-sm">
            <Store size={14} /> Catalog
          </button>
          <Link
            href="/agents/new"
            className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg font-medium transition-colors text-sm"
          >
            + New Agent
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-[var(--muted)] py-20">Loading agents...</div>
      ) : agents.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-4xl mb-4">🤖</p>
          <p className="text-lg font-medium mb-2">No agents yet</p>
          <p className="text-[var(--muted)] mb-4">Create your first AI agent to get started</p>
          <div className="flex gap-2 justify-center">
            <Link
              href="/agents/new"
              className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg font-medium transition-colors inline-block"
            >
              Create Agent
            </Link>
            <button onClick={openCatalog}
              className="px-4 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--hover)] font-medium transition-colors inline-block">
              Browse Catalog
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <Link
              key={agent.id}
              href={`/agents/${agent.id}`}
              className="block p-5 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] rounded-xl transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  {agent.avatar && agent.avatar.startsWith('/') ? (
                    <img src={agent.avatar} alt={agent.name} className="w-8 h-8 rounded-full object-cover object-top" />
                  ) : (
                    <span className="text-2xl">{agent.avatar || typeIcons[agent.type] || '🤖'}</span>
                  )}
                  <div>
                    <h3 className="font-semibold">{agent.name}</h3>
                    <p className="text-xs text-[var(--muted)]">{agent.positions?.[0]?.title || agent.slug}</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[agent.status]}`}>
                  {agent.status}
                </span>
              </div>
              <p className="text-sm text-[var(--muted)] line-clamp-2 mb-3">
                {agent.mission || agent.systemPrompt?.substring(0, 100)}
              </p>
              <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
                <span className="px-2 py-0.5 bg-[var(--accent)]/10 rounded-full">{agent.llmProvider}</span>
                <span>{agent.llmModel}</span>
                {agent._count && (
                  <span className="ml-auto">{agent._count.tools} tools</span>
                )}
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/comms?direct=AGENT:${agent.id}`); }}
                  className="p-1 rounded hover:bg-[var(--accent)]/20 text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
                  title="Open Chat"
                >
                  <MessageSquare size={14} strokeWidth={1.5} />
                </button>
                {agent.status === 'ARCHIVED' ? (
                  <button
                    onClick={async (e) => {
                      e.preventDefault(); e.stopPropagation();
                      await api.unarchiveAgent(agent.id);
                      loadAgents();
                    }}
                    className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 transition-colors"
                    title="Restore"
                  >
                    Restore
                  </button>
                ) : (
                  <button
                    onClick={async (e) => {
                      e.preventDefault(); e.stopPropagation();
                      if (confirm(`Archive ${agent.name}?`)) {
                        await api.archiveAgent(agent.id);
                        loadAgents();
                      }
                    }}
                    className="p-1 rounded hover:bg-red-500/10 text-[var(--muted)] hover:text-red-400 transition-colors"
                    title="Archive"
                  >
                    <Archive size={14} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Catalog Modal - List View */}
      {showCatalog && !selectedAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCatalog(false)}>
          <div className="bg-[var(--card)] rounded-xl w-full max-w-[720px] mx-4 max-h-[80vh] flex flex-col border border-[var(--border)]" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="p-5 border-b border-[var(--border)] flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-lg font-semibold">Add from Catalog</h3>
                  <p className="text-sm text-[var(--muted)]">Browse and import community agents</p>
                </div>
                <button onClick={() => setShowCatalog(false)} className="p-1 rounded-lg hover:bg-[var(--border)]/50">
                  <X size={18} />
                </button>
              </div>
              <input
                type="text"
                placeholder="Search agents..."
                value={catalogSearch}
                onChange={e => setCatalogSearch(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {/* List */}
            <div className="overflow-y-auto flex-1 p-3">
              {catalogLoading ? (
                <div className="text-center py-10 text-[var(--muted)]">Loading...</div>
              ) : catalogItems.length === 0 ? (
                <div className="text-center py-10 text-[var(--muted)]">No agents found</div>
              ) : (
                <div className="space-y-2">
                  {catalogItems.map((item: any) => (
                    <div
                      key={item.id}
                      onClick={() => openAgentDetail(item)}
                      className="p-4 rounded-lg border border-[var(--border)] hover:border-[var(--accent)]/30 cursor-pointer transition group"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex-shrink-0 mt-0.5">
                          <AgentAvatar avatar={item.avatar} type={item.type} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-sm font-semibold truncate">{item.name}</h4>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] flex-shrink-0">
                              {typeLabels[item.type] || item.type}
                            </span>
                            <ChevronRight size={14} className="text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity ml-auto flex-shrink-0" />
                          </div>
                          <p className="text-xs text-[var(--muted)] line-clamp-2 mb-2">
                            {item.description || item.mission || ''}
                          </p>
                          <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
                            {(item.llmProvider || item.llmModel) && (
                              <span className="flex items-center gap-1"><Cpu size={10} /> {item.llmProvider}{item.llmModel ? ` / ${item.llmModel}` : ''}</span>
                            )}
                            {item.toolSlugs?.length > 0 && (
                              <span className="flex items-center gap-1"><Wrench size={10} /> {item.toolSlugs.length} tools</span>
                            )}
                            {item.skillSlugs?.length > 0 && (
                              <span className="flex items-center gap-1"><Sparkles size={10} /> {item.skillSlugs.length} skills</span>
                            )}
                            <span className="ml-auto flex items-center gap-1">
                              <User size={10} /> {item.authorOrg}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCatalogImport(item.id); }}
                          disabled={catalogImporting === item.id}
                          className="px-3 py-1.5 bg-[var(--accent)] text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex-shrink-0 self-center"
                        >
                          {catalogImporting === item.id ? '...' : 'Import'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Catalog Modal - Detail View */}
      {selectedAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setSelectedAgent(null); if (!showCatalog) setShowCatalog(false); }}>
          <div
            className="bg-[var(--card)] rounded-xl w-full max-w-[640px] mx-4 max-h-[85vh] overflow-y-auto border border-[var(--border)]"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-[var(--card)] border-b border-[var(--border)] p-5 flex items-start justify-between z-10">
              <div className="flex items-center gap-3">
                <AgentAvatar avatar={selectedAgent.avatar} type={selectedAgent.type} size="lg" />
                <div>
                  <h2 className="text-lg font-bold">{selectedAgent.name}</h2>
                  <p className="text-sm text-[var(--muted)]">{selectedAgent.slug}</p>
                </div>
              </div>
              <button onClick={() => setSelectedAgent(null)} className="p-1 rounded-lg hover:bg-[var(--border)]/50">
                <X size={18} />
              </button>
            </div>

            {detailLoading ? (
              <div className="p-8 text-center text-[var(--muted)]">Loading details...</div>
            ) : (
              <div className="p-5 space-y-5">
                {/* Type & Model */}
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium">
                    {typeLabels[selectedAgent.type] || selectedAgent.type}
                  </span>
                  {selectedAgent.llmProvider && (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 font-medium flex items-center gap-1">
                      <Cpu size={11} /> {selectedAgent.llmProvider} / {selectedAgent.llmModel || '—'}
                    </span>
                  )}
                </div>

                {/* Description */}
                {(selectedAgent.description || selectedAgent.mission) && (
                  <div>
                    <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">Description</h4>
                    <p className="text-sm leading-relaxed">{selectedAgent.description || selectedAgent.mission}</p>
                  </div>
                )}

                {/* System Prompt */}
                {selectedAgent.systemPrompt && (
                  <div>
                    <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">System Prompt</h4>
                    <pre className="text-xs bg-[var(--background)] rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto border border-[var(--border)] leading-relaxed">
                      {selectedAgent.systemPrompt}
                    </pre>
                  </div>
                )}

                {/* Tools & Skills */}
                {(selectedAgent.toolSlugs?.length > 0 || selectedAgent.skillSlugs?.length > 0) && (
                  <div className="grid grid-cols-2 gap-4">
                    {selectedAgent.toolSlugs?.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <Wrench size={11} /> Tools ({selectedAgent.toolSlugs.length})
                        </h4>
                        <div className="space-y-1">
                          {selectedAgent.toolSlugs.map((slug: string) => (
                            <div key={slug} className="text-xs px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)]">
                              {slug}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedAgent.skillSlugs?.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <Sparkles size={11} /> Skills ({selectedAgent.skillSlugs.length})
                        </h4>
                        <div className="space-y-1">
                          {selectedAgent.skillSlugs.map((slug: string) => (
                            <div key={slug} className="text-xs px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)]">
                              {slug}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Tags */}
                {selectedAgent.tags?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <Tag size={11} /> Tags
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedAgent.tags.map((tag: string) => (
                        <span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-[var(--border)] text-[var(--muted)]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Author & Stats */}
                <div className="flex items-center justify-between text-sm text-[var(--muted)] pt-3 border-t border-[var(--border)]">
                  <span className="flex items-center gap-1.5"><User size={13} /> {selectedAgent.authorOrg}</span>
                  <span className="flex items-center gap-1.5"><Download size={13} /> {selectedAgent.downloads || 0} imports</span>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setSelectedAgent(null)}
                    className="px-4 py-2.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--border)]/50 transition"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => handleCatalogImport(selectedAgent.id)}
                    disabled={catalogImporting === selectedAgent.id}
                    className="flex-1 px-4 py-2.5 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
                  >
                    {catalogImporting === selectedAgent.id ? 'Importing...' : 'Import to My Workspace'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
