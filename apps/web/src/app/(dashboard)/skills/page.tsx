'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { Save, Plus, Trash2, Pencil, X, Upload, Download, Store } from 'lucide-react';

const skillTypes = ['BUILTIN', 'PLUGIN', 'CUSTOM'];

const typeBadge: Record<string, string> = {
  BUILTIN: 'bg-blue-500/15 text-blue-400',
  PLUGIN: 'bg-purple-500/15 text-purple-400',
  CUSTOM: 'bg-emerald-500/15 text-emerald-400',
};

const typeIcon: Record<string, string> = {
  BUILTIN: '🔧',
  PLUGIN: '🔌',
  CUSTOM: '🧠',
};

export default function SkillsPage() {
  const [skills, setSkills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', slug: '', description: '', content: '', version: '1.0.0', type: 'CUSTOM', entryPoint: '' });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', slug: '', description: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogImporting, setCatalogImporting] = useState<string | null>(null);

  const handleExport = async () => {
    try {
      const data = await api.exportSkills();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agems-skills-${new Date().toISOString().slice(0, 10)}.json`;
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
        const result = await api.importSkills(data);
        const msg = [`Imported: ${result.created} skill(s)`];
        if (result.skipped) msg.push(`Skipped (duplicate): ${result.skipped}`);
        if (result.errors?.length) msg.push(`Errors: ${result.errors.join('; ')}`);
        alert(msg.join('\n'));
        const r = await api.getSkills();
        setSkills(r.data || r || []);
      } catch (e: any) {
        alert(e.message || 'Import failed — invalid JSON');
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
      const res = await api.getCatalogSkills({ pageSize: '100' });
      setCatalogItems(res.data || []);
    } catch { setCatalogItems([]); }
    setCatalogLoading(false);
  };

  const handleCatalogImport = async (id: string) => {
    setCatalogImporting(id);
    try {
      await api.importSkillFromCatalog(id);
      alert('Skill imported successfully!');
      const r = await api.getSkills();
      setSkills(r.data || r || []);
    } catch (e: any) {
      alert(e.message || 'Import failed');
    }
    setCatalogImporting(null);
  };

  useEffect(() => {
    api.getSkills().then((r: any) => {
      setSkills(r.data || r || []);
    }).finally(() => setLoading(false));
  }, []);

  const openEditor = useCallback((skill: any) => {
    setEditing(skill);
    setForm({
      name: skill.name || '',
      slug: skill.slug || '',
      description: skill.description || '',
      content: skill.content || '',
      version: skill.version || '1.0.0',
      type: skill.type || 'CUSTOM',
      entryPoint: skill.entryPoint || '',
    });
    setDirty(false);
  }, []);

  const switchSkill = useCallback((skill: any) => {
    if (dirty && !confirm('You have unsaved changes. Switch anyway?')) return;
    openEditor(skill);
  }, [dirty, openEditor]);

  const closeEditor = () => {
    if (dirty && !confirm('You have unsaved changes. Close anyway?')) return;
    setEditing(null);
    setDirty(false);
  };

  const updateForm = (updates: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...updates }));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!editing || !form.name.trim()) return;
    setSaving(true);
    try {
      const slug = form.slug.trim() || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const updated = await api.updateSkill(editing.id, { ...form, slug });
      const merged = { ...editing, ...(updated as Record<string, any>) };
      setSkills(skills.map((s) => (s.id === editing.id ? merged : s)));
      setEditing(merged);
      setDirty(false);
    } catch (e: any) {
      alert(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    const slug = createForm.slug.trim() || createForm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    try {
      const created = await api.createSkill({
        name: createForm.name,
        slug,
        description: createForm.description || createForm.name,
        content: '',
        version: '1.0.0',
        type: 'CUSTOM',
        entryPoint: `skills/${slug}`,
      });
      setSkills([created, ...skills]);
      setShowCreate(false);
      setCreateForm({ name: '', slug: '', description: '' });
      openEditor(created);
    } catch (e: any) {
      alert(e.message || 'Failed to create');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteSkill(id);
      const remaining = skills.filter((s) => s.id !== id);
      setSkills(remaining);
      if (editing?.id === id) setEditing(null);
      setDeleteConfirm(null);
    } catch (e: any) {
      alert(e.message || 'Failed to delete');
    }
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (dirty) handleSave();
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-1">Skills</h1>
          <p className="text-[var(--muted)] text-sm">Reusable instructions injected into agent system prompts</p>
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
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 text-sm">
            + New Skill
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--muted)]">Loading...</p>
      ) : skills.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-4xl mb-4">🧠</p>
          <p className="text-lg font-medium mb-2">No skills yet</p>
          <p className="text-[var(--muted)] mb-4">Create reusable skill instructions for your agents</p>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg">+ Add Skill</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {skills.map((skill) => (
            <div key={skill.id} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 hover:border-[var(--accent)]/30 transition">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">
                    <span className="mr-2">{typeIcon[skill.type] || '🧠'}</span>
                    {skill.name}
                  </h3>
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${typeBadge[skill.type] || 'bg-gray-500/15 text-gray-400'}`}>
                      {skill.type}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--hover)] text-[var(--muted)]">v{skill.version}</span>
                  </div>
                </div>
              </div>
              {skill.description && <p className="text-sm text-[var(--muted)] mb-3 line-clamp-2">{skill.description}</p>}
              {skill.content && (
                <p className="text-xs font-mono text-[var(--muted)] mb-3 line-clamp-2 opacity-60">{skill.content}</p>
              )}
              {skill._count?.agents > 0 && (
                <p className="text-xs text-[var(--accent)] mb-2">{skill._count.agents} agent(s)</p>
              )}
              <div className="flex gap-2 mt-3 pt-3 border-t border-[var(--border)]">
                <button onClick={() => openEditor(skill)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--hover)]">
                  <Pencil size={12} /> Edit
                </button>
                {deleteConfirm === skill.id ? (
                  <div className="flex gap-1 ml-auto">
                    <button onClick={() => handleDelete(skill.id)}
                      className="text-xs px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600">Confirm</button>
                    <button onClick={() => setDeleteConfirm(null)}
                      className="text-xs px-3 py-1.5 rounded border border-[var(--border)]">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirm(skill.id)}
                    className="text-xs px-3 py-1.5 rounded border border-red-300/30 text-red-400 hover:bg-red-500/10 ml-auto">
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Editor modal ── */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={closeEditor} onKeyDown={handleEditorKeyDown}>
          <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] flex w-[1100px] max-w-[95vw] h-[85vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}>

            {/* Skill list sidebar */}
            <div className="hidden md:flex w-56 border-r border-[var(--border)] flex-col bg-[var(--bg)] shrink-0">
              <div className="p-3 border-b border-[var(--border)] text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Skills
              </div>
              <div className="flex-1 overflow-y-auto">
                {skills.map((skill) => (
                  <button key={skill.id} onClick={() => switchSkill(skill)}
                    className={`w-full text-left px-3 py-2.5 border-b border-[var(--border)] transition hover:bg-[var(--hover)] text-sm ${
                      editing.id === skill.id ? 'bg-[var(--card)] border-l-2 border-l-[var(--accent)]' : ''
                    }`}>
                    <div className="font-medium truncate">{skill.name}</div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${typeBadge[skill.type] || 'bg-gray-500/15 text-gray-400'}`}>
                      {skill.type}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Editor area */}
            <div className="flex-1 flex flex-col overflow-hidden" onKeyDown={handleEditorKeyDown}>
              {/* Header */}
              <div className="shrink-0 px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold">{form.name || 'Untitled Skill'}</h2>
                  {dirty && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Unsaved</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={handleSave} disabled={!dirty || saving}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-30 text-sm">
                    <Save size={14} />
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={closeEditor}
                    className="p-1.5 rounded-lg hover:bg-[var(--hover)] text-[var(--muted)] hover:text-white transition">
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Form */}
              <div className="flex-1 overflow-y-auto p-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--muted)] mb-1">Name</label>
                    <input value={form.name} onChange={(e) => updateForm({ name: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--muted)] mb-1">Slug</label>
                    <input value={form.slug} onChange={(e) => updateForm({ slug: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--muted)] mb-1">Type</label>
                    <select value={form.type} onChange={(e) => updateForm({ type: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm">
                      {skillTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--muted)] mb-1">Version</label>
                    <input value={form.version} onChange={(e) => updateForm({ version: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm" />
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1">Description</label>
                  <textarea value={form.description} onChange={(e) => updateForm({ description: e.target.value })}
                    rows={2} placeholder="Short description of what this skill does..."
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm" />
                </div>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                    Skill Content <span className="font-normal">(instructions injected into agent system prompt)</span>
                  </label>
                  <textarea value={form.content} onChange={(e) => updateForm({ content: e.target.value })}
                    rows={16} placeholder={"Write the skill instructions here...\n\nThis text will be injected into the agent's system prompt when the skill is assigned."}
                    className="w-full px-4 py-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm font-mono leading-relaxed resize-y min-h-[200px]" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1">Entry Point</label>
                  <input value={form.entryPoint} onChange={(e) => updateForm({ entryPoint: e.target.value })}
                    placeholder="skills/my-skill"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm font-mono" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Catalog modal ── */}
      {showCatalog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCatalog(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[600px] mx-4 max-h-[75vh] overflow-y-auto border border-[var(--border)]" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Add from Catalog</h3>
            <p className="text-sm text-[var(--muted)] mb-4">Import skills shared by the community</p>

            {catalogLoading ? (
              <div className="text-center py-10 text-[var(--muted)]">Loading...</div>
            ) : catalogItems.length === 0 ? (
              <div className="text-center py-10 text-[var(--muted)]">No skills in catalog yet</div>
            ) : (
              <div className="space-y-2">
                {catalogItems.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] hover:border-[var(--accent)]/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-lg flex-shrink-0">{typeIcon[item.type] || '🧠'}</span>
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

      {/* ── Create modal ── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[440px] mx-4 border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">New Skill</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="Data Analysis" autoFocus
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Slug <span className="text-[var(--muted)] font-normal">(auto-generated if empty)</span>
                </label>
                <input value={createForm.slug} onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })}
                  placeholder="data-analysis"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-mono text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  rows={2} placeholder="Short description..."
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Cancel</button>
              <button onClick={handleCreate} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
