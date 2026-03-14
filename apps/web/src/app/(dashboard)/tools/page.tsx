'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

const toolTypes = ['REST_API', 'GRAPHQL', 'DATABASE', 'MCP_SERVER', 'WEBHOOK', 'N8N', 'DIGITALOCEAN', 'SSH', 'FIRECRAWL', 'CUSTOM'];
const authTypes = ['NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC', 'OAUTH2', 'CUSTOM'];
const typeIcons: Record<string, string> = { DATABASE: '🗄️', REST_API: '🌐', MCP_SERVER: '🔌', GRAPHQL: '📊', WEBHOOK: '🔗', N8N: '⚡', DIGITALOCEAN: '🌊', SSH: '🖥️', FIRECRAWL: '🔥', CUSTOM: '⚙️' };

const emptyForm = { name: '', type: 'REST_API', description: '', config: '{}', authType: 'NONE', authConfig: '{}' };

export default function ToolsPage() {
  const [tools, setTools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTool, setEditingTool] = useState<any>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; ms?: number }>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogImporting, setCatalogImporting] = useState<string | null>(null);

  const loadTools = () => {
    api.getTools().then((r: any) => setTools(r.data || [])).finally(() => setLoading(false));
  };

  useEffect(() => { loadTools(); }, []);

  const openCatalog = async () => {
    setShowCatalog(true);
    setCatalogLoading(true);
    try {
      const res = await api.getCatalogTools({ pageSize: '100' });
      setCatalogItems(res.data || []);
    } catch { setCatalogItems([]); }
    setCatalogLoading(false);
  };

  const handleCatalogImport = async (id: string) => {
    setCatalogImporting(id);
    try {
      await api.importToolFromCatalog(id);
      alert('Tool imported successfully!');
      loadTools();
    } catch (e: any) {
      alert(e.message || 'Import failed');
    }
    setCatalogImporting(null);
  };

  const openCreate = () => {
    setEditingTool(null);
    setForm({ ...emptyForm });
    setError('');
    setShowModal(true);
  };

  const openEdit = (tool: any) => {
    setEditingTool(tool);
    const cfg = tool.config || {};
    setForm({
      name: tool.name || '',
      type: tool.type || 'REST_API',
      description: cfg.description || '',
      config: JSON.stringify(tool.config || {}, null, 2),
      authType: tool.authType || 'NONE',
      authConfig: JSON.stringify(tool.authConfig || {}, null, 2),
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    let config: any, authConfig: any;
    try { config = JSON.parse(form.config || '{}'); } catch { setError('Invalid config JSON'); return; }
    try { authConfig = JSON.parse(form.authConfig || '{}'); } catch { setError('Invalid auth config JSON'); return; }

    setSaving(true);
    setError('');
    try {
      const payload: any = {
        name: form.name,
        type: form.type,
        config,
        authType: form.authType !== 'NONE' ? form.authType : null,
        authConfig: form.authType !== 'NONE' ? authConfig : null,
      };

      if (editingTool) {
        const updated = await api.updateTool(editingTool.id, payload);
        setTools(tools.map((t) => (t.id === editingTool.id ? { ...t, ...(updated as Record<string, any>) } : t)));
      } else {
        const created = await api.createTool(payload);
        setTools([created, ...tools]);
      }
      setShowModal(false);
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (toolId: string) => {
    try {
      const start = Date.now();
      await api.testTool(toolId);
      setTestResults((prev) => ({ ...prev, [toolId]: { ok: true, ms: Date.now() - start } }));
    } catch {
      setTestResults((prev) => ({ ...prev, [toolId]: { ok: false } }));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteTool(id);
      setTools(tools.filter((t) => t.id !== id));
      setDeleteConfirm(null);
    } catch (e: any) {
      alert(e.message || 'Failed to delete');
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-1">Tools</h1>
          <p className="text-[var(--muted)] text-sm">Manage REST APIs, databases, MCP servers, and integrations</p>
        </div>
        <div className="flex gap-2">
          <button onClick={async () => {
            try {
              const data = await api.exportTools();
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `agems-tools-${new Date().toISOString().slice(0, 10)}.json`;
              a.click(); URL.revokeObjectURL(url);
            } catch (e: any) { alert(e.message); }
          }} className="px-3 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--hover)] text-sm">
            Export
          </button>
          <label className="px-3 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--hover)] text-sm cursor-pointer">
            Import
            <input type="file" accept=".json" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0]; if (!file) return;
              try {
                const text = await file.text();
                const data = JSON.parse(text);
                const res = await api.importTools(data);
                alert(`Created: ${res.created}, Skipped: ${res.skipped}${res.errors?.length ? ', Errors: ' + res.errors.join('; ') : ''}`);
                loadTools();
              } catch (err: any) { alert(err.message); }
              e.target.value = '';
            }} />
          </label>
          <button onClick={openCatalog} className="px-3 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--hover)] text-sm">
            Catalog
          </button>
          <button onClick={openCreate} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 text-sm">
            + New Tool
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--muted)]">Loading...</p>
      ) : tools.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-4xl mb-4">🔌</p>
          <p className="text-lg font-medium mb-2">No tools yet</p>
          <p className="text-[var(--muted)] mb-4">Add REST APIs, databases, MCP servers</p>
          <button onClick={openCreate} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg">+ Add Tool</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.map((tool) => {
            const cfg = tool.config || {};
            const authCfg = tool.authConfig || {};
            const needsCreds = tool.authType && tool.authType !== 'NONE';
            const hasEmptyCreds = needsCreds && (!authCfg || Object.keys(authCfg).length === 0 || Object.values(authCfg).every((v: any) => !v));
            return (
              <div key={tool.id} className={`bg-[var(--card)] border rounded-xl p-5 transition ${hasEmptyCreds ? 'border-red-500/60 hover:border-red-400' : 'border-[var(--border)] hover:border-[var(--accent)]/30'}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">
                      <span className="mr-2">{typeIcons[tool.type] || '⚙️'}</span>
                      {tool.name}
                    </h3>
                    <div className="flex gap-2 mt-1.5 flex-wrap">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--hover)] text-[var(--muted)]">{tool.type}</span>
                      {tool.authType && tool.authType !== 'NONE' && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--hover)] text-[var(--muted)]">{tool.authType}</span>
                      )}
                      {hasEmptyCreds && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">No credentials</span>
                      )}
                    </div>
                  </div>
                  <div className={`w-3 h-3 rounded-full shrink-0 mt-1 ${
                    testResults[tool.id]?.ok === true ? 'bg-green-500' :
                    testResults[tool.id]?.ok === false ? 'bg-red-500' : 'bg-gray-500/40'
                  }`} />
                </div>
                {cfg.description && <p className="text-sm text-[var(--muted)] mb-3 line-clamp-2">{cfg.description}</p>}
                {cfg.url && <p className="text-xs font-mono text-[var(--muted)] mb-2 truncate">{cfg.url}</p>}
                {cfg.host && <p className="text-xs font-mono text-[var(--muted)] mb-2">{cfg.host}:{cfg.port || 3306}/{cfg.database}</p>}
                {tool._count?.agents > 0 && (
                  <p className="text-xs text-[var(--accent)] mb-2">{tool._count.agents} agent(s)</p>
                )}
                {testResults[tool.id]?.ms && (
                  <p className="text-xs text-green-500 mb-2">{testResults[tool.id].ms}ms</p>
                )}
                <div className="flex gap-2 mt-3 pt-3 border-t border-[var(--border)]">
                  <button onClick={() => handleTest(tool.id)}
                    className="text-xs px-3 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--hover)]">
                    Test
                  </button>
                  <button onClick={() => openEdit(tool)}
                    className="text-xs px-3 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--hover)]">
                    Edit
                  </button>
                  {deleteConfirm === tool.id ? (
                    <div className="flex gap-1 ml-auto">
                      <button onClick={() => handleDelete(tool.id)}
                        className="text-xs px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600">Confirm</button>
                      <button onClick={() => setDeleteConfirm(null)}
                        className="text-xs px-3 py-1.5 rounded border border-[var(--border)]">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteConfirm(tool.id)}
                      className="text-xs px-3 py-1.5 rounded border border-red-300/30 text-red-400 hover:bg-red-500/10 ml-auto">
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Catalog modal */}
      {showCatalog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCatalog(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[600px] mx-4 max-h-[75vh] overflow-y-auto border border-[var(--border)]" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Add from Catalog</h3>
            <p className="text-sm text-[var(--muted)] mb-4">Import tools shared by the community</p>

            {catalogLoading ? (
              <div className="text-center py-10 text-[var(--muted)]">Loading...</div>
            ) : catalogItems.length === 0 ? (
              <div className="text-center py-10 text-[var(--muted)]">No tools in catalog yet</div>
            ) : (
              <div className="space-y-2">
                {catalogItems.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] hover:border-[var(--accent)]/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-lg flex-shrink-0">{typeIcons[item.type] || '⚙️'}</span>
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

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[520px] mx-4 max-h-[85vh] overflow-y-auto border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">{editingTool ? 'Edit Tool' : 'New Tool'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="My API Tool"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  {toolTypes.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Config (JSON)</label>
                <textarea value={form.config} onChange={(e) => setForm({ ...form, config: e.target.value })}
                  rows={5} placeholder='{"url": "https://api.example.com", "description": "..."}'
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-mono text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Auth Type</label>
                <select value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  {authTypes.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              {form.authType !== 'NONE' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Auth Config (JSON)</label>
                  <textarea value={form.authConfig} onChange={(e) => setForm({ ...form, authConfig: e.target.value })}
                    rows={3} placeholder='{"apiKey": "...", "token": "..."}'
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-mono text-sm" />
                </div>
              )}
              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
                {saving ? 'Saving...' : editingTool ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
