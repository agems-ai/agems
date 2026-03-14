'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { X, Download, Cpu, Wrench, Sparkles, Tag, User, ChevronRight } from 'lucide-react';

type Tab = 'agents' | 'skills' | 'tools';

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

const typeIcons: Record<string, string> = {
  AUTONOMOUS: '🤖', ASSISTANT: '💬', META: '🧠', REACTIVE: '⚡',
  BUILTIN: '📦', PLUGIN: '🔌', CUSTOM: '✨',
  DATABASE: '🗄️', REST_API: '🌐', MCP_SERVER: '🔌', GRAPHQL: '📊',
  WEBHOOK: '🔗', N8N: '⚡', DIGITALOCEAN: '🌊', SSH: '🖥️', FIRECRAWL: '🔥',
  WEBSOCKET: '📡', GRPC: '🔧', S3_STORAGE: '📁',
};

const typeLabels: Record<string, string> = {
  AUTONOMOUS: 'Autonomous', ASSISTANT: 'Assistant', META: 'Meta Agent', REACTIVE: 'Reactive',
  BUILTIN: 'Built-in', PLUGIN: 'Plugin', CUSTOM: 'Custom',
  DATABASE: 'Database', REST_API: 'REST API', MCP_SERVER: 'MCP Server', GRAPHQL: 'GraphQL',
  WEBHOOK: 'Webhook', N8N: 'n8n', DIGITALOCEAN: 'DigitalOcean', SSH: 'SSH', FIRECRAWL: 'Firecrawl',
  WEBSOCKET: 'WebSocket', GRPC: 'gRPC', S3_STORAGE: 'S3 Storage',
};

