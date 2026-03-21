'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

const STATUSES = ['BACKLOG', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

const statusColors: Record<string, string> = {
  BACKLOG: 'bg-gray-500/20 text-gray-400',
  PLANNED: 'bg-blue-500/20 text-blue-400',
  IN_PROGRESS: 'bg-purple-500/20 text-purple-400',
  COMPLETED: 'bg-emerald-500/20 text-emerald-400',
  CANCELLED: 'bg-red-500/20 text-red-400',
  ON_HOLD: 'bg-yellow-500/20 text-yellow-400',
};

const priorityColors: Record<string, string> = {
  CRITICAL: 'text-red-400',
  HIGH: 'text-orange-400',
  MEDIUM: 'text-yellow-400',
  LOW: 'text-gray-400',
};

const priorityIcon: Record<string, string> = {
  CRITICAL: '!!!',
  HIGH: '!!',
  MEDIUM: '!',
  LOW: '-',
};

const emptyForm = {
  name: '',
  description: '',
  status: 'PLANNED' as string,
  priority: 'MEDIUM' as string,
  leadType: 'HUMAN' as string,
  leadId: '',
  startDate: '',
  targetDate: '',
  progress: 0,
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    loadProjects();
    api.getAgents().then((r: any) => setAgents(Array.isArray(r) ? r : r.data || [])).catch(() => {});
    api.getUsers().then((r: any) => setUsers(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  const loadProjects = () => {
    setLoading(true);
    api.getProjects({ pageSize: '100' })
      .then((res: any) => setProjects(res.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const openCreate = () => {
    setForm({ ...emptyForm });
    setError('');
    setModalMode('create');
  };

  const openEdit = (project: any) => {
    setForm({
      name: project.name || '',
      description: project.description || '',
      status: project.status || 'PLANNED',
      priority: project.priority || 'MEDIUM',
      leadType: project.leadType || 'HUMAN',
      leadId: project.leadId || '',
      startDate: project.startDate ? project.startDate.substring(0, 10) : '',
      targetDate: project.targetDate ? project.targetDate.substring(0, 10) : '',
      progress: project.progress ?? 0,
    });
    setError('');
    setModalMode('edit');
  };

  const openDetail = async (project: any) => {
    setSelectedProject(project);
    setStatsLoading(true);
    setStats(null);
    try {
      const s = await api.getProjectStats(project.id);
      setStats(s);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedProject(null);
    setStats(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: any = {
        name: form.name,
        description: form.description,
        status: form.status,
        priority: form.priority,
        progress: Number(form.progress),
      };
      if (form.leadId) {
        payload.leadType = form.leadType;
        payload.leadId = form.leadId;
      }
      if (form.startDate) payload.startDate = form.startDate;
      if (form.targetDate) payload.targetDate = form.targetDate;

      if (modalMode === 'edit' && selectedProject) {
        await api.updateProject(selectedProject.id, payload);
      } else {
        await api.createProject(payload);
      }
      setModalMode(null);
      loadProjects();
      if (selectedProject && modalMode === 'edit') {
        const updated = await api.getProject(selectedProject.id);
        setSelectedProject(updated);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedProject) return;
    setSaving(true);
    try {
      await api.deleteProject(selectedProject.id);
      setDeleteConfirm(false);
      closeDetail();
      loadProjects();
    } catch (e: any) {
      setError(e.message || 'Failed to delete');
    } finally {
      setSaving(false);
    }
  };

  const getLeadName = (project: any) => {
    if (!project.leadId) return 'Unassigned';
    if (project.leadType === 'AGENT') {
      const agent = agents.find((a: any) => a.id === project.leadId);
      return agent?.name || 'Agent';
    }
    const user = users.find((u: any) => u.id === project.leadId);
    return user?.name || 'User';
  };

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '--';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const truncate = (text: string, max: number) => {
    if (!text) return '';
    return text.length > max ? text.substring(0, max) + '...' : text;
  };

  // Detail view
  if (selectedProject) {
    return (
      <div className="p-4 md:p-8 max-w-7xl mx-auto">
        <button onClick={closeDetail} className="text-[var(--muted)] hover:text-white mb-4 text-sm flex items-center gap-1">
          &larr; Back to Projects
        </button>

        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h1 className="text-2xl font-bold">{selectedProject.name}</h1>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColors[selectedProject.status] || 'bg-gray-500/20 text-gray-400'}`}>
                  {selectedProject.status?.replace('_', ' ')}
                </span>
              </div>
              {selectedProject.description && (
                <p className="text-[var(--muted)] text-sm mt-2">{selectedProject.description}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => openEdit(selectedProject)}
                className="px-3 py-1.5 text-sm bg-[var(--accent)] text-white rounded-lg hover:opacity-90"
              >
                Edit
              </button>
              <button
                onClick={() => setDeleteConfirm(true)}
                className="px-3 py-1.5 text-sm bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30"
              >
                Delete
              </button>
            </div>
          </div>

          {/* Meta info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 text-sm">
            <div>
              <span className="text-[var(--muted)]">Priority</span>
              <div className={`font-medium mt-0.5 ${priorityColors[selectedProject.priority] || ''}`}>
                {priorityIcon[selectedProject.priority] || ''} {selectedProject.priority}
              </div>
            </div>
            <div>
              <span className="text-[var(--muted)]">Lead</span>
              <div className="font-medium mt-0.5">{getLeadName(selectedProject)}</div>
            </div>
            <div>
              <span className="text-[var(--muted)]">Start Date</span>
              <div className="font-medium mt-0.5">{formatDate(selectedProject.startDate)}</div>
            </div>
            <div>
              <span className="text-[var(--muted)]">Target Date</span>
              <div className="font-medium mt-0.5">{formatDate(selectedProject.targetDate)}</div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-6">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-[var(--muted)]">Progress</span>
              <span className="font-medium">{selectedProject.progress ?? 0}%</span>
            </div>
            <div className="w-full bg-[var(--border)] rounded-full h-2.5">
              <div
                className="h-2.5 rounded-full bg-[var(--accent)] transition-all"
                style={{ width: `${selectedProject.progress ?? 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Tasks by status */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <h3 className="font-semibold mb-4">Tasks by Status</h3>
            {statsLoading ? (
              <p className="text-[var(--muted)] text-sm">Loading stats...</p>
            ) : stats?.tasksByStatus ? (
              <div className="space-y-2">
                {Object.entries(stats.tasksByStatus).map(([status, count]: [string, any]) => (
                  <div key={status} className="flex items-center justify-between text-sm">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${statusColors[status] || 'bg-gray-500/20 text-gray-400'}`}>
                      {status.replace('_', ' ')}
                    </span>
                    <span className="font-medium">{count}</span>
                  </div>
                ))}
                {Object.keys(stats.tasksByStatus).length === 0 && (
                  <p className="text-[var(--muted)] text-sm">No tasks yet</p>
                )}
              </div>
            ) : (
              <p className="text-[var(--muted)] text-sm">No task data available</p>
            )}
          </div>

          {/* Goals by status */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <h3 className="font-semibold mb-4">Goals by Status</h3>
            {statsLoading ? (
              <p className="text-[var(--muted)] text-sm">Loading stats...</p>
            ) : stats?.goalsByStatus ? (
              <div className="space-y-2">
                {Object.entries(stats.goalsByStatus).map(([status, count]: [string, any]) => (
                  <div key={status} className="flex items-center justify-between text-sm">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${statusColors[status] || 'bg-gray-500/20 text-gray-400'}`}>
                      {status.replace('_', ' ')}
                    </span>
                    <span className="font-medium">{count}</span>
                  </div>
                ))}
                {Object.keys(stats.goalsByStatus).length === 0 && (
                  <p className="text-[var(--muted)] text-sm">No goals yet</p>
                )}
              </div>
            ) : (
              <p className="text-[var(--muted)] text-sm">No goal data available</p>
            )}
          </div>
        </div>

        {/* Delete confirmation */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 max-w-sm w-full">
              <h3 className="text-lg font-semibold mb-2">Delete Project</h3>
              <p className="text-[var(--muted)] text-sm mb-4">
                Are you sure you want to delete &ldquo;{selectedProject.name}&rdquo;? This action cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setDeleteConfirm(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] hover:bg-[var(--card-hover)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {saving ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit modal (reused) */}
        {modalMode && renderModal()}
      </div>
    );
  }

  function renderModal() {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
          <h2 className="text-lg font-semibold mb-4">
            {modalMode === 'create' ? 'New Project' : 'Edit Project'}
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm text-[var(--muted)] mb-1">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 bg-transparent border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                placeholder="Project name"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm text-[var(--muted)] mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 bg-transparent border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)] resize-none"
                placeholder="Project description"
              />
            </div>

            {/* Status + Priority */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[var(--muted)] mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full px-3 py-2 bg-transparent border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-[var(--muted)] mb-1">Priority</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="w-full px-3 py-2 bg-transparent border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Lead */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[var(--muted)] mb-1">Lead Type</label>
                <select
                  value={form.leadType}
                  onChange={(e) => setForm({ ...form, leadType: e.target.value, leadId: '' })}
                  className="w-full px-3 py-2 bg-transparent border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="HUMAN">User</option>
                  <option value="AGENT">Agent</option>
                  <option value="SYSTEM">System</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-[var(--muted)] mb-1">Lead</label>
                <select
                  value={form.leadId}
                  onChange={(e) => setForm({ ...form, leadId: e.target.value })}
                  className="w-full px-3 py-2 bg-transparent border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="">-- None --</option>
                  {form.leadType === 'AGENT'
                    ? agents.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)
                    : users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)
                  }
                </select>
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[var(--muted)] mb-1">Start Date</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  className="w-full px-3 py-2 bg-transparent border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--muted)] mb-1">Target Date</label>
                <input
                  type="date"
                  value={form.targetDate}
                  onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
                  className="w-full px-3 py-2 bg-transparent border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>

            {/* Progress */}
            <div>
              <label className="block text-sm text-[var(--muted)] mb-1">Progress: {form.progress}%</label>
              <input
                type="range"
                min={0}
                max={100}
                value={form.progress}
                onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })}
                className="w-full accent-[var(--accent)]"
              />
            </div>
          </div>

          <div className="flex gap-2 justify-end mt-6">
            <button
              onClick={() => setModalMode(null)}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] hover:bg-[var(--card-hover)]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : modalMode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Card grid view
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-1">Projects</h1>
          <p className="text-[var(--muted)] text-sm md:text-base">Manage and track project progress</p>
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90">
          + New Project
        </button>
      </div>

      {loading ? (
        <p className="text-[var(--muted)]">Loading...</p>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-4xl mb-4">📋</p>
          <p className="text-lg font-medium mb-2">No projects yet</p>
          <p className="text-[var(--muted)] mb-4">Create your first project to get started</p>
          <button onClick={openCreate} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg">+ New Project</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => openDetail(project)}
              className="text-left bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 hover:border-[var(--accent)] hover:bg-[var(--card-hover)] transition"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <h3 className="font-semibold text-base truncate flex-1">{project.name}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${statusColors[project.status] || 'bg-gray-500/20 text-gray-400'}`}>
                  {project.status?.replace('_', ' ')}
                </span>
              </div>

              {/* Description */}
              {project.description && (
                <p className="text-sm text-[var(--muted)] mb-3 line-clamp-2">
                  {truncate(project.description, 120)}
                </p>
              )}

              {/* Priority + Lead */}
              <div className="flex items-center gap-3 text-xs mb-3">
                <span className={`font-medium ${priorityColors[project.priority] || ''}`}>
                  {priorityIcon[project.priority] || ''} {project.priority}
                </span>
                <span className="text-[var(--muted)]">|</span>
                <span className="text-[var(--muted)] truncate">{getLeadName(project)}</span>
              </div>

              {/* Progress bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-[var(--muted)]">Progress</span>
                  <span>{project.progress ?? 0}%</span>
                </div>
                <div className="w-full bg-[var(--border)] rounded-full h-1.5">
                  <div
                    className="h-1.5 rounded-full bg-[var(--accent)] transition-all"
                    style={{ width: `${project.progress ?? 0}%` }}
                  />
                </div>
              </div>

              {/* Dates + counts */}
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <div className="flex gap-3">
                  {project.startDate && (
                    <span>{formatDate(project.startDate)}</span>
                  )}
                  {project.targetDate && (
                    <span>-&gt; {formatDate(project.targetDate)}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  {project._count?.tasks !== undefined && (
                    <span title="Tasks">{project._count.tasks} tasks</span>
                  )}
                  {project._count?.goals !== undefined && (
                    <span title="Goals">{project._count.goals} goals</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {modalMode && renderModal()}
    </div>
  );
}
