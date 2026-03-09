'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Building2, Copy, Plus, ArrowLeft, Check, Loader2 } from 'lucide-react';

const CLONE_ENTITIES = [
  { key: 'settings', label: 'Settings', desc: 'Platform configuration' },
  { key: 'tools', label: 'Tools', desc: 'API integrations & tools' },
  { key: 'skills', label: 'Skills', desc: 'Agent skills & prompts' },
  { key: 'agents', label: 'Agents', desc: 'AI agents with tool/skill assignments' },
  { key: 'channels', label: 'Channels', desc: 'Direct & group channels with participants' },
  { key: 'messages', label: 'Messages', desc: 'Channel message history' },
  { key: 'tasks', label: 'Tasks', desc: 'Tasks with comments & subtasks' },
  { key: 'meetings', label: 'Meetings', desc: 'Meetings with entries & decisions' },
  { key: 'approvals', label: 'Approvals', desc: 'Approval policies per agent' },
  { key: 'files', label: 'Files', desc: 'Uploaded files & folder structure' },
  { key: 'executions', label: 'Agent History', desc: 'Agent execution logs' },
  { key: 'employees', label: 'Employees', desc: 'Team members' },
  { key: 'company', label: 'Company Structure', desc: 'Org chart & positions' },
];

export default function NewOrgPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [createMode, setCreateMode] = useState<'blank' | 'clone'>('blank');
  const [orgs, setOrgs] = useState<any[]>([]);
  const [cloneFromOrgId, setCloneFromOrgId] = useState('');
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getProfile().then((profile: any) => {
      const memberOrgs = profile.memberships?.map((m: any) => ({
        id: m.org.id,
        name: m.org.name,
      })) || [];
      setOrgs(memberOrgs);
      if (memberOrgs.length > 0) setCloneFromOrgId(memberOrgs[0].id);
    }).catch(() => {});
  }, []);

  const toggleEntity = (key: string) => {
    setSelectedEntities(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const selectAll = () => {
    if (selectedEntities.length === CLONE_ENTITIES.length) {
      setSelectedEntities([]);
    } else {
      setSelectedEntities(CLONE_ENTITIES.map(e => e.key));
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Organization name is required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.createOrg(
        name.trim(),
        createMode === 'clone' ? cloneFromOrgId : undefined,
        createMode === 'clone' && selectedEntities.length > 0 ? selectedEntities : undefined,
      );
      // Refresh profile to get updated org list, then switch
      const profile = await api.getProfile();
      const newOrg = profile.memberships?.find((m: any) => m.org.name === name.trim());
      if (newOrg) {
        const res = await api.switchOrg(newOrg.org.id);
        api.setToken(res.token);
        window.location.href = '/dashboard';
      } else {
        window.location.reload();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create organization');
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-lg mx-auto">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      <h1 className="text-2xl font-bold mb-1">New Organization</h1>
      <p className="text-sm text-[var(--muted)] mb-6">Create a blank organization or clone from existing one</p>

      {error && (
        <div className="p-3 mb-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>
      )}

      {/* Name */}
      <div className="mb-6">
        <label className="text-sm text-[var(--muted)] block mb-1.5">Organization Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-white text-sm outline-none focus:border-[var(--accent)]"
          placeholder="My Company"
          autoFocus
        />
      </div>

      {/* Mode selection */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => setCreateMode('blank')}
          className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${
            createMode === 'blank'
              ? 'border-[var(--accent)] bg-[var(--accent)]/10'
              : 'border-[var(--border)] bg-[var(--card)] hover:border-[var(--border-hover)]'
          }`}
        >
          <Plus size={24} className={createMode === 'blank' ? 'text-[var(--accent)]' : 'text-[var(--muted)]'} />
          <span className="text-sm font-medium">Blank</span>
          <span className="text-[10px] text-[var(--muted)]">Start fresh</span>
        </button>
        <button
          onClick={() => setCreateMode('clone')}
          className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${
            createMode === 'clone'
              ? 'border-[var(--accent)] bg-[var(--accent)]/10'
              : 'border-[var(--border)] bg-[var(--card)] hover:border-[var(--border-hover)]'
          }`}
        >
          <Copy size={24} className={createMode === 'clone' ? 'text-[var(--accent)]' : 'text-[var(--muted)]'} />
          <span className="text-sm font-medium">Clone</span>
          <span className="text-[10px] text-[var(--muted)]">Copy from existing</span>
        </button>
      </div>

      {/* Clone options */}
      {createMode === 'clone' && (
        <div className="space-y-4 mb-6">
          {/* Source org */}
          <div>
            <label className="text-sm text-[var(--muted)] block mb-1.5">Clone From</label>
            <select
              value={cloneFromOrgId}
              onChange={e => setCloneFromOrgId(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-white text-sm outline-none focus:border-[var(--accent)]"
            >
              {orgs.map(org => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </div>

          {/* Entity selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-[var(--muted)]">Entities to Clone</label>
              <button onClick={selectAll} className="text-xs text-[var(--accent)] hover:underline">
                {selectedEntities.length === CLONE_ENTITIES.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="space-y-1.5">
              {CLONE_ENTITIES.map(entity => (
                <button
                  key={entity.key}
                  onClick={() => toggleEntity(entity.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-left ${
                    selectedEntities.includes(entity.key)
                      ? 'border-[var(--accent)]/50 bg-[var(--accent)]/5'
                      : 'border-[var(--border)] bg-[var(--card)] hover:border-[var(--border-hover)]'
                  }`}
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                    selectedEntities.includes(entity.key)
                      ? 'bg-[var(--accent)] border-[var(--accent)]'
                      : 'border-[var(--border)]'
                  }`}>
                    {selectedEntities.includes(entity.key) && <Check size={10} className="text-white" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{entity.label}</p>
                    <p className="text-[10px] text-[var(--muted)]">{entity.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create button */}
      <button
        onClick={handleCreate}
        disabled={loading || !name.trim()}
        className="w-full py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Creating...
          </>
        ) : (
          <>
            <Building2 size={16} />
            Create Organization
          </>
        )}
      </button>
    </div>
  );
}
