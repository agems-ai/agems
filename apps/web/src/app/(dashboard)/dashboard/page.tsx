'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

/* ═══════════════════════════════════════════════════════════
   Agent Activity Dashboard
   ═══════════════════════════════════════════════════════════ */

function timeAgo(date: string | Date): string {
  const now = Date.now();
  const d = new Date(date).getTime();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function duration(startedAt: string): string {
  const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

const statusConfig: Record<string, { icon: string; color: string; bg: string }> = {
  RUNNING: { icon: '\u25CF', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  COMPLETED: { icon: '\u2713', color: 'text-green-400', bg: 'bg-green-500/5 border-green-500/20' },
  FAILED: { icon: '\u2717', color: 'text-red-400', bg: 'bg-red-500/5 border-red-500/20' },
  CANCELLED: { icon: '\u25CB', color: 'text-gray-400', bg: 'bg-gray-500/5 border-gray-500/20' },
  WAITING_HITL: { icon: '\u23F3', color: 'text-amber-400', bg: 'bg-amber-500/5 border-amber-500/20' },
};

const triggerLabels: Record<string, string> = {
  TASK: 'Task', MESSAGE: 'Message', SCHEDULE: 'Schedule', EVENT: 'Event/Goal',
  MANUAL: 'Manual', MEETING: 'Meeting', TELEGRAM: 'Telegram', APPROVAL: 'Approval',
};

export default function DashboardPage() {
  const [activity, setActivity] = useState<{ running: any[]; recent: any[] }>({ running: [], recent: [] });
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const fetchData = useCallback(async () => {
    try {
      const [act, st] = await Promise.all([
        api.getActivity(),
        api.getSystemStats(),
      ]);
      setActivity(act);
      setStats(st);
      setLastRefresh(Date.now());
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // refresh every 5s
    return () => clearInterval(interval);
  }, [fetchData]);

  // Force re-render for "running for" timer
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
          <p className="text-[var(--muted)] text-sm">Real-time agent activity monitor</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-[var(--muted)]">Live</span>
        </div>
      </div>

      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Active Agents', value: stats.agents?.byStatus?.find((s: any) => s.label === 'ACTIVE')?.value || 0, color: 'text-emerald-400' },
            { label: 'Pending Tasks', value: stats.tasks?.byStatus?.find((s: any) => s.label === 'PENDING')?.value || 0, color: 'text-amber-400' },
            { label: 'Executions (7d)', value: stats.executions?.recent || 0, color: 'text-blue-400' },
            { label: 'Pending Approvals', value: stats.pendingApprovals || 0, color: 'text-purple-400' },
          ].map((s, i) => (
            <div key={i} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-[var(--muted)]">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Running Now */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <h2 className="text-lg font-semibold">Running Now</h2>
          <span className="text-xs text-[var(--muted)]">({activity.running.length})</span>
        </div>

        {activity.running.length === 0 ? (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center">
            <p className="text-[var(--muted)] text-sm">No agents are executing right now</p>
            <p className="text-[var(--muted)] text-xs mt-1">Activity will appear here in real-time when agents work</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activity.running.map((exec: any) => {
              const cfg = statusConfig.RUNNING;
              return (
                <div key={exec.id} className={`border rounded-xl p-4 ${cfg.bg} animate-pulse-slow`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`text-lg ${cfg.color}`}>{cfg.icon}</span>
                      <div>
                        <span className="font-semibold">{exec.agent?.name || 'Agent'}</span>
                        <span className="text-[var(--muted)] text-sm ml-2">
                          {triggerLabels[exec.triggerType] || exec.triggerType}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-mono text-emerald-400">{duration(exec.startedAt)}</div>
                      {exec.tokensUsed > 0 && (
                        <div className="text-xs text-[var(--muted)]">{exec.tokensUsed} tokens</div>
                      )}
                    </div>
                  </div>
                  {exec.triggerId && (
                    <div className="text-xs text-[var(--muted)] mt-1 ml-7 font-mono truncate">
                      ID: {exec.triggerId}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Recent Activity</h2>

        {activity.recent.length === 0 && !loading ? (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center">
            <p className="text-[var(--muted)] text-sm">No recent agent activity</p>
          </div>
        ) : (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
            {activity.recent.map((exec: any, i: number) => {
              const cfg = statusConfig[exec.status] || statusConfig.COMPLETED;
              const costStr = exec.costUsd ? `$${exec.costUsd.toFixed(4)}` : '';
              return (
                <div key={exec.id}
                  className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-[var(--border)]' : ''} hover:bg-[var(--hover)] transition`}>
                  <span className={`text-sm ${cfg.color}`}>{cfg.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{exec.agent?.name || 'Agent'}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg)] text-[var(--muted)]">
                        {triggerLabels[exec.triggerType] || exec.triggerType}
                      </span>
                      {exec.tokensUsed > 0 && (
                        <span className="text-xs text-[var(--muted)]">{exec.tokensUsed} tok</span>
                      )}
                      {costStr && (
                        <span className="text-xs text-[var(--muted)]">{costStr}</span>
                      )}
                    </div>
                    {exec.error && (
                      <p className="text-xs text-red-400 truncate mt-0.5">{exec.error}</p>
                    )}
                  </div>
                  <span className="text-xs text-[var(--muted)] whitespace-nowrap">{timeAgo(exec.startedAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
