'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

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

const typeLabels: Record<string, string> = {
  ONE_TIME: 'One-time',
  RECURRING: 'Recurring',
  CONTINUOUS: 'Continuous',
};

export default function TaskDetailPage() {
  const params = useParams();
  const [task, setTask] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [sending, setSending] = useState(false);

  const loadTask = useCallback(async () => {
    if (!params.id) return;
    const data = await api.getTask(params.id as string);
    setTask(data);
  }, [params.id]);

  useEffect(() => {
    Promise.all([
      loadTask(),
      api.fetch('/agents').then((r: any) => setAgents(r.data || r || [])).catch(() => {}),
      api.getUsers().then((r: any) => setUsers(r || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [loadTask]);

  const resolveActor = (type: string, id: string) => {
    if (type === 'AGENT') {
      const a = agents.find((a: any) => a.id === id);
      if (!a) return id.substring(0, 8) + '...';
      const pos = a.positions?.[0]?.title;
      return pos ? `${a.name} · ${pos}` : a.name;
    }
    if (type === 'HUMAN') {
      const u = users.find((u: any) => u.id === id);
      return u ? u.name : id.substring(0, 8) + '...';
    }
    return type === 'SYSTEM' ? 'System' : id.substring(0, 8) + '...';
  };

  const handleAddComment = async () => {
    if (!commentText.trim() || !params.id) return;
    setSending(true);
    try {
      await api.addTaskComment(params.id as string, commentText.trim());
      setCommentText('');
      await loadTask();
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading task...</div>;
  if (!task) return <div className="p-8 text-red-400">Task not found</div>;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <Link href="/tasks" className="text-sm text-[var(--muted)] hover:text-white mb-4 inline-block">&larr; Back to tasks</Link>

      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">{task.title}</h1>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[task.status] || ''}`}>
              {task.status}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
            <span className={priorityColors[task.priority] || ''}>{task.priority}</span>
            <span>&middot;</span>
            <span>{typeLabels[task.type] || task.type}</span>
            {task.cronExpression && (
              <>
                <span>&middot;</span>
                <span className="font-mono text-xs bg-[var(--bg)] px-2 py-0.5 rounded">{task.cronExpression}</span>
              </>
            )}
            {task.deadline && (
              <>
                <span>&middot;</span>
                <span>Due: {new Date(task.deadline).toLocaleDateString()}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      {task.description && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 mb-4">
          <h3 className="font-semibold mb-2 text-sm text-[var(--muted)] uppercase tracking-wider">Description</h3>
          <p className="text-sm whitespace-pre-wrap">{task.description}</p>
        </div>
      )}

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          <h3 className="font-semibold mb-2 text-[10px] text-[var(--muted)] uppercase tracking-wider">Creator</h3>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${task.creatorType === 'AGENT' ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-emerald-500/10 text-emerald-400'}`}>
              {task.creatorType}
            </span>
            <span className="text-sm font-medium">{resolveActor(task.creatorType, task.creatorId)}</span>
          </div>
        </div>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          <h3 className="font-semibold mb-2 text-[10px] text-[var(--muted)] uppercase tracking-wider">Assignee</h3>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${task.assigneeType === 'AGENT' ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-emerald-500/10 text-emerald-400'}`}>
              {task.assigneeType}
            </span>
            <span className="text-sm font-medium">{resolveActor(task.assigneeType, task.assigneeId)}</span>
          </div>
        </div>
      </div>

      {/* Parent task */}
      {task.parentTask && (
        <div className="mb-4">
          <Link href={`/tasks/${task.parentTask.id}`} className="text-sm text-[var(--accent)] hover:underline">
            &uarr; Parent: {task.parentTask.title}
          </Link>
        </div>
      )}

      {/* Subtasks */}
      {task.subtasks?.length > 0 && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 mb-4">
          <h3 className="font-semibold mb-3 text-sm text-[var(--muted)] uppercase tracking-wider">Subtasks ({task.subtasks.length})</h3>
          <div className="space-y-2">
            {task.subtasks.map((s: any) => (
              <Link key={s.id} href={`/tasks/${s.id}`} className="flex items-center gap-3 p-2.5 bg-[var(--bg)] rounded-lg hover:bg-[var(--hover)] transition">
                <span className={`w-2 h-2 rounded-full shrink-0 ${s.status === 'COMPLETED' ? 'bg-emerald-400' : s.status === 'IN_PROGRESS' ? 'bg-blue-400' : s.status === 'FAILED' ? 'bg-red-400' : 'bg-gray-400'}`} />
                <span className="text-sm flex-1">{s.title}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColors[s.status] || ''}`}>{s.status}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Result */}
      {task.result && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 mb-4">
          <h3 className="font-semibold mb-2 text-sm text-[var(--muted)] uppercase tracking-wider">Result</h3>
          <pre className="text-xs bg-[var(--bg)] rounded-lg p-3 max-h-40 overflow-auto">
            {typeof task.result === 'string' ? task.result : JSON.stringify(task.result, null, 2)}
          </pre>
        </div>
      )}

      {/* Comments */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
        <h3 className="font-semibold mb-4 text-sm text-[var(--muted)] uppercase tracking-wider">
          Comments ({task.comments?.length || 0})
        </h3>

        {task.comments?.length > 0 ? (
          <div className="space-y-3 mb-4">
            {task.comments.map((c: any) => (
              <div key={c.id} className="flex gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                  c.authorType === 'AGENT' ? 'bg-[var(--accent)]/15 text-[var(--accent)]' :
                  c.authorType === 'SYSTEM' ? 'bg-gray-500/15 text-gray-400' :
                  'bg-emerald-500/15 text-emerald-400'
                }`}>
                  {c.authorType === 'SYSTEM' ? 'S' : resolveActor(c.authorType, c.authorId)?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium">{resolveActor(c.authorType, c.authorId)}</span>
                    <span className="text-[10px] text-[var(--muted)]">
                      {new Date(c.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap text-[var(--muted)]">{c.content}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)] mb-4">No comments yet.</p>
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
            disabled={!commentText.trim() || sending}
            className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm shrink-0"
          >
            {sending ? '...' : 'Comment'}
          </button>
        </div>
      </div>

      {/* Metadata */}
      <div className="mt-4 text-[10px] text-[var(--muted)] flex gap-4">
        <span>Created: {new Date(task.createdAt).toLocaleString()}</span>
        <span>Updated: {new Date(task.updatedAt).toLocaleString()}</span>
        {task.completedAt && <span>Completed: {new Date(task.completedAt).toLocaleString()}</span>}
        <span className="font-mono">{task.id}</span>
      </div>
    </div>
  );
}
