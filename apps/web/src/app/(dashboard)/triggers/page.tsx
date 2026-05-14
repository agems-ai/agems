'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { Webhook, Plus, Trash2, Copy, Check, X, Power, PowerOff } from 'lucide-react';

type AuthKind = 'HMAC' | 'BEARER' | 'NONE';
type TriggerKind = 'WEBHOOK' | 'GMAIL' | 'N8N';

interface Trigger {
  id: string;
  taskId: string;
  slug: string;
  kind: TriggerKind;
  authKind: AuthKind;
  signatureHeader: string | null;
  enabled: boolean;
  lastFiredAt: string | null;
  firingCount: number;
  metadata: any;
  createdAt: string;
  updatedAt: string;
}

const kindBadge: Record<TriggerKind, string> = {
  WEBHOOK: 'bg-blue-500/15 text-blue-400',
  GMAIL: 'bg-rose-500/15 text-rose-400',
  N8N: 'bg-purple-500/15 text-purple-400',
};

const authBadge: Record<AuthKind, string> = {
  HMAC: 'bg-emerald-500/15 text-emerald-400',
  BEARER: 'bg-amber-500/15 text-amber-400',
  NONE: 'bg-zinc-500/15 text-zinc-400',
};

export default function TriggersPage() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<{
    taskId: string;
    kind: TriggerKind;
    authKind: AuthKind;
    signatureHeader: string;
  }>({ taskId: '', kind: 'WEBHOOK', authKind: 'HMAC', signatureHeader: '' });
  const [saving, setSaving] = useState(false);
  const [secretReveal, setSecretReveal] = useState<{ slug: string; secret: string | null } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tg, ts] = await Promise.all([
        api.listTriggers(),
        api.getTasks().catch(() => ({ data: [] })),
      ]);
      setTriggers(Array.isArray(tg) ? tg : []);
      const taskArr = Array.isArray(ts) ? ts : (ts?.data ?? ts?.tasks ?? []);
      setTasks(Array.isArray(taskArr) ? taskArr : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!createForm.taskId) { alert('Pick a task first'); return; }
    setSaving(true);
    try {
      const r: any = await api.createTrigger({
        taskId: createForm.taskId,
        kind: createForm.kind,
        authKind: createForm.authKind,
        signatureHeader: createForm.signatureHeader || undefined,
      });
      setSecretReveal({ slug: r.slug, secret: r.secret ?? null });
      setShowCreate(false);
      setCreateForm({ taskId: '', kind: 'WEBHOOK', authKind: 'HMAC', signatureHeader: '' });
      await load();
    } catch (e: any) {
      alert('Failed to create: ' + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(t: Trigger) {
    try {
      await api.setTriggerEnabled(t.id, !t.enabled);
      await load();
    } catch (e: any) {
      alert('Failed to toggle: ' + (e?.message ?? e));
    }
  }

  async function remove(t: Trigger) {
    if (!confirm(`Delete trigger ${t.slug}? Webhook URL stops working immediately.`)) return;
    try {
      await api.deleteTrigger(t.id);
      await load();
    } catch (e: any) {
      alert('Failed to delete: ' + (e?.message ?? e));
    }
  }

  function copy(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }

  const apiBase = (typeof window !== 'undefined' ? window.location.origin : '');

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Webhook size={24} /> Webhook Triggers</h1>
          <p className="text-sm text-[var(--muted)]">External events that fire a Task. Stripe / GitHub / generic webhooks → agent runs.</p>
        </div>
        <button
          className="px-3 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium flex items-center gap-2"
          onClick={() => setShowCreate(true)}
        >
          <Plus size={16} /> New trigger
        </button>
      </div>

      {/* Secret reveal banner (shown ONCE after create) */}
      {secretReveal && (
        <div className="mb-4 p-4 rounded-lg border border-amber-500/40 bg-amber-500/10">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-amber-300">⚠️ Copy this secret now — it will never be shown again.</div>
            <button onClick={() => setSecretReveal(null)} className="text-amber-300 hover:text-amber-100"><X size={18} /></button>
          </div>
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <span className="text-xs text-[var(--muted)] w-20">URL</span>
              <code className="flex-1 px-2 py-1 rounded bg-black/30 text-xs">{apiBase}/api/triggers/{secretReveal.slug}</code>
              <button onClick={() => copy(`${apiBase}/api/triggers/${secretReveal.slug}`, 'url')} className="p-1 hover:bg-white/10 rounded">
                {copiedField === 'url' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            {secretReveal.secret && (
              <div className="flex gap-2 items-center">
                <span className="text-xs text-[var(--muted)] w-20">Secret</span>
                <code className="flex-1 px-2 py-1 rounded bg-black/30 text-xs font-mono break-all">{secretReveal.secret}</code>
                <button onClick={() => copy(secretReveal.secret!, 'secret')} className="p-1 hover:bg-white/10 rounded">
                  {copiedField === 'secret' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-sm text-[var(--muted)]">Loading…</div>
      ) : triggers.length === 0 ? (
        <div className="p-8 rounded-lg border border-[var(--border)] bg-[var(--card)] text-center">
          <Webhook size={32} className="mx-auto text-[var(--muted)] mb-2" />
          <div className="font-medium">No triggers yet</div>
          <div className="text-sm text-[var(--muted)] mt-1">Create one to fire a task from an external webhook.</div>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black/20 text-xs text-[var(--muted)]">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Slug</th>
                <th className="text-left px-3 py-2 font-medium">Kind</th>
                <th className="text-left px-3 py-2 font-medium">Auth</th>
                <th className="text-left px-3 py-2 font-medium">Task</th>
                <th className="text-left px-3 py-2 font-medium">Fired</th>
                <th className="text-left px-3 py-2 font-medium">Last</th>
                <th className="text-right px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {triggers.map(t => {
                const task = tasks.find(x => x.id === t.taskId);
                return (
                  <tr key={t.id} className="border-t border-[var(--border)] hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <code className="text-xs">{t.slug.slice(0, 8)}…</code>
                        <button onClick={() => copy(`${apiBase}/api/triggers/${t.slug}`, t.id + ':url')} className="p-1 hover:bg-white/10 rounded">
                          {copiedField === t.id + ':url' ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs ${kindBadge[t.kind]}`}>{t.kind}</span></td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs ${authBadge[t.authKind]}`}>{t.authKind}</span></td>
                    <td className="px-3 py-2 text-xs text-[var(--muted)]">{task?.title ?? t.taskId.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-xs">{t.firingCount}×</td>
                    <td className="px-3 py-2 text-xs text-[var(--muted)]">
                      {t.lastFiredAt ? new Date(t.lastFiredAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => toggle(t)} title={t.enabled ? 'Disable' : 'Enable'} className="p-1.5 hover:bg-white/10 rounded">
                        {t.enabled ? <Power size={14} className="text-emerald-400" /> : <PowerOff size={14} className="text-zinc-500" />}
                      </button>
                      <button onClick={() => remove(t)} title="Delete" className="p-1.5 hover:bg-rose-500/10 rounded ml-1">
                        <Trash2 size={14} className="text-rose-400" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-5 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">New webhook trigger</h2>
              <button onClick={() => setShowCreate(false)} className="text-[var(--muted)]"><X size={18} /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--muted)] block mb-1">Task</label>
                <select
                  value={createForm.taskId}
                  onChange={e => setCreateForm(f => ({ ...f, taskId: e.target.value }))}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm"
                >
                  <option value="">-- pick a task --</option>
                  {tasks.map(t => (
                    <option key={t.id} value={t.id}>{t.title} ({t.status})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-[var(--muted)] block mb-1">Kind</label>
                  <select
                    value={createForm.kind}
                    onChange={e => setCreateForm(f => ({ ...f, kind: e.target.value as TriggerKind }))}
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm"
                  >
                    <option value="WEBHOOK">WEBHOOK</option>
                    <option value="GMAIL">GMAIL</option>
                    <option value="N8N">N8N</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--muted)] block mb-1">Auth</label>
                  <select
                    value={createForm.authKind}
                    onChange={e => setCreateForm(f => ({ ...f, authKind: e.target.value as AuthKind }))}
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm"
                  >
                    <option value="HMAC">HMAC (signed)</option>
                    <option value="BEARER">BEARER (token)</option>
                    <option value="NONE">NONE (open)</option>
                  </select>
                </div>
              </div>

              {createForm.authKind === 'HMAC' && (
                <div>
                  <label className="text-xs text-[var(--muted)] block mb-1">Signature header (optional)</label>
                  <input
                    type="text"
                    placeholder="X-Signature (default)"
                    value={createForm.signatureHeader}
                    onChange={e => setCreateForm(f => ({ ...f, signatureHeader: e.target.value }))}
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm font-mono"
                  />
                  <div className="text-xs text-[var(--muted)] mt-1">
                    Default looks at <code>X-Signature</code>, then <code>X-Hub-Signature-256</code>, then <code>X-Webhook-Signature</code>.
                  </div>
                </div>
              )}

              {createForm.authKind === 'NONE' && (
                <div className="p-2 rounded bg-rose-500/10 text-xs text-rose-300">
                  ⚠️ Unauthenticated triggers can be fired by anyone who knows the URL. Use only behind a VPN.
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button className="px-3 py-1.5 text-sm rounded border border-[var(--border)]" onClick={() => setShowCreate(false)}>Cancel</button>
              <button
                className="px-3 py-1.5 text-sm rounded bg-[var(--accent)] text-white disabled:opacity-50"
                disabled={saving || !createForm.taskId}
                onClick={handleCreate}
              >
                {saving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
