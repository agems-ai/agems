'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { Save, Plus, Trash2, Pencil, X, Download } from 'lucide-react';

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
  const [showImport, setShowImport] = useState(false);
  const [defaults, setDefaults] = useState<any[]>([]);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

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

  const openImport = async () => {
    setShowImport(true);
    try {
      const res = await api.getDefaultSkills();
      const list = Array.isArray(res) ? res : (res as any).data || [];
      setDefaults(list);
      const existingSlugs = new Set(skills.map((s: any) => s.slug));
      setSelectedSlugs(new Set(list.filter((d: any) => !existingSlugs.has(d.slug)).map((d: any) => d.slug)));
    } catch (e: any) {
      alert(e.message || 'Failed to load defaults');
      setShowImport(false);
    }
  };

  const handleImport = async () => {
    if (selectedSlugs.size === 0) return;
    setImporting(true);
    try {
      const result = await api.importDefaultSkills([...selectedSlugs]);
      const refreshed = await api.getSkills();
      setSkills((refreshed as any).data || refreshed || []);
      setShowImport(false);
      alert(`Imported ${(result as any).created} skills` + ((result as any).skipped ? `, ${(result as any).skipped} already existed` : ''));
    } catch (e: any) {
      alert(e.message || 'Import failed');
    } finally {
      setImporting(false);
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
          <button onClick={openImport} className="flex items-center gap-1.5 px-4 py-2 border border-[var(--border)] text-sm rounded-lg hover:bg-[var(--hover)]">
            <Download size={14} /> Import Defaults
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

      {/* ── Import defaults modal ── */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowImport(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[600px] mx-4 border border-[var(--border)] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Import Default Skills</h3>
              <span className="text-sm text-[var(--muted)]">{selectedSlugs.size} selected</span>
            </div>
            <p className="text-sm text-[var(--muted)] mb-4">Select skills to import. Already existing skills (by slug) are marked.</p>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setSelectedSlugs(new Set(defaults.map(d => d.slug)))}
                className="text-xs px-3 py-1 rounded border border-[var(--border)] hover:bg-[var(--hover)]">Select All</button>
              <button onClick={() => setSelectedSlugs(new Set())}
                className="text-xs px-3 py-1 rounded border border-[var(--border)] hover:bg-[var(--hover)]">Deselect All</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 mb-4">
              {defaults.map((d) => {
                const exists = skills.some((s: any) => s.slug === d.slug);
                return (
                  <label key={d.slug} className={`flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--hover)] cursor-pointer ${exists ? 'opacity-50' : ''}`}>
                    <input type="checkbox" checked={selectedSlugs.has(d.slug)}
                      onChange={(e) => {
                        const next = new Set(selectedSlugs);
                        e.target.checked ? next.add(d.slug) : next.delete(d.slug);
                        setSelectedSlugs(next);
                      }}
                      className="accent-[var(--accent)]" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{d.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${typeBadge[d.type] || 'bg-gray-500/15 text-gray-400'}`}>{d.type}</span>
                        {exists && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">exists</span>}
                      </div>
                      <p className="text-xs text-[var(--muted)] truncate">{d.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowImport(false)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Cancel</button>
              <button onClick={handleImport} disabled={selectedSlugs.size === 0 || importing}
                className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-30">
                {importing ? 'Importing...' : `Import ${selectedSlugs.size} Skills`}
              </button>
            </div>
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
