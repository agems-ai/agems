'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function SettingsPage() {
  const [tab, setTab] = useState<'llm' | 'platform' | 'n8n' | 'tasks' | 'prompts' | 'system'>('llm');

  // LLM Keys
  const [llmKeys, setLlmKeys] = useState<Record<string, { set: boolean; masked: string }>>({});
  const [newKeys, setNewKeys] = useState({ openai: '', anthropic: '', google: '', deepseek: '', mistral: '' });
  const [savingKeys, setSavingKeys] = useState(false);
  const [keysSaved, setKeysSaved] = useState(false);

  // Platform settings
  const [platformForm, setPlatformForm] = useState({
    platform_name: 'AGEMS Platform',
    default_llm_provider: 'OPENAI',
    default_model: 'gpt-4o',
    max_concurrent_executions: '10',
    execution_timeout: '300',
  });
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [platformSaved, setPlatformSaved] = useState(false);

  // Task Agents
  const [taskAgentsEnabled, setTaskAgentsEnabled] = useState(true);
  const [taskInterval, setTaskInterval] = useState(60);
  const [reviewInterval, setReviewInterval] = useState(300);
  const [reviewBudget, setReviewBudget] = useState(1.0);
  const [autonomyLevel, setAutonomyLevel] = useState(3);
  const [savingTasks, setSavingTasks] = useState(false);
  const [tasksSaved, setTasksSaved] = useState(false);

  // System Prompts
  const [preamble, setPreamble] = useState('');
  const [preambleOriginal, setPreambleOriginal] = useState('');
  const [savingPrompts, setSavingPrompts] = useState(false);
  const [promptsSaved, setPromptsSaved] = useState(false);
  const [resettingPrompts, setResettingPrompts] = useState(false);

  // N8N
  const [n8nUrl, setN8nUrl] = useState('');
  const [n8nKey, setN8nKey] = useState('');
  const [n8nConfig, setN8nConfig] = useState<{ url: string; keySet: boolean; keyMasked: string }>({ url: '', keySet: false, keyMasked: '' });
  const [savingN8n, setSavingN8n] = useState(false);
  const [n8nSaved, setN8nSaved] = useState(false);
  const [n8nTest, setN8nTest] = useState<{ ok?: boolean; error?: string; workflowCount?: number } | null>(null);
  const [testingN8n, setTestingN8n] = useState(false);

  // System Update
  const [versionInfo, setVersionInfo] = useState<any>(null);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<any>(null);

  useEffect(() => {
    api.getLlmKeys().then(setLlmKeys).catch(() => {});
    api.getSettings().then((s) => {
      setPlatformForm({
        platform_name: s.platform_name || 'AGEMS Platform',
        default_llm_provider: s.default_llm_provider || 'OPENAI',
        default_model: s.default_model || 'gpt-4o',
        max_concurrent_executions: s.max_concurrent_executions || '10',
        execution_timeout: s.execution_timeout || '300',
      });
    }).catch(() => {});
    api.getN8nSettings().then((c) => {
      setN8nConfig(c);
      setN8nUrl(c.url);
    }).catch(() => {});
    api.getTaskAgentsConfig().then((c) => {
      setTaskAgentsEnabled(c.enabled);
      setTaskInterval(c.interval);
      setReviewInterval(c.reviewInterval);
      setReviewBudget(c.reviewBudget);
      setAutonomyLevel(c.autonomyLevel);
    }).catch(() => {});
    api.getSystemPrompts().then((p) => {
      setPreamble(p.agems_preamble || '');
      setPreambleOriginal(p.agems_preamble || '');
    }).catch(() => {});
  }, []);

  const handleSaveKeys = async () => {
    setSavingKeys(true);
    try {
      const filtered: Record<string, string> = {};
      if (newKeys.openai) filtered.openai = newKeys.openai;
      if (newKeys.anthropic) filtered.anthropic = newKeys.anthropic;
      if (newKeys.google) filtered.google = newKeys.google;
      if (newKeys.deepseek) filtered.deepseek = newKeys.deepseek;
      if (newKeys.mistral) filtered.mistral = newKeys.mistral;
      if (Object.keys(filtered).length === 0) return;
      const result = await api.setLlmKeys(filtered);
      setLlmKeys(result);
      setNewKeys({ openai: '', anthropic: '', google: '', deepseek: '', mistral: '' });
      setKeysSaved(true);
      setTimeout(() => setKeysSaved(false), 2000);
    } finally {
      setSavingKeys(false);
    }
  };

  const handleSavePlatform = async () => {
    setSavingPlatform(true);
    try {
      await api.updateSettings(platformForm);
      setPlatformSaved(true);
      setTimeout(() => setPlatformSaved(false), 2000);
    } finally {
      setSavingPlatform(false);
    }
  };

  const providers = [
    { id: 'openai', name: 'OpenAI', desc: 'GPT-4, GPT-4o, Whisper', placeholder: 'sk-...' },
    { id: 'anthropic', name: 'Anthropic', desc: 'Claude 4, Claude 3.5', placeholder: 'sk-ant-...' },
    { id: 'google', name: 'Google AI', desc: 'Gemini Pro, Gemini Ultra', placeholder: 'AIza...' },
    { id: 'deepseek', name: 'DeepSeek', desc: 'DeepSeek V3, DeepSeek R1', placeholder: 'sk-...' },
    { id: 'mistral', name: 'Mistral', desc: 'Mistral Large, Mistral Medium', placeholder: 'sk-...' },
  ];

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold mb-1">Settings</h1>
      <p className="text-[var(--muted)] mb-6 text-sm">Platform configuration and API keys</p>

      <div className="flex gap-1 mb-6 bg-[var(--card)] p-1 rounded-lg border border-[var(--border)] w-fit overflow-x-auto max-w-full">
        {[
          { key: 'llm', label: 'LLM Keys' },
          { key: 'platform', label: 'Platform' },
          { key: 'tasks', label: 'Task Agents' },
          { key: 'prompts', label: 'System Prompts' },
          { key: 'n8n', label: 'N8N' },
          { key: 'system', label: 'System' },
        ].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${tab === t.key ? 'bg-[var(--accent)] text-white' : 'hover:bg-[var(--hover)]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'llm' && (
        <div className="space-y-4">
          {providers.map((p) => {
            const info = llmKeys[p.id];
            return (
              <div key={p.id} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold">{p.name}</h3>
                    <p className="text-xs text-[var(--muted)]">{p.desc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {info?.set && (
                      <span className="text-xs text-[var(--muted)] font-mono">{info.masked}</span>
                    )}
                    <div className={`w-3 h-3 rounded-full ${info?.set ? 'bg-green-500' : 'bg-gray-400'}`} />
                  </div>
                </div>
                <input
                  type="password"
                  value={(newKeys as any)[p.id]}
                  onChange={(e) => setNewKeys({ ...newKeys, [p.id]: e.target.value })}
                  placeholder={info?.set ? 'Enter new key to update...' : p.placeholder}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-mono text-sm"
                />
              </div>
            );
          })}
          <div className="flex items-center gap-3">
            <button onClick={handleSaveKeys} disabled={savingKeys}
              className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
              {savingKeys ? 'Saving...' : 'Save Keys'}
            </button>
            {keysSaved && <span className="text-green-500 text-sm">Saved!</span>}
          </div>
        </div>
      )}

      {tab === 'platform' && (
        <div className="space-y-4">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <h3 className="font-semibold mb-3">General</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Platform Name</label>
                <input value={platformForm.platform_name}
                  onChange={(e) => setPlatformForm({ ...platformForm, platform_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Default LLM Provider</label>
                <select value={platformForm.default_llm_provider}
                  onChange={(e) => setPlatformForm({ ...platformForm, default_llm_provider: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  <option value="OPENAI">OpenAI</option>
                  <option value="ANTHROPIC">Anthropic</option>
                  <option value="GOOGLE">Google</option>
                  <option value="DEEPSEEK">DeepSeek</option>
                  <option value="MISTRAL">Mistral</option>
                  <option value="OLLAMA">Ollama</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Default Model</label>
                <input value={platformForm.default_model}
                  onChange={(e) => setPlatformForm({ ...platformForm, default_model: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>
            </div>
          </div>
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <h3 className="font-semibold mb-3">Execution</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Max Concurrent Executions</label>
                <input type="number" value={platformForm.max_concurrent_executions}
                  onChange={(e) => setPlatformForm({ ...platformForm, max_concurrent_executions: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Execution Timeout (seconds)</label>
                <input type="number" value={platformForm.execution_timeout}
                  onChange={(e) => setPlatformForm({ ...platformForm, execution_timeout: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleSavePlatform} disabled={savingPlatform}
              className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
              {savingPlatform ? 'Saving...' : 'Save Settings'}
            </button>
            {platformSaved && <span className="text-green-500 text-sm">Saved!</span>}
          </div>
        </div>
      )}

      {tab === 'tasks' && (
        <div className="space-y-4">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold">Agent Task Execution</h3>
                <p className="text-xs text-[var(--muted)]">Control whether agents automatically pick up and execute assigned tasks</p>
              </div>
              <button
                onClick={async () => {
                  const newVal = !taskAgentsEnabled;
                  setTaskAgentsEnabled(newVal);
                  setSavingTasks(true);
                  try {
                    const res = await api.setTaskAgentsConfig({ enabled: newVal });
                    setTaskAgentsEnabled(res.enabled);
                  } catch { setTaskAgentsEnabled(!newVal); }
                  finally { setSavingTasks(false); }
                }}
                disabled={savingTasks}
                className={`relative w-14 h-7 rounded-full transition-colors duration-200 ${
                  taskAgentsEnabled ? 'bg-emerald-500' : 'bg-gray-600'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform duration-200 ${
                  taskAgentsEnabled ? 'translate-x-7' : 'translate-x-0'
                }`} />
              </button>
            </div>

            <div className={`p-4 rounded-lg border ${taskAgentsEnabled ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${taskAgentsEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                <span className={`text-sm font-medium ${taskAgentsEnabled ? 'text-emerald-400' : 'text-red-400'}`}>
                  {taskAgentsEnabled ? 'Agents are actively executing tasks' : 'All agent task execution is paused'}
                </span>
              </div>
              <p className="text-xs text-[var(--muted)] mt-1 ml-4.5">
                {taskAgentsEnabled
                  ? 'The scheduler picks up pending tasks and assigns them to agents automatically.'
                  : 'No new tasks will be started. Tasks already in progress will finish, but no new ones will begin.'}
              </p>
            </div>
          </div>

          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <h3 className="font-semibold mb-1">Autonomy Level</h3>
            <p className="text-xs text-[var(--muted)] mb-4">
              Controls how agents balance independent work vs team collaboration. Low = agents do everything themselves. High = agents delegate and coordinate with specialists.
            </p>

            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <span className="text-xs text-[var(--muted)] w-10">Solo</span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={autonomyLevel}
                  onChange={(e) => setAutonomyLevel(parseInt(e.target.value))}
                  className="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
                  style={{ background: `linear-gradient(to right, var(--accent) ${(autonomyLevel - 1) * 25}%, var(--border) ${(autonomyLevel - 1) * 25}%)` }}
                />
                <span className="text-xs text-[var(--muted)] w-16 text-right">Full team</span>
              </div>

              <div className="flex justify-between px-10">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => setAutonomyLevel(n)}
                    className={`w-8 h-8 rounded-full text-xs font-bold transition-all ${
                      autonomyLevel === n
                        ? 'bg-[var(--accent)] text-white scale-110'
                        : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>

              <div className={`p-3 rounded-lg border text-sm ${
                autonomyLevel <= 2
                  ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                  : autonomyLevel === 3
                  ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
                  : 'border-purple-500/30 bg-purple-500/10 text-purple-300'
              }`}>
                {autonomyLevel === 1 && 'Solo — Agents work independently. Only ask for help when they truly cannot do the task.'}
                {autonomyLevel === 2 && 'Lean — Agents prefer self-reliance. Delegate only when specialized expertise is required.'}
                {autonomyLevel === 3 && 'Balanced — Agents use judgment. Simple tasks done alone, complex projects involve the team.'}
                {autonomyLevel === 4 && 'Team-first — Agents default to delegation. Create tasks for specialists even if they could do it.'}
                {autonomyLevel === 5 && 'Full collaboration — Every project involves all relevant specialists. Maximum coordination.'}
              </div>

              <button
                onClick={async () => {
                  setSavingTasks(true);
                  try {
                    const res = await api.setTaskAgentsConfig({ autonomyLevel });
                    setAutonomyLevel(res.autonomyLevel);
                    setTasksSaved(true);
                    setTimeout(() => setTasksSaved(false), 2000);
                  } finally { setSavingTasks(false); }
                }}
                disabled={savingTasks}
                className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {savingTasks ? 'Saving...' : 'Save Autonomy Level'}
              </button>
              {tasksSaved && <span className="text-green-500 text-sm ml-3">Saved!</span>}
            </div>
          </div>

          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <h3 className="font-semibold mb-3">Scheduler Interval</h3>
            <p className="text-xs text-[var(--muted)] mb-3">How often the scheduler checks for pending tasks and recurring task resets</p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={10}
                max={3600}
                value={taskInterval}
                onChange={(e) => setTaskInterval(parseInt(e.target.value) || 60)}
                className="w-28 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
              />
              <span className="text-sm text-[var(--muted)]">seconds</span>
              <span className="text-xs text-[var(--muted)]">(min 10s)</span>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={async () => {
                  setSavingTasks(true);
                  try {
                    const res = await api.setTaskAgentsConfig({ interval: taskInterval });
                    setTaskInterval(res.interval);
                    setTasksSaved(true);
                    setTimeout(() => setTasksSaved(false), 2000);
                  } finally { setSavingTasks(false); }
                }}
                disabled={savingTasks}
                className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {savingTasks ? 'Saving...' : 'Save Interval'}
              </button>
              {tasksSaved && <span className="text-green-500 text-sm">Saved! Scheduler restarted.</span>}
            </div>
          </div>

          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <h3 className="font-semibold mb-3">Review Cycle</h3>
            <p className="text-xs text-[var(--muted)] mb-3">How often agents are reminded to progress IN_PROGRESS tasks, review work, and verify results</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Review Interval</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={30}
                    max={3600}
                    value={reviewInterval}
                    onChange={(e) => setReviewInterval(parseInt(e.target.value) || 300)}
                    className="w-28 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                  />
                  <span className="text-sm text-[var(--muted)]">seconds</span>
                  <span className="text-xs text-[var(--muted)]">(min 30s)</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Daily Review Budget per Agent</label>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[var(--muted)]">$</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={reviewBudget}
                    onChange={(e) => setReviewBudget(parseFloat(e.target.value) || 1.0)}
                    className="w-28 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                  />
                  <span className="text-xs text-[var(--muted)]">USD/day per agent (0 = unlimited)</span>
                </div>
              </div>
              <button
                onClick={async () => {
                  setSavingTasks(true);
                  try {
                    const res = await api.setTaskAgentsConfig({ reviewInterval, reviewBudget });
                    setReviewInterval(res.reviewInterval);
                    setReviewBudget(res.reviewBudget);
                    setTasksSaved(true);
                    setTimeout(() => setTasksSaved(false), 2000);
                  } finally { setSavingTasks(false); }
                }}
                disabled={savingTasks}
                className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {savingTasks ? 'Saving...' : 'Save Review Settings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'prompts' && (
        <div className="space-y-4">
          {/* Warning banner */}
          <div className="p-4 rounded-xl border-2 border-amber-500/40 bg-amber-500/10">
            <div className="flex items-start gap-3">
              <span className="text-2xl mt-0.5">&#9888;&#65039;</span>
              <div>
                <h3 className="font-semibold text-amber-400 mb-1">Caution: Core Platform Instructions</h3>
                <p className="text-sm text-amber-300/80">
                  This prompt is injected into <strong>every agent</strong> on every execution. It teaches agents how to use the AGEMS platform — tasks, channels, meetings, approvals, memory.
                  Incorrect changes may cause agents to stop using platform features properly or behave unpredictably.
                </p>
                <p className="text-xs text-amber-300/60 mt-1">
                  Default is pre-filled for every new organization. Use &quot;Reset to Default&quot; to restore the original version.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold">AGEMS Platform Preamble</h3>
                <p className="text-xs text-[var(--muted)]">Platform instructions injected before every agent&apos;s system prompt</p>
              </div>
              <span className="text-xs text-[var(--muted)]">{preamble.length} chars</span>
            </div>
            <textarea
              value={preamble}
              onChange={(e) => setPreamble(e.target.value)}
              rows={24}
              className="w-full px-4 py-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-mono text-sm leading-relaxed resize-y"
              placeholder="AGEMS platform preamble..."
            />
            {preamble !== preambleOriginal && (
              <p className="text-xs text-amber-400 mt-2">Unsaved changes</p>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={async () => {
                setSavingPrompts(true);
                try {
                  const result = await api.setSystemPrompts({ agems_preamble: preamble });
                  setPreambleOriginal(result.agems_preamble);
                  setPreamble(result.agems_preamble);
                  setPromptsSaved(true);
                  setTimeout(() => setPromptsSaved(false), 2000);
                } finally { setSavingPrompts(false); }
              }}
              disabled={savingPrompts || preamble === preambleOriginal}
              className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {savingPrompts ? 'Saving...' : 'Save Prompt'}
            </button>

            <button
              onClick={async () => {
                if (!confirm('Reset AGEMS Preamble to factory default? This will overwrite your current version.')) return;
                setResettingPrompts(true);
                try {
                  const result = await api.resetSystemPrompt('agems_preamble');
                  setPreamble(result.agems_preamble);
                  setPreambleOriginal(result.agems_preamble);
                } finally { setResettingPrompts(false); }
              }}
              disabled={resettingPrompts}
              className="px-6 py-2 border border-amber-500/30 text-amber-400 rounded-lg hover:bg-amber-500/10 disabled:opacity-50"
            >
              {resettingPrompts ? 'Resetting...' : 'Reset to Default'}
            </button>

            {promptsSaved && <span className="text-green-500 text-sm">Saved!</span>}
          </div>
        </div>
      )}

      {tab === 'system' && (
        <div className="space-y-4">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold">System Version</h3>
                <p className="text-xs text-[var(--muted)]">Check for updates and update from GitHub</p>
              </div>
              <button
                onClick={async () => {
                  setCheckingVersion(true);
                  try {
                    const info = await api.getSystemVersion();
                    setVersionInfo(info);
                  } catch (e: any) {
                    setVersionInfo({ error: e.message });
                  }
                  setCheckingVersion(false);
                }}
                disabled={checkingVersion}
                className="px-4 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--hover)] disabled:opacity-50 text-sm"
              >
                {checkingVersion ? 'Checking...' : 'Check for Updates'}
              </button>
            </div>

            {versionInfo && !versionInfo.error && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                    <div className="text-xs text-[var(--muted)] mb-1">Current Version</div>
                    <div className="font-mono text-sm">{versionInfo.commit || versionInfo.version}</div>
                    {versionInfo.date && <div className="text-xs text-[var(--muted)] mt-0.5">{new Date(versionInfo.date).toLocaleString()}</div>}
                  </div>
                  <div className="p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                    <div className="text-xs text-[var(--muted)] mb-1">Branch</div>
                    <div className="font-mono text-sm">{versionInfo.branch || 'unknown'}</div>
                    {versionInfo.commitsBehind > 0 && (
                      <div className="text-xs text-amber-400 mt-0.5">{versionInfo.commitsBehind} commit(s) behind</div>
                    )}
                  </div>
                </div>

                {versionInfo.updateAvailable ? (
                  <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/10">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-sm font-medium text-amber-400">Update Available</span>
                      <span className="text-xs text-[var(--muted)] ml-auto">Latest: {versionInfo.remoteCommit}</span>
                    </div>
                    {versionInfo.remoteLog && (
                      <pre className="text-xs text-[var(--muted)] bg-black/20 rounded p-2 mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">
                        {versionInfo.remoteLog}
                      </pre>
                    )}
                  </div>
                ) : (
                  <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/10">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                      <span className="text-sm font-medium text-green-400">Up to date</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {versionInfo?.error && (
              <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/10">
                <p className="text-red-400 text-sm">{versionInfo.error}</p>
              </div>
            )}

            {!versionInfo && !checkingVersion && (
              <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                <p className="text-sm text-[var(--muted)]">Click &quot;Check for Updates&quot; to see the current version and available updates.</p>
              </div>
            )}
          </div>

          {versionInfo?.updateAvailable && versionInfo?.canAutoUpdate && (
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
              <h3 className="font-semibold mb-2">Apply Update</h3>
              <p className="text-xs text-[var(--muted)] mb-4">
                This will pull the latest code from GitHub and rebuild the containers. The platform will restart automatically — this takes about 30-60 seconds.
              </p>
              <button
                onClick={async () => {
                  if (!confirm('Update AGEMS to the latest version? The platform will restart.')) return;
                  setUpdating(true);
                  setUpdateResult(null);
                  try {
                    const result = await api.triggerSystemUpdate();
                    setUpdateResult(result);
                    if (result.ok) {
                      setTimeout(() => window.location.reload(), 40000);
                    }
                  } catch (e: any) {
                    setUpdateResult({ ok: false, error: e.message });
                  }
                  setUpdating(false);
                }}
                disabled={updating}
                className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {updating ? 'Updating...' : 'Update Now'}
              </button>

              {updateResult?.ok && (
                <div className="mt-4 p-4 rounded-lg border border-green-500/30 bg-green-500/10">
                  <p className="text-green-400 text-sm font-medium mb-2">{updateResult.message}</p>
                  {updateResult.pullLog && (
                    <pre className="text-xs text-[var(--muted)] bg-black/20 rounded p-2 whitespace-pre-wrap font-mono">{updateResult.pullLog}</pre>
                  )}
                  <p className="text-xs text-[var(--muted)] mt-2 animate-pulse">Page will reload automatically...</p>
                </div>
              )}

              {updateResult && !updateResult.ok && (
                <div className="mt-4 p-4 rounded-lg border border-red-500/30 bg-red-500/10">
                  <p className="text-red-400 text-sm">{updateResult.error}</p>
                  {updateResult.output && (
                    <pre className="text-xs text-[var(--muted)] bg-black/20 rounded p-2 mt-2 whitespace-pre-wrap font-mono">{updateResult.output}</pre>
                  )}
                </div>
              )}
            </div>
          )}

          {versionInfo && !versionInfo.canAutoUpdate && (
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
              <h3 className="font-semibold mb-2">Manual Update</h3>
              <p className="text-xs text-[var(--muted)] mb-3">
                Auto-update is not available. To enable it, add these volumes to your <code className="text-[var(--accent)]">docker-compose.yml</code> in the api service:
              </p>
              <pre className="text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 font-mono">
{`volumes:
  - .:/app/host-repo:rw
  - /var/run/docker.sock:/var/run/docker.sock`}
              </pre>
              <p className="text-xs text-[var(--muted)] mt-3">Or update manually:</p>
              <pre className="text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 font-mono mt-1">
{`cd /path/to/agems
git pull origin main
docker compose up -d --build`}
              </pre>
            </div>
          )}
        </div>
      )}

      {tab === 'n8n' && (
        <div className="space-y-4">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold">N8N Instance</h3>
                <p className="text-xs text-[var(--muted)]">Connect to your n8n automation platform</p>
              </div>
              <div className="flex items-center gap-2">
                {n8nConfig.keySet && (
                  <span className="text-xs text-[var(--muted)] font-mono">{n8nConfig.keyMasked}</span>
                )}
                <div className={`w-3 h-3 rounded-full ${n8nConfig.keySet ? 'bg-green-500' : 'bg-gray-400'}`} />
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">N8N API URL</label>
                <input value={n8nUrl}
                  onChange={(e) => setN8nUrl(e.target.value)}
                  placeholder="https://n8n.example.com"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-mono text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">API Key</label>
                <input type="password" value={n8nKey}
                  onChange={(e) => setN8nKey(e.target.value)}
                  placeholder={n8nConfig.keySet ? 'Enter new key to update...' : 'Your n8n API key'}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] font-mono text-sm" />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={async () => {
              setSavingN8n(true);
              try {
                const result = await api.setN8nSettings(n8nUrl, n8nKey || undefined);
                setN8nConfig(result);
                setN8nKey('');
                setN8nSaved(true);
                setTimeout(() => setN8nSaved(false), 2000);
              } finally { setSavingN8n(false); }
            }} disabled={savingN8n}
              className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
              {savingN8n ? 'Saving...' : 'Save'}
            </button>

            <button onClick={async () => {
              setTestingN8n(true);
              setN8nTest(null);
              try {
                const result = await api.testN8nConnection();
                setN8nTest(result);
              } catch (e: any) {
                setN8nTest({ ok: false, error: e.message });
              } finally { setTestingN8n(false); }
            }} disabled={testingN8n || !n8nConfig.keySet}
              className="px-6 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--hover)] disabled:opacity-50">
              {testingN8n ? 'Testing...' : 'Test Connection'}
            </button>

            {n8nSaved && <span className="text-green-500 text-sm">Saved!</span>}
          </div>

          {n8nTest && (
            <div className={`p-4 rounded-lg border ${n8nTest.ok ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
              {n8nTest.ok ? (
                <p className="text-green-400 text-sm">Connected successfully! Found {n8nTest.workflowCount} workflow(s).</p>
              ) : (
                <p className="text-red-400 text-sm">Connection failed: {n8nTest.error}</p>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
