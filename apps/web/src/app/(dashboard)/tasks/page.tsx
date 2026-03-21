'use client';

import { useEffect, useState, useRef, DragEvent, useCallback } from 'react';
import { api } from '@/lib/api';

const COLUMNS = [
  { key: 'PENDING', label: 'Pending', color: 'bg-gray-500/20 text-gray-400', dot: 'bg-gray-400' },
  { key: 'IN_PROGRESS', label: 'In Progress', color: 'bg-blue-500/20 text-blue-400', dot: 'bg-blue-400' },
  { key: 'REVIEW', label: 'Review', color: 'bg-purple-500/20 text-purple-400', dot: 'bg-purple-400' },
  { key: 'COMPLETED', label: 'Completed', color: 'bg-emerald-500/20 text-emerald-400', dot: 'bg-emerald-400' },
  { key: 'FAILED', label: 'Failed / Blocked', color: 'bg-red-500/20 text-red-400', dot: 'bg-red-400' },
];

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const TASK_TYPES = ['ONE_TIME', 'RECURRING', 'CONTINUOUS'] as const;
const taskTypeLabels: Record<string, string> = { ONE_TIME: 'One-time', RECURRING: 'Recurring', CONTINUOUS: 'Continuous' };
const taskTypeBadge: Record<string, string> = { RECURRING: '🔄', CONTINUOUS: '♾️' };

