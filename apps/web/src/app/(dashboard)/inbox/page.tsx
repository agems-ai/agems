'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';

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

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Tab = 'unread' | 'all';

export default function InboxPage() {
  const router = useRouter();
  const [unreadTasks, setUnreadTasks] = useState<any[]>([]);
  const [allTasks, setAllTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('unread');
  const [markingAll, setMarkingAll] = useState(false);
  const [markingIds, setMarkingIds] = useState<Set<string>>(new Set());
  const [agents, setAgents] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  const nameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of agents) m[a.id] = a.name;
    for (const u of users) m[u.id] = u.name || u.email;
    return m;
  }, [agents, users]);

  const unreadIds = useMemo(() => {
    return new Set(unreadTasks.map(t => t.id));
  }, [unreadTasks]);

  const loadData = useCallback(async () => {
    try {
      const [inbox, all, agentRes, userRes] = await Promise.all([
        api.getInbox(),
        api.getTasks({ pageSize: '50', sort: 'updatedAt' }),
        api.getAgents().catch(() => ({ data: [] })),
        api.getUsers().catch(() => []),
      ]);
      setUnreadTasks(Array.isArray(inbox) ? inbox : []);
      setAllTasks(Array.isArray(all) ? all : all.data || []);
      setAgents(Array.isArray(agentRes) ? agentRes : agentRes.data || []);
      setUsers(Array.isArray(userRes) ? userRes : []);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleMarkRead = useCallback(async (taskId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setMarkingIds(prev => new Set(prev).add(taskId));
    try {
      await api.markTaskRead(taskId);
      setUnreadTasks(prev => prev.filter(t => t.id !== taskId));
    } catch {
      /* noop */
    } finally {
      setMarkingIds(prev => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    setMarkingAll(true);
    try {
      await api.markAllTasksRead();
      setUnreadTasks([]);
    } catch {
      /* noop */
    } finally {
      setMarkingAll(false);
    }
  }, []);

  const handleTaskClick = useCallback(async (task: any) => {
    if (unreadIds.has(task.id)) {
      api.markTaskRead(task.id).catch(() => {});
      setUnreadTasks(prev => prev.filter(t => t.id !== task.id));
    }
    router.push(`/tasks/${task.id}`);
  }, [router, unreadIds]);

  const resolveName = useCallback((id: string | null) => {
    if (!id) return null;
    return nameMap[id] || id.slice(0, 8);
  }, [nameMap]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded" style={{ background: 'var(--card)' }} />
          <div className="h-10 w-72 rounded" style={{ background: 'var(--card)' }} />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 rounded-lg" style={{ background: 'var(--card)' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Inbox</h1>
          {unreadTasks.length > 0 && (
            <span
              className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {unreadTasks.length}
            </span>
          )}
        </div>
        {unreadTasks.length > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{
              border: '1px solid var(--border)',
              opacity: markingAll ? 0.5 : 1,
            }}
          >
            {markingAll ? 'Marking...' : 'Mark All Read'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-lg" style={{ background: 'var(--card)' }}>
        {([
          { key: 'unread' as Tab, label: 'Unread', count: unreadTasks.length },
          { key: 'all' as Tab, label: 'All Activity', count: allTasks.length },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all"
            style={{
              background: activeTab === tab.key ? 'var(--card-hover)' : 'transparent',
              color: activeTab === tab.key ? '#fff' : 'var(--muted)',
              border: activeTab === tab.key ? '1px solid var(--border)' : '1px solid transparent',
            }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1.5 text-xs opacity-60">({tab.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Unread Tab */}
      {activeTab === 'unread' && (
        <div className="space-y-2">
          {unreadTasks.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-16 rounded-xl"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mb-4 text-3xl"
                style={{ background: 'var(--success)', opacity: 0.15 }}
              >
                <span style={{ color: 'var(--success)', opacity: 1 }}>&#10003;</span>
              </div>
              <p className="text-lg font-semibold mb-1">All caught up!</p>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                No unread tasks in your inbox.
              </p>
            </div>
          ) : (
            unreadTasks.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                isUnread={true}
                marking={markingIds.has(task.id)}
                onMarkRead={handleMarkRead}
                onClick={handleTaskClick}
                resolveName={resolveName}
              />
            ))
          )}
        </div>
      )}

      {/* All Activity Tab */}
      {activeTab === 'all' && (
        <div className="space-y-2">
          {allTasks.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-16 rounded-xl"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
            >
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                No recent activity.
              </p>
            </div>
          ) : (
            allTasks.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                isUnread={unreadIds.has(task.id)}
                marking={markingIds.has(task.id)}
                onMarkRead={handleMarkRead}
                onClick={handleTaskClick}
                resolveName={resolveName}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  isUnread,
  marking,
  onMarkRead,
  onClick,
  resolveName,
}: {
  task: any;
  isUnread: boolean;
  marking: boolean;
  onMarkRead: (id: string, e?: React.MouseEvent) => void;
  onClick: (task: any) => void;
  resolveName: (id: string | null) => string | null;
}) {
  const assigneeName = resolveName(task.assigneeId);
  const statusClass = statusColors[task.status] || statusColors.PENDING;
  const prioColor = priorityColors[task.priority] || priorityColors.MEDIUM;
  const prioLabel = priorityIcon[task.priority] || '!';

  return (
    <div
      onClick={() => onClick(task)}
      className="flex items-center gap-4 px-4 py-3 rounded-lg cursor-pointer transition-colors group"
      style={{
        background: isUnread ? 'var(--card-hover)' : 'var(--card)',
        border: '1px solid var(--border)',
        borderLeft: isUnread ? '3px solid var(--accent)' : '3px solid transparent',
      }}
    >
      {/* Unread dot */}
      <div className="flex-shrink-0 w-2.5">
        {isUnread && (
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: 'var(--accent)' }}
          />
        )}
      </div>

      {/* Task info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className={`text-sm truncate ${isUnread ? 'font-semibold' : 'font-normal'}`}
            style={{ color: isUnread ? '#fff' : 'var(--muted)' }}
          >
            {task.title}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
          {assigneeName && <span>{assigneeName}</span>}
          {assigneeName && <span>-</span>}
          <span>{formatDate(task.createdAt)}</span>
          <span>-</span>
          <span>{timeAgo(task.createdAt)}</span>
        </div>
      </div>

      {/* Priority */}
      <span className={`text-xs font-mono font-bold flex-shrink-0 ${prioColor}`}>
        {prioLabel}
      </span>

      {/* Status badge */}
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${statusClass}`}
      >
        {task.status?.replace(/_/g, ' ')}
      </span>

      {/* Mark as read button */}
      {isUnread && (
        <button
          onClick={(e) => onMarkRead(task.id, e)}
          disabled={marking}
          className="flex-shrink-0 px-2 py-1 rounded text-xs transition-opacity opacity-0 group-hover:opacity-100"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            color: 'var(--muted)',
          }}
          title="Mark as Read"
        >
          {marking ? '...' : 'Read'}
        </button>
      )}
    </div>
  );
}
