'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function SettingsPage() {
  const [tab, setTab] = useState<'llm' | 'platform' | 'n8n' | 'modules' | 'prompts' | 'system'>('llm');

  // LLM Keys
  const [llmKeys, setLlmKeys] = useState<Record<string, { set: boolean; masked: string }>>({});
  const [newKeys, setNewKeys] = useState<Record<string, string>>({ openai: '', anthropic: '', google: '', deepseek: '', mistral: '', minimax: '', glm: '', xai: '', cohere: '', perplexity: '', together: '', fireworks: '', groq: '', moonshot: '', qwen: '', ai21: '', sambanova: '' });
  const [savingKeys, setSavingKeys] = useState(false);
  const [keysSaved, setKeysSaved] = useState(false);

  // Platform settings
  const [platformForm, setPlatformForm] = useState({
    platform_name: 'AGEMS Platform',
    default_llm_provider: 'OPENAI',
    default_model: 'gpt-4o',
    default_api_format: '',
    default_base_url: '',
    default_temperature: '0.7',
    default_max_tokens: '4096',
    max_concurrent_executions: '10',
    execution_timeout: '300',
  });
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [platformSaved, setPlatformSaved] = useState(false);

  // Module Settings
  type ModuleName = 'tasks' | 'comms' | 'meetings' | 'goals' | 'projects';
  interface ModuleConfig { enabled: boolean; activityLevel: number; autonomyLevel: number; }
  const defaultModules: Record<ModuleName, ModuleConfig> = {
    tasks: { enabled: true, activityLevel: 3, autonomyLevel: 3 },
    comms: { enabled: true, activityLevel: 3, autonomyLevel: 3 },
    meetings: { enabled: true, activityLevel: 3, autonomyLevel: 3 },
    goals: { enabled: true, activityLevel: 3, autonomyLevel: 3 },
    projects: { enabled: true, activityLevel: 3, autonomyLevel: 3 },
  };
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [crossChannelEnabled, setCrossChannelEnabled] = useState(false);
  const [crossChannelMessages, setCrossChannelMessages] = useState(10);
  const [modules, setModules] = useState<Record<ModuleName, ModuleConfig>>(defaultModules);
  const [savingModules, setSavingModules] = useState(false);
  const [modulesSaved, setModulesSaved] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(false);
  // Task advanced settings (kept via legacy endpoint)
  const [taskInterval, setTaskInterval] = useState(60);
  const [reviewInterval, setReviewInterval] = useState(300);
  const [reviewBudget, setReviewBudget] = useState(1.0);
  const [savingTaskAdvanced, setSavingTaskAdvanced] = useState(false);
  const [taskAdvancedSaved, setTaskAdvancedSaved] = useState(false);

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
        default_api_format: s.default_api_format || '',
        default_base_url: s.default_base_url || '',
        default_temperature: s.default_temperature || '0.7',
        default_max_tokens: s.default_max_tokens || '4096',
        max_concurrent_executions: s.max_concurrent_executions || '10',
        execution_timeout: s.execution_timeout || '300',
      });
    }).catch(() => {});
    api.getN8nSettings().then((c) => {
      setN8nConfig(c);
      setN8nUrl(c.url);
    }).catch(() => {});
    api.getModulesConfig().then((c) => {
      setGlobalEnabled(c.globalEnabled);
      if (c.crossChannel) {
        setCrossChannelEnabled(c.crossChannel.enabled);
        setCrossChannelMessages(c.crossChannel.messageCount);
      }
      setModules(c.modules as Record<ModuleName, ModuleConfig>);
    }).catch(() => {});
    api.getTaskAgentsConfig().then((c) => {
      setTaskInterval(c.interval);
      setReviewInterval(c.reviewInterval);
      setReviewBudget(c.reviewBudget);
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
      for (const [key, value] of Object.entries(newKeys)) {
        if (value) filtered[key] = value;
      }
      if (Object.keys(filtered).length === 0) return;
      const result = await api.setLlmKeys(filtered);
      setLlmKeys(result);
      setNewKeys(Object.fromEntries(Object.keys(newKeys).map(k => [k, ''])));
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
    { id: 'minimax', name: 'MiniMax', desc: 'MiniMax-M2.7', placeholder: 'eyJ...' },
    { id: 'glm', name: 'GLM', desc: 'GLM-5', placeholder: 'sk-...' },
    { id: 'xai', name: 'xAI', desc: 'Grok-3, Grok-3 Mini', placeholder: 'xai-...' },
    { id: 'cohere', name: 'Cohere', desc: 'Command R+, Command A', placeholder: 'co-...' },
    { id: 'perplexity', name: 'Perplexity', desc: 'Sonar Pro, Sonar', placeholder: 'pplx-...' },
    { id: 'together', name: 'Together AI', desc: 'Llama, Qwen, Mixtral', placeholder: 'sk-...' },
    { id: 'fireworks', name: 'Fireworks AI', desc: 'Llama, Mixtral, Qwen', placeholder: 'fw_...' },
    { id: 'groq', name: 'Groq', desc: 'Llama, Gemma, Mixtral', placeholder: 'gsk_...' },
    { id: 'moonshot', name: 'Moonshot / Kimi', desc: 'Kimi K2', placeholder: 'sk-...' },
    { id: 'qwen', name: 'Alibaba / Qwen', desc: 'Qwen3, Qwen-Max', placeholder: 'sk-...' },
    { id: 'ai21', name: 'AI21 Labs', desc: 'Jamba 2', placeholder: 'sk-...' },
    { id: 'sambanova', name: 'SambaNova', desc: 'Llama, DeepSeek (fast)', placeholder: 'sk-...' },
  ];

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold mb-1">Settings</h1>
      <p className="text-[var(--muted)] mb-6 text-sm">Platform configuration and API keys</p>

      <div className="flex gap-1 mb-6 bg-[var(--card)] p-1 rounded-lg border border-[var(--border)] w-fit overflow-x-auto max-w-full">
        {[
          { key: 'llm', label: 'LLM Keys' },
          { key: 'platform', label: 'Platform' },
          { key: 'modules', label: 'AI Modules' },
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
                  value={newKeys[p.id] || ''}
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
                  <option value="MINIMAX">MiniMax</option>
                  <option value="GLM">GLM</option>
                  <option value="XAI">xAI (Grok)</option>
                  <option value="COHERE">Cohere</option>
                  <option value="PERPLEXITY">Perplexity</option>
                  <option value="TOGETHER">Together AI</option>
                  <option value="FIREWORKS">Fireworks AI</option>
                  <option value="GROQ">Groq</option>
                  <option value="MOONSHOT">Moonshot / Kimi</option>
                  <option value="QWEN">Alibaba / Qwen</option>
                  <option value="AI21">AI21 Labs</option>
                  <option value="SAMBANOVA">SambaNova</option>
                  <option value="OLLAMA">Ollama</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Default Model</label>
                <input value={platformForm.default_model}
                  onChange={(e) => setPlatformForm({ ...platformForm, default_model: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Default API Format</label>
                  <select value={platformForm.default_api_format}
                    onChange={(e) => setPlatformForm({ ...platformForm, default_api_format: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                    <option value="">Auto (default)</option>
                    <option value="openai">OpenAI-compatible</option>
                    <option value="anthropic">Anthropic-compatible</option>
                    <option value="google">Google Gemini</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Default Base URL</label>
                  <input value={platformForm.default_base_url}
                    onChange={(e) => setPlatformForm({ ...platformForm, default_base_url: e.target.value })}
                    placeholder="Custom API endpoint (optional)"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Default Temperature</label>
                  <input type="number" step="0.1" min="0" max="2" value={platformForm.default_temperature}
                    onChange={(e) => setPlatformForm({ ...platformForm, default_temperature: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
                  <p className="text-xs text-[var(--muted)] mt-1">Creativity: 0 = precise, 1+ = creative</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Default Max Tokens</label>
                  <input type="number" min="256" max="200000" value={platformForm.default_max_tokens}
                    onChange={(e) => setPlatformForm({ ...platformForm, default_max_tokens: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]" />
                  <p className="text-xs text-[var(--muted)] mt-1">Max response length</p>
                </div>
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

      {tab === 'modules' && (() => {
        const moduleList: { key: ModuleName; label: string; icon: string; desc: string }[] = [
          { key: 'tasks', label: 'Tasks', icon: '\u2611\uFE0F', desc: 'Execute, review, and create tasks' },
          { key: 'comms', label: 'Comms', icon: '\uD83D\uDCAC', desc: 'Respond to messages in channels' },
          { key: 'meetings', label: 'Meetings', icon: '\uD83D\uDCC5', desc: 'Participate in meetings and vote' },
          { key: 'goals', label: 'Goals', icon: '\uD83C\uDFAF', desc: 'Track and advance goals' },
          { key: 'projects', label: 'Projects', icon: '\uD83D\uDCC1', desc: 'Manage project work' },
        ];
        const activityLabels: Record<number, string> = {
          1: 'Passive \u2014 Only when explicitly asked',
          2: 'Reactive \u2014 Responds to assigned work',
          3: 'Balanced \u2014 Picks up work + suggests',
          4: 'Proactive \u2014 Creates work, flags blockers',
          5: 'Aggressive \u2014 Full autonomous drive',
        };
        const autonomyLabels: Record<number, string> = {
          1: 'Solo \u2014 Work independently',
          2: 'Lean \u2014 Mostly independent',
          3: 'Balanced \u2014 Use judgment',
          4: 'Team-first \u2014 Delegate by default',
          5: 'Full team \u2014 Maximum collaboration',
        };
        const updateModule = (mod: ModuleName, patch: Partial<ModuleConfig>) => {
          setModules(prev => ({ ...prev, [mod]: { ...prev[mod], ...patch } }));
        };
        const handleSaveModules = async () => {
          setSavingModules(true);
          try {
            const res = await api.setModulesConfig({
              globalEnabled,
              crossChannel: { enabled: crossChannelEnabled, messageCount: crossChannelMessages },
              modules,
            });
            setGlobalEnabled(res.globalEnabled);
            if (res.crossChannel) {
              setCrossChannelEnabled(res.crossChannel.enabled);
              setCrossChannelMessages(res.crossChannel.messageCount);
            }
            setModules(res.modules as Record<ModuleName, ModuleConfig>);
            setModulesSaved(true);
            setTimeout(() => setModulesSaved(false), 2000);
          } finally { setSavingModules(false); }
        };
        const handleSaveTaskAdvanced = async () => {
          setSavingTaskAdvanced(true);
          try {
            const res = await api.setTaskAgentsConfig({ interval: taskInterval, reviewInterval, reviewBudget });
            setTaskInterval(res.interval);
            setReviewInterval(res.reviewInterval);
            setReviewBudget(res.reviewBudget);
            setTaskAdvancedSaved(true);
            setTimeout(() => setTaskAdvancedSaved(false), 2000);
          } finally { setSavingTaskAdvanced(false); }
        };

        return (
        <div className="space-y-4">
          {/* Global Master Switch */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold">AI Agent Execution</h3>
                <p className="text-xs text-[var(--muted)]">Master switch for all agent interactions across all modules</p>
              </div>
              <button
                onClick={async () => {
                  const next = !globalEnabled;
                  setGlobalEnabled(next);
                  try {
                    await api.setModulesConfig({ globalEnabled: next });
                  } catch {
                    setGlobalEnabled(!next);
                  }
                }}
                className={`relative w-14 h-7 rounded-full transition-colors duration-200 ${globalEnabled ? 'bg-emerald-500' : 'bg-gray-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform duration-200 ${globalEnabled ? 'translate-x-7' : 'translate-x-0'}`} />
              </button>
            </div>
            <div className={`p-3 rounded-lg border ${globalEnabled ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${globalEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                <span className={`text-sm font-medium ${globalEnabled ? 'text-emerald-400' : 'text-red-400'}`}>
                  {globalEnabled ? 'Agents are active across all enabled modules' : 'All agent interactions are paused'}
                </span>
              </div>
            </div>
          </div>

          {/* Cross-Channel Context */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold">Cross-Channel Context</h3>
                <p className="text-xs text-[var(--muted)]">Inject recent messages from agent's other channels into conversation context</p>
              </div>
              <button
                onClick={() => setCrossChannelEnabled(!crossChannelEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${crossChannelEnabled ? 'bg-emerald-500' : 'bg-gray-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform duration-200 ${crossChannelEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </div>
            {crossChannelEnabled && (
              <div className="flex items-center gap-3 mt-2">
                <label className="text-xs text-[var(--muted)]">Messages to include:</label>
                <input type="number" min={1} max={50} value={crossChannelMessages}
                  onChange={(e) => setCrossChannelMessages(parseInt(e.target.value) || 10)}
                  className="w-16 px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-xs text-center" />
                <span className="text-xs text-[var(--muted)]">from other channels</span>
              </div>
            )}
            <p className="text-[10px] text-[var(--muted)] mt-2">
              Conversation summaries are always saved to memory automatically, regardless of this setting.
            </p>
          </div>

          {/* Module Cards Grid */}
          <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${!globalEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
            {moduleList.map(({ key: mod, label, icon, desc }) => {
              const mc = modules[mod];
              return (
                <div key={mod} className={`bg-[var(--card)] border rounded-xl p-5 transition-all ${mc.enabled ? 'border-[var(--border)]' : 'border-[var(--border)] opacity-60'}`}>
                  {/* Header with toggle */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{icon}</span>
                      <div>
                        <h3 className="font-semibold">{label}</h3>
                        <p className="text-xs text-[var(--muted)]">{desc}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => updateModule(mod, { enabled: !mc.enabled })}
                      className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${mc.enabled ? 'bg-emerald-500' : 'bg-gray-600'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform duration-200 ${mc.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {/* Body - activity & autonomy levels */}
                  <div className={`space-y-4 ${!mc.enabled ? 'opacity-30 pointer-events-none' : ''}`}>
                    {/* Activity Level */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-[var(--muted)]">Activity Level</span>
                        <span className="text-xs text-[var(--muted)]">{mc.activityLevel}/5</span>
                      </div>
                      <div className="flex gap-1.5">
                        {[1, 2, 3, 4, 5].map(n => (
                          <button key={n} onClick={() => updateModule(mod, { activityLevel: n })}
                            className={`flex-1 h-7 rounded text-xs font-bold transition-all ${
                              mc.activityLevel === n
                                ? 'bg-[var(--accent)] text-white scale-105'
                                : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]'
                            }`}
                          >{n}</button>
                        ))}
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-[var(--muted)]">Passive</span>
                        <span className="text-[10px] text-[var(--muted)]">Aggressive</span>
                      </div>
                      <div className={`mt-2 p-2 rounded text-xs ${
                        mc.activityLevel <= 2 ? 'bg-blue-500/10 text-blue-300' : mc.activityLevel === 3 ? 'bg-yellow-500/10 text-yellow-300' : 'bg-orange-500/10 text-orange-300'
                      }`}>
                        {activityLabels[mc.activityLevel]}
                      </div>
                    </div>

                    {/* Autonomy Level */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-[var(--muted)]">Autonomy Level</span>
                        <span className="text-xs text-[var(--muted)]">{mc.autonomyLevel}/5</span>
                      </div>
                      <div className="flex gap-1.5">
                        {[1, 2, 3, 4, 5].map(n => (
                          <button key={n} onClick={() => updateModule(mod, { autonomyLevel: n })}
                            className={`flex-1 h-7 rounded text-xs font-bold transition-all ${
                              mc.autonomyLevel === n
                                ? 'bg-purple-500 text-white scale-105'
                                : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:border-purple-400'
                            }`}
                          >{n}</button>
                        ))}
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-[var(--muted)]">Solo</span>
                        <span className="text-[10px] text-[var(--muted)]">Full team</span>
                      </div>
                      <div className={`mt-2 p-2 rounded text-xs ${
                        mc.autonomyLevel <= 2 ? 'bg-blue-500/10 text-blue-300' : mc.autonomyLevel === 3 ? 'bg-yellow-500/10 text-yellow-300' : 'bg-purple-500/10 text-purple-300'
                      }`}>
                        {autonomyLabels[mc.autonomyLevel]}
                      </div>
                    </div>

                    {/* Tasks advanced settings (collapsible) */}
                    {mod === 'tasks' && (
                      <div className="border-t border-[var(--border)] pt-3 mt-3">
                        <button onClick={() => setTasksExpanded(!tasksExpanded)}
                          className="flex items-center gap-1 text-xs font-medium text-[var(--muted)] hover:text-white transition">
                          <span className={`transition-transform ${tasksExpanded ? 'rotate-90' : ''}`}>{'\u25B6'}</span>
                          Advanced Settings
                        </button>
                        {tasksExpanded && (
                          <div className="mt-3 space-y-3">
                            <div>
                              <label className="block text-xs font-medium mb-1">Scheduler Interval</label>
                              <div className="flex items-center gap-2">
                                <input type="number" min={10} max={3600} value={taskInterval}
                                  onChange={(e) => setTaskInterval(parseInt(e.target.value) || 60)}
                                  className="w-20 px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-xs" />
                                <span className="text-xs text-[var(--muted)]">sec</span>
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-medium mb-1">Review Interval</label>
                              <div className="flex items-center gap-2">
                                <input type="number" min={30} max={3600} value={reviewInterval}
                                  onChange={(e) => setReviewInterval(parseInt(e.target.value) || 300)}
                                  className="w-20 px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-xs" />
                                <span className="text-xs text-[var(--muted)]">sec</span>
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-medium mb-1">Daily Review Budget</label>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-[var(--muted)]">$</span>
                                <input type="number" min={0} max={100} step={0.1} value={reviewBudget}
                                  onChange={(e) => setReviewBudget(parseFloat(e.target.value) || 1.0)}
                                  className="w-20 px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-xs" />
                                <span className="text-xs text-[var(--muted)]">/day (0 = no limit)</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={handleSaveTaskAdvanced} disabled={savingTaskAdvanced}
                                className="px-4 py-1.5 bg-[var(--accent)] text-white rounded text-xs hover:opacity-90 disabled:opacity-50">
                                {savingTaskAdvanced ? 'Saving...' : 'Save Advanced'}
                              </button>
                              {taskAdvancedSaved && <span className="text-green-500 text-xs">Saved!</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Save All Button */}
          <div className="flex items-center gap-3">
            <button onClick={handleSaveModules} disabled={savingModules}
              className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
              {savingModules ? 'Saving...' : 'Save All Module Settings'}
            </button>
            {modulesSaved && <span className="text-green-500 text-sm">All module settings saved!</span>}
          </div>
        </div>
        );
      })()}

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
                Auto-update is intentionally disabled for security. If you need repository access inside the API container, use read-only mount:
              </p>
              <pre className="text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 font-mono">
{`volumes:
  - .:/app/host-repo:ro`}
              </pre>
              <p className="text-xs text-[var(--muted)] mt-3">Update manually:</p>
              <pre className="text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 font-mono mt-1">
{`cd /path/to/agems
git pull origin main
docker compose pull && docker compose up -d`}
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
