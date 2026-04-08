'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function spendColor(percent: number): string {
  if (percent >= 100) return 'var(--danger)';
  if (percent >= 80) return 'var(--warning)';
  return 'var(--success)';
}

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [selectedBudget, setSelectedBudget] = useState<any>(null);
  const [form, setForm] = useState({ agentId: '', monthlyLimitUsd: 100, dailyLimitUsd: 3, hourlyLimitUsd: 0.5, softAlertPercent: 80, hardStopEnabled: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [agents, setAgents] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [incidentBudgetId, setIncidentBudgetId] = useState<string | null>(null);
  const [incidentsLoading, setIncidentsLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [budgetRes, summaryRes, agentRes] = await Promise.all([
        api.getBudgets({ pageSize: '100' }),
        api.getBudgetSummary(),
        api.getAgents({ pageSize: '200' }),
      ]);
      setBudgets(budgetRes.data || []);
      setSummary(summaryRes);
      setAgents(agentRes.data || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openCreate = () => {
    setForm({ agentId: '', monthlyLimitUsd: 100, dailyLimitUsd: 3, hourlyLimitUsd: 0.5, softAlertPercent: 80, hardStopEnabled: true });
    setSelectedBudget(null);
    setError('');
    setModalMode('create');
  };

  const openEdit = (budget: any) => {
    // Get daily/hourly from agent's llmConfig
    const agent = agentMap.get(budget.agentId);
    const lc = (agent?.llmConfig || {}) as any;
    setForm({
      agentId: budget.agentId,
      monthlyLimitUsd: budget.monthlyLimitUsd,
      dailyLimitUsd: lc.dailyBudgetUsd ?? 3,
      hourlyLimitUsd: lc.hourlyBudgetUsd ?? 0.5,
      softAlertPercent: budget.softAlertPercent ?? 80,
      hardStopEnabled: budget.hardStopEnabled ?? true,
    });
    setSelectedBudget(budget);
    setError('');
    setModalMode('edit');
  };

  const handleSave = async () => {
    if (!form.agentId) { setError('Please select an agent'); return; }
    if (form.monthlyLimitUsd <= 0) { setError('Monthly limit must be positive'); return; }
    setSaving(true);
    setError('');
    try {
      const budgetPayload = {
        agentId: form.agentId,
        monthlyLimitUsd: form.monthlyLimitUsd,
        softAlertPercent: form.softAlertPercent,
        hardStopEnabled: form.hardStopEnabled,
      };
      if (modalMode === 'create') {
        await api.createBudget(budgetPayload);
      } else if (modalMode === 'edit' && selectedBudget) {
        await api.updateBudget(selectedBudget.id, budgetPayload);
      }
      // Save daily/hourly limits to agent's llmConfig
      if (form.agentId) {
        try {
          const agentData = await api.getAgent(form.agentId);
          const llmConfig = { ...(agentData.llmConfig || {}), dailyBudgetUsd: form.dailyLimitUsd, hourlyBudgetUsd: form.hourlyLimitUsd };
          await api.updateAgent(form.agentId, { llmConfig });
        } catch { /* silent */ }
      }
      setModalMode(null);
      loadData();
    } catch (e: any) {
      setError(e.message || 'Failed to save budget');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (budget: any) => {
    if (!confirm(`Reset current spend for ${budget.agent?.name || 'this agent'}? This will zero the spend counter.`)) return;
    try {
      await api.resetBudget(budget.id);
      loadData();
    } catch (e: any) {
      alert(e.message || 'Failed to reset budget');
    }
  };

  const viewIncidents = async (budgetId: string) => {
    if (incidentBudgetId === budgetId) {
      setIncidentBudgetId(null);
      setIncidents([]);
      return;
    }
    setIncidentBudgetId(budgetId);
    setIncidentsLoading(true);
    try {
      const data = await api.getBudgetIncidents(budgetId);
      setIncidents(data || []);
    } catch {
      setIncidents([]);
    } finally {
      setIncidentsLoading(false);
    }
  };

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 md:mb-8 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Budgets & Costs</h1>
          <p className="text-[var(--muted)] mt-1 text-sm">Monitor and control agent spending</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg font-medium transition-colors text-sm"
        >
          + New Budget
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="p-5 bg-[var(--card)] border border-[var(--border)] rounded-xl">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Total Monthly Limit</p>
            <p className="text-2xl font-bold">{formatUsd(summary.totalLimitUsd ?? summary.totalLimit ?? 0)}</p>
          </div>
          <div className="p-5 bg-[var(--card)] border border-[var(--border)] rounded-xl">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Total Current Spend</p>
            <p className="text-2xl font-bold">{formatUsd(summary.totalSpendUsd ?? summary.totalSpend ?? 0)}</p>
          </div>
          <div className="p-5 bg-[var(--card)] border border-[var(--border)] rounded-xl">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Agents Over Budget</p>
            <p className="text-2xl font-bold" style={{ color: (Array.isArray(summary.agentsOverBudget) ? summary.agentsOverBudget.length : summary.agentsOverBudget) > 0 ? 'var(--danger)' : 'var(--success)' }}>
              {Array.isArray(summary.agentsOverBudget) ? summary.agentsOverBudget.length : summary.agentsOverBudget}
            </p>
          </div>
          <div className="p-5 bg-[var(--card)] border border-[var(--border)] rounded-xl">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Budget Utilization</p>
            <p className="text-2xl font-bold">{(summary.utilizationPercent ?? summary.utilization ?? 0).toFixed(1)}%</p>
          </div>
        </div>
      )}

      {/* Budget List */}
      {loading ? (
        <div className="text-center text-[var(--muted)] py-20">Loading budgets...</div>
      ) : budgets.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-4xl mb-4">💰</p>
          <p className="text-lg font-medium mb-2">No budgets configured</p>
          <p className="text-[var(--muted)] mb-4">Set up spending limits for your agents</p>
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg font-medium transition-colors inline-block"
          >
            Create Budget
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Table Header */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-2 text-xs text-[var(--muted)] uppercase tracking-wide">
            <div className="col-span-2">Agent</div>
            <div className="col-span-3">Limits (hr / day / mo)</div>
            <div className="col-span-3">Current Spend</div>
            <div className="col-span-2">Alerts</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          {budgets.map((budget) => {
            const percent = budget.monthlyLimitUsd > 0 ? (budget.currentSpendUsd / budget.monthlyLimitUsd) * 100 : 0;
            const agent = agentMap.get(budget.agentId) || budget.agent;
            const agentName = agent?.name || budget.agentId;

            return (
              <div key={budget.id}>
                <div className="bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] rounded-xl p-5 transition-colors">
                  <div className="md:grid md:grid-cols-12 md:gap-4 md:items-center space-y-3 md:space-y-0">
                    {/* Agent */}
                    <div className="col-span-2">
                      <p className="font-semibold">{agentName}</p>
                      {budget.periodStart && (
                        <p className="text-xs text-[var(--muted)]">
                          {new Date(budget.periodStart).toLocaleDateString()} - {new Date(budget.periodEnd).toLocaleDateString()}
                        </p>
                      )}
                    </div>

                    {/* Limits: hourly / daily / monthly */}
                    <div className="col-span-3">
                      {(() => {
                        const lc = (agent?.llmConfig || {}) as any;
                        const h = lc.hourlyBudgetUsd;
                        const d = lc.dailyBudgetUsd;
                        return (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-xs font-mono" title="Hourly">
                              {h ? `$${h}/h` : '—'}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 text-xs font-mono" title="Daily">
                              {d ? `$${d}/d` : '—'}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-xs font-mono" title="Monthly">
                              {formatUsd(budget.monthlyLimitUsd)}/mo
                            </span>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Spend + Progress */}
                    <div className="col-span-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{formatUsd(budget.currentSpendUsd || 0)}</span>
                        <span className="text-xs text-[var(--muted)]">{percent.toFixed(1)}%</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-[var(--border)] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.min(percent, 100)}%`,
                            backgroundColor: spendColor(percent),
                          }}
                        />
                      </div>
                    </div>

                    {/* Alert Status */}
                    <div className="col-span-2">
                      <div className="flex flex-wrap gap-1">
                        {budget.softAlertSent && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">
                            Soft Alert
                          </span>
                        )}
                        {budget.hardStopTriggered && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                            Hard Stop
                          </span>
                        )}
                        {!budget.softAlertSent && !budget.hardStopTriggered && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">
                            OK
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="col-span-2 flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(budget)}
                        className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] hover:bg-[var(--card-hover)] transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleReset(budget)}
                        className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] hover:bg-[var(--card-hover)] transition-colors"
                      >
                        Reset
                      </button>
                      <button
                        onClick={() => viewIncidents(budget.id)}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                          incidentBudgetId === budget.id
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                            : 'border-[var(--border)] hover:bg-[var(--card-hover)]'
                        }`}
                      >
                        Incidents
                      </button>
                    </div>
                  </div>
                </div>

                {/* Incidents Panel */}
                {incidentBudgetId === budget.id && (
                  <div className="mt-1 bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 ml-4 border-l-2 border-l-[var(--accent)]">
                    <h3 className="text-sm font-semibold mb-3">Incidents for {agentName}</h3>
                    {incidentsLoading ? (
                      <p className="text-sm text-[var(--muted)]">Loading incidents...</p>
                    ) : incidents.length === 0 ? (
                      <p className="text-sm text-[var(--muted)]">No incidents recorded</p>
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {incidents.map((inc, idx) => (
                          <div key={inc.id || idx} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                            <span className={`mt-0.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                              inc.type === 'HARD_STOP' ? 'bg-red-500/20 text-red-400'
                                : inc.type === 'SOFT_ALERT' ? 'bg-yellow-500/20 text-yellow-400'
                                : 'bg-blue-500/20 text-blue-400'
                            }`}>
                              {inc.type}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm">{inc.message}</p>
                              <div className="flex gap-4 mt-1 text-xs text-[var(--muted)]">
                                {inc.amountUsd != null && <span>Amount: {formatUsd(inc.amountUsd)}</span>}
                                {inc.limitUsd != null && <span>Limit: {formatUsd(inc.limitUsd)}</span>}
                              </div>
                            </div>
                            <span className="text-xs text-[var(--muted)] whitespace-nowrap">
                              {inc.createdAt ? new Date(inc.createdAt).toLocaleString() : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalMode(null)}>
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl w-full max-w-md p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-5">
              {modalMode === 'create' ? 'Create Budget' : 'Edit Budget'}
            </h2>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-4">
              {/* Agent Select */}
              <div>
                <label className="block text-sm font-medium mb-1">Agent</label>
                <select
                  value={form.agentId}
                  onChange={(e) => setForm({ ...form, agentId: e.target.value })}
                  disabled={modalMode === 'edit'}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm disabled:opacity-50"
                >
                  <option value="">Select agent...</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </div>

              {/* Spending Limits */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1 text-[var(--muted)]">Hourly (USD)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={form.hourlyLimitUsd}
                    onChange={(e) => setForm({ ...form, hourlyLimitUsd: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                    placeholder="0.50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1 text-[var(--muted)]">Daily (USD)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={form.dailyLimitUsd}
                    onChange={(e) => setForm({ ...form, dailyLimitUsd: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                    placeholder="3.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1 text-[var(--muted)]">Monthly (USD)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.monthlyLimitUsd}
                    onChange={(e) => setForm({ ...form, monthlyLimitUsd: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                    placeholder="100"
                  />
                </div>
              </div>
              <p className="text-xs text-[var(--muted)] -mt-2">Hourly and daily limits prevent overspending in short bursts. 0 = no limit.</p>

              {/* Soft Alert Percent */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Soft Alert Threshold: {form.softAlertPercent}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={form.softAlertPercent}
                  onChange={(e) => setForm({ ...form, softAlertPercent: parseInt(e.target.value) })}
                  className="w-full accent-[var(--accent)]"
                />
                <div className="flex justify-between text-xs text-[var(--muted)] mt-1">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>

              {/* Hard Stop Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Hard Stop</p>
                  <p className="text-xs text-[var(--muted)]">Block agent when budget is exceeded</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, hardStopEnabled: !form.hardStopEnabled })}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    form.hardStopEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                      form.hardStopEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[var(--border)]">
              <button
                onClick={() => setModalMode(null)}
                className="px-4 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--card-hover)] text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : modalMode === 'create' ? 'Create Budget' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
