'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import ChatPanel from '@/components/ChatPanel';

/**
 * Floating Gemma chat widget — available on all pages.
 * Finds the META agent (Gemma) and creates/reuses a direct channel.
 */
export default function GemmaWidget() {
  const [open, setOpen] = useState(false);
  const [gemmaId, setGemmaId] = useState<string | null>(null);
  const [gemmaName, setGemmaName] = useState('Gemma');
  const [gemmaAvatar, setGemmaAvatar] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [channelId, setChannelId] = useState<string | null>(null);
  const [unread, setUnread] = useState(false);

  // Find Gemma (META agent) on mount
  useEffect(() => {
    api.getAgents().then((agents: any) => {
      const arr = Array.isArray(agents) ? agents : agents?.data || [];
      const meta = arr.find((a: any) => a.type === 'META' && a.status === 'ACTIVE')
        || arr.find((a: any) => a.name?.toLowerCase().includes('gemma'));
      if (meta) {
        setGemmaId(meta.id);
        setGemmaName(meta.name || 'Gemma');
        setGemmaAvatar(meta.avatarUrl || null);
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

    // Restore open state from localStorage
    const saved = localStorage.getItem('gemma_widget_open');
    if (saved === 'true') setOpen(true);
  }, []);

  const toggle = () => {
    const newState = !open;
    setOpen(newState);
    localStorage.setItem('gemma_widget_open', String(newState));
    if (newState) setUnread(false);
  };

  if (!gemmaId) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={toggle}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-[var(--accent)] text-white shadow-lg hover:scale-105 transition-all flex items-center justify-center"
        title={`Chat with ${gemmaName}`}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
        ) : (
          <>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
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
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg)]">
            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-sm font-bold text-purple-300">
              {gemmaAvatar ? (
                <img src={gemmaAvatar} alt={gemmaName} className="w-8 h-8 rounded-full object-cover" />
              ) : (
                gemmaName[0]
              )}
            </div>
            <div className="flex-1">
              <div className="font-semibold text-sm">{gemmaName}</div>
              <div className="text-[10px] text-[var(--muted)]">System Director</div>
            </div>
            <button onClick={toggle} className="text-[var(--muted)] hover:text-white transition p-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>

          {/* Chat body */}
          <div className="flex-1 overflow-hidden">
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
                  <div className="text-3xl mb-3">&#128075;</div>
                  <p className="text-sm font-medium">Hi! I'm {gemmaName}</p>
                  <p className="text-xs mt-1">Your AGEMS System Director. Ask me anything about the platform, your agents, or get help.</p>
                </div>
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
