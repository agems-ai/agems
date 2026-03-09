'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Building2, ArrowLeft } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '', orgName: '', inviteCode: '' });

  // Org picker state
  const [orgPicker, setOrgPicker] = useState(false);
  const [organizations, setOrganizations] = useState<any[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      let res: any;
      if (mode === 'register') {
        res = await api.register(form.email, form.password, form.name, form.orgName || undefined, form.inviteCode || undefined);
      } else {
        res = await api.login(form.email, form.password);
      }

      // Multi-org: show org picker
      if (res.requireOrgSelection) {
        setOrganizations(res.organizations);
        setOrgPicker(true);
        setLoading(false);
        return;
      }

      api.setToken(res.token);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const selectOrg = async (orgId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.login(form.email, form.password, orgId);
      api.setToken(res.token);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to select organization');
    } finally {
      setLoading(false);
    }
  };

  // Org picker screen
  if (orgPicker) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-2">
              <span className="bg-gradient-to-r from-[#6c5ce7] to-[#00cec9] bg-clip-text text-transparent">AGEMS</span>
            </h1>
            <p className="text-sm text-[var(--muted)]">Select Organization</p>
          </div>

          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
            {error && <div className="p-3 mb-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>}

            <div className="space-y-2">
              {organizations.map((org) => (
                <button
                  key={org.id}
                  onClick={() => selectOrg(org.id)}
                  disabled={loading}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-[var(--background)] border border-[var(--border)] rounded-lg hover:border-[var(--accent)] transition-colors text-left disabled:opacity-50"
                >
                  <div className="w-9 h-9 rounded-lg bg-[var(--accent)]/20 flex items-center justify-center">
                    <Building2 size={18} className="text-[var(--accent)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{org.name}</p>
                    <p className="text-xs text-[var(--muted)]">{org.role} &middot; {org.plan}</p>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => { setOrgPicker(false); setError(''); }}
              className="mt-4 flex items-center gap-2 text-sm text-[var(--muted)] hover:text-white transition-colors"
            >
              <ArrowLeft size={14} />
              Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">
            <span className="bg-gradient-to-r from-[#6c5ce7] to-[#00cec9] bg-clip-text text-transparent">AGEMS</span>
          </h1>
          <p className="text-sm text-[var(--muted)]">Agent Management System</p>
        </div>

        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
          <div className="flex mb-6 border-b border-[var(--border)]">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 pb-3 text-sm font-medium transition-colors ${mode === 'login' ? 'text-white border-b-2 border-[var(--accent)]' : 'text-[var(--muted)]'}`}
            >
              Login
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 pb-3 text-sm font-medium transition-colors ${mode === 'register' ? 'text-white border-b-2 border-[var(--accent)]' : 'text-[var(--muted)]'}`}
            >
              Register
            </button>
          </div>

          {error && <div className="p-3 mb-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className="text-sm text-[var(--muted)] block mb-1">Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    required
                    className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-white text-sm outline-none focus:border-[var(--accent)]"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label className="text-sm text-[var(--muted)] block mb-1">Organization</label>
                  <input
                    type="text"
                    value={form.orgName}
                    onChange={e => setForm(f => ({ ...f, orgName: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-white text-sm outline-none focus:border-[var(--accent)]"
                    placeholder="Company name (optional)"
                  />
                </div>
                <div>
                  <label className="text-sm text-[var(--muted)] block mb-1">Invite Code</label>
                  <input
                    type="text"
                    value={form.inviteCode}
                    onChange={e => setForm(f => ({ ...f, inviteCode: e.target.value }))}
                    required
                    className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-white text-sm outline-none focus:border-[var(--accent)]"
                    placeholder="Enter invite code"
                  />
                </div>
              </>
            )}
            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                required
                className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-white text-sm outline-none focus:border-[var(--accent)]"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                minLength={8}
                maxLength={128}
                className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-white text-sm outline-none focus:border-[var(--accent)]"
                placeholder="Min 8 characters"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
