'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const STATUSES = ['PLANNED', 'ACTIVE', 'ACHIEVED', 'CANCELLED', 'PAUSED'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const OWNER_TYPES = ['COMPANY', 'TEAM', 'AGENT', 'TASK'] as const;

const statusBadge: Record<string, string> = {
  PLANNED: 'bg-gray-500/20 text-gray-400',
  ACTIVE: 'bg-blue-500/20 text-blue-400',
  ACHIEVED: 'bg-emerald-500/20 text-emerald-400',
  CANCELLED: 'bg-red-500/20 text-red-400',
  PAUSED: 'bg-yellow-500/20 text-yellow-400',
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

interface Goal {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  progress: number;
  parentId?: string | null;
  ownerType?: string;
  ownerId?: string;
  agentId?: string;
  projectId?: string;
  targetDate?: string;
  createdAt?: string;
  updatedAt?: string;
  children?: Goal[];
}

const emptyForm = {
  title: '',
  description: '',
  status: 'PLANNED',
  priority: 'MEDIUM',
  parentId: '',
  ownerType: 'COMPANY',
  ownerId: '',
  agentId: '',
  projectId: '',
  progress: 0,
  targetDate: '',
};

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState<'view' | 'edit' | 'create' | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loadGoals = async () => {
    try {
      const res = await (api as any).getGoals({ pageSize: '200' });
      setGoals(res.data || []);
      // Expand all by default on first load
      if (expandedIds.size === 0) {
        const allIds = new Set<string>((res.data || []).map((g: Goal) => g.id));
        setExpandedIds(allIds);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGoals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build tree from flat list
  const buildTree = (items: Goal[]): Goal[] => {
    const map = new Map<string, Goal>();
    const roots: Goal[] = [];

    items.forEach((g) => map.set(g.id, { ...g, children: [] }));
    items.forEach((g) => {
      const node = map.get(g.id)!;
      if (g.parentId && map.has(g.parentId)) {
        map.get(g.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  };

  const tree = buildTree(goals);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openView = async (goal: Goal) => {
    setSelectedGoal(goal);
    setModalMode('view');
    setDeleteConfirm(false);
    setError('');
    try {
      const full = await (api as any).getGoal(goal.id);
      setSelectedGoal(full);
    } catch {
      // keep partial data
    }
  };

  const openCreate = (parentId?: string) => {
    setSelectedGoal(null);
    setForm({ ...emptyForm, parentId: parentId || '' });
    setError('');
    setDeleteConfirm(false);
    setModalMode('create');
  };

  const openEdit = () => {
    if (!selectedGoal) return;
    setForm({
      title: selectedGoal.title || '',
      description: selectedGoal.description || '',
      status: selectedGoal.status || 'PLANNED',
      priority: selectedGoal.priority || 'MEDIUM',
      parentId: selectedGoal.parentId || '',
      ownerType: selectedGoal.ownerType || 'COMPANY',
      ownerId: selectedGoal.ownerId || '',
      agentId: selectedGoal.agentId || '',
      projectId: selectedGoal.projectId || '',
      progress: selectedGoal.progress ?? 0,
      targetDate: selectedGoal.targetDate ? selectedGoal.targetDate.substring(0, 10) : '',
    });
    setError('');
    setDeleteConfirm(false);
    setModalMode('edit');
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload: any = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        status: form.status,
        priority: form.priority,
        progress: Number(form.progress),
        ownerType: form.ownerType || undefined,
        ownerId: form.ownerId || undefined,
        agentId: form.agentId || undefined,
        projectId: form.projectId || undefined,
        parentId: form.parentId || null,
        targetDate: form.targetDate || undefined,
      };

      if (modalMode === 'create') {
        await (api as any).createGoal(payload);
      } else if (modalMode === 'edit' && selectedGoal) {
        await (api as any).updateGoal(selectedGoal.id, payload);
      }
      setModalMode(null);
      setSelectedGoal(null);
      await loadGoals();
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedGoal) return;
    setSaving(true);
    try {
      await (api as any).deleteGoal(selectedGoal.id);
      setModalMode(null);
      setSelectedGoal(null);
      await loadGoals();
    } catch (e: any) {
      setError(e.message || 'Failed to delete');
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => {
    setModalMode(null);
    setSelectedGoal(null);
    setError('');
    setDeleteConfirm(false);
  };

  const formatDate = (d?: string) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString();
  };

  const progressColor = (p: number) => {
    if (p >= 80) return 'bg-emerald-500';
    if (p >= 50) return 'bg-blue-500';
    if (p >= 25) return 'bg-yellow-500';
    return 'bg-gray-500';
  };

  // Recursive tree renderer
  const renderGoalNode = (goal: Goal, depth: number = 0) => {
    const hasChildren = goal.children && goal.children.length > 0;
    const isExpanded = expandedIds.has(goal.id);

    return (
      <div key={goal.id}>
        <div
          className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] hover:bg-[var(--card-hover)] cursor-pointer transition-colors group"
          style={{ paddingLeft: `${depth * 28 + 16}px` }}
          onClick={() => openView(goal)}
        >
          {/* Expand/collapse toggle */}
          <button
            className={`w-5 h-5 flex items-center justify-center rounded text-xs shrink-0 ${
              hasChildren
                ? 'text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--border)]'
                : 'invisible'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleExpand(goal.id);
            }}
          >
            {hasChildren ? (isExpanded ? '▼' : '▶') : ''}
          </button>

          {/* Title */}
          <div className="flex-1 min-w-0">
            <span className="font-medium truncate block">{goal.title}</span>
          </div>

          {/* Status badge */}
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
              statusBadge[goal.status] || 'bg-gray-500/20 text-gray-400'
            }`}
          >
            {goal.status}
          </span>

          {/* Priority */}
          <span
            className={`text-xs font-mono font-bold shrink-0 w-8 text-center ${
              priorityColors[goal.priority] || 'text-gray-400'
            }`}
            title={goal.priority}
          >
            {priorityIcon[goal.priority] || '-'}
          </span>

          {/* Progress bar */}
          <div className="w-24 shrink-0 hidden md:flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${progressColor(goal.progress ?? 0)}`}
                style={{ width: `${goal.progress ?? 0}%` }}
              />
            </div>
            <span className="text-xs text-[var(--muted)] w-8 text-right">{goal.progress ?? 0}%</span>
          </div>

          {/* Owner type */}
          {goal.ownerType && (
            <span className="text-xs text-[var(--muted)] shrink-0 hidden lg:block w-16 text-center">
              {goal.ownerType}
            </span>
          )}

          {/* Target date */}
          <span className="text-xs text-[var(--muted)] shrink-0 hidden sm:block w-20 text-right">
            {formatDate(goal.targetDate)}
          </span>

          {/* Quick add child */}
          <button
            className="opacity-0 group-hover:opacity-100 text-xs text-[var(--muted)] hover:text-[var(--accent)] px-1 transition-opacity shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              openCreate(goal.id);
            }}
            title="Add sub-goal"
          >
            +
          </button>
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div>
            {goal.children!.map((child) => renderGoalNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-1">Goals</h1>
          <p className="text-[var(--muted)] text-sm">
            Hierarchical objectives from company down to individual tasks
          </p>
        </div>
        <button
          onClick={() => openCreate()}
          className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 text-sm"
        >
          + New Goal
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <p className="text-[var(--muted)]">Loading...</p>
      ) : goals.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-4xl mb-4">🎯</p>
          <p className="text-lg font-medium mb-2">No goals yet</p>
          <p className="text-[var(--muted)] mb-4">
            Create your first goal to start tracking objectives
          </p>
          <button
            onClick={() => openCreate()}
            className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg"
          >
            + New Goal
          </button>
        </div>
      ) : (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] text-xs text-[var(--muted)] font-medium uppercase tracking-wider bg-[var(--card)]">
            <div className="w-5 shrink-0" />
            <div className="flex-1">Title</div>
            <div className="w-20 text-center shrink-0">Status</div>
            <div className="w-8 text-center shrink-0">Pri</div>
            <div className="w-24 shrink-0 hidden md:block">Progress</div>
            <div className="w-16 text-center shrink-0 hidden lg:block">Owner</div>
            <div className="w-20 text-right shrink-0 hidden sm:block">Target</div>
            <div className="w-4 shrink-0" />
          </div>

          {/* Tree rows */}
          {tree.map((goal) => renderGoalNode(goal, 0))}
        </div>
      )}

      {/* Modal overlay */}
      {modalMode && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={closeModal}
        >
          <div
            className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[560px] mx-4 border border-[var(--border)] max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* VIEW MODE */}
            {modalMode === 'view' && selectedGoal && (
              <>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <h3 className="text-lg font-semibold">{selectedGoal.title}</h3>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
                      statusBadge[selectedGoal.status] || 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    {selectedGoal.status}
                  </span>
                </div>

                {selectedGoal.description && (
                  <p className="text-sm text-[var(--muted)] mb-4 whitespace-pre-wrap">
                    {selectedGoal.description}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <span className="text-xs text-[var(--muted)] block mb-1">Priority</span>
                    <span className={`text-sm font-medium ${priorityColors[selectedGoal.priority] || ''}`}>
                      {selectedGoal.priority}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--muted)] block mb-1">Progress</span>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-[var(--border)] overflow-hidden">
                        <div
                          className={`h-full rounded-full ${progressColor(selectedGoal.progress ?? 0)}`}
                          style={{ width: `${selectedGoal.progress ?? 0}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium">{selectedGoal.progress ?? 0}%</span>
                    </div>
                  </div>
                  {selectedGoal.ownerType && (
                    <div>
                      <span className="text-xs text-[var(--muted)] block mb-1">Owner Type</span>
                      <span className="text-sm">{selectedGoal.ownerType}</span>
                    </div>
                  )}
                  {selectedGoal.ownerId && (
                    <div>
                      <span className="text-xs text-[var(--muted)] block mb-1">Owner ID</span>
                      <span className="text-sm font-mono text-xs">{selectedGoal.ownerId}</span>
                    </div>
                  )}
                  {selectedGoal.agentId && (
                    <div>
                      <span className="text-xs text-[var(--muted)] block mb-1">Agent</span>
                      <span className="text-sm font-mono text-xs">{selectedGoal.agentId}</span>
                    </div>
                  )}
                  {selectedGoal.projectId && (
                    <div>
                      <span className="text-xs text-[var(--muted)] block mb-1">Project</span>
                      <span className="text-sm font-mono text-xs">{selectedGoal.projectId}</span>
                    </div>
                  )}
                  {selectedGoal.targetDate && (
                    <div>
                      <span className="text-xs text-[var(--muted)] block mb-1">Target Date</span>
                      <span className="text-sm">{formatDate(selectedGoal.targetDate)}</span>
                    </div>
                  )}
                  {selectedGoal.createdAt && (
                    <div>
                      <span className="text-xs text-[var(--muted)] block mb-1">Created</span>
                      <span className="text-sm">{formatDate(selectedGoal.createdAt)}</span>
                    </div>
                  )}
                </div>

                {selectedGoal.parentId && (
                  <div className="mb-4">
                    <span className="text-xs text-[var(--muted)] block mb-1">Parent Goal</span>
                    <span className="text-sm font-mono text-xs">
                      {goals.find((g) => g.id === selectedGoal.parentId)?.title || selectedGoal.parentId}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--border)]">
                  <div>
                    {!deleteConfirm ? (
                      <button
                        onClick={() => setDeleteConfirm(true)}
                        className="text-xs px-3 py-1.5 rounded border border-red-300/30 text-red-400 hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    ) : (
                      <div className="flex gap-1">
                        <button
                          onClick={handleDelete}
                          disabled={saving}
                          className="text-xs px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                        >
                          {saving ? 'Deleting...' : 'Confirm Delete'}
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(false)}
                          className="text-xs px-3 py-1.5 rounded border border-[var(--border)]"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={closeModal}
                      className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm"
                    >
                      Close
                    </button>
                    <button
                      onClick={openEdit}
                      className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 text-sm"
                    >
                      Edit
                    </button>
                  </div>
                </div>

                {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
              </>
            )}

            {/* CREATE / EDIT MODE */}
            {(modalMode === 'create' || modalMode === 'edit') && (
              <>
                <h3 className="text-lg font-semibold mb-4">
                  {modalMode === 'create' ? 'Create Goal' : 'Edit Goal'}
                </h3>
                <div className="space-y-4">
                  {/* Title */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Title</label>
                    <input
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="Goal title"
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)]"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Description</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="Describe this goal..."
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] resize-none"
                    />
                  </div>

                  {/* Status + Priority */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Status</label>
                      <select
                        value={form.status}
                        onChange={(e) => setForm({ ...form, status: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)]"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Priority</label>
                      <select
                        value={form.priority}
                        onChange={(e) => setForm({ ...form, priority: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)]"
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Parent Goal */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Parent Goal</label>
                    <select
                      value={form.parentId}
                      onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)]"
                    >
                      <option value="">None (top-level)</option>
                      {goals
                        .filter((g) => modalMode !== 'edit' || g.id !== selectedGoal?.id)
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.title}
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Owner Type + Owner ID */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Owner Type</label>
                      <select
                        value={form.ownerType}
                        onChange={(e) => setForm({ ...form, ownerType: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)]"
                      >
                        {OWNER_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Owner ID</label>
                      <input
                        value={form.ownerId}
                        onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
                        placeholder="Owner identifier"
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)]"
                      />
                    </div>
                  </div>

                  {/* Agent + Project */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Agent ID</label>
                      <input
                        value={form.agentId}
                        onChange={(e) => setForm({ ...form, agentId: e.target.value })}
                        placeholder="Optional agent"
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Project ID</label>
                      <input
                        value={form.projectId}
                        onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                        placeholder="Optional project"
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)]"
                      />
                    </div>
                  </div>

                  {/* Progress slider */}
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Progress: {form.progress}%
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={form.progress}
                      onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })}
                      className="w-full accent-[var(--accent)]"
                    />
                    <div className="flex justify-between text-xs text-[var(--muted)]">
                      <span>0%</span>
                      <span>50%</span>
                      <span>100%</span>
                    </div>
                  </div>

                  {/* Target date */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Target Date</label>
                    <input
                      type="date"
                      value={form.targetDate}
                      onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)]"
                    />
                  </div>

                  {error && <p className="text-sm text-red-400">{error}</p>}
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <button
                    onClick={closeModal}
                    className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
                  >
                    {saving
                      ? 'Saving...'
                      : modalMode === 'create'
                        ? 'Create Goal'
                        : 'Save Changes'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
