'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { MessageSquare, Archive, Upload, Download, Store } from 'lucide-react';

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

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogImporting, setCatalogImporting] = useState<string | null>(null);

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
    setCatalogLoading(true);
    try {
      const res = await api.getCatalogAgents({ pageSize: '100' });
      setCatalogItems(res.data || []);
    } catch { setCatalogItems([]); }
    setCatalogLoading(false);
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

      {/* Catalog Modal */}
      {showCatalog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCatalog(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[600px] mx-4 max-h-[75vh] overflow-y-auto border border-[var(--border)]" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Add from Catalog</h3>
            <p className="text-sm text-[var(--muted)] mb-4">Import agents shared by the community</p>

            {catalogLoading ? (
              <div className="text-center py-10 text-[var(--muted)]">Loading...</div>
            ) : catalogItems.length === 0 ? (
              <div className="text-center py-10 text-[var(--muted)]">No agents in catalog yet</div>
            ) : (
              <div className="space-y-2">
                {catalogItems.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] hover:border-[var(--accent)]/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex-shrink-0">
                        {item.avatar && item.avatar.startsWith('/') ? (
                          <img src={item.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
                        ) : (
                          <span className="text-lg">{item.avatar || typeIcons[item.type] || '🤖'}</span>
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-xs text-[var(--muted)]">{item.type} | by {item.authorOrg}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleCatalogImport(item.id)}
                      disabled={catalogImporting === item.id}
                      className="px-3 py-1.5 bg-[var(--accent)] text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex-shrink-0"
                    >
                      {catalogImporting === item.id ? 'Importing...' : 'Import'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button onClick={() => setShowCatalog(false)}
              className="mt-4 w-full px-4 py-2 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--border)]/50 transition">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
