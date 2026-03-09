'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

function TreeNode({ node, level = 0, onAssign, agents }: { node: any; level?: number; onAssign: (id: string) => void; agents: any[] }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div style={{ marginLeft: Math.min(level * 24, 96) }}>
      <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--hover)] group">
        {hasChildren ? (
          <button onClick={() => setExpanded(!expanded)} className="w-5 h-5 flex items-center justify-center text-xs text-[var(--muted)]">
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <div className="w-5" />
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{node.title}</span>
            {node.department && <span className="text-xs px-2 py-0.5 rounded bg-[var(--hover)] text-[var(--muted)]">{node.department}</span>}
          </div>
          <div className="text-xs text-[var(--muted)] mt-0.5">
            {node.holderType === 'AGENT' && node.agent ? (
              <span className="text-[var(--accent)]">{node.agent.name}</span>
            ) : node.holderType === 'HUMAN' && node.user ? (
              <span>{node.user.name}</span>
            ) : (
              <span className="italic">Vacant</span>
            )}
          </div>
        </div>
        <button
          onClick={() => onAssign(node.id)}
          className="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--hover)] transition"
        >Assign</button>
      </div>
      {expanded && hasChildren && node.children.map((child: any) => (
        <TreeNode key={child.id} node={child} level={level + 1} onAssign={onAssign} agents={agents} />
      ))}
    </div>
  );
}

export default function OrgPage() {
  const [tree, setTree] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showAssign, setShowAssign] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', department: '', parentId: '' });

  const loadData = async () => {
    const [t, p, a] = await Promise.all([
      api.getOrgTree(),
      api.getOrgPositions(),
      api.getAgents().then((r: any) => r.data || []),
    ]);
    setTree(t);
    setPositions(p);
    setAgents(a);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    await api.createOrgPosition({
      title: form.title,
      department: form.department || undefined,
      parentId: form.parentId || undefined,
    });
    setShowCreate(false);
    setForm({ title: '', department: '', parentId: '' });
    loadData();
  };

  const handleAssign = async (positionId: string, holderType: string, agentId?: string) => {
    await api.assignOrgHolder(positionId, { holderType, agentId });
    setShowAssign(null);
    loadData();
  };

  const handleDelete = async (id: string) => {
    await api.deleteOrgPosition(id);
    loadData();
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-1">Org Structure</h1>
          <p className="text-[var(--muted)]">Organizational hierarchy — agents and humans</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90">
          + New Position
        </button>
      </div>

      {loading ? (
        <p className="text-[var(--muted)]">Loading...</p>
      ) : tree.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-4xl mb-4">🏢</p>
          <p className="text-lg font-medium mb-2">No positions yet</p>
          <p className="text-[var(--muted)] mb-4">Build your organizational structure</p>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg">+ Add Position</button>
        </div>
      ) : (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          {tree.map((node) => (
            <TreeNode key={node.id} node={node} onAssign={(id) => setShowAssign(id)} agents={agents} />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[440px] mx-4 border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">New Position</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" placeholder="e.g. CTO, Head of Sales" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Department</label>
                <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" placeholder="e.g. Engineering" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Parent Position</label>
                <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  <option value="">None (root)</option>
                  {positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Cancel</button>
              <button onClick={handleCreate} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Assign modal */}
      {showAssign && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAssign(null)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[440px] mx-4 border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Assign Holder</h3>
            <div className="space-y-2">
              <button
                onClick={() => handleAssign(showAssign, 'HUMAN')}
                className="w-full text-left p-3 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)]"
              >
                <div className="font-medium">Current User (Human)</div>
                <div className="text-xs text-[var(--muted)]">Assign yourself to this position</div>
              </button>
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => handleAssign(showAssign, 'AGENT', a.id)}
                  className="w-full text-left p-3 rounded-lg border border-[var(--border)] hover:bg-[var(--hover)]"
                >
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-[var(--muted)]">{a.positions?.[0]?.title || a.role || 'Agent'}</div>
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowAssign(null)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
