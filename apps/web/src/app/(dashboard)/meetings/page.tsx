'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const statusColors: Record<string, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-green-100 text-green-700',
  COMPLETED: 'bg-gray-100 text-gray-600',
  CANCELLED: 'bg-red-100 text-red-600',
};

export default function MeetingsPage() {
  const router = useRouter();
  const [meetings, setMeetings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);
  const [form, setForm] = useState({ title: '', agenda: '', scheduledAt: '', participantIds: [] as string[] });

  useEffect(() => {
    api.getMeetings().then((r: any) => setMeetings(r.data || [])).finally(() => setLoading(false));
    api.getAgents().then((r: any) => setAgents(r.data || []));
  }, []);

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    const meeting: any = await api.createMeeting({
      title: form.title,
      agenda: form.agenda,
      scheduledAt: form.scheduledAt || undefined,
      participants: form.participantIds.map((id) => ({ type: 'AGENT', id, role: 'MEMBER' })),
    });
    router.push(`/meetings/${meeting.id}`);
  };

  const toggleParticipant = (agentId: string) => {
    setForm((prev) => ({
      ...prev,
      participantIds: prev.participantIds.includes(agentId)
        ? prev.participantIds.filter((id) => id !== agentId)
        : [...prev.participantIds, agentId],
    }));
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-1">Meeting Room</h1>
          <p className="text-[var(--muted)] text-sm md:text-base">AI-powered meetings with voting and decisions</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90">
          + New Meeting
        </button>
      </div>

      {loading ? (
        <p className="text-[var(--muted)]">Loading...</p>
      ) : meetings.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-4xl mb-4">🏛️</p>
          <p className="text-lg font-medium mb-2">No meetings yet</p>
          <p className="text-[var(--muted)] mb-4">Schedule a meeting with your agents</p>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg">+ Schedule Meeting</button>
        </div>
      ) : (
        <div className="space-y-3">
          {meetings.map((m) => (
            <button
              key={m.id}
              onClick={() => router.push(`/meetings/${m.id}`)}
              className="w-full text-left bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 hover:border-[var(--accent)] transition"
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-base md:text-lg">{m.title}</h3>
                  {m.agenda && <p className="text-sm text-[var(--muted)] mt-1">{m.agenda}</p>}
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[m.status] || 'bg-gray-100'}`}>
                  {m.status}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-[var(--muted)]">
                <span>{m.participants?.length || 0} participants</span>
                <span>{m.scheduledAt ? new Date(m.scheduledAt).toLocaleDateString() : 'No date'}</span>
                {m.startedAt && <span>Started: {new Date(m.startedAt).toLocaleTimeString()}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-[var(--card)] rounded-xl p-6 w-full max-w-[520px] mx-4 border border-[var(--border)] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">New Meeting</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Agenda</label>
                <textarea value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })}
                  rows={3} className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Date & Time</label>
                <input type="datetime-local" value={form.scheduledAt}
                  onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Participants</label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {agents.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 p-2 rounded hover:bg-[var(--hover)] cursor-pointer">
                      <input type="checkbox" checked={form.participantIds.includes(a.id)}
                        onChange={() => toggleParticipant(a.id)} className="rounded" />
                      <span className="text-sm">{a.name}</span>
                      <span className="text-xs text-[var(--muted)]">{a.positions?.[0]?.title || a.role}</span>
                    </label>
                  ))}
                  {agents.length === 0 && <p className="text-sm text-[var(--muted)]">No agents available</p>}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Cancel</button>
              <button onClick={handleCreate} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
