'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function N8nPage() {
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await api.getN8nWorkflows({ limit: 100 });
      setWorkflows(Array.isArray(data) ? data : data?.data || []);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load workflows');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.createN8nWorkflow({ name: newName.trim() });
      setNewName('');
      load();
    } catch (err: any) {
      setError(err.message);
    }
    setCreating(false);
  };

  const handleToggle = async (wf: any) => {
    setToggling(wf.id);
    try {
      if (wf.active) {
        await api.deactivateN8nWorkflow(wf.id);
      } else {
        await api.activateN8nWorkflow(wf.id);
      }
      load();
    } catch (err: any) {
      setError(err.message);
    }
    setToggling(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete workflow "${name}"?`)) return;
    try {
      await api.deleteN8nWorkflow(id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleExecute = async (id: string) => {
    try {
      await api.executeN8nWorkflow(id);
      setError('');
      alert('Workflow executed');
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) return <div className="p-8 text-[var(--muted)]">Loading workflows...</div>;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <h1 className="text-2xl font-bold">N8N Workflows</h1>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New workflow name..."
            className="bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)] flex-1 sm:flex-initial min-w-0"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || creating}
            className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity shrink-0"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {workflows.length === 0 ? (
        <div className="text-center py-16 text-[var(--muted)]">
          <p>No workflows found.</p>
          <p className="text-sm mt-1">Configure N8N connection in Settings first.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3 md:p-4 flex items-center gap-2 md:gap-4 flex-wrap hover:bg-[var(--card-hover)] transition-colors"
            >
              <button
                onClick={() => handleToggle(wf)}
                disabled={toggling === wf.id}
                className={`w-10 h-5 rounded-full relative transition-colors ${wf.active ? 'bg-emerald-500' : 'bg-gray-600'}`}
                title={wf.active ? 'Deactivate' : 'Activate'}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${wf.active ? 'left-5' : 'left-0.5'}`} />
              </button>

              <Link href={`/n8n/${wf.id}`} className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{wf.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  ID: {wf.id} &middot; {wf.nodes?.length ?? 0} nodes &middot; Updated {new Date(wf.updatedAt).toLocaleDateString()}
                </p>
              </Link>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleExecute(wf.id)}
                  className="px-3 py-1.5 text-xs bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors"
                  title="Execute"
                >
                  Run
                </button>
                <button
                  onClick={() => handleDelete(wf.id, wf.name)}
                  className="px-3 py-1.5 text-xs bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                  title="Delete"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
