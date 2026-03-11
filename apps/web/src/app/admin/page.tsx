'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface AdminStats {
  companies: { total: number; enterprise: number; pro: number; free: number };
  users: number;
  agents: number;
  recentOrgs: Array<{
    id: string;
    name: string;
    slug: string;
    plan: string;
    createdAt: string;
    metadata: any;
    _count: { members: number; agents: number };
  }>;
  github: {
    stars: number;
    forks: number;
    watchers: number;
    openIssues: number;
    contributors: number;
    language: string;
    topics: string[];
    createdAt: string;
    updatedAt: string;
    size: number;
  } | null;
  achievements: Array<{
    name: string;
    description: string;
    icon: string;
    tier: string | null;
    requirement: string;
    progress: number;
    maxProgress: number;
    unlocked: boolean;
  }>;
}

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const user = api.getUserFromToken();
    if (!user) {
      router.push('/login');
      return;
    }

    api.getAdminStats()
      .then(setStats)
      .catch(err => setError(err.message || 'Access denied'))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="text-[#888]">Loading admin panel...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-lg mb-2">Access Denied</div>
          <div className="text-[#888] text-sm">{error}</div>
          <button onClick={() => router.push('/dashboard')} className="mt-4 px-4 py-2 bg-[#1a1a2e] border border-[#333] rounded-lg text-sm hover:border-[#6366f1] transition-colors">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const gh = stats.github;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="max-w-6xl mx-auto p-6 md:p-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">AGEMS Admin</h1>
            <p className="text-[#888] text-sm mt-1">Platform statistics and GitHub achievements</p>
          </div>
          <button onClick={() => router.push('/dashboard')} className="px-4 py-2 bg-[#1a1a2e] border border-[#333] rounded-lg text-sm hover:border-[#6366f1] transition-colors">
            Back to Dashboard
          </button>
        </div>

        {/* Main Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Companies" value={stats.companies.total} color="#6366f1" />
          <StatCard label="Enterprise" value={stats.companies.enterprise} color="#f59e0b" />
          <StatCard label="Pro" value={stats.companies.pro} color="#10b981" />
          <StatCard label="Free" value={stats.companies.free} color="#888" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          <StatCard label="Total Users" value={stats.users} color="#8b5cf6" />
          <StatCard label="Total Agents" value={stats.agents} color="#ec4899" />
          <StatCard label="GitHub Stars" value={gh?.stars ?? 0} color="#f59e0b" icon="star" />
        </div>

        {/* GitHub Stats */}
        {gh && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4">GitHub Repository</h2>
            <div className="bg-[#12121a] border border-[#222] rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">📦</span>
                <div>
                  <a href="https://github.com/agems-ai/agems" target="_blank" rel="noopener noreferrer" className="text-lg font-semibold hover:text-[#6366f1] transition-colors">
                    agems-ai/agems
                  </a>
                  <p className="text-[#888] text-xs">{gh.language} &middot; {(gh.size / 1024).toFixed(1)} MB</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <GhStat icon="star" label="Stars" value={gh.stars} />
                <GhStat icon="fork" label="Forks" value={gh.forks} />
                <GhStat icon="eye" label="Watchers" value={gh.watchers} />
                <GhStat icon="user" label="Contributors" value={gh.contributors} />
                <GhStat icon="issue" label="Open Issues" value={gh.openIssues} />
              </div>
              {gh.topics.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {gh.topics.map(t => (
                    <span key={t} className="text-xs bg-[#6366f1]/10 text-[#6366f1] px-2 py-0.5 rounded-full">{t}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* GitHub Achievements */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">GitHub Achievements</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {stats.achievements.map(a => (
              <div key={a.name} className={`bg-[#12121a] border rounded-xl p-4 flex items-start gap-4 ${a.unlocked ? 'border-[#f59e0b]/40' : 'border-[#222]'}`}>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 ${a.unlocked ? 'bg-[#f59e0b]/10' : 'bg-[#1a1a2e]'}`}>
                  {a.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{a.name}</span>
                    {a.tier && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        a.tier === 'Gold' ? 'bg-yellow-500/20 text-yellow-400' :
                        a.tier === 'Silver' ? 'bg-gray-400/20 text-gray-300' :
                        a.tier === 'Bronze' ? 'bg-orange-500/20 text-orange-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {a.tier}
                      </span>
                    )}
                    {a.unlocked && <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full">Unlocked</span>}
                  </div>
                  <p className="text-xs text-[#888] mt-0.5">{a.description}</p>
                  <p className="text-xs text-[#666] mt-1">{a.requirement}</p>
                  {a.maxProgress > 0 && (
                    <div className="mt-2">
                      <div className="w-full h-1.5 bg-[#1a1a2e] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${a.unlocked ? 'bg-[#f59e0b]' : 'bg-[#6366f1]'}`}
                          style={{ width: `${Math.min(100, (a.progress / a.maxProgress) * 100)}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-[#666] mt-0.5">{a.progress} / {a.maxProgress}</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Organizations */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Recent Organizations</h2>
          <div className="bg-[#12121a] border border-[#222] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#222] text-[#888] text-xs">
                  <th className="text-left p-3 font-medium">Name</th>
                  <th className="text-left p-3 font-medium">Plan</th>
                  <th className="text-left p-3 font-medium">Members</th>
                  <th className="text-left p-3 font-medium">Agents</th>
                  <th className="text-left p-3 font-medium">Created</th>
                  <th className="text-left p-3 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentOrgs.map(org => (
                  <tr key={org.id} className="border-b border-[#222] last:border-0 hover:bg-[#1a1a2e]">
                    <td className="p-3">
                      <div className="font-medium">{org.name}</div>
                      <div className="text-[10px] text-[#666]">{org.slug}</div>
                    </td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        org.plan === 'ENTERPRISE' ? 'bg-amber-500/20 text-amber-400' :
                        org.plan === 'PRO' ? 'bg-green-500/20 text-green-400' :
                        'bg-[#1a1a2e] text-[#888]'
                      }`}>
                        {org.plan}
                      </span>
                    </td>
                    <td className="p-3 text-[#888]">{org._count.members}</td>
                    <td className="p-3 text-[#888]">{org._count.agents}</td>
                    <td className="p-3 text-[#888] text-xs">{new Date(org.createdAt).toLocaleDateString()}</td>
                    <td className="p-3">
                      {(org.metadata as any)?.isDemo ? (
                        <span className="text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded-full">
                          Demo {(org.metadata as any)?.demoType}
                        </span>
                      ) : (
                        <span className="text-[10px] bg-[#1a1a2e] text-[#888] px-1.5 py-0.5 rounded-full">Regular</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon?: string }) {
  return (
    <div className="bg-[#12121a] border border-[#222] rounded-xl p-4">
      <div className="text-xs text-[#888] mb-1">{label}</div>
      <div className="text-2xl font-bold" style={{ color }}>
        {icon === 'star' && '★ '}{value.toLocaleString()}
      </div>
    </div>
  );
}

function GhStat({ icon, label, value }: { icon: string; label: string; value: number }) {
  const icons: Record<string, string> = {
    star: '★',
    fork: '🔱',
    eye: '👁',
    user: '👤',
    issue: '🔴',
  };
  return (
    <div className="text-center">
      <div className="text-lg">{icons[icon] || ''}</div>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] text-[#888]">{label}</div>
    </div>
  );
}
