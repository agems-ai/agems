'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import { getCommsSocket } from '@/lib/socket';
import ApprovalCard from '@/components/ApprovalCard';

const STATUS_TABS = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'EXPIRED', label: 'Expired' },
  { key: '', label: 'All' },
] as const;

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  // Filters
  const [statusTab, setStatusTab] = useState('PENDING');
  const [filterAgent, setFilterAgent] = useState('');
  const [filterApprover, setFilterApprover] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterRisk, setFilterRisk] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkActing, setBulkActing] = useState(false);

  // Build lookup maps for agent/user names
  const nameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of agents) m[a.id] = a.positions?.[0]?.title ? `${a.name} · ${a.positions[0].title}` : a.name;
    for (const u of users) m[u.id] = u.name || u.email;
    return m;
  }, [agents, users]);

  const resolveName = useCallback((type: string | null, id: string | null) => {
    if (!id) return null;
    if (type === 'SYSTEM') return 'System';
    return nameMap[id] || (type === 'HUMAN' ? 'Admin' : id.slice(0, 8));
  }, [nameMap]);

  const loadApprovals = useCallback(async () => {
    const params: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
    if (statusTab) params.status = statusTab;
    if (filterAgent) params.agentId = filterAgent;
    if (filterCategory) params.category = filterCategory;
    if (filterRisk) params.riskLevel = filterRisk;
    if (filterApprover) params.requestedFromId = filterApprover;

    try {
      const res = await api.getApprovals(params);
      setApprovals(res.data || []);
      setTotal(res.total || 0);
    } catch { /* noop */ }
    setLoading(false);
  }, [page, statusTab, filterAgent, filterApprover, filterCategory, filterRisk]);

  const loadPendingCount = useCallback(async () => {
    try {
      const res = await api.getPendingApprovalCount();
      setPendingCount(res.count);
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    api.getAgents().then((r: any) => setAgents(r.data || []));
    api.getUsers?.().then((r: any) => setUsers(r.data || r || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    loadApprovals();
    loadPendingCount();
  }, [loadApprovals, loadPendingCount]);

  // WebSocket for real-time updates
  useEffect(() => {
    const socket = getCommsSocket();
    socket.connect();
    socket.on('approval_new', () => { loadApprovals(); loadPendingCount(); });
    socket.on('approval_resolved', () => { loadApprovals(); loadPendingCount(); });
    socket.on('approval_count', (data: { count: number }) => setPendingCount(data.count));
    return () => {
      socket.off('approval_new');
      socket.off('approval_resolved');
      socket.off('approval_count');
      socket.disconnect();
    };
  }, [loadApprovals, loadPendingCount]);

  const handleResolved = () => {
    loadApprovals();
    loadPendingCount();
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const pendingIds = approvals.filter((a) => a.status === 'PENDING').map((a) => a.id);
    if (selected.size === pendingIds.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingIds));
    }
  };

  const handleBulkApprove = async () => {
    if (selected.size === 0) return;
    setBulkActing(true);
    try {
      await api.bulkApprove([...selected]);
      setSelected(new Set());
      handleResolved();
    } catch { /* noop */ }
    setBulkActing(false);
  };

  const handleBulkReject = async () => {
    if (selected.size === 0) return;
    setBulkActing(true);
    try {
      await api.bulkReject([...selected]);
      setSelected(new Set());
      handleResolved();
    } catch { /* noop */ }
    setBulkActing(false);
  };

  const hasFilters = filterAgent || filterApprover || filterCategory || filterRisk;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Approvals</h1>
          <p className="text-[var(--muted)] mt-1">
            {pendingCount > 0 ? `${pendingCount} pending` : 'No pending approvals'}
          </p>
        </div>
        {pendingCount > 0 && (
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-500/20 text-amber-400 font-bold text-lg">
            {pendingCount}
          </div>
        )}
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 border-b border-[var(--border)] pb-2 overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setStatusTab(tab.key); setPage(1); setSelected(new Set()); }}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition ${
              statusTab === tab.key
                ? 'bg-[var(--accent)]/10 text-[var(--accent)] border-b-2 border-[var(--accent)]'
                : 'text-[var(--muted)] hover:text-white'
            }`}
          >
            {tab.label}
            {tab.key === 'PENDING' && pendingCount > 0 && (
              <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={filterAgent}
          onChange={(e) => { setFilterAgent(e.target.value); setPage(1); }}
          className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
        >
          <option value="">From: All</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}{a.positions?.[0]?.title ? ` · ${a.positions[0].title}` : ''}</option>
          ))}
        </select>

        <select
          value={filterApprover}
          onChange={(e) => { setFilterApprover(e.target.value); setPage(1); }}
          className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
        >
          <option value="">To: All</option>
          <optgroup label="Agents">
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.positions?.[0]?.title ? ` · ${a.positions[0].title}` : ''}</option>
            ))}
          </optgroup>
          {users.length > 0 && (
            <optgroup label="Humans">
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name || u.email}</option>
              ))}
            </optgroup>
          )}
        </select>

        <select
          value={filterCategory}
          onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
          className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
        >
          <option value="">All categories</option>
          {['READ', 'WRITE', 'DELETE', 'EXECUTE', 'SEND', 'ADMIN'].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select
          value={filterRisk}
          onChange={(e) => { setFilterRisk(e.target.value); setPage(1); }}
          className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
        >
          <option value="">All risk levels</option>
          {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        {hasFilters && (
          <button
            onClick={() => { setFilterAgent(''); setFilterApprover(''); setFilterCategory(''); setFilterRisk(''); setPage(1); }}
            className="text-xs text-[var(--muted)] hover:text-white px-2 py-1 rounded border border-[var(--border)]"
          >
            Clear filters
          </button>
        )}

        <span className="text-xs text-[var(--muted)] ml-auto">{total} total</span>
      </div>

      {/* Bulk actions */}
      {statusTab === 'PENDING' && approvals.some((a) => a.status === 'PENDING') && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <button
            onClick={selectAll}
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-white transition"
          >
            {selected.size === approvals.filter((a) => a.status === 'PENDING').length ? 'Deselect all' : 'Select all'}
          </button>
          {selected.size > 0 && (
            <>
              <span className="text-xs text-[var(--muted)]">{selected.size} selected</span>
              <button
                onClick={handleBulkApprove}
                disabled={bulkActing}
                className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-medium hover:bg-emerald-600 disabled:opacity-40 transition"
              >
                Approve all
              </button>
              <button
                onClick={handleBulkReject}
                disabled={bulkActing}
                className="px-3 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-medium hover:bg-red-500/30 disabled:opacity-40 transition"
              >
                Reject all
              </button>
            </>
          )}
        </div>
      )}

      {/* Approval list */}
      {loading ? (
        <div className="text-center text-[var(--muted)] py-20">Loading approvals...</div>
      ) : approvals.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-4">&#9989;</p>
          <p className="text-lg font-medium text-[var(--muted)]">
            {statusTab === 'PENDING' ? 'No pending approvals' : 'No approvals found'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((approval) => (
            <div key={approval.id} className="flex items-start gap-3">
              {statusTab === 'PENDING' && approval.status === 'PENDING' && (
                <input
                  type="checkbox"
                  checked={selected.has(approval.id)}
                  onChange={() => toggleSelect(approval.id)}
                  className="mt-4 rounded"
                />
              )}
              <div className="flex-1">
                <ApprovalCard
                  approval={approval}
                  agentName={nameMap[approval.agentId] || 'Unknown Agent'}
                  requestedFromName={resolveName(approval.requestedFromType, approval.requestedFromId)}
                  resolvedByName={resolveName(approval.resolvedByType, approval.resolvedById)}
                  onResolved={handleResolved}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-sm text-[var(--muted)]">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
