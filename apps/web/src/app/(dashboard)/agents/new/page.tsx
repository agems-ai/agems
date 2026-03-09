'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

const providers = ['ANTHROPIC', 'OPENAI', 'GOOGLE', 'DEEPSEEK', 'MISTRAL', 'OLLAMA', 'CUSTOM'];
const types = ['AUTONOMOUS', 'ASSISTANT', 'META', 'REACTIVE'];

export default function NewAgentPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    slug: '',
    avatar: '🤖',
    type: 'AUTONOMOUS',
    llmProvider: 'ANTHROPIC',
    llmModel: 'claude-opus-4-6',
    systemPrompt: '',
    mission: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const agent = await api.createAgent(form) as any;
      router.push(`/agents/${agent.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create agent');
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <Link href="/agents" className="text-sm text-[var(--muted)] hover:text-white mb-4 inline-block">&larr; Back to agents</Link>
      <h1 className="text-3xl font-bold mb-8">Create Agent</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Name" required>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') }))} required />
          </Field>
          <Field label="Slug">
            <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Avatar">
            <input value={form.avatar} onChange={e => setForm(f => ({ ...f, avatar: e.target.value }))} />
          </Field>
          <Field label="Type">
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Provider">
            <select value={form.llmProvider} onChange={e => setForm(f => ({ ...f, llmProvider: e.target.value }))}>
              {providers.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Model">
          <input value={form.llmModel} onChange={e => setForm(f => ({ ...f, llmModel: e.target.value }))} placeholder="claude-opus-4-6" />
        </Field>

        <Field label="Mission">
          <input value={form.mission} onChange={e => setForm(f => ({ ...f, mission: e.target.value }))} placeholder="What is this agent's purpose?" />
        </Field>

        <Field label="System Prompt" required>
          <textarea value={form.systemPrompt} onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))} rows={6} required placeholder="You are..." />
        </Field>

        <div className="flex gap-3 pt-4">
          <button type="submit" disabled={saving} className="px-6 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg font-medium transition-colors disabled:opacity-50">
            {saving ? 'Creating...' : 'Create Agent'}
          </button>
          <Link href="/agents" className="px-6 py-2.5 border border-[var(--border)] rounded-lg hover:border-[var(--accent)] transition-colors">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm text-[var(--muted)] mb-1 block">{label}{required && <span className="text-red-400 ml-1">*</span>}</span>
      <div className="[&>input]:w-full [&>input]:px-3 [&>input]:py-2 [&>input]:bg-[var(--background)] [&>input]:border [&>input]:border-[var(--border)] [&>input]:rounded-lg [&>input]:text-white [&>input]:text-sm [&>input]:outline-none [&>input:focus]:border-[var(--accent)] [&>select]:w-full [&>select]:px-3 [&>select]:py-2 [&>select]:bg-[var(--background)] [&>select]:border [&>select]:border-[var(--border)] [&>select]:rounded-lg [&>select]:text-white [&>select]:text-sm [&>select]:outline-none [&>textarea]:w-full [&>textarea]:px-3 [&>textarea]:py-2 [&>textarea]:bg-[var(--background)] [&>textarea]:border [&>textarea]:border-[var(--border)] [&>textarea]:rounded-lg [&>textarea]:text-white [&>textarea]:text-sm [&>textarea]:outline-none [&>textarea:focus]:border-[var(--accent)] [&>textarea]:resize-y">
        {children}
      </div>
    </label>
  );
}
