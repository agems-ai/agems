'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function N8nWorkflowPage() {
  const params = useParams();
  const router = useRouter();
  const [workflow, setWorkflow] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [jsonEdit, setJsonEdit] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [executions, setExecutions] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!params.id) return;
    try {
      const data = await api.getN8nWorkflow(params.id as string);
      setWorkflow(data);
      setJsonEdit(JSON.stringify({ nodes: data.nodes, connections: data.connections }, null, 2));
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [params.id]);

  const loadExecutions = useCallback(async () => {
    if (!params.id) return;
    try {
      const data = await api.getN8nExecutions({ workflowId: params.id as string, limit: 10 });
      setExecutions(Array.isArray(data) ? data : data?.data || []);
    } catch { /* noop */ }
  }, [params.id]);

  useEffect(() => { load(); loadExecutions(); }, [load, loadExecutions]);

  const handleSave = async () => {
    if (!workflow) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const parsed = JSON.parse(jsonEdit);
      await api.updateN8nWorkflow(workflow.id, {
        name: workflow.name,
        nodes: parsed.nodes,
        connections: parsed.connections,
        settings: workflow.settings || {},
        staticData: workflow.staticData || null,
      });
      setSuccess('Saved');
      setEditMode(false);
      load();
    } catch (err: any) {
      setError(err.message || 'Invalid JSON');
    }
    setSaving(false);
  };

  const handleToggle = async () => {
    if (!workflow) return;
    try {
      if (workflow.active) {
        await api.deactivateN8nWorkflow(workflow.id);
      } else {
        await api.activateN8nWorkflow(workflow.id);
      }
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleExecute = async () => {
    if (!workflow) return;
    try {
      await api.executeN8nWorkflow(workflow.id);
      setSuccess('Executed');
      loadExecutions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async () => {
    if (!workflow || !confirm(`Delete workflow "${workflow.name}"?`)) return;
    try {
      await api.deleteN8nWorkflow(workflow.id);
      router.push('/n8n');
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading workflow...</div>;
  if (!workflow) return <div className="p-8 text-red-400">Workflow not found. {error}</div>;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <Link href="/n8n" className="text-sm text-[var(--muted)] hover:text-white mb-4 inline-block">&larr; Back to workflows</Link>

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold flex-1">{workflow.name}</h1>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${workflow.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'}`}>
          {workflow.active ? 'Active' : 'Inactive'}
        </span>
        <button onClick={handleToggle} className="px-3 py-1.5 text-xs bg-[var(--card)] border border-[var(--border)] rounded-lg hover:bg-[var(--card-hover)] transition-colors">
          {workflow.active ? 'Deactivate' : 'Activate'}
        </button>
        <button onClick={handleExecute} className="px-3 py-1.5 text-xs bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors">
          Run
        </button>
        <button onClick={handleDelete} className="px-3 py-1.5 text-xs bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors">
          Delete
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{error}</div>}
      {success && <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-sm text-emerald-400">{success}</div>}

      {/* Metadata */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <InfoCard label="ID" value={workflow.id} />
        <InfoCard label="Nodes" value={workflow.nodes?.length ?? 0} />
        <InfoCard label="Created" value={new Date(workflow.createdAt).toLocaleDateString()} />
        <InfoCard label="Updated" value={new Date(workflow.updatedAt).toLocaleDateString()} />
      </div>

      {/* Nodes */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 mb-6">
        <h3 className="font-semibold mb-3 text-sm text-[var(--muted)] uppercase tracking-wider">Nodes ({workflow.nodes?.length ?? 0})</h3>
        {workflow.nodes?.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {workflow.nodes.map((node: any, i: number) => (
              <div key={i} className="flex items-center gap-2 p-2 bg-[var(--background)] rounded-lg border border-[var(--border)]">
                <span className="text-xs font-medium truncate flex-1">{node.name}</span>
                <span className="text-[10px] text-[var(--muted)] truncate max-w-[140px]">{node.type}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">No nodes</p>
        )}
      </div>

      {/* JSON Editor */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm text-[var(--muted)] uppercase tracking-wider">Workflow JSON</h3>
          <div className="flex gap-2">
            {editMode ? (
              <>
                <button onClick={handleSave} disabled={saving} className="px-3 py-1 text-xs bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors">
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => { setEditMode(false); setJsonEdit(JSON.stringify({ nodes: workflow.nodes, connections: workflow.connections }, null, 2)); }} className="px-3 py-1 text-xs bg-gray-500/20 text-gray-400 rounded-lg hover:bg-gray-500/30 transition-colors">
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setEditMode(true)} className="px-3 py-1 text-xs bg-[var(--accent)]/20 text-[var(--accent)] rounded-lg hover:bg-[var(--accent)]/30 transition-colors">
                Edit
              </button>
            )}
          </div>
        </div>
        <textarea
          value={jsonEdit}
          onChange={(e) => setJsonEdit(e.target.value)}
          readOnly={!editMode}
          className="w-full h-96 bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 text-xs font-mono resize-y focus:outline-none focus:border-[var(--accent)]"
          spellCheck={false}
        />
      </div>

      {/* Executions */}
      {executions.length > 0 && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
          <h3 className="font-semibold mb-3 text-sm text-[var(--muted)] uppercase tracking-wider">Recent Executions</h3>
          <div className="space-y-2">
            {executions.map((ex: any) => (
              <div key={ex.id} className="flex items-center gap-3 p-3 bg-[var(--background)] rounded-lg border border-[var(--border)]">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  ex.finished
                    ? (ex.data?.resultData?.error ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400')
                    : 'bg-blue-500/20 text-blue-400'
                }`}>
                  {ex.finished ? (ex.data?.resultData?.error ? 'Error' : 'Success') : 'Running'}
                </span>
                <span className="text-xs text-[var(--muted)] flex-1">ID: {ex.id}</span>
                <span className="text-xs text-[var(--muted)]">
                  {ex.startedAt ? new Date(ex.startedAt).toLocaleString() : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <p className="text-xs text-[var(--muted)] mb-1">{label}</p>
      <p className="text-sm font-medium truncate">{String(value)}</p>
    </div>
  );
}
