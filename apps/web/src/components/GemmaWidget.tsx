'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import ChatPanel from '@/components/ChatPanel';

/**
 * Floating Gemma chat widget — available on all pages.
 * Features: chat history list, new chat, fullscreen mode.
 */
export default function GemmaWidget() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [gemmaId, setGemmaId] = useState<string | null>(null);
  const [gemmaName, setGemmaName] = useState('Gemma');
  const [gemmaAvatar, setGemmaAvatar] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [channelId, setChannelId] = useState<string | null>(null);
  const [unread, setUnread] = useState(false);
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Find Gemma (META agent) and existing channel on mount
  useEffect(() => {
    api.getAgents().then(async (agents: any) => {
      const arr = Array.isArray(agents) ? agents : agents?.data || [];
      const meta = arr.find((a: any) => a.type === 'META' && a.status === 'ACTIVE')
        || arr.find((a: any) => a.name?.toLowerCase().includes('gemma'));
      if (meta) {
        setGemmaId(meta.id);
        setGemmaName(meta.name || 'Gemma');
        setGemmaAvatar(meta.avatar || null);

        // Try to find existing direct channel with Gemma
        try {
          const found = await api.findDirectChannel('AGENT', meta.id) as any;
          if (found?.id) setChannelId(found.id);
        } catch {}
      }
    }).catch(() => {});

    // Get current user ID from JWT token
    try {
      const token = localStorage.getItem('token');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUserId(payload.sub || payload.id || '');
      }
    } catch {}

    const saved = localStorage.getItem('gemma_widget_open');
    if (saved === 'true') setOpen(true);
  }, []);

  // Load chat history (all channels with Gemma)
  const loadHistory = useCallback(async () => {
    if (!gemmaId) return;
    setLoadingHistory(true);
    try {
      const channels = await api.getChannels() as any[];
      const gemmaChats = channels.filter((ch: any) =>
        ch.participants?.some((p: any) => p.participantType === 'AGENT' && p.participantId === gemmaId)
      ).sort((a: any, b: any) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
      setChatHistory(gemmaChats);
    } catch {}
    setLoadingHistory(false);
  }, [gemmaId]);

  const toggle = () => {
    const newState = !open;
    setOpen(newState);
    setView('chat');
    localStorage.setItem('gemma_widget_open', String(newState));
    if (newState) setUnread(false);
  };

  const openHistory = () => {
    setView('history');
    loadHistory();
  };

  const selectChat = (chId: string) => {
    setChannelId(chId);
    setView('chat');
  };

  const startNewChat = async () => {
    if (!gemmaId) return;
    try {
      const ch = await api.createChannel({
        type: 'DIRECT',
        targetType: 'AGENT',
        targetId: gemmaId,
      }) as any;
      if (ch?.id) {
        setChannelId(ch.id);
        setView('chat');
      }
    } catch {
      // If creation fails (already exists), just switch to chat view
      setView('chat');
    }
  };

  const openFullscreen = () => {
    if (channelId) {
      router.push(`/comms?channel=${channelId}`);
    } else {
      router.push('/comms');
    }
    setOpen(false);
    localStorage.setItem('gemma_widget_open', 'false');
  };

  const timeAgo = (date: string) => {
    const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  if (!gemmaId) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={toggle}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-[var(--accent)] text-white shadow-lg hover:scale-105 transition-all flex items-center justify-center overflow-hidden"
        title={`Chat with ${gemmaName}`}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
        ) : (
          <>
            {gemmaAvatar ? (
              <img src={gemmaAvatar} alt={gemmaName} className="w-14 h-14 rounded-full object-cover" />
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
            )}
            {unread && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] flex items-center justify-center animate-pulse">!</span>
            )}
          </>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-40 w-[380px] h-[520px] bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border)] bg-[var(--bg)]">
            <div className="w-7 h-7 rounded-full bg-purple-500/20 flex items-center justify-center text-xs font-bold text-purple-300 shrink-0">
              {gemmaAvatar ? (
                <img src={gemmaAvatar} alt={gemmaName} className="w-7 h-7 rounded-full object-cover" />
              ) : (
                gemmaName[0]
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm leading-tight">{gemmaName}</div>
              <div className="text-[10px] text-[var(--muted)]">System Director</div>
            </div>
            {/* Action buttons */}
            <div className="flex items-center gap-0.5">
              {/* New chat */}
              <button onClick={startNewChat} className="text-[var(--muted)] hover:text-white transition p-1.5 rounded hover:bg-[var(--hover)]" title="New chat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
              </button>
              {/* Chat history */}
              <button onClick={view === 'history' ? () => setView('chat') : openHistory} className={`text-[var(--muted)] hover:text-white transition p-1.5 rounded hover:bg-[var(--hover)] ${view === 'history' ? 'text-white bg-[var(--hover)]' : ''}`} title="Chat history">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="10" /></svg>
              </button>
              {/* Fullscreen */}
              <button onClick={openFullscreen} className="text-[var(--muted)] hover:text-white transition p-1.5 rounded hover:bg-[var(--hover)]" title="Open fullscreen">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
              </button>
              {/* Close */}
              <button onClick={toggle} className="text-[var(--muted)] hover:text-white transition p-1.5 rounded hover:bg-[var(--hover)]" title="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden">
            {view === 'history' ? (
              /* Chat history list */
              <div className="h-full overflow-auto">
                <div className="p-3">
                  <button
                    onClick={startNewChat}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--hover)] transition text-sm"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                    <span>Start new conversation</span>
                  </button>
                </div>
                {loadingHistory ? (
                  <div className="text-center text-[var(--muted)] text-xs py-8">Loading...</div>
                ) : chatHistory.length === 0 ? (
                  <div className="text-center text-[var(--muted)] text-xs py-8">No conversations yet</div>
                ) : (
                  <div className="px-3 space-y-1 pb-3">
                    {chatHistory.map((ch: any) => (
                      <button
                        key={ch.id}
                        onClick={() => selectChat(ch.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg hover:bg-[var(--hover)] transition ${channelId === ch.id ? 'bg-[var(--hover)] border border-[var(--accent)]/30' : ''}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium truncate">{ch.name || 'Chat with ' + gemmaName}</span>
                          <span className="text-[10px] text-[var(--muted)] shrink-0 ml-2">
                            {ch.updatedAt ? timeAgo(ch.updatedAt) : ch.createdAt ? timeAgo(ch.createdAt) : ''}
                          </span>
                        </div>
                        {ch.lastMessage && (
                          <p className="text-xs text-[var(--muted)] truncate mt-0.5">{ch.lastMessage}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Chat */
              <ChatPanel
                channelId={channelId || ''}
                currentUserId={userId}
                nameMap={(type, id) => {
                  if (type === 'AGENT' && id === gemmaId) return { name: gemmaName, avatar: gemmaAvatar };
                  return { name: 'You' };
                }}
                autoCreateChannel={{ targetType: 'AGENT', targetId: gemmaId }}
                onChannelCreated={(id) => setChannelId(id)}
                placeholder={`Message ${gemmaName}...`}
                height="100%"
                emptyState={
                  <div className="text-center text-[var(--muted)] py-12 px-4">
                    {gemmaAvatar ? (
                      <img src={gemmaAvatar} alt={gemmaName} className="w-16 h-16 rounded-full object-cover mx-auto mb-3" />
                    ) : (
                      <div className="text-3xl mb-3">&#128075;</div>
                    )}
                    <p className="text-sm font-medium">Hi! I'm {gemmaName}</p>
                    <p className="text-xs mt-1">Your AGEMS System Director. Ask me anything about the platform, your agents, or get help.</p>
                  </div>
                }
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
