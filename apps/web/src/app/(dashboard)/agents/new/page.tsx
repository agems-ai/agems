'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

const providers = ['ANTHROPIC', 'OPENAI', 'GOOGLE', 'DEEPSEEK', 'MISTRAL', 'OLLAMA', 'CUSTOM'];
const types = ['AUTONOMOUS', 'ASSISTANT', 'META', 'REACTIVE', 'EXTERNAL'];
const adapterTypes = ['CLAUDE_CODE', 'CODEX', 'CURSOR', 'GEMINI_CLI', 'OPENCLAW', 'OPENCODE', 'PI', 'HTTP', 'PROCESS'];

const adapterConfigTemplates: Record<string, Record<string, string>> = {
  CLAUDE_CODE: { workingDirectory: '/path/to/project', maxTokens: '8192' },
  CODEX: { workingDirectory: '/path/to/project', approvalMode: 'suggest' },
  CURSOR: { workingDirectory: '/path/to/project' },
  GEMINI_CLI: { workingDirectory: '/path/to/project' },
  OPENCLAW: { gatewayUrl: 'http://localhost:8080', apiKey: '', model: 'default' },
  OPENCODE: { workingDirectory: '/path/to/project' },
  PI: { workingDirectory: '/path/to/project' },
  HTTP: { url: 'https://your-api.com/execute', method: 'POST', authType: 'bearer', authToken: '' },
  PROCESS: { command: '/path/to/binary', args: '', workingDirectory: '/path/to/project' },
};

interface AgentTemplate {
  slug: string;
  name: string;
  avatar: string;
  type: string;
  department: string;
  position: string;
  mission: string;
  tags: string[];
  tools: string[];
  skills: string[];
  isStartupEssential: boolean;
}

