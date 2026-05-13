'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

const authTypes = ['NONE', 'SSH_KEY', 'TOKEN', 'BASIC'];
const authTypeLabels: Record<string, string> = { NONE: 'None', SSH_KEY: 'SSH Key', TOKEN: 'Access Token', BASIC: 'Basic Auth' };
const statusColors: Record<string, string> = {
  SYNCED: 'bg-emerald-500/20 text-emerald-400',
  SYNCING: 'bg-amber-500/20 text-amber-400',
  CLONING: 'bg-amber-500/20 text-amber-400',
  ERROR: 'bg-red-500/20 text-red-400',
  PENDING: 'bg-gray-500/20 text-gray-400',
};

const emptyForm = {
  name: '', slug: '', gitUrl: '', branch: 'main', description: '',
  authType: 'NONE', authConfig: { sshKey: '', token: '', username: '', password: '' },
  syncSchedule: '', excludes: '',
};

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function timeAgo(date: string | null) {
  if (!date) return 'Never';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function ReposPage() {
  const isAdmin = api.getUserFromToken()?.role === 'ADMIN';
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRepo, setEditingRepo] = useState<any>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [slugManual, setSlugManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [busyRepoId, setBusyRepoId] = useState<string | null>(null);
  const [authChanged, setAuthChanged] = useState(false);
  const [progress, setProgress] = useState<Record<string, { stage: string; percent: number }>>({});

  const loadRepos = () => {
    api.getRepos().then((r: any) => setRepos(Array.isArray(r) ? r : r.data || [])).finally(() => setLoading(false));
  };

  useEffect(() => { loadRepos(); }, []);

  // Auto-refresh when repos are in progress
  useEffect(() => {
    const hasInProgress = repos.some(r => ['PENDING', 'CLONING', 'SYNCING'].includes(r.syncStatus));
    if (!hasInProgress) return;
    const timer = setInterval(loadRepos, 5000);
    return () => clearInterval(timer);
  }, [repos]);

  // Poll sync progress
  useEffect(() => {
    const syncing = repos.filter(r => ['CLONING', 'SYNCING'].includes(r.syncStatus));
    if (syncing.length === 0) {
      setProgress({});
      return;
    }
    const poll = () => {
      Promise.all(syncing.map(async (r) => {
        try {
          const p = await api.getRepoProgress(r.id);
          return p ? [r.id, p] as const : null;
        } catch { return null; }
      })).then((results) => {
        const next: Record<string, { stage: string; percent: number }> = {};
        for (const res of results) {
          if (res) next[res[0]] = res[1];
        }
        setProgress(next);
      });
    };
    poll();
    const timer = setInterval(poll, 1500);
    return () => clearInterval(timer);
  }, [repos]);

  const openCreate = () => {
    setEditingRepo(null);
    setForm({ ...emptyForm });
    setSlugManual(false);
    setAuthChanged(false);
    setError('');
    setShowModal(true);
  };

  const openEdit = (repo: any) => {
    setEditingRepo(repo);
    setForm({
      name: repo.name || '',
      slug: repo.slug || '',
      gitUrl: repo.gitUrl || '',
      branch: repo.branch || 'main',
      description: repo.description || '',
      authType: repo.authType || 'NONE',
      authConfig: { sshKey: '', token: '', username: '', password: '' },
      syncSchedule: repo.syncSchedule || '',
      excludes: repo.excludes || '',
    });
    setSlugManual(true);
    setAuthChanged(false);
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.gitUrl.trim()) { setError('Git URL is required'); return; }

    const slug = form.slug || slugify(form.name);
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug)) {
      setError('Slug must contain only lowercase letters, numbers, and hyphens');
      return;
    }

    setSaving(true);
    setError('');
    try {
      let authConfig: any = null;
      if (form.authType !== 'NONE') {
        if (form.authType === 'SSH_KEY') authConfig = { sshKey: form.authConfig.sshKey };
        else if (form.authType === 'TOKEN') authConfig = { token: form.authConfig.token };
        else if (form.authType === 'BASIC') authConfig = { username: form.authConfig.username, password: form.authConfig.password };
      }

      const payload: any = {
        name: form.name,
        slug,
        gitUrl: form.gitUrl,
        branch: form.branch || 'main',
        description: form.description || null,
        authType: form.authType,
        syncSchedule: form.syncSchedule || null,
        excludes: form.excludes || null,
      };

      // Only send authConfig if creating or user changed it
      if (!editingRepo || authChanged) {
        payload.authConfig = authConfig;
      }

      if (editingRepo) {
        await api.updateRepo(editingRepo.id, payload);
      } else {
        await api.createRepo(payload);
      }
      setShowModal(false);
      loadRepos();
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async (id: string) => {
    setBusyRepoId(id);
    try {
      await api.syncRepo(id);
      loadRepos();
    } catch (e: any) {
      alert(e.message || 'Sync failed');
    } finally {
      setBusyRepoId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyRepoId(id);
    try {
      await api.deleteRepo(id);
      setRepos(repos.filter(r => r.id !== id));
      setDeleteConfirm(null);
    } catch (e: any) {
      alert(e.message || 'Failed to delete');
    } finally {
      setBusyRepoId(null);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-1">Repositories</h1>
          <p className="text-[var(--muted)] text-sm">Manage Git repositories for agent code search</p>
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 text-sm">
          + Add Repository
        </button>
      </div>

      {loading ? (
        <p className="text-[var(--muted)]">Loading...</p>
      ) : repos.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-4xl mb-4">📦</p>
          <p className="text-lg font-medium mb-2">No repositories yet</p>
          <p className="text-[var(--muted)] mb-4">Clone Git repositories to give agents code search tools</p>
          <button onClick={openCreate} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg">+ Add Repository</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {repos.map((repo) => (
            <div key={repo.id} className={`bg-[var(--card)] border rounded-xl p-5 transition ${repo.syncStatus === 'ERROR' ? 'border-red-500/60 hover:border-red-400' : 'border-[var(--border)] hover:border-[var(--accent)]/30'}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">{repo.name}</h3>
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded ${statusColors[repo.syncStatus] || 'bg-gray-500/20 text-gray-400'}`}>
                      {repo.syncStatus}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--hover)] text-[var(--muted)]">{repo.branch}</span>
                    {repo.authType && repo.authType !== 'NONE' && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--hover)] text-[var(--muted)]">{authTypeLabels[repo.authType] || repo.authType}</span>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-xs font-mono text-[var(--muted)] mb-2 truncate">{repo.gitUrl}</p>
              {repo.description && <p className="text-sm text-[var(--muted)] mb-3 line-clamp-2">{repo.description}</p>}
              <div className="flex items-center gap-3 text-xs text-[var(--muted)] mb-2">
                <span>Synced: {timeAgo(repo.lastSyncAt)}</span>
                {repo.syncSchedule && <span className="font-mono">{repo.syncSchedule}</span>}
                {repo._count?.agents > 0 && <span className="text-[var(--accent)]">{repo._count.agents} agent(s)</span>}
              </div>
              {repo.lastSyncError && (
                <p className="text-xs text-red-400 mb-2 line-clamp-2">{repo.lastSyncError}</p>
              )}
              {progress[repo.id] && (
                <div className="mb-2">
                  <div className="flex justify-between text-[10px] text-[var(--muted)] mb-1">
                    <span>{progress[repo.id].stage}</span>
                    <span>{progress[repo.id].percent}%</span>
                  </div>
                  <div className="h-1.5 bg-[var(--hover)] rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--accent)] rounded-full transition-all duration-300" style={{ width: `${progress[repo.id].percent}%` }} />
                  </div>
                </div>
              )}
              <div className="flex gap-2 mt-3 pt-3 border-t border-[var(--border)]">
                <button onClick={() => handleSync(repo.id)}
                  disabled={busyRepoId === repo.id || ['CLONING', 'SYNCING'].includes(repo.syncStatus)}
                  className="text-xs px-3 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-50">
                  Sync
                </button>
                <button onClick={() => openEdit(repo)}
                  disabled={busyRepoId === repo.id}
                  className="text-xs px-3 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-50">
                  Edit
                </button>
                {isAdmin && (deleteConfirm === repo.id ? (
                  <div className="flex gap-1 ml-auto">
                    <button onClick={() => handleDelete(repo.id)}
                      disabled={busyRepoId === repo.id}
                      className="text-xs px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50">Confirm</button>
                    <button onClick={() => setDeleteConfirm(null)}
                      disabled={busyRepoId === repo.id}
                      className="text-xs px-3 py-1.5 rounded border border-[var(--border)] disabled:opacity-50">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirm(repo.id)}
                    disabled={busyRepoId === repo.id}
                    className="text-xs px-3 py-1.5 rounded border border-red-300/30 text-red-400 hover:bg-red-500/10 ml-auto disabled:opacity-50">
                    Delete
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[520px] mx-4 max-h-[85vh] overflow-y-auto border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">{editingRepo ? 'Edit Repository' : 'New Repository'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input value={form.name} onChange={(e) => {
                  const name = e.target.value;
                  setForm({ ...form, name, ...(!slugManual ? { slug: slugify(name) } : {}) });
                }}
                  placeholder="Backend API"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Slug</label>
                <input value={form.slug} onChange={(e) => { setForm({ ...form, slug: e.target.value }); setSlugManual(true); }}
                  placeholder="backend-api"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-mono text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Git URL</label>
                <input value={form.gitUrl} onChange={(e) => setForm({ ...form, gitUrl: e.target.value })}
                  placeholder="git@gitlab.com:org/repo.git"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-mono text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Branch</label>
                <input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })}
                  placeholder="main"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2} placeholder="API server on NestJS"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Auth Type</label>
                <select value={form.authType} onChange={(e) => { setForm({ ...form, authType: e.target.value }); setAuthChanged(true); }}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  {authTypes.map((t) => <option key={t} value={t}>{authTypeLabels[t]}</option>)}
                </select>
              </div>
              {form.authType === 'SSH_KEY' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Private SSH Key</label>
                  <textarea value={form.authConfig.sshKey} onChange={(e) => { setForm({ ...form, authConfig: { ...form.authConfig, sshKey: e.target.value } }); setAuthChanged(true); }}
                    rows={4} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-mono text-xs" />
                  {editingRepo && !authChanged && <p className="text-xs text-[var(--muted)] mt-1">Leave empty to keep existing key</p>}
                </div>
              )}
              {form.authType === 'TOKEN' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Token</label>
                  <input type="password" value={form.authConfig.token} onChange={(e) => { setForm({ ...form, authConfig: { ...form.authConfig, token: e.target.value } }); setAuthChanged(true); }}
                    placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-mono text-sm" />
                  {editingRepo && !authChanged && <p className="text-xs text-[var(--muted)] mt-1">Leave empty to keep existing token</p>}
                </div>
              )}
              {form.authType === 'BASIC' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Username</label>
                    <input value={form.authConfig.username} onChange={(e) => { setForm({ ...form, authConfig: { ...form.authConfig, username: e.target.value } }); setAuthChanged(true); }}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Password</label>
                    <input type="password" value={form.authConfig.password} onChange={(e) => { setForm({ ...form, authConfig: { ...form.authConfig, password: e.target.value } }); setAuthChanged(true); }}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
                  </div>
                  {editingRepo && !authChanged && <p className="text-xs text-[var(--muted)]">Leave empty to keep existing credentials</p>}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">Excludes</label>
                <textarea value={form.excludes} onChange={(e) => setForm({ ...form, excludes: e.target.value })}
                  rows={3} placeholder={"tests/*\ndocs/*\n*.test.ts"}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-mono text-xs" />
                <p className="text-xs text-[var(--muted)] mt-1">Files and folders to remove after sync (one pattern per line, supports wildcards)</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Sync Schedule</label>
                <input value={form.syncSchedule} onChange={(e) => setForm({ ...form, syncSchedule: e.target.value })}
                  placeholder="0 8 * * 1"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-mono text-sm" />
                <p className="text-xs text-[var(--muted)] mt-1">Cron format. Examples: <code className="bg-[var(--hover)] px-1 rounded">0 8 * * 1</code> (Mon 8am), <code className="bg-[var(--hover)] px-1 rounded">0 */6 * * *</code> (every 6h), <code className="bg-[var(--hover)] px-1 rounded">0 9 * * 1-5</code> (weekdays 9am)</p>
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
                {saving ? 'Saving...' : editingRepo ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
