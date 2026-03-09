'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

interface TelegramSectionProps {
  agent: any;
  onAgentUpdated: () => void;
}

export default function TelegramSection({ agent, onAgentUpdated }: TelegramSectionProps) {
  const tgConfig = (agent.telegramConfig || {}) as any;

  // Bot status
  const [botStatus, setBotStatus] = useState<any>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  // Config form
  const [botToken, setBotToken] = useState(tgConfig.botToken || '');
  const [botEnabled, setBotEnabled] = useState(tgConfig.botEnabled ?? true);
  const [accessMode, setAccessMode] = useState(tgConfig.accessMode || 'OPEN');
  const [allowedChatIds, setAllowedChatIds] = useState<string>(
    (tgConfig.allowedChatIds || []).join(', '),
  );
  const [voiceEnabled, setVoiceEnabled] = useState(tgConfig.voiceEnabled ?? false);
  const [ttsVoice, setTtsVoice] = useState(tgConfig.ttsVoice || 'Kore');

  // Account (MTProto)
  const [apiId, setApiId] = useState(tgConfig.apiId?.toString() || '');
  const [apiHash, setApiHash] = useState(tgConfig.apiHash || '');
  const [sessionString, setSessionString] = useState(tgConfig.sessionString || '');

  // UI state
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [testResult, setTestResult] = useState('');
  const [testing, setTesting] = useState(false);

  // Chats
  const [chats, setChats] = useState<any[]>([]);

  const loadBotStatus = useCallback(async () => {
    try {
      const s = await api.getTelegramBotStatus(agent.id);
      setBotStatus(s);
    } catch {
      setBotStatus(null);
    }
  }, [agent.id]);

  const loadChats = useCallback(async () => {
    try {
      const c = await api.getTelegramChats(agent.id);
      setChats(Array.isArray(c) ? c : []);
    } catch {
      setChats([]);
    }
  }, [agent.id]);

  useEffect(() => {
    loadBotStatus();
    loadChats();
  }, [loadBotStatus, loadChats]);

  // Sync config from agent prop when it changes
  useEffect(() => {
    const cfg = (agent.telegramConfig || {}) as any;
    setBotToken(cfg.botToken || '');
    setBotEnabled(cfg.botEnabled ?? true);
    setAccessMode(cfg.accessMode || 'OPEN');
    setAllowedChatIds((cfg.allowedChatIds || []).join(', '));
    setVoiceEnabled(cfg.voiceEnabled ?? false);
    setTtsVoice(cfg.ttsVoice || 'Kore');
    setApiId(cfg.apiId?.toString() || '');
    setApiHash(cfg.apiHash || '');
    setSessionString(cfg.sessionString || '');
  }, [agent.telegramConfig]);

  const handleTestToken = async () => {
    if (!botToken.trim()) return;
    setTesting(true);
    setTestResult('');
    try {
      const r = await api.testTelegramToken(botToken.trim());
      setTestResult(`Bot: @${r.username} (${r.firstName})`);
    } catch (err: any) {
      setTestResult(`Error: ${err.message}`);
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const parsedChatIds = allowedChatIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => !isNaN(n));

      await api.updateAgent(agent.id, {
        telegramConfig: {
          botToken: botToken.trim() || undefined,
          botEnabled,
          accessMode,
          allowedChatIds: parsedChatIds.length > 0 ? parsedChatIds : undefined,
          voiceEnabled,
          ttsVoice: ttsVoice || undefined,
          apiId: apiId ? parseInt(apiId) : undefined,
          apiHash: apiHash.trim() || undefined,
          sessionString: sessionString.trim() || undefined,
        },
      });
      setSaveMsg('Saved');
      onAgentUpdated();
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (err: any) {
      setSaveMsg(`Error: ${err.message}`);
    }
    setSaving(false);
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      await api.startTelegramBot(agent.id);
      await loadBotStatus();
    } catch { /* noop */ }
    setStarting(false);
  };

  const handleStop = async () => {
    setStopping(true);
    try {
      await api.stopTelegramBot(agent.id);
      await loadBotStatus();
    } catch { /* noop */ }
    setStopping(false);
  };

  const handleApprove = async (chatId: string) => {
    await api.approveTelegramChat(chatId);
    loadChats();
  };

  const handleReject = async (chatId: string) => {
    await api.rejectTelegramChat(chatId);
    loadChats();
  };

  const isRunning = botStatus?.running === true;

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 md:col-span-2">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm text-[var(--muted)] uppercase tracking-wider">Telegram</h3>
        <div className="flex items-center gap-2">
          {isRunning ? (
            <>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Running
              </span>
              <button
                onClick={handleStop}
                disabled={stopping}
                className="px-3 py-1 text-xs bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 disabled:opacity-40"
              >
                {stopping ? 'Stopping...' : 'Stop'}
              </button>
            </>
          ) : (
            <>
              <span className="text-xs text-[var(--muted)]">Stopped</span>
              <button
                onClick={handleStart}
                disabled={starting || !tgConfig.botToken}
                className="px-3 py-1 text-xs bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 disabled:opacity-40"
              >
                {starting ? 'Starting...' : 'Start'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* Bot Token */}
        <div>
          <label className="block text-sm font-medium mb-1">Bot Token</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456:ABC-DEF..."
              className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm"
            />
            <button
              onClick={handleTestToken}
              disabled={testing || !botToken.trim()}
              className="px-3 py-2 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--card-hover)] disabled:opacity-40"
            >
              {testing ? '...' : 'Test'}
            </button>
          </div>
          {testResult && (
            <p className={`text-xs mt-1 ${testResult.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
              {testResult}
            </p>
          )}
        </div>

        {/* Access Mode */}
        <div>
          <label className="block text-sm font-medium mb-1">Access Mode</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="accessMode"
                checked={accessMode === 'OPEN'}
                onChange={() => setAccessMode('OPEN')}
                className="accent-[var(--accent)]"
              />
              Open
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="accessMode"
                checked={accessMode === 'WHITELIST'}
                onChange={() => setAccessMode('WHITELIST')}
                className="accent-[var(--accent)]"
              />
              Whitelist
            </label>
          </div>
        </div>

        {/* Allowed Chat IDs (shown when WHITELIST) */}
        {accessMode === 'WHITELIST' && (
          <div>
            <label className="block text-sm font-medium mb-1">Allowed Chat IDs</label>
            <input
              value={allowedChatIds}
              onChange={(e) => setAllowedChatIds(e.target.value)}
              placeholder="936873508, 123456789"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm"
            />
            <p className="text-xs text-[var(--muted)] mt-1">Comma-separated Telegram chat IDs</p>
          </div>
        )}

        {/* Voice */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(e) => setVoiceEnabled(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Voice Responses
          </label>
          {voiceEnabled && (
            <select
              value={ttsVoice}
              onChange={(e) => setTtsVoice(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm"
            >
              {['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          )}
        </div>

        {/* Connected Chats */}
        {chats.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">Connected Chats ({chats.length})</p>
            <div className="space-y-1">
              {chats.map((chat: any) => (
                <div key={chat.id} className="flex items-center gap-3 p-2 bg-[var(--background)] rounded-lg border border-[var(--border)] text-sm">
                  <span className="flex-1 truncate">
                    {chat.firstName || chat.username || 'Unknown'}{' '}
                    <span className="text-[var(--muted)]">({chat.telegramChatId?.toString()})</span>
                  </span>
                  {chat.isApproved ? (
                    <span className="text-xs text-emerald-400">Approved</span>
                  ) : (
                    <div className="flex gap-1">
                      <span className="text-xs text-yellow-400 mr-1">Pending</span>
                      <button
                        onClick={() => handleApprove(chat.id)}
                        className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(chat.id)}
                        className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Account Control (MTProto) */}
        <details className="border border-[var(--border)] rounded-lg">
          <summary className="px-4 py-2 text-sm text-[var(--muted)] cursor-pointer hover:text-white transition-colors">
            Account Control (MTProto)
          </summary>
          <div className="px-4 pb-4 space-y-3 pt-2">
            <div>
              <label className="block text-xs font-medium mb-1 text-[var(--muted)]">API ID</label>
              <input
                value={apiId}
                onChange={(e) => setApiId(e.target.value)}
                placeholder="12345678"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-[var(--muted)]">API Hash</label>
              <input
                type="password"
                value={apiHash}
                onChange={(e) => setApiHash(e.target.value)}
                placeholder="0123456789abcdef..."
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-[var(--muted)]">Session String</label>
              <textarea
                value={sessionString}
                onChange={(e) => setSessionString(e.target.value)}
                placeholder="GramJS session string..."
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm font-mono resize-y"
              />
            </div>
            <p className="text-xs text-[var(--muted)]">
              Allows the agent to send messages from a Telegram user account (like Telethon).
            </p>
          </div>
        </details>

        {/* Save */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Saving...' : 'Save Telegram Config'}
          </button>
          {saveMsg && (
            <span className={`text-sm ${saveMsg.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
              {saveMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