export default function NewAgentPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'scratch' | 'template'>('template');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [filter, setFilter] = useState('');
  const [importing, setImporting] = useState('');
  const [form, setForm] = useState<Record<string, any>>({
    name: '',
    slug: '',
    avatar: '',
    type: 'AUTONOMOUS',
    llmProvider: 'ANTHROPIC',
    llmModel: 'claude-sonnet-4-5-20250929',
    systemPrompt: '',
    mission: '',
    adapterType: '',
    adapterConfig: {},
  });

  useEffect(() => {
    api.getAgentTemplates()
      .then(setTemplates)
      .catch(() => {})
      .finally(() => setLoadingTemplates(false));
    // Load platform defaults for new agents
    api.getSettings().then((s) => {
      const updates: Record<string, any> = {};
      if (s.default_llm_provider) updates.llmProvider = s.default_llm_provider;
      if (s.default_model) updates.llmModel = s.default_model;
      if (Object.keys(updates).length) setForm((f) => ({ ...f, ...updates }));
    }).catch(() => {});
  }, []);

  const isExternal = form.type === 'EXTERNAL';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, any> = { ...form };
      if (!isExternal) {
        delete payload.adapterType;
        delete payload.adapterConfig;
      } else {
        delete payload.llmProvider;
        delete payload.llmModel;
      }
      const agent = await api.createAgent(payload) as any;
      router.push(`/agents/${agent.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create agent');
      setSaving(false);
    }
  };

  const handleImport = async (template: AgentTemplate) => {
    setImporting(template.slug);
    setError('');
    try {
      const agent = await api.importAgentFromTemplate(template.slug) as any;
      router.push(`/agents/${agent.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to import agent');
      setImporting('');
    }
  };

  const departments = [...new Set(templates.map(t => t.department))];
  const filteredTemplates = templates.filter(t => {
    if (!filter) return true;
    if (filter === '_essential') return t.isStartupEssential;
    return t.department === filter;
  });

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <Link href="/agents" className="text-sm text-[var(--muted)] hover:text-white mb-4 inline-block">&larr; Back to agents</Link>
      <h1 className="text-3xl font-bold mb-6">Create Agent</h1>

      {/* Tab Switcher */}
      <div className="flex gap-1 mb-6 bg-[var(--surface)] p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('template')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'template' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)] hover:text-white'}`}
        >
          Import from Template
        </button>
        <button
          onClick={() => setTab('scratch')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'scratch' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)] hover:text-white'}`}
        >
          From Scratch
        </button>
      </div>

      {error && <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm mb-4">{error}</div>}

      {tab === 'template' ? (
        <div>
          {/* Filter Bar */}
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => setFilter('')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!filter ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface)] text-[var(--muted)] hover:text-white'}`}
            >
              All ({templates.length})
            </button>
            <button
              onClick={() => setFilter('_essential')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === '_essential' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface)] text-[var(--muted)] hover:text-white'}`}
            >
              Essential ({templates.filter(t => t.isStartupEssential).length})
            </button>
            {departments.map(d => (
              <button
                key={d}
                onClick={() => setFilter(d)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === d ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface)] text-[var(--muted)] hover:text-white'}`}
              >
                {d} ({templates.filter(t => t.department === d).length})
              </button>
            ))}
          </div>

          {loadingTemplates ? (
            <div className="text-center py-12 text-[var(--muted)]">Loading templates...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTemplates.map(t => (
                <div
                  key={t.slug}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-[var(--accent)] transition-colors group"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center text-lg flex-shrink-0">
                      {t.avatar.startsWith('/') ? (
                        <img src={t.avatar} alt={t.name} className="w-8 h-8 rounded-md" />
                      ) : t.avatar}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm">{t.name}</h3>
                      <p className="text-xs text-[var(--accent)]">{t.position}</p>
                    </div>
                    {t.isStartupEssential && (
                      <span className="ml-auto text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full flex-shrink-0">Essential</span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)] mb-3 line-clamp-2">{t.mission}</p>
                  <div className="flex flex-wrap gap-1 mb-3">
                    <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">{t.department}</span>
                    {t.tools.slice(0, 2).map(tool => (
                      <span key={tool} className="text-[10px] bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded">{tool}</span>
                    ))}
                    {t.tools.length > 2 && (
                      <span className="text-[10px] bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded">+{t.tools.length - 2}</span>
                    )}
                    <span className="text-[10px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded">{t.skills.length} skills</span>
                  </div>
                  <button
                    onClick={() => handleImport(t)}
                    disabled={!!importing}
                    className="w-full px-3 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {importing === t.slug ? 'Importing...' : 'Import Agent'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
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
              <input value={form.avatar} onChange={e => setForm(f => ({ ...f, avatar: e.target.value }))} placeholder="/avatars/agent.png" />
            </Field>
            <Field label="Type">
              <select value={form.type} onChange={e => {
                const newType = e.target.value;
                if (newType === 'EXTERNAL') {
                  setForm(f => ({ ...f, type: newType, adapterType: 'CLAUDE_CODE', adapterConfig: { ...adapterConfigTemplates.CLAUDE_CODE } }));
                } else {
                  setForm(f => ({ ...f, type: newType, adapterType: '', adapterConfig: {} }));
                }
              }}>
                {types.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            {!isExternal ? (
              <Field label="Provider">
                <select value={form.llmProvider} onChange={e => setForm(f => ({ ...f, llmProvider: e.target.value }))}>
                  {providers.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Adapter">
                <select value={form.adapterType} onChange={e => {
                  const at = e.target.value;
                  setForm(f => ({ ...f, adapterType: at, adapterConfig: { ...(adapterConfigTemplates[at] || {}) } }));
                }}>
                  {adapterTypes.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
                </select>
              </Field>
            )}
          </div>

          {!isExternal ? (
            <Field label="Model">
              <input value={form.llmModel} onChange={e => setForm(f => ({ ...f, llmModel: e.target.value }))} placeholder="claude-sonnet-4-5-20250929" />
            </Field>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium">Adapter Configuration</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(form.adapterConfig || {}).map(([key, val]) => (
                  <Field key={key} label={key}>
                    <input value={String(val)} onChange={e => setForm(f => ({ ...f, adapterConfig: { ...f.adapterConfig, [key]: e.target.value } }))} />
                  </Field>
                ))}
              </div>
            </div>
          )}

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
      )}
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
