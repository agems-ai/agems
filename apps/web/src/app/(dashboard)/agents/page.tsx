'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { MessageSquare, Archive } from 'lucide-react';

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/20 text-emerald-400',
  DRAFT: 'bg-gray-500/20 text-gray-400',
  PAUSED: 'bg-yellow-500/20 text-yellow-400',
  ERROR: 'bg-red-500/20 text-red-400',
  ARCHIVED: 'bg-gray-500/20 text-gray-500',
};

const typeIcons: Record<string, string> = {
  AUTONOMOUS: '🤖',
  ASSISTANT: '🧑‍💻',
  META: '👑',
  REACTIVE: '⚡',
};

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAgents = () => {
    api.getAgents({ pageSize: '100' }).then((res) => {
      setAgents(res.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { loadAgents(); }, []);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 md:mb-8 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Agent Registry</h1>
          <p className="text-[var(--muted)] mt-1 text-sm">Manage your AI agents</p>
        </div>
        <Link
          href="/agents/new"
          className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg font-medium transition-colors text-sm"
        >
          + New Agent
        </Link>
      </div>

      {loading ? (
        <div className="text-center text-[var(--muted)] py-20">Loading agents...</div>
      ) : agents.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-4xl mb-4">🤖</p>
          <p className="text-lg font-medium mb-2">No agents yet</p>
          <p className="text-[var(--muted)] mb-4">Create your first AI agent to get started</p>
          <Link
            href="/agents/new"
            className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg font-medium transition-colors inline-block"
          >
            Create Agent
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <Link
              key={agent.id}
              href={`/agents/${agent.id}`}
              className="block p-5 bg-[var(--card)] hover:bg-[var(--card-hover)] border border-[var(--border)] rounded-xl transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  {agent.avatar && agent.avatar.startsWith('/') ? (
                    <img src={agent.avatar} alt={agent.name} className="w-8 h-8 rounded-full object-cover object-top" />
                  ) : (
                    <span className="text-2xl">{agent.avatar || typeIcons[agent.type] || '🤖'}</span>
                  )}
                  <div>
                    <h3 className="font-semibold">{agent.name}</h3>
                    <p className="text-xs text-[var(--muted)]">{agent.positions?.[0]?.title || agent.slug}</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[agent.status]}`}>
                  {agent.status}
                </span>
              </div>
              <p className="text-sm text-[var(--muted)] line-clamp-2 mb-3">
                {agent.mission || agent.systemPrompt?.substring(0, 100)}
              </p>
              <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
                <span className="px-2 py-0.5 bg-[var(--accent)]/10 rounded-full">{agent.llmProvider}</span>
                <span>{agent.llmModel}</span>
                {agent._count && (
                  <span className="ml-auto">{agent._count.tools} tools</span>
                )}
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/comms?direct=AGENT:${agent.id}`); }}
                  className="p-1 rounded hover:bg-[var(--accent)]/20 text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
                  title="Open Chat"
                >
                  <MessageSquare size={14} strokeWidth={1.5} />
                </button>
                {agent.status !== 'ARCHIVED' && (
                  <button
                    onClick={async (e) => {
                      e.preventDefault(); e.stopPropagation();
                      if (confirm(`Archive ${agent.name}?`)) {
                        await api.archiveAgent(agent.id);
                        loadAgents();
                      }
                    }}
                    className="p-1 rounded hover:bg-red-500/10 text-[var(--muted)] hover:text-red-400 transition-colors"
                    title="Archive"
                  >
                    <Archive size={14} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
