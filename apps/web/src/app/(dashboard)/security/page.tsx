'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

const actionColors: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-700',
  UPDATE: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700',
  LOGIN: 'bg-purple-100 text-purple-700',
  EXECUTE: 'bg-yellow-100 text-yellow-700',
  ACTIVATE: 'bg-emerald-100 text-emerald-700',
  PAUSE: 'bg-orange-100 text-orange-700',
};

export default function SecurityPage() {
  const [tab, setTab] = useState<'audit' | 'rules'>('audit');
  const [logs, setLogs] = useState<any[]>([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ actorType: '', action: '', from: '', to: '' });
  const [agents, setAgents] = useState<any[]>([]);
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [ruleForm, setRuleForm] = useState({ agentId: '', resourceType: '', permissionLevel: 'READ', grantedByType: 'HUMAN', grantedById: '' });

  const loadAudit = async () => {
    const params: Record<string, string> = { page: page.toString() };
    if (filters.actorType) params.actorType = filters.actorType;
    if (filters.action) params.action = filters.action;
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    const res = await api.getAuditLogs(params);
    setLogs(res.data || []);
    setTotalLogs(res.total || 0);
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadAudit(),
      api.getAccessRules().then(setRules),
      api.getAgents().then((r: any) => setAgents(r.data || [])),
    ]).finally(() => setLoading(false));
  }, [page, filters]);

  const handleCreateRule = async () => {
    if (!ruleForm.agentId || !ruleForm.resourceType) return;
    const rule = await api.createAccessRule(ruleForm);
    setRules((prev) => [rule, ...prev]);
    setShowCreateRule(false);
    setRuleForm({ agentId: '', resourceType: '', permissionLevel: 'READ', grantedByType: 'HUMAN', grantedById: '' });
  };

  const handleDeleteRule = async (id: string) => {
    await api.deleteAccessRule(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-1">Audit & Security</h1>
          <p className="text-[var(--muted)]">Activity log, access rules, and compliance</p>
        </div>
        {tab === 'rules' && (
          <button onClick={() => setShowCreateRule(true)} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90">
            + New Rule
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[var(--card)] p-1 rounded-lg border border-[var(--border)] w-fit">
        <button onClick={() => setTab('audit')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition ${tab === 'audit' ? 'bg-[var(--accent)] text-white' : 'hover:bg-[var(--hover)]'}`}>
          Audit Log ({totalLogs})
        </button>
        <button onClick={() => setTab('rules')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition ${tab === 'rules' ? 'bg-[var(--accent)] text-white' : 'hover:bg-[var(--hover)]'}`}>
          Access Rules ({rules.length})
        </button>
      </div>

      {tab === 'audit' ? (
        <>
          {/* Filters */}
          <div className="flex gap-3 mb-4 flex-wrap">
            <select value={filters.actorType} onChange={(e) => setFilters({ ...filters, actorType: e.target.value })}
              className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm">
              <option value="">All actors</option>
              <option value="HUMAN">Human</option>
              <option value="AGENT">Agent</option>
              <option value="SYSTEM">System</option>
            </select>
            <select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm">
              <option value="">All actions</option>
              <option value="CREATE">Create</option>
              <option value="UPDATE">Update</option>
              <option value="DELETE">Delete</option>
              <option value="LOGIN">Login</option>
              <option value="EXECUTE">Execute</option>
            </select>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm" placeholder="From" />
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm" placeholder="To" />
          </div>

          {loading ? (
            <p className="text-[var(--muted)]">Loading...</p>
          ) : logs.length === 0 ? (
            <p className="text-[var(--muted)] text-center py-10">No audit records found</p>
          ) : (
            <>
              <div className="space-y-2">
                {logs.map((log) => (
                  <div key={log.id} className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-3 md:p-4 flex items-start md:items-center gap-2 md:gap-4 flex-wrap md:flex-nowrap">
                    <div className="text-xs text-[var(--muted)] w-auto md:w-36 shrink-0">
                      {new Date(log.createdAt).toLocaleString()}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium w-16 text-center shrink-0 ${actionColors[log.action] || 'bg-gray-100'}`}>
                      {log.action}
                    </span>
                    <div className="flex-1 text-sm min-w-0 w-full md:w-auto">
                      <span className="font-medium">{log.actorType}</span>
                      <span className="text-[var(--muted)]"> ({log.actorId.slice(0, 8)}...) </span>
                      <span className="text-[var(--muted)]">{log.resourceType}</span>
                      <span className="text-[var(--muted)]"> {log.resourceId.slice(0, 8)}...</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-center gap-4 mt-6">
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                  className="px-3 py-1.5 rounded border border-[var(--border)] text-sm disabled:opacity-40">Prev</button>
                <span className="text-sm text-[var(--muted)]">Page {page}</span>
                <button onClick={() => setPage(page + 1)} disabled={logs.length < 50}
                  className="px-3 py-1.5 rounded border border-[var(--border)] text-sm disabled:opacity-40">Next</button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {rules.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
              <p className="text-4xl mb-4">🔐</p>
              <p className="text-lg font-medium mb-2">No access rules</p>
              <p className="text-[var(--muted)] mb-4">Define what agents can access</p>
              <button onClick={() => setShowCreateRule(true)} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg">+ Add Rule</button>
            </div>
          ) : (
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--bg)]">
                    <th className="text-left p-3 font-medium">Agent</th>
                    <th className="text-left p-3 font-medium">Resource</th>
                    <th className="text-left p-3 font-medium">Permission</th>
                    <th className="text-left p-3 font-medium">Granted By</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border)]">
                      <td className="p-3">{r.agent?.name || r.agentId.slice(0, 8)}</td>
                      <td className="p-3">{r.resourceType}{r.resourceId ? `:${r.resourceId.slice(0, 8)}` : ''}</td>
                      <td className="p-3"><span className="px-2 py-0.5 rounded bg-[var(--hover)] text-xs">{r.permissionLevel}</span></td>
                      <td className="p-3 text-[var(--muted)]">{r.grantedByType}</td>
                      <td className="p-3">
                        <button onClick={() => handleDeleteRule(r.id)} className="text-red-500 text-xs hover:underline">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Create rule modal */}
      {showCreateRule && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreateRule(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[440px] mx-4 border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">New Access Rule</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Agent</label>
                <select value={ruleForm.agentId} onChange={(e) => setRuleForm({ ...ruleForm, agentId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  <option value="">Select agent</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.positions?.[0]?.title ? ` · ${a.positions[0].title}` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Resource Type</label>
                <input value={ruleForm.resourceType} onChange={(e) => setRuleForm({ ...ruleForm, resourceType: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" placeholder="e.g. database, api, file" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Permission Level</label>
                <select value={ruleForm.permissionLevel} onChange={(e) => setRuleForm({ ...ruleForm, permissionLevel: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  <option value="READ">Read</option>
                  <option value="WRITE">Write</option>
                  <option value="EXECUTE">Execute</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreateRule(false)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Cancel</button>
              <button onClick={handleCreateRule} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