export default function CatalogPage() {
  const [tab, setTab] = useState<Tab>('agents');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Publish modal
  const [showPublish, setShowPublish] = useState(false);
  const [publishTab, setPublishTab] = useState<Tab>('agents');
  const [publishItems, setPublishItems] = useState<any[]>([]);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null);

  const user = api.getUserFromToken();

  const loadCatalog = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { pageSize: '100' };
      if (search) params.search = search;
      const res = tab === 'agents'
        ? await api.getCatalogAgents(params)
        : tab === 'skills'
          ? await api.getCatalogSkills(params)
          : await api.getCatalogTools(params);
      setItems(res.data || []);
    } catch { setItems([]); }
    setLoading(false);
  };

  useEffect(() => { loadCatalog(); }, [tab, search]);

  const openDetail = async (item: any) => {
    setSelectedItem(item);
    setDetailLoading(true);
    try {
      const full = tab === 'agents'
        ? await api.getCatalogAgent(item.id)
        : tab === 'skills'
          ? await api.getCatalogSkill(item.id)
          : await api.getCatalogTool(item.id);
      setSelectedItem(full);
    } catch { /* keep the list item data */ }
    setDetailLoading(false);
  };

  const handleImport = async (id: string) => {
    setImporting(id);
    setMessage(null);
    try {
      if (tab === 'agents') await api.importAgentFromCatalog(id);
      else if (tab === 'skills') await api.importSkillFromCatalog(id);
      else await api.importToolFromCatalog(id);
      setMessage({ type: 'success', text: 'Successfully imported!' });
      loadCatalog();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Import failed' });
    }
    setImporting(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove from catalog?')) return;
    try {
      if (tab === 'agents') await api.deleteCatalogAgent(id);
      else if (tab === 'skills') await api.deleteCatalogSkill(id);
      else await api.deleteCatalogTool(id);
      setSelectedItem(null);
      loadCatalog();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Delete failed' });
    }
  };

  // Load own items for publishing
  const loadPublishItems = async (t: Tab) => {
    setPublishLoading(true);
    try {
      if (t === 'agents') {
        const res = await api.getAgents({ pageSize: '100' });
        setPublishItems(res.data || []);
      } else if (t === 'skills') {
        const res = await api.getSkills();
        setPublishItems(res.data || []);
      } else {
        const res = await api.getTools();
        setPublishItems(res.data || []);
      }
    } catch { setPublishItems([]); }
    setPublishLoading(false);
  };

  const openPublish = (t: Tab) => {
    setPublishTab(t);
    setShowPublish(true);
    loadPublishItems(t);
  };

  const handlePublish = async (item: any) => {
    setPublishing(item.id);
    try {
      if (publishTab === 'agents') {
        const fullAgent = await api.getAgent(item.id);
        const skillSlugs = (fullAgent.skills || []).map((s: any) => s.skill?.slug).filter(Boolean);
        const toolSlugs = (fullAgent.tools || []).map((t: any) => t.tool?.name).filter(Boolean);
        await api.publishAgentToCatalog({
          slug: fullAgent.slug, name: fullAgent.name, avatar: fullAgent.avatar,
          type: fullAgent.type, description: fullAgent.mission || fullAgent.name,
          systemPrompt: fullAgent.systemPrompt, mission: fullAgent.mission,
          llmProvider: fullAgent.llmProvider, llmModel: fullAgent.llmModel,
          llmConfig: fullAgent.llmConfig, runtimeConfig: fullAgent.runtimeConfig,
          values: fullAgent.values, metadata: fullAgent.metadata,
          tags: [], skillSlugs, toolSlugs,
        });
      } else if (publishTab === 'skills') {
        await api.publishSkillToCatalog({
          slug: item.slug, name: item.name, description: item.description,
          content: item.content, version: item.version, type: item.type,
          entryPoint: item.entryPoint, configSchema: item.configSchema, tags: [],
        });
      } else {
        await api.publishToolToCatalog({
          name: item.name, description: (item.config as any)?.description || item.name,
          type: item.type, configTemplate: item.config, authType: item.authType, tags: [],
        });
      }
      setMessage({ type: 'success', text: `Published "${item.name}" to catalog` });
      setShowPublish(false);
      loadCatalog();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Publish failed' });
    }
    setPublishing(null);
  };

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'agents', label: 'Agents', icon: '🤖' },
    { key: 'skills', label: 'Skills', icon: '✨' },
    { key: 'tools', label: 'Tools', icon: '🔧' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Catalog</h1>
          <p className="text-[var(--muted)] text-sm mt-1">
            Browse and import shared agents, skills, and tools
          </p>
        </div>
        <button
          onClick={() => openPublish(tab)}
          className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition text-sm font-medium"
        >
          + Publish to Catalog
        </button>
      </div>

      {message && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="float-right font-bold">×</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-[var(--card)] rounded-lg p-1 border border-[var(--border)] w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSearch(''); }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${tab === t.key ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder={`Search ${tab}...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-md px-4 py-2 rounded-lg bg-[var(--card)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
        />
      </div>

      {/* Items Grid */}
      {loading ? (
        <div className="text-center py-20 text-[var(--muted)]">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-4xl mb-4">{tabs.find(t => t.key === tab)?.icon}</p>
          <p className="text-lg font-medium mb-1">No {tab} in catalog yet</p>
          <p className="text-[var(--muted)] text-sm mb-4">
            Be the first to publish {tab} from your organization
          </p>
          <button
            onClick={() => openPublish(tab)}
            className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 text-sm"
          >
            + Publish {tab.slice(0, -1)}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item: any) => (
            <div
              key={item.id}
              onClick={() => openDetail(item)}
              className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 hover:border-[var(--accent)]/30 transition cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  {tab === 'agents'
                    ? <AgentAvatar avatar={item.avatar} type={item.type} />
                    : <span className="text-xl">{typeIcons[item.type] || '📦'}</span>}
                  <div>
                    <h3 className="font-semibold text-sm">{item.name}</h3>
                    <p className="text-xs text-[var(--muted)]">{item.slug}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">
                    {typeLabels[item.type] || item.type}
                  </span>
                  <ChevronRight size={14} className="text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>

              <p className="text-sm text-[var(--muted)] mb-3 line-clamp-2">
                {item.description || item.mission || ''}
              </p>

              {/* Agent-specific info */}
              {tab === 'agents' && (item.llmProvider || item.llmModel) && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] mb-2">
                  <Cpu size={11} />
                  <span>{item.llmProvider}{item.llmModel ? ` / ${item.llmModel}` : ''}</span>
                </div>
              )}

              {/* Tools/Skills counts for agents */}
              {tab === 'agents' && (item.toolSlugs?.length > 0 || item.skillSlugs?.length > 0) && (
                <div className="flex items-center gap-3 text-xs text-[var(--muted)] mb-2">
                  {item.toolSlugs?.length > 0 && (
                    <span className="flex items-center gap-1"><Wrench size={11} /> {item.toolSlugs.length} tools</span>
                  )}
                  {item.skillSlugs?.length > 0 && (
                    <span className="flex items-center gap-1"><Sparkles size={11} /> {item.skillSlugs.length} skills</span>
                  )}
                </div>
              )}

              {item.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {item.tags.slice(0, 4).map((tag: string) => (
                    <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-[var(--border)] text-[var(--muted)]">
                      {tag}
                    </span>
                  ))}
                  {item.tags.length > 4 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--border)] text-[var(--muted)]">
                      +{item.tags.length - 4}
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-[var(--muted)] pt-2 border-t border-[var(--border)]">
                <span className="flex items-center gap-1"><User size={11} /> {item.authorOrg}</span>
                <span className="flex items-center gap-1"><Download size={11} /> {item.downloads || 0} imports</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedItem(null)}>
          <div
            className="bg-[var(--card)] rounded-xl w-full max-w-[640px] mx-4 max-h-[85vh] overflow-y-auto border border-[var(--border)]"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-[var(--card)] border-b border-[var(--border)] p-5 flex items-start justify-between z-10">
              <div className="flex items-center gap-3">
                {tab === 'agents'
                  ? <AgentAvatar avatar={selectedItem.avatar} type={selectedItem.type} size="lg" />
                  : <span className="text-3xl">{typeIcons[selectedItem.type] || '📦'}</span>}
                <div>
                  <h2 className="text-lg font-bold">{selectedItem.name}</h2>
                  <p className="text-sm text-[var(--muted)]">{selectedItem.slug}</p>
                </div>
              </div>
              <button onClick={() => setSelectedItem(null)} className="p-1 rounded-lg hover:bg-[var(--border)]/50">
                <X size={18} />
              </button>
            </div>

            {detailLoading ? (
              <div className="p-8 text-center text-[var(--muted)]">Loading details...</div>
            ) : (
              <div className="p-5 space-y-5">
                {/* Type & Meta */}
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium">
                    {typeLabels[selectedItem.type] || selectedItem.type}
                  </span>
                  {tab === 'agents' && selectedItem.llmProvider && (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 font-medium flex items-center gap-1">
                      <Cpu size={11} /> {selectedItem.llmProvider} / {selectedItem.llmModel || '—'}
                    </span>
                  )}
                  {tab === 'tools' && selectedItem.authType && selectedItem.authType !== 'NONE' && (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-yellow-500/10 text-yellow-400 font-medium">
                      Auth: {selectedItem.authType}
                    </span>
                  )}
                </div>

                {/* Description */}
                {(selectedItem.description || selectedItem.mission) && (
                  <div>
                    <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">Description</h4>
                    <p className="text-sm leading-relaxed">{selectedItem.description || selectedItem.mission}</p>
                  </div>
                )}

                {/* System Prompt (agents only) */}
                {tab === 'agents' && selectedItem.systemPrompt && (
                  <div>
                    <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">System Prompt</h4>
                    <pre className="text-xs bg-[var(--background)] rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto border border-[var(--border)] leading-relaxed">
                      {selectedItem.systemPrompt}
                    </pre>
                  </div>
                )}

                {/* Tools & Skills (agents only) */}
                {tab === 'agents' && (selectedItem.toolSlugs?.length > 0 || selectedItem.skillSlugs?.length > 0) && (
                  <div className="grid grid-cols-2 gap-4">
                    {selectedItem.toolSlugs?.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <Wrench size={11} /> Tools ({selectedItem.toolSlugs.length})
                        </h4>
                        <div className="space-y-1">
                          {selectedItem.toolSlugs.map((slug: string) => (
                            <div key={slug} className="text-xs px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)]">
                              {slug}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedItem.skillSlugs?.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <Sparkles size={11} /> Skills ({selectedItem.skillSlugs.length})
                        </h4>
                        <div className="space-y-1">
                          {selectedItem.skillSlugs.map((slug: string) => (
                            <div key={slug} className="text-xs px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)]">
                              {slug}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Config Template (tools only) */}
                {tab === 'tools' && selectedItem.configTemplate && Object.keys(selectedItem.configTemplate).length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">Configuration</h4>
                    <pre className="text-xs bg-[var(--background)] rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto border border-[var(--border)] leading-relaxed">
                      {JSON.stringify(selectedItem.configTemplate, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Content (skills only) */}
                {tab === 'skills' && selectedItem.content && (
                  <div>
                    <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">Content</h4>
                    <pre className="text-xs bg-[var(--background)] rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto border border-[var(--border)] leading-relaxed">
                      {selectedItem.content}
                    </pre>
                  </div>
                )}

                {/* Tags */}
                {selectedItem.tags?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <Tag size={11} /> Tags
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedItem.tags.map((tag: string) => (
                        <span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-[var(--border)] text-[var(--muted)]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Author & Stats */}
                <div className="flex items-center justify-between text-sm text-[var(--muted)] pt-3 border-t border-[var(--border)]">
                  <span className="flex items-center gap-1.5"><User size={13} /> {selectedItem.authorOrg}</span>
                  <span className="flex items-center gap-1.5"><Download size={13} /> {selectedItem.downloads || 0} imports</span>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => handleImport(selectedItem.id)}
                    disabled={importing === selectedItem.id}
                    className="flex-1 px-4 py-2.5 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
                  >
                    {importing === selectedItem.id ? 'Importing...' : 'Import to My Workspace'}
                  </button>
                  {user?.role === 'ADMIN' && (
                    <button
                      onClick={() => handleDelete(selectedItem.id)}
                      className="px-4 py-2.5 text-red-500 border border-red-500/20 rounded-lg text-sm hover:bg-red-500/10 transition"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Publish Modal */}
      {showPublish && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowPublish(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[560px] mx-4 max-h-[70vh] overflow-y-auto border border-[var(--border)]" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Publish to Catalog</h3>
            <p className="text-sm text-[var(--muted)] mb-4">
              Select a {publishTab.slice(0, -1)} from your organization to share with the community
            </p>

            <div className="flex gap-1 mb-4 bg-[var(--background)] rounded-lg p-1 w-fit">
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => { setPublishTab(t.key); loadPublishItems(t.key); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${publishTab === t.key ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)]'}`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {publishLoading ? (
              <div className="text-center py-10 text-[var(--muted)]">Loading...</div>
            ) : publishItems.length === 0 ? (
              <div className="text-center py-10 text-[var(--muted)]">
                No {publishTab} in your organization
              </div>
            ) : (
              <div className="space-y-2">
                {publishItems.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] hover:border-[var(--accent)]/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex-shrink-0">
                        {publishTab === 'agents'
                          ? <AgentAvatar avatar={item.avatar} type={item.type} size="sm" />
                          : <span className="text-lg">{typeIcons[item.type] || '📦'}</span>}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-xs text-[var(--muted)]">{item.type}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handlePublish(item)}
                      disabled={publishing === item.id}
                      className="px-3 py-1.5 bg-[var(--accent)] text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex-shrink-0"
                    >
                      {publishing === item.id ? 'Publishing...' : 'Publish'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowPublish(false)}
              className="mt-4 w-full px-4 py-2 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--border)]/50 transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
