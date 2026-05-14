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

// ──────────────────────────────────────────────────────────────────────────
// Platform Budget Card (org-wide limits, higher priority than agent limits)
// ──────────────────────────────────────────────────────────────────────────

function PlatformBudgetCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<{
    hourlyLimitUsd: string;
    dailyLimitUsd: string;
    monthlyLimitUsd: string;
    softAlertPercent: number;
    hardStopEnabled: boolean;
  }>({ hourlyLimitUsd: '', dailyLimitUsd: '', monthlyLimitUsd: '', softAlertPercent: 80, hardStopEnabled: true });

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getPlatformBudget();
      setData(res);
      setForm({
        hourlyLimitUsd: res.budget?.hourlyLimitUsd != null ? String(res.budget.hourlyLimitUsd) : '',
        dailyLimitUsd: res.budget?.dailyLimitUsd != null ? String(res.budget.dailyLimitUsd) : '',
        monthlyLimitUsd: res.budget?.monthlyLimitUsd != null ? String(res.budget.monthlyLimitUsd) : '',
        softAlertPercent: res.budget?.softAlertPercent ?? 80,
        hardStopEnabled: res.budget?.hardStopEnabled ?? true,
      });
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const toNum = (s: string) => (s === '' ? null : parseFloat(s));
      await api.upsertPlatformBudget({
        hourlyLimitUsd: toNum(form.hourlyLimitUsd),
        dailyLimitUsd: toNum(form.dailyLimitUsd),
        monthlyLimitUsd: toNum(form.monthlyLimitUsd),
        softAlertPercent: form.softAlertPercent,
        hardStopEnabled: form.hardStopEnabled,
      });
      setEditing(false);
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm('Reset platform monthly spend to 0?')) return;
    try {
      await api.resetPlatformBudget();
      await load();
    } catch (e: any) {
      alert(e.message || 'Failed to reset');
    }
  };

  if (loading) {
    return (
      <div className="mb-6 p-6 bg-[var(--card)] border border-[var(--border)] rounded-xl">
        <p className="text-sm text-[var(--muted)]">Loading platform budget…</p>
      </div>
    );
  }

  const bd = data?.breakdown;
  const windows = [
    { key: 'hourly',  label: 'Hourly',  spend: bd?.hourly?.spend ?? 0,  limit: bd?.hourly?.limit  ?? null, tone: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
    { key: 'daily',   label: 'Daily',   spend: bd?.daily?.spend ?? 0,   limit: bd?.daily?.limit   ?? null, tone: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
    { key: 'monthly', label: 'Monthly', spend: bd?.monthly?.spend ?? 0, limit: bd?.monthly?.limit ?? null, tone: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  ];

  return (
    <div className="mb-6 bg-[var(--card)] border-2 border-[var(--accent)]/40 rounded-2xl p-5 md:p-6">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-[var(--accent)]/20 text-[var(--accent)] text-xs font-semibold uppercase tracking-wide">
              Platform
            </span>
            <h2 className="text-xl font-bold">Organization Budget</h2>
            {data?.breakdown?.hardStopTriggered && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                HARD STOP
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--muted)] mt-1">
            Applies to all agents. <span className="font-medium">Higher priority than per-agent limits</span> — if exceeded, every agent in the org is blocked.
          </p>
        </div>
        <div className="flex gap-2">
          {!editing && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--card-hover)] text-sm transition-colors"
              >
                {data?.budget ? 'Edit Limits' : 'Set Limits'}
              </button>
              {data?.budget && (
                <button
                  onClick={reset}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--card-hover)] text-sm transition-colors"
                >
                  Reset Monthly
                </button>
              )}
            </>
          )}
          {editing && (
            <>
              <button
                onClick={() => { setEditing(false); load(); }}
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--card-hover)] text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-sm font-medium transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
      )}

      {!editing ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {windows.map((w) => {
            const hasLimit = w.limit !== null && w.limit > 0;
            const pct = hasLimit ? (w.spend / (w.limit as number)) * 100 : 0;
            return (
              <div key={w.key} className={`p-4 rounded-xl border ${w.tone}`}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wide">{w.label}</span>
                  {hasLimit ? (
                    <span className="text-xs opacity-80">{pct.toFixed(0)}%</span>
                  ) : (
                    <span className="text-xs opacity-60">no limit</span>
                  )}
                </div>
                <div className="text-lg font-bold">
                  {formatUsd(w.spend)}
                  {hasLimit && <span className="text-sm font-normal opacity-70"> / {formatUsd(w.limit as number)}</span>}
                </div>
                {hasLimit && (
                  <div className="w-full h-1.5 rounded-full bg-black/20 overflow-hidden mt-2">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: spendColor(pct) }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            {[
              { k: 'hourlyLimitUsd',  label: 'Hourly Limit (USD)',  step: '0.1', placeholder: 'e.g. 2.00' },
              { k: 'dailyLimitUsd',   label: 'Daily Limit (USD)',   step: '1',   placeholder: 'e.g. 50' },
              { k: 'monthlyLimitUsd', label: 'Monthly Limit (USD)', step: '10',  placeholder: 'e.g. 1000' },
            ].map((f) => (
              <div key={f.k}>
                <label className="block text-xs font-medium mb-1 text-[var(--muted)]">{f.label}</label>
                <input
                  type="number"
                  min="0"
                  step={f.step}
                  placeholder={f.placeholder}
                  value={(form as any)[f.k]}
                  onChange={(e) => setForm({ ...form, [f.k]: e.target.value } as any)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--muted)] mb-3">Leave empty to remove the cap for that window.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Soft Alert Threshold: {form.softAlertPercent}%</label>
              <input
                type="range"
                min="0"
                max="100"
                value={form.softAlertPercent}
                onChange={(e) => setForm({ ...form, softAlertPercent: parseInt(e.target.value) })}
                className="w-full accent-[var(--accent)]"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Hard Stop</p>
                <p className="text-xs text-[var(--muted)]">Pause all agents when monthly limit exceeded</p>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, hardStopEnabled: !form.hardStopEnabled })}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  form.hardStopEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  form.hardStopEnabled ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────────────

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [selectedBudget, setSelectedBudget] = useState<any>(null);
  const [form, setForm] = useState({ agentId: '', monthlyLimitUsd: 4, dailyLimitUsd: '', hourlyLimitUsd: '', softAlertPercent: 80, hardStopEnabled: true });
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
    setForm({ agentId: '', monthlyLimitUsd: 4, dailyLimitUsd: '', hourlyLimitUsd: '', softAlertPercent: 80, hardStopEnabled: true });
    setSelectedBudget(null);
    setError('');
    setModalMode('create');
  };

  const openEdit = (budget: any) => {
    setForm({
      agentId: budget.agentId,
      monthlyLimitUsd: budget.monthlyLimitUsd,
      // Prefer new agent_budgets columns; fall back to legacy llm_config
      dailyLimitUsd: budget.dailyLimitUsd != null ? String(budget.dailyLimitUsd)
        : (agentMap.get(budget.agentId)?.llmConfig?.dailyBudgetUsd != null
          ? String(agentMap.get(budget.agentId).llmConfig.dailyBudgetUsd) : ''),
      hourlyLimitUsd: budget.hourlyLimitUsd != null ? String(budget.hourlyLimitUsd)
        : (agentMap.get(budget.agentId)?.llmConfig?.hourlyBudgetUsd != null
          ? String(agentMap.get(budget.agentId).llmConfig.hourlyBudgetUsd) : ''),
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
      const toNum = (s: string | number) =>
        typeof s === 'number' ? (s > 0 ? s : null) : (s === '' ? null : parseFloat(s));
      const budgetPayload = {
        agentId: form.agentId,
        monthlyLimitUsd: form.monthlyLimitUsd,
        dailyLimitUsd: toNum(form.dailyLimitUsd),
        hourlyLimitUsd: toNum(form.hourlyLimitUsd),
        softAlertPercent: form.softAlertPercent,
        hardStopEnabled: form.hardStopEnabled,
      };
      if (modalMode === 'create') {
        await api.createBudget(budgetPayload);
      } else if (modalMode === 'edit' && selectedBudget) {
        await api.updateBudget(selectedBudget.id, budgetPayload);
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
          <p className="text-[var(--muted)] mt-1 text-sm">Platform-wide cap + per-agent limits. Platform wins.</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg font-medium transition-colors text-sm"
        >
          + New Agent Budget
        </button>
      </div>

      {/* Platform Budget Card — top-priority cap on the whole org */}
      <PlatformBudgetCard />

      {/* Burn-rate forecast — sourced from cost-forecast.ts */}
      <BurnRateCard />

      {/* Cost breakdown by provider × model */}
      <ModelBreakdownCard />


      {/* Agent Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="p-5 bg-[var(--card)] border border-[var(--border)] rounded-xl">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Total Monthly Limit (agents)</p>
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
          <p className="text-lg font-medium mb-2">No per-agent budgets configured</p>
          <p className="text-[var(--muted)] mb-4">Set up spending limits for individual agents</p>
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
            <div className="col-span-3">Monthly Spend</div>
            <div className="col-span-2">Alerts</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          {budgets.map((budget) => {
            const percent = budget.monthlyLimitUsd > 0 ? (budget.currentSpendUsd / budget.monthlyLimitUsd) * 100 : 0;
            const agent = agentMap.get(budget.agentId) || budget.agent;
            const agentName = agent?.name || budget.agentId;
            // Prefer new agent_budgets cols; fall back to legacy llm_config
            const h = budget.hourlyLimitUsd ?? (agent?.llmConfig as any)?.hourlyBudgetUsd ?? null;
            const d = budget.dailyLimitUsd ?? (agent?.llmConfig as any)?.dailyBudgetUsd ?? null;

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
                      <div className="flex items-center gap-2 text-sm">
                        <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-xs font-mono" title="Hourly">
                          {h != null ? `$${h}/h` : '—'}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 text-xs font-mono" title="Daily">
                          {d != null ? `$${d}/d` : '—'}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-xs font-mono" title="Monthly">
                          {formatUsd(budget.monthlyLimitUsd)}/mo
                        </span>
                      </div>
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
                        {budget.alertSent && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">
                            Soft Alert
                          </span>
                        )}
                        {budget.hardStopTriggered && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                            Hard Stop
                          </span>
                        )}
                        {!budget.alertSent && !budget.hardStopTriggered && (
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
                        {incidents.map((inc: any, idx: number) => (
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
                                {inc.spendUsd != null && <span>Spend: {formatUsd(inc.spendUsd)}</span>}
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
              {modalMode === 'create' ? 'Create Agent Budget' : 'Edit Agent Budget'}
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
                    onChange={(e) => setForm({ ...form, hourlyLimitUsd: e.target.value })}
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
                    onChange={(e) => setForm({ ...form, dailyLimitUsd: e.target.value })}
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
              <p className="text-xs text-[var(--muted)] -mt-2">Empty = no limit for that window. Platform cap still applies on top.</p>

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
                  <p className="text-xs text-[var(--muted)]">Block agent when monthly budget is exceeded</p>
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

// ─────────────────────────────────────────────────────────────────
// Burn-rate forecast card — surfaces `forecast` block on
// getOrgCostStats response (cost-forecast.ts).
// ─────────────────────────────────────────────────────────────────
function BurnRateCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r: any = await api.getOrgCostStats('daily', 30);
        setData(r);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return null;
  const f = data?.forecast;
  if (!f) return null;

  const trendColor =
    f.trend === 'rising' ? 'text-rose-400' :
    f.trend === 'falling' ? 'text-emerald-400' :
    'text-zinc-400';
  const trendArrow = f.trend === 'rising' ? '↑' : f.trend === 'falling' ? '↓' : '→';
  const dteColor =
    f.daysToExhaust == null ? 'text-zinc-400' :
    f.daysToExhaust <= 3 ? 'text-rose-400' :
    f.daysToExhaust <= 7 ? 'text-amber-400' :
    'text-emerald-400';

  return (
    <div className="mb-6 p-5 bg-[var(--card)] border border-[var(--border)] rounded-xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Burn Rate Forecast</h3>
        <span className="text-xs text-[var(--muted)]">last 30d</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <div>
          <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Recent daily burn</p>
          <p className="text-xl font-bold">{formatUsd(f.recentDailyBurn ?? 0)}</p>
          <p className="text-[10px] text-[var(--muted)]">trailing 7d avg</p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Avg daily burn</p>
          <p className="text-xl font-bold">{formatUsd(f.avgDailyBurn ?? 0)}</p>
          <p className="text-[10px] text-[var(--muted)]">30d mean</p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Trend</p>
          <p className={`text-xl font-bold ${trendColor}`}>
            {trendArrow} {f.trend}
          </p>
          <p className="text-[10px] text-[var(--muted)]">
            {Number.isFinite(f.trendDeltaPercent) ? `${f.trendDeltaPercent > 0 ? '+' : ''}${f.trendDeltaPercent.toFixed(1)}% wk-over-wk` : 'not enough history'}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Runway</p>
          <p className={`text-xl font-bold ${dteColor}`}>
            {f.daysToExhaust == null ? '—' : f.daysToExhaust === 0 ? 'OVER' : `${f.daysToExhaust}d`}
          </p>
          <p className="text-[10px] text-[var(--muted)]">
            {f.exhaustDate ? `until ${f.exhaustDate}` : 'no platform cap set'}
          </p>
        </div>
      </div>

      {f.spikes && f.spikes.length > 0 && (
        <div className="pt-3 border-t border-[var(--border)]">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-2">Recent spikes ({f.spikes.length})</p>
          <div className="flex flex-wrap gap-2">
            {f.spikes.slice(-5).map((s: any, i: number) => (
              <span
                key={i}
                className={`text-xs px-2 py-1 rounded ${s.multiplier >= 10 ? 'bg-rose-500/15 text-rose-300' : s.multiplier >= 5 ? 'bg-amber-500/15 text-amber-300' : 'bg-blue-500/15 text-blue-300'}`}
              >
                {s.date}: {formatUsd(s.cost)} <span className="opacity-70">({s.multiplier.toFixed(1)}× median)</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Cost breakdown by (provider, model) — uses new columns added in
// commit 2591b49 (per-execution cost attribution). Rows with NULL
// provider bucket into "unknown" (pre-attribution history).
// ─────────────────────────────────────────────────────────────────
function ModelBreakdownCard() {
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r: any = await api.getOrgCostStats('daily', 30);
        setData(r?.modelBreakdown ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading || !data || data.length === 0) return null;
  const totalCost = data.reduce((sum, m) => sum + (m.cost ?? 0), 0);

  return (
    <div className="mb-6 p-5 bg-[var(--card)] border border-[var(--border)] rounded-xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Cost by Model</h3>
        <span className="text-xs text-[var(--muted)]">last 30d · total {formatUsd(totalCost)}</span>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-[var(--muted)] uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium pb-2">Provider · Model</th>
            <th className="text-right font-medium pb-2">Spend</th>
            <th className="text-right font-medium pb-2">Share</th>
            <th className="text-right font-medium pb-2">In tokens</th>
            <th className="text-right font-medium pb-2">Out tokens</th>
            <th className="text-right font-medium pb-2">Cached</th>
            <th className="text-right font-medium pb-2">Calls</th>
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 12).map((m: any, i: number) => {
            const pct = totalCost > 0 ? (m.cost / totalCost) * 100 : 0;
            return (
              <tr key={i} className="border-t border-[var(--border)]">
                <td className="py-2">
                  <span className="text-xs text-[var(--muted)]">{m.provider}</span>
                  <span className="mx-1 text-[var(--muted)]">·</span>
                  <span className="font-mono text-xs">{m.model}</span>
                </td>
                <td className="text-right">{formatUsd(m.cost ?? 0)}</td>
                <td className="text-right text-xs text-[var(--muted)]">{pct.toFixed(1)}%</td>
                <td className="text-right text-xs">{(m.inputTokens ?? 0).toLocaleString()}</td>
                <td className="text-right text-xs">{(m.outputTokens ?? 0).toLocaleString()}</td>
                <td className="text-right text-xs text-emerald-400">
                  {m.cachedInputTokens > 0 ? (m.cachedInputTokens).toLocaleString() : '—'}
                </td>
                <td className="text-right text-xs">{m.executions}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