const statusColors: Record<string, string> = {
  PENDING: 'bg-gray-500/20 text-gray-400',
  IN_PROGRESS: 'bg-blue-500/20 text-blue-400',
  IN_REVIEW: 'bg-purple-500/20 text-purple-400',
  IN_TESTING: 'bg-violet-500/20 text-violet-400',
  VERIFIED: 'bg-indigo-500/20 text-indigo-400',
  COMPLETED: 'bg-emerald-500/20 text-emerald-400',
  FAILED: 'bg-red-500/20 text-red-400',
  BLOCKED: 'bg-orange-500/20 text-orange-400',
  CANCELLED: 'bg-gray-500/20 text-gray-500',
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

type QuickFilter = 'all' | 'my_tasks' | 'assigned_to_me' | 'created_by_me';

export default function TasksPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState<'view' | 'edit' | 'create' | null>(null);
  const [viewTask, setViewTask] = useState<any>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [editTask, setEditTask] = useState<any>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterCreator, setFilterCreator] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');

  // Create form
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'MEDIUM',
    type: 'ONE_TIME' as string,
    cronExpression: '',
    assigneeType: 'AGENT' as 'AGENT' | 'HUMAN',
    assigneeId: '',
    deadline: '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    Promise.all([
      api.getTasks({ pageSize: '100' }).then((res: any) => res.data || []),
      api.getAgents().then((res: any) => res.data || res || []),
      api.getUsers().then((res: any) => res || []),
      api.fetch<any>('/auth/profile').catch(() => null),
    ]).then(([t, a, u, profile]) => {
      setTasks(t);
      setAgents(Array.isArray(a) ? a : []);
      setUsers(Array.isArray(u) ? u : []);
      if (profile) setCurrentUser(profile);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const myId = currentUser?.id;

  const filtered = tasks.filter(t => {
    // Quick filters
    if (quickFilter === 'my_tasks' && myId) {
      if (t.assigneeId !== myId && t.creatorId !== myId) return false;
    }
    if (quickFilter === 'assigned_to_me' && myId) {
      if (t.assigneeId !== myId) return false;
    }
    if (quickFilter === 'created_by_me' && myId) {
      if (t.creatorId !== myId) return false;
    }
    // Detailed filters
    if (filterAssignee && t.assigneeId !== filterAssignee) return false;
    if (filterCreator && t.creatorId !== filterCreator) return false;
    return true;
  });

  // Counts for quick filter badges
  const myTasksCount = myId ? tasks.filter(t => t.assigneeId === myId || t.creatorId === myId).length : 0;
  const assignedToMeCount = myId ? tasks.filter(t => t.assigneeId === myId).length : 0;
  const createdByMeCount = myId ? tasks.filter(t => t.creatorId === myId).length : 0;

  const grouped: Record<string, any[]> = {
    PENDING: filtered.filter(t => t.status === 'PENDING'),
    IN_PROGRESS: filtered.filter(t => t.status === 'IN_PROGRESS'),
    REVIEW: filtered.filter(t => t.status === 'IN_REVIEW' || t.status === 'IN_TESTING' || t.status === 'VERIFIED'),
    COMPLETED: filtered.filter(t => t.status === 'COMPLETED'),
    FAILED: filtered.filter(t => t.status === 'FAILED' || t.status === 'BLOCKED' || t.status === 'CANCELLED'),
  };

  // ── Drag & Drop ──
  const handleDragStart = (e: DragEvent, taskId: string) => {
    setDragId(taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: DragEvent, colKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(colKey);
  };

  const handleDragLeave = () => {
    setDragOver(null);
  };

  const handleDrop = async (e: DragEvent, newStatus: string) => {
    e.preventDefault();
    setDragOver(null);
    if (!dragId) return;

    const task = tasks.find(t => t.id === dragId);
    if (!task || task.status === newStatus) { setDragId(null); return; }

    // Map column key to actual status
    const actualStatus = newStatus === 'FAILED' ? 'FAILED' : newStatus;

    // Optimistic update
    setTasks(prev => prev.map(t => t.id === dragId ? { ...t, status: actualStatus } : t));
    setDragId(null);

    try {
      await api.updateTask(dragId, { status: actualStatus });
    } catch {
      // Revert on error
      setTasks(prev => prev.map(t => t.id === dragId ? { ...t, status: task.status } : t));
    }
  };

  const resolveActor = (type: string, id: string) => {
    if (type === 'AGENT') {
      const a = agents.find((x: any) => x.id === id);
      if (!a) return id?.substring(0, 8) + '...';
      const pos = a.positions?.[0]?.title;
      return pos ? `${a.name} · ${pos}` : a.name;
    }
    if (type === 'HUMAN') {
      const u = users.find((x: any) => x.id === id);
      return u ? u.name : id?.substring(0, 8) + '...';
    }
    return type === 'SYSTEM' ? 'System' : id?.substring(0, 8) + '...';
  };

  // ── Open View Modal ──
  const openView = async (task: any) => {
    setModalMode('view');
    setViewTask(task);
    setCommentText('');
    setViewLoading(true);
    try {
      const full = await api.getTask(task.id);
      setViewTask(full);
    } catch {} finally {
      setViewLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim() || !viewTask) return;
    setSendingComment(true);
    try {
      await api.addTaskComment(viewTask.id, commentText.trim());
      setCommentText('');
      const full = await api.getTask(viewTask.id);
      setViewTask(full);
    } finally {
      setSendingComment(false);
    }
  };

  // ── Create Task ──
  const openCreate = () => {
    setForm({ title: '', description: '', priority: 'MEDIUM', type: 'ONE_TIME', cronExpression: '', assigneeType: 'AGENT', assigneeId: agents[0]?.id || '', deadline: '' });
    setFormError('');
    setModalMode('create');
    setEditTask(null);
  };

  const openEdit = (task: any) => {
    setForm({
      title: task.title,
      description: task.description || '',
      priority: task.priority,
      type: task.type || 'ONE_TIME',
      cronExpression: task.cronExpression || '',
      assigneeType: task.assigneeType,
      assigneeId: task.assigneeId,
      deadline: task.deadline ? task.deadline.substring(0, 16) : '',
    });
    setFormError('');
    setEditTask(task);
    setModalMode('edit');
  };

  const handleSave = async () => {
    if (!form.title.trim()) { setFormError('Title is required'); return; }
    if (!form.assigneeId) { setFormError('Assignee is required'); return; }
    setSaving(true);
    setFormError('');
    try {
      if (editTask) {
        const updated = await api.updateTask(editTask.id, {
          title: form.title,
          description: form.description || undefined,
          priority: form.priority,
          type: form.type,
          cronExpression: form.type === 'RECURRING' ? form.cronExpression || undefined : undefined,
          assigneeType: form.assigneeType,
          assigneeId: form.assigneeId,
          deadline: form.deadline ? new Date(form.deadline).toISOString() : undefined,
        });
        setTasks(prev => prev.map(t => t.id === editTask.id ? { ...t, ...(updated as Record<string, any>) } : t));
      } else {
        const created = await api.createTask({
          title: form.title,
          description: form.description || undefined,
          priority: form.priority,
          type: form.type,
          cronExpression: form.type === 'RECURRING' ? form.cronExpression || undefined : undefined,
          assigneeType: form.assigneeType,
          assigneeId: form.assigneeId,
          deadline: form.deadline ? new Date(form.deadline).toISOString() : undefined,
        });
        setTasks(prev => [created, ...prev]);
      }
      setModalMode(null);
    } catch (e: any) {
      setFormError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // ── Status change via dropdown ──
  const handleStatusChange = async (taskId: string, newStatus: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    try {
      await api.updateTask(taskId, { status: newStatus });
    } catch {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: task.status } : t));
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Tasks</h1>
          <p className="text-[var(--muted)] mt-1 text-sm md:text-base hidden md:block">Drag tasks between columns to change status</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setViewMode('board')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'board' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)] hover:text-white'}`}
            >Board</button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)] hover:text-white'}`}
            >List</button>
          </div>
          <button onClick={openCreate} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90">
            + New Task
          </button>
        </div>
      </div>

      {/* Quick filters */}
      <div className="flex items-center gap-2 mb-3 flex-wrap overflow-x-auto">
        {([
          { key: 'all', label: 'All tasks', count: tasks.length },
          { key: 'my_tasks', label: 'My tasks', count: myTasksCount },
          { key: 'assigned_to_me', label: 'Assigned to me', count: assignedToMeCount },
          { key: 'created_by_me', label: 'Created by me', count: createdByMeCount },
        ] as const).map((f) => (
          <button
            key={f.key}
            onClick={() => { setQuickFilter(f.key); setFilterAssignee(''); setFilterCreator(''); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition border ${
              quickFilter === f.key
                ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                : 'border-transparent text-[var(--muted)] hover:text-white hover:bg-[var(--card-hover)]'
            }`}
          >
            {f.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              quickFilter === f.key ? 'bg-[var(--accent)]/20' : 'bg-[var(--border)]'
            }`}>
              {f.count}
            </span>
          </button>
        ))}

        <span className="text-xs text-[var(--muted)] ml-auto">
          {filtered.length} of {tasks.length} tasks
        </span>
      </div>

      {/* Detailed filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <AvatarDropdown
          value={filterAssignee}
          onChange={(v) => { setFilterAssignee(v); if (v) setQuickFilter('all'); }}
          placeholder="All assignees"
          agents={agents}
          users={users}
        />
        <AvatarDropdown
          value={filterCreator}
          onChange={(v) => { setFilterCreator(v); if (v) setQuickFilter('all'); }}
          placeholder="All creators"
          agents={agents}
          users={users}
          showSystem
        />

        {(filterAssignee || filterCreator || quickFilter !== 'all') && (
          <button
            onClick={() => { setFilterAssignee(''); setFilterCreator(''); setQuickFilter('all'); }}
            className="text-xs text-[var(--muted)] hover:text-white px-2 py-1 rounded border border-[var(--border)]"
          >
            Clear all filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center text-[var(--muted)] py-20">Loading tasks...</div>
      ) : viewMode === 'list' ? (
        /* ── List View ── */
        <div className="border border-[var(--border)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--card)]">
                <th className="text-left px-4 py-3 font-medium text-[var(--muted)]">Title</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--muted)] hidden md:table-cell">Status</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--muted)] hidden md:table-cell">Priority</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--muted)] hidden lg:table-cell">Assignee</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--muted)] hidden lg:table-cell">Deadline</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => openView(task)}
                  className="border-b border-[var(--border)] hover:bg-[var(--card-hover)] cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{task.title}</span>
                      {taskTypeBadge[task.type] && <span className="text-xs">{taskTypeBadge[task.type]}</span>}
                      <span className={`md:hidden px-1.5 py-0.5 rounded text-[10px] ${statusColors[task.status]}`}>{task.status}</span>
                    </div>
                    {task.description && <p className="text-xs text-[var(--muted)] mt-0.5 line-clamp-1">{task.description}</p>}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[task.status]}`}>{task.status}</span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={`font-mono font-bold text-xs ${priorityColors[task.priority]}`}>{priorityIcon[task.priority]} {task.priority}</span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <AssigneeChip assigneeId={task.assigneeId} assigneeType={task.assigneeType} agents={agents} users={users} />
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-[var(--muted)] text-xs">
                    {task.deadline ? new Date(task.deadline).toLocaleDateString() : '-'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="text-center py-12 text-[var(--muted)]">No tasks match filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Board View (Kanban) ── */
        <div className="flex md:grid md:grid-cols-5 gap-4 overflow-x-auto pb-4 md:pb-0 snap-x snap-mandatory md:snap-none" style={{ minHeight: 400 }}>
          {COLUMNS.map((col) => (
            <div
              key={col.key}
              onDragOver={(e) => handleDragOver(e, col.key)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.key)}
              className={`rounded-xl p-3 border transition-colors min-w-[280px] md:min-w-0 snap-center shrink-0 md:shrink ${
                dragOver === col.key
                  ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                  : 'border-[var(--border)] bg-[var(--card)]'
              }`}
            >
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                <span className="text-sm font-medium">{col.label}</span>
                <span className="text-xs text-[var(--muted)] ml-auto">{grouped[col.key]?.length || 0}</span>
              </div>

              <div className="space-y-2 min-h-[100px]">
                {(grouped[col.key] || []).map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onClick={() => openView(task)}
                    className={`p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)] cursor-grab active:cursor-grabbing hover:border-[var(--accent)]/50 transition ${
                      dragId === task.id ? 'opacity-40' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <p className="font-medium text-sm leading-snug flex-1">{task.title}</p>
                      {taskTypeBadge[task.type] && (
                        <span className="text-xs" title={taskTypeLabels[task.type]}>{taskTypeBadge[task.type]}</span>
                      )}
                    </div>
                    {task.description && (
                      <p className="text-xs text-[var(--muted)] line-clamp-2 mb-2">{task.description}</p>
                    )}
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`font-mono font-bold ${priorityColors[task.priority]}`}>
                        {priorityIcon[task.priority]}
                      </span>
                      <AssigneeChip
                        assigneeId={task.assigneeId}
                        assigneeType={task.assigneeType}
                        agents={agents}
                        users={users}
                      />
                      {task.deadline && (
                        <span className="text-[var(--muted)] ml-auto">
                          {new Date(task.deadline).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                {(grouped[col.key] || []).length === 0 && (
                  <div className="text-center py-8 text-[var(--muted)] text-xs">
                    Drop tasks here
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── View Task Modal ── */}
      {modalMode === 'view' && viewTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setModalMode(null)}>
          <div className="bg-[var(--card)] rounded-xl w-full max-w-[640px] mx-4 border border-[var(--border)] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="p-5 pb-0">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg font-bold truncate">{viewTask.title}</h2>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${statusColors[viewTask.status] || 'bg-gray-500/20 text-gray-400'}`}>
                      {viewTask.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <span className={priorityColors[viewTask.priority]}>{viewTask.priority}</span>
                    <span>&middot;</span>
                    <span>{taskTypeLabels[viewTask.type] || viewTask.type}</span>
                    {viewTask.cronExpression && (
                      <>
                        <span>&middot;</span>
                        <span className="font-mono bg-[var(--bg)] px-1.5 py-0.5 rounded">{viewTask.cronExpression}</span>
                      </>
                    )}
                    {viewTask.deadline && (
                      <>
                        <span>&middot;</span>
                        <span>Due: {new Date(viewTask.deadline).toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(viewTask); }}
                  className="p-2 rounded-lg hover:bg-[var(--hover)] transition shrink-0"
                  title="Edit task"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
                  </svg>
                </button>
                <button onClick={() => setModalMode(null)} className="p-2 rounded-lg hover:bg-[var(--hover)] transition shrink-0 text-[var(--muted)]">
                  &times;
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* Description */}
              {viewTask.description && (
                <div className="bg-[var(--bg)] rounded-lg p-3">
                  <p className="text-sm whitespace-pre-wrap">{viewTask.description}</p>
                </div>
              )}

              {/* Info row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[var(--bg)] rounded-lg p-3">
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider mb-1">Creator</div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${viewTask.creatorType === 'AGENT' ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-emerald-500/10 text-emerald-400'}`}>
                      {viewTask.creatorType}
                    </span>
                    <span className="text-sm">{resolveActor(viewTask.creatorType, viewTask.creatorId)}</span>
                  </div>
                </div>
                <div className="bg-[var(--bg)] rounded-lg p-3">
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider mb-1">Assignee</div>
                  <div className="flex items-center gap-2">
                    <AssigneeChip assigneeId={viewTask.assigneeId} assigneeType={viewTask.assigneeType} agents={agents} users={users} />
                  </div>
                </div>
              </div>

              {/* Parent task */}
              {viewTask.parentTask && (
                <button onClick={() => openView(viewTask.parentTask)} className="text-sm text-[var(--accent)] hover:underline">
                  &uarr; Parent: {viewTask.parentTask.title}
                </button>
              )}

              {/* Subtasks */}
              {viewTask.subtasks?.length > 0 && (
                <div>
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider mb-2">Subtasks ({viewTask.subtasks.length})</div>
                  <div className="space-y-1.5">
                    {viewTask.subtasks.map((s: any) => (
                      <button key={s.id} onClick={() => openView(s)} className="w-full flex items-center gap-2 p-2 bg-[var(--bg)] rounded-lg hover:bg-[var(--hover)] transition text-left">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${s.status === 'COMPLETED' ? 'bg-emerald-400' : s.status === 'IN_PROGRESS' ? 'bg-blue-400' : s.status === 'FAILED' ? 'bg-red-400' : (s.status === 'IN_REVIEW' || s.status === 'IN_TESTING' || s.status === 'VERIFIED') ? 'bg-purple-400' : 'bg-gray-400'}`} />
                        <span className="text-sm flex-1 truncate">{s.title}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColors[s.status] || ''}`}>{s.status}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Result */}
              {viewTask.result && (
                <div>
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider mb-2">Result</div>
                  <pre className="text-xs bg-[var(--bg)] rounded-lg p-3 max-h-32 overflow-auto">
                    {typeof viewTask.result === 'string' ? viewTask.result : JSON.stringify(viewTask.result, null, 2)}
                  </pre>
                </div>
              )}

              {/* Comments */}
              <div>
                <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider mb-3">
                  Comments ({viewTask.comments?.length || 0})
                </div>

                {viewLoading ? (
                  <p className="text-xs text-[var(--muted)]">Loading...</p>
                ) : viewTask.comments?.length > 0 ? (
                  <div className="space-y-3 mb-3 max-h-60 overflow-y-auto">
                    {viewTask.comments.map((c: any) => (
                      <div key={c.id} className="flex gap-2.5">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          c.authorType === 'AGENT' ? 'bg-[var(--accent)]/15 text-[var(--accent)]' :
                          c.authorType === 'SYSTEM' ? 'bg-gray-500/15 text-gray-400' :
                          'bg-emerald-500/15 text-emerald-400'
                        }`}>
                          {c.authorType === 'SYSTEM' ? 'S' : resolveActor(c.authorType, c.authorId)?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-medium">{resolveActor(c.authorType, c.authorId)}</span>
                            <span className="text-[10px] text-[var(--muted)]">{new Date(c.createdAt).toLocaleString()}</span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap text-[var(--muted)]">{c.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--muted)] mb-3">No comments yet.</p>
                )}

                {/* Add comment */}
                <div className="flex gap-2">
                  <input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAddComment()}
                    placeholder="Add a comment..."
                    className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                  />
                  <button
                    onClick={handleAddComment}
                    disabled={!commentText.trim() || sendingComment}
                    className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm shrink-0"
                  >
                    {sendingComment ? '...' : 'Send'}
                  </button>
                </div>
              </div>

              {/* Metadata */}
              <div className="text-[10px] text-[var(--muted)] flex gap-3 pt-2 border-t border-[var(--border)]">
                <span>Created: {new Date(viewTask.createdAt).toLocaleString()}</span>
                <span>Updated: {new Date(viewTask.updatedAt).toLocaleString()}</span>
                {viewTask.completedAt && <span>Done: {new Date(viewTask.completedAt).toLocaleString()}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      {(modalMode === 'create' || modalMode === 'edit') && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setModalMode(null)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[500px] mx-4 border border-[var(--border)] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold">
                  {editTask ? 'Edit Task' : 'New Task'}
                </h3>
                {editTask && (
                  <button onClick={() => { setModalMode('view'); if (!viewTask || viewTask.id !== editTask.id) openView(editTask); else setModalMode('view'); }}
                    className="text-xs text-[var(--muted)] hover:text-white">
                    &larr; Back
                  </button>
                )}
              </div>
              {editTask && (
                <select
                  value={editTask.status}
                  onChange={(e) => {
                    handleStatusChange(editTask.id, e.target.value);
                    setEditTask({ ...editTask, status: e.target.value });
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border-0 cursor-pointer ${
                    statusColors[editTask.status] || 'bg-gray-500/20 text-gray-400'
                  }`}
                >
                  <option value="PENDING">PENDING</option>
                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                  <option value="IN_REVIEW">IN_REVIEW</option>
                  <option value="IN_TESTING">IN_TESTING</option>
                  <option value="VERIFIED">VERIFIED</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="FAILED">FAILED</option>
                  <option value="BLOCKED">BLOCKED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Task title..."
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional description..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Task Type</label>
                <div className="flex gap-1">
                  {TASK_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setForm({ ...form, type: t })}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition border ${
                        form.type === t
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                          : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                      }`}
                    >
                      {taskTypeBadge[t] ? `${taskTypeBadge[t]} ` : ''}{taskTypeLabels[t]}
                    </button>
                  ))}
                </div>
              </div>

              {form.type === 'RECURRING' && (
                <CronBuilder
                  value={form.cronExpression}
                  onChange={(v) => setForm({ ...form, cronExpression: v })}
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Priority</label>
                  <div className="flex gap-1">
                    {PRIORITIES.map((p) => (
                      <button
                        key={p}
                        onClick={() => setForm({ ...form, priority: p })}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition border ${
                          form.priority === p
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                            : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                        } ${priorityColors[p]}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Deadline</label>
                  <input
                    type="datetime-local"
                    value={form.deadline}
                    onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Assign to</label>
                <div className="flex gap-2 mb-2">
                  {(['AGENT', 'HUMAN'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setForm({ ...form, assigneeType: t, assigneeId: t === 'AGENT' ? (agents[0]?.id || '') : (users[0]?.id || '') })}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition border ${
                        form.assigneeType === t
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                          : 'border-[var(--border)]'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <AvatarDropdown
                  value={form.assigneeId}
                  onChange={(id) => setForm({ ...form, assigneeId: id })}
                  placeholder={form.assigneeType === 'AGENT' ? 'Select agent...' : 'Select employee...'}
                  agents={form.assigneeType === 'AGENT' ? agents : []}
                  users={form.assigneeType === 'HUMAN' ? users : []}
                  full
                />
              </div>

              {formError && <p className="text-sm text-red-400">{formError}</p>}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setModalMode(null)} className="px-4 py-2 rounded-lg border border-[var(--border)]">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
                {saving ? 'Saving...' : editTask ? 'Save Changes' : 'Create Task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Friendly Cron Schedule Builder ─────────────────────────── */

const SCHEDULE_PRESETS = [
  { label: 'Every day', cron: '0 9 * * *', desc: 'Daily at 09:00' },
  { label: 'Every weekday', cron: '0 9 * * 1-5', desc: 'Mon-Fri at 09:00' },
  { label: 'Every Monday', cron: '0 9 * * 1', desc: 'Monday at 09:00' },
  { label: 'Every hour', cron: '0 * * * *', desc: 'At the start of each hour' },
  { label: 'Every 30 min', cron: '*/30 * * * *', desc: 'Every 30 minutes' },
  { label: 'Twice a day', cron: '0 9,18 * * *', desc: 'At 09:00 and 18:00' },
  { label: '1st of month', cron: '0 9 1 * *', desc: '1st day of month at 09:00' },
  { label: 'Custom', cron: '', desc: 'Write your own cron expression' },
] as const;

const DAYS_OF_WEEK = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

function parseCronToPreset(cron: string): string {
  const preset = SCHEDULE_PRESETS.find((p) => p.cron === cron);
  return preset ? preset.label : 'Custom';
}

function describeCron(cron: string): string {
  if (!cron) return '';
  const preset = SCHEDULE_PRESETS.find((p) => p.cron === cron);
  if (preset && preset.label !== 'Custom') return preset.desc;

  const parts = cron.split(/\s+/);
  if (parts.length !== 5) return 'Invalid expression';

  const [min, hour, day, month, weekday] = parts;
  const segments: string[] = [];

  if (min.startsWith('*/')) segments.push(`Every ${min.slice(2)} min`);
  else if (hour.startsWith('*/')) segments.push(`Every ${hour.slice(2)} hours`);
  else if (hour !== '*' && min !== '*') {
    const hours = hour.split(',');
    const timeStr = hours.map((h) => `${h.padStart(2, '0')}:${min.padStart(2, '0')}`).join(', ');
    segments.push(`At ${timeStr}`);
  }

  if (weekday !== '*') {
    const dayMap: Record<string, string> = { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat', '7': 'Sun' };
    if (weekday === '1-5') segments.push('Mon-Fri');
    else {
      const names = weekday.split(',').map((d) => dayMap[d] || d);
      segments.push(names.join(', '));
    }
  }

  if (day !== '*') {
    if (day === '1') segments.push('1st of month');
    else if (day === '15') segments.push('15th of month');
    else segments.push(`day ${day}`);
  }

  return segments.join(' | ') || cron;
}

function CronBuilder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [mode, setMode] = useState<string>(() => parseCronToPreset(value));
  const [showCustom, setShowCustom] = useState(false);

  // Simple builder state
  const [time, setTime] = useState(() => {
    if (!value) return '09:00';
    const parts = value.split(/\s+/);
    if (parts.length === 5 && parts[1] !== '*' && parts[0] !== '*' && !parts[0].startsWith('*/')) {
      return `${parts[1].split(',')[0].padStart(2, '0')}:${parts[0].padStart(2, '0')}`;
    }
    return '09:00';
  });

  const [selectedDays, setSelectedDays] = useState<number[]>(() => {
    if (!value) return [];
    const parts = value.split(/\s+/);
    if (parts.length === 5 && parts[4] !== '*') {
      if (parts[4] === '1-5') return [1, 2, 3, 4, 5];
      return parts[4].split(',').map(Number).filter((n) => !isNaN(n));
    }
    return [];
  });

  const handlePreset = (preset: typeof SCHEDULE_PRESETS[number]) => {
    setMode(preset.label);
    if (preset.label === 'Custom') {
      setShowCustom(true);
    } else {
      setShowCustom(false);
      onChange(preset.cron);
    }
  };

  const buildCronFromDaysTime = (days: number[], t: string) => {
    const [h, m] = t.split(':');
    const min = parseInt(m) || 0;
    const hour = parseInt(h) || 9;
    if (days.length === 0) return `${min} ${hour} * * *`;
    if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return `${min} ${hour} * * 1-5`;
    if (days.length === 7) return `${min} ${hour} * * *`;
    return `${min} ${hour} * * ${days.sort().join(',')}`;
  };

  const handleTimeChange = (t: string) => {
    setTime(t);
    setMode('Custom');
    setShowCustom(false);
    onChange(buildCronFromDaysTime(selectedDays, t));
  };

  const handleDayToggle = (day: number) => {
    const newDays = selectedDays.includes(day)
      ? selectedDays.filter((d) => d !== day)
      : [...selectedDays, day];
    setSelectedDays(newDays);
    setMode('Custom');
    setShowCustom(false);
    onChange(buildCronFromDaysTime(newDays, time));
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">Schedule</label>

      {/* Preset pills */}
      <div className="flex flex-wrap gap-1.5">
        {SCHEDULE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => handlePreset(p)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition border ${
              mode === p.label
                ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/50 hover:text-white'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Time + Days builder */}
      <div className="flex items-center gap-4">
        <div>
          <label className="block text-[10px] text-[var(--muted)] mb-1 uppercase tracking-wider">Time</label>
          <input
            type="time"
            value={time}
            onChange={(e) => handleTimeChange(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm w-28"
          />
        </div>
        <div className="flex-1">
          <label className="block text-[10px] text-[var(--muted)] mb-1 uppercase tracking-wider">Days</label>
          <div className="flex gap-1">
            {DAYS_OF_WEEK.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => handleDayToggle(d.value)}
                className={`flex-1 py-1.5 rounded text-[10px] font-medium transition border ${
                  selectedDays.includes(d.value)
                    ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
                    : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/50'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Custom cron input (collapsible) */}
      {showCustom && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="* * * * *"
          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] font-mono text-sm"
        />
      )}

      {/* Human-readable description */}
      {value && (
        <p className="text-xs text-[var(--accent)]">{describeCron(value)}</p>
      )}
    </div>
  );
}

/* ── Avatar helpers ──────────────────────────────────────────── */

function MiniAvatar({ src, name, size = 20 }: { src?: string; name: string; size?: number }) {
  if (src && src.startsWith('/')) {
    return <img src={src} alt={name} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  }
  if (src) {
    return <span className="shrink-0 leading-none" style={{ fontSize: size * 0.75 }}>{src}</span>;
  }
  return (
    <span
      className="rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-[var(--accent)] font-medium shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {name?.charAt(0)?.toUpperCase() || '?'}
    </span>
  );
}

/* ── Assignee chip (for task cards) ──────────────────────────── */

function AssigneeChip({ assigneeId, assigneeType, agents, users }: {
  assigneeId: string; assigneeType: string; agents: any[]; users: any[];
}) {
  if (assigneeType === 'AGENT') {
    const a = agents.find((x) => x.id === assigneeId);
    if (!a) return <span className="text-[var(--muted)] truncate">{assigneeId?.substring(0, 8)}</span>;
    const pos = a.positions?.[0]?.title;
    return (
      <span className="flex items-center gap-1.5 truncate text-[var(--muted)]">
        <MiniAvatar src={a.avatar} name={a.name} size={16} />
        <span className="truncate">{a.name}{pos ? <span className="opacity-60"> · {pos}</span> : ''}</span>
      </span>
    );
  }
  const u = users.find((x) => x.id === assigneeId);
  if (!u) return <span className="text-[var(--muted)] truncate">{assigneeId?.substring(0, 8)}</span>;
  return (
    <span className="flex items-center gap-1.5 truncate text-[var(--muted)]">
      <MiniAvatar src={u.avatarUrl} name={u.name} size={16} />
      <span className="truncate">{u.name}</span>
    </span>
  );
}

/* ── Custom dropdown with avatars ────────────────────────────── */

function AvatarDropdown({ value, onChange, placeholder, agents, users, showSystem, full }: {
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  agents: any[];
  users: any[];
  showSystem?: boolean;
  full?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Find selected item
  const selectedAgent = agents.find((a) => a.id === value);
  const selectedUser = users.find((u) => u.id === value);
  const selectedPos = selectedAgent?.positions?.[0]?.title;
  const selectedLabel = selectedAgent
    ? (selectedPos ? `${selectedAgent.name} · ${selectedPos}` : selectedAgent.name)
    : selectedUser
      ? selectedUser.name
      : value === 'system'
        ? 'System'
        : null;
  const selectedAvatar = selectedAgent?.avatar || selectedUser?.avatarUrl;

  return (
    <div ref={ref} className={`relative ${full ? 'w-full' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm hover:border-[var(--accent)]/50 transition ${full ? 'w-full' : ''}`}
      >
        {selectedLabel ? (
          <>
            <MiniAvatar src={selectedAvatar} name={selectedLabel} size={18} />
            <span className="truncate">{selectedLabel}</span>
          </>
        ) : (
          <span className="text-[var(--muted)]">{placeholder}</span>
        )}
        <span className="ml-auto text-[var(--muted)] text-xs">{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 left-0 w-64 max-h-72 overflow-y-auto bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-xl">
          {/* Reset option */}
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--card-hover)] transition"
          >
            {placeholder}
          </button>

          {/* Agents */}
          {agents.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] text-[var(--muted)] uppercase tracking-wider border-t border-[var(--border)]">Agents</div>
              {agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => { onChange(a.id); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--card-hover)] transition ${value === a.id ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : ''}`}
                >
                  <MiniAvatar src={a.avatar} name={a.name} size={22} />
                  <div className="flex flex-col items-start truncate">
                    <span className="truncate">{a.name}</span>
                    {a.positions?.[0]?.title && <span className="text-[10px] text-[var(--muted)] truncate">{a.positions[0].title}</span>}
                  </div>
                </button>
              ))}
            </>
          )}

          {/* Users */}
          {users.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] text-[var(--muted)] uppercase tracking-wider border-t border-[var(--border)]">Employees</div>
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => { onChange(u.id); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--card-hover)] transition ${value === u.id ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : ''}`}
                >
                  <MiniAvatar src={u.avatarUrl} name={u.name} size={22} />
                  <span className="truncate">{u.name}</span>
                  <span className="text-[10px] text-[var(--muted)] ml-auto truncate max-w-[100px]">{u.email}</span>
                </button>
              ))}
            </>
          )}

          {/* System option */}
          {showSystem && (
            <>
              <div className="border-t border-[var(--border)]" />
              <button
                type="button"
                onClick={() => { onChange('system'); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--card-hover)] transition ${value === 'system' ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : ''}`}
              >
                <span className="shrink-0 text-base">&#9881;</span>
                <span>System</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
